// traffic.js — 障碍车对象池 + 变道 AI（§10.2）+ 碰撞事件（撞击计数判定在 main，§10.3）
import { CFG } from './config.js';
import { wrapDelta, wrapZ, segIndexAt, getTrack } from './road.js';

const TYPES = {
  sedan: { key: 'sedan', w: 1.84, halfL: 2.1, vMin: 24, vMax: 31, weight: 0.6 },
  truck: { key: 'truck', w: 2.45, halfL: 4.4, vMin: 19, vMax: 24, weight: 0.25 },
  bus:   { key: 'bus',   w: 2.45, halfL: 5.0, vMin: 21, vMax: 26, weight: 0.15 },
};

function pickType(r) {
  if (r < TYPES.sedan.weight) return TYPES.sedan;
  if (r < TYPES.sedan.weight + TYPES.truck.weight) return TYPES.truck;
  return TYPES.bus;
}

export class Traffic {
  constructor() {
    this.cars = [];
    this.bySeg = new Map();
    this.spawnT = 0;
  }

  reset(playerZabs) {
    this.cars.length = 0;
    for (let i = 0; i < 8; i++) this.trySpawn(playerZabs + 120 + Math.random() * 650, true);
  }

  targetCount(distM) {
    if (distM < 1000) return CFG.teachDensity;
    return Math.min(CFG.trafficMax, CFG.trafficBase + Math.floor(distM / 2000));
  }

  trySpawn(zAbs, force = false) {
    const track = getTrack();
    if (track.curveWindowAt(wrapZ(zAbs))) return false;      // 弯道禁行窗内不生成（§10.4）
    const info = track.roadInfoAt(zAbs);
    const free = [];
    for (let lane = 0; lane < info.lanes; lane++) {
      if (!this.cars.some(c => c.lane === lane && Math.abs(wrapDelta(c.z - zAbs)) < 45)) free.push(lane);
    }
    if (free.length <= 1 && !force) return false;
    const lane = free.length ? free[(Math.random() * free.length) | 0] : (Math.random() * info.lanes) | 0;
    const t = pickType(Math.random());
    this.cars.push({
      type: t, lane, z: zAbs,
      x: track.laneCenterAt(zAbs, lane),
      speed: t.vMin + Math.random() * (t.vMax - t.vMin),
      prevDz: 1, scrapeCd: 0,
      // —— §10.2 变道 AI ——
      canChange: Math.random() < 0.35,   // 生成时 35% 成为可变道车
      changed: false,                     // 一生一次
      changeCd: 0, changeState: null,     // null | 'signal' | 'moving'
      changeFrom: 0, changeTo: 0, changeT: 0, signalT: 0, targetLane: 0, blinkSide: 0,
    });
    return true;
  }

  // 返回事件数组：{type:'overtake'|'scrape'|'hit', ...}
  update(dt, player, playerZabs, distM, events) {
    const track = getTrack();
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.cars.length < this.targetCount(distM)) {
      this.trySpawn(playerZabs + 150 + Math.random() * 600);
      this.spawnT = 0.4;
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];

      // 跟车：同车道前车太近则匹配速度
      for (const o of this.cars) {
        if (o !== c && o.lane === c.lane && !o.changeState) {
          const d = wrapDelta(o.z - c.z);
          if (d > 0 && d < 28) { c.speed = Math.min(c.speed, o.speed); break; }
        }
      }
      c.z = wrapZ(c.z + c.speed * dt);
      c.scrapeCd = Math.max(0, c.scrapeCd - dt);
      c.changeCd = Math.max(0, c.changeCd - dt);

      // 驶入弯道禁行窗 → 静默移除（待转区/转向区无障碍车）
      if (track.curveWindowAt(c.z)) { this.cars.splice(i, 1); continue; }

      // —— §10.2 变道决策：资格 + 玩家 150–400m 区间随机时刻 + 一生一次 ——
      if (c.canChange && !c.changed && !c.changeState && c.changeCd <= 0) {
        const dz = wrapDelta(c.z - playerZabs);
        if (dz > 150 && dz < 400 && Math.random() < dt * 0.25) {
          let dir = Math.random() < 0.5 ? -1 : 1;
          if (c.lane === 0) dir = 1;                        // 边界只向内（杜绝撞围栏）
          if (c.lane === CFG.lanes - 1) dir = -1;
          const target = c.lane + dir;
          const blocked = this.cars.some(o => o !== c &&
            (o.lane === target || (o.changeState && o.targetLane === target)) &&
            Math.abs(wrapDelta(o.z - c.z)) < 30);           // 避让：目标车道 ±30m 有车则放弃
          if (blocked) {
            c.changeCd = 2.0;
          } else {
            c.changeState = 'signal'; c.signalT = 0.5;      // 转向灯预告 0.5s（闪 3 次）
            c.changeFrom = c.x;
            c.changeTo = (target - (CFG.lanes - 1) / 2) * CFG.laneWidth;
            c.targetLane = target; c.blinkSide = dir;
          }
        }
      }
      if (c.changeState === 'signal') {
        c.signalT -= dt;
        if (c.signalT <= 0) { c.changeState = 'moving'; c.changeT = 0; }
      } else if (c.changeState === 'moving') {
        c.changeT += dt / CFG.laneShift;                    // 与主车同参数 160ms
        const k = Math.min(1, c.changeT);
        const e = k * k * (3 - 2 * k);                      // smoothstep
        c.x = c.changeFrom + (c.changeTo - c.changeFrom) * e;
        if (k >= 1) {
          c.lane = c.targetLane; c.changed = true;
          c.changeState = null; c.x = c.changeTo;
        }
      }

      const dz = wrapDelta(c.z - playerZabs);
      const zrel = dz;

      // —— 碰撞（先于回收！否则追尾判定窗 [2, 2.31] 会被高速帧跨过而漏判）——
      if (Math.abs(zrel) < (CFG.carL / 2 + c.type.halfL) * 0.82) {
        const overlap = 1 - Math.abs(player.x - c.x) / ((CFG.carW + c.type.w) / 2);
        if (overlap > 0.30) {
          const headOn = overlap >= 0.55 && Math.abs(zrel) < (CFG.carL / 2 + c.type.halfL) * 0.55;
          if (headOn) {
            if (player.invuln <= 0) {
              events.push({ type: 'hit', car: c, grace: distM <= CFG.graceDist });
            }
          } else if (c.scrapeCd <= 0 && player.invuln <= 0) {
            c.scrapeCd = 1.0;
            events.push({ type: 'scrape', car: c, side: Math.sign(player.x - c.x) || 1, overlap });
          }
        }
      }

      // 回收：远离前方或已被甩身后（超车判定在回收前先记）
      if (zrel > 820 || zrel < 2) {
        if (c.prevDz > 0 && zrel <= 2) {
          // 贴身 = 横向差<2m 且相对速度>36km/h（车道间距 3.7m 下的风险回报定义）
          const gap = Math.abs(player.x - c.x) - (CFG.carW / 2 + c.type.w / 2);
          const rel = player.speed - c.speed;
          events.push({ type: 'overtake', close: gap < 2.0 && rel > 10, car: c });
        }
        this.cars.splice(i, 1);
        continue;
      }
      c.prevDz = zrel;
    }

    // 渲染用：段索引 → 车列表
    this.bySeg.clear();
    for (const c of this.cars) {
      const si = segIndexAt(c.z);
      let arr = this.bySeg.get(si);
      if (!arr) { arr = []; this.bySeg.set(si, arr); }
      arr.push(c);
    }
  }
}
