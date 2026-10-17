// traffic.js — 障碍车对象池 + 变道 AI（§10.2）+ 碰撞事件（撞击计数判定在 main，§10.3）
// 2026-10-07 修复「跑到车道之外」：变道边界与目标坐标一律用所在路段实际车道几何
// （info.lanes / laneCenterAt），不再用全局常量 CFG.lanes / CFG.laneWidth；
// 跨路段车道数变化时按比例重映射车道索引；每帧由 laneCenterAt 重导 x（自愈漂移）。
import { CFG, clamp } from './config.js';
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
    // 只装环岛车的段索引表：渲染层要在「主线 alpha=0 → 跳过整段」之前知道
    // 这段有没有环岛车，否则绕岛时环岛车连收集都不会发生（不是画黑，是根本没进 items）。
    this.ringBySeg = new Map();
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

  // —— v5.4 环岛车流 ——
  // 环岛车不是「主线车开进环岛」，而是**出生就在环道上的一批车**：环岛的存在意义就是
  // 「你要往里挤，跟着车流绕一圈」，没有车流的环岛只是一条双车道弯道。
  // 它们横向位置相对「环道中线」(rampInfoAt.off) 而不是主线中线，不参与主线车流 AI
  // （不变道、不在待转区淡出），驶出环道汇回主线后才脱环交还给普通逻辑。
  ringCarsFor(j) { return this.cars.filter(c => c.ringJ === j); }

  // 维持环岛上的车数：接近 / 行驶在环岛影响范围内时补车
  maintainRing(playerZabs) {
    const track = getTrack();
    for (const j of track.junctions) {
      if (!j.ring) continue;
      // 窗口 = 待转区前 ringTrafficLead m ~ 驶出环岛后 ringTrafficTail m。
      // 收尾必须按「驶出环岛」算而不是按待转区：整条环道弯出+绕岛+弯回有 700m，
      // 按待转区收尾会在玩家进环岛前很久就停止补车，环上只剩一条被远远甩开的空路。
      const dIn = wrapDelta(j.waitZ - playerZabs);
      const dOut = wrapDelta(playerZabs - j.mergeZ);
      if (dIn > CFG.ringTrafficLead || dOut > CFG.ringTrafficTail) continue;
      const mine = this.ringCarsFor(j);
      if (mine.length >= CFG.ringTrafficCount) continue;
      const r = j.ramps[0];                                // 取任一条：两环道的 hold 段位置相同
      const holdZ0 = j.forkZ + r.holdStart * CFG.segLen;
      const holdZ1 = j.forkZ + r.holdEnd * CFG.segLen;
      // 车位按「相对玩家的前距」排，而不是按绕岛段的绝对位置铺满：
      // 玩家是全速冲进来的（进环岛段前 220km/h），绝对位置铺的车在他开到绕岛段之前
      // 就被全部追过回收了，等真正进环岛只剩一条空路——车流得跟着玩家往前滚。
      //
      // 车位表 [环道方向, 车道, 前距]：每条环道先放**内圈**车（限速低），外圈车放在它后面——
      // 外圈车限速高，几秒内就会追上内圈车排队。于是「外圈 150」这条卖点经常兑现不了：
      // 想抢时间就得盯着队尾空档并随时变道（绕岛段是可变道的），这就是让行有牙齿的地方。
      const slots = CFG.ringTrafficSlots;
      for (let k = 0; k < slots.length; k++) {
        if (this.ringCarsFor(j).length >= CFG.ringTrafficCount) break;
        const [dir, lane, lead] = slots[k];
        const z = Math.min(holdZ1, Math.max(holdZ0, wrapZ(playerZabs + lead)));
        if (wrapDelta(z - playerZabs) < 40) continue;       // 车位已落到玩家身后（环岛快走完了）
        if (mine.some(c => Math.abs(wrapDelta(c.z - z)) < 40)) continue;   // 避免补车叠在现有车上
        this.spawnRingCar(j, z, dir, lane);
      }
    }
  }

  spawnRingCar(j, zAbs, dir, lane) {
    const track = getTrack();
    const ri = track.rampInfoAt(zAbs, dir);
    if (!ri || ri.lanes < 2) return false;
    if (lane >= ri.lanes) lane = ri.lanes - 1;
    const laneOff = (lane - (ri.lanes - 1) / 2) * CFG.laneWidth;
    const inner = Math.sign(ri.off) * laneOff < 0;         // 与环岛同侧（岛在匝道偏移的反方向）
    // 内圈车按内圈限速跑、外圈车按外圈限速跑——玩家一眼就能从车速差读出「哪边快」
    const cap = (inner ? CFG.ringInnerCap : CFG.ringOuterCap) * (0.9 + Math.random() * 0.06);
    const t = pickType(Math.random());
    this.cars.push({
      type: t, lane, z: zAbs,
      x: ri.off + laneOff,
      speed: cap,
      prevDz: 1, scrapeCd: 0, lastLanes: ri.lanes,
      ringJ: j, ringDir: dir, ringCap: cap,
      canChange: false, changed: true,                     // 环岛车不变道（双车道里换道等于乱切）
      changeCd: 0, changeState: null,
      fromLane: 0, toLane: 0, changeT: 0, signalT: 0, blinkSide: 0,
    });
    return true;
  }

  // 前方 ringYieldRange m 内最近的**同车道同环道**环岛车 → {c, d}（要它的速度算让行目标，也要距离做 HUD）。
  // 只认同车道：环岛绕岛段是双车道，玩家选了空车道就是「这次不用让」——
  // 让行与内/外圈的选择绑在一起，这条取舍才有代价（跟着别人的车过环岛 vs 抢空车道自己跑）。
  ringCarAhead(playerZabs, dir, lane) {
    if (!dir) return null;
    let best = null, bestD = Infinity;
    for (const c of this.cars) {
      if (c.ringDir !== dir || c.lane !== lane) continue;
      const d = wrapDelta(c.z - playerZabs);
      if (d > 0 && d < CFG.ringYieldRange && d < bestD) { best = c; bestD = d; }
    }
    return best ? { c: best, d: bestD } : null;
  }

  trySpawn(zAbs, force = false) {
    const track = getTrack();
    if (track.junctionRemovalAt(wrapZ(zAbs))) return false;   // 待转区/分叉口不生成
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
      prevDz: 1, scrapeCd: 0, lastLanes: info.lanes,
      // —— §10.2 变道 AI ——
      canChange: Math.random() < 0.35,   // 生成时 35% 成为可变道车
      changed: false,                     // 一生一次
      changeCd: 0, changeState: null,     // null | 'signal' | 'moving'
      fromLane: 0, toLane: 0, changeT: 0, signalT: 0, blinkSide: 0,
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
    this.maintainRing(playerZabs);

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];

      // —— v5.4 环岛车：每帧重导横向位置（相对环道中线）+ 按内/外圈限速巡航 ——
      // 加速比减速慢（0.8 vs 3.0），于是跟车减速后会缓慢重新提速，读起来是走走停停的车流而不是滑块。
      if (c.ringDir) {
        const ri = track.rampInfoAt(c.z, c.ringDir);
        if (ri && ri.lanes >= 2) {
          c.x = ri.off + (c.lane - (ri.lanes - 1) / 2) * CFG.laneWidth;
          c.lastLanes = ri.lanes;
          const k = c.speed > c.ringCap ? Math.min(1, dt * 3) : Math.min(1, dt * 0.8);
          c.speed += (c.ringCap - c.speed) * k;
        } else {
          c.ringDir = 0; c.ringJ = null;                    // 驶出环道：脱环，交还主线逻辑（下面的 x 重导接管）
        }
      }

      // 跟车：同车道前车太近则匹配速度（环岛车只在环岛车内互相跟——主线同号车道的车与它并不在同一路上）
      for (const o of this.cars) {
        if (o !== c && o.lane === c.lane && !o.changeState && (o.ringDir || 0) === (c.ringDir || 0)) {
          const d = wrapDelta(o.z - c.z);
          if (d > 0 && d < 28) { c.speed = Math.min(c.speed, o.speed); break; }
        }
      }
      c.z = wrapZ(c.z + c.speed * dt);
      c.scrapeCd = Math.max(0, c.scrapeCd - dt);
      c.changeCd = Math.max(0, c.changeCd - dt);

      // 路段车道数变化 → 按比例重映射车道索引（杜绝旧索引指向不存在的车道）
      const info = track.roadInfoAt(c.z);
      if (!c.ringDir && info.lanes !== c.lastLanes) {
        c.lane = clamp(Math.round((c.lane * (info.lanes - 1)) / Math.max(1, c.lastLanes - 1)), 0, info.lanes - 1);
        c.lastLanes = info.lanes;
        if (c.changeState === 'moving') { c.changeState = null; }
      }

      // 驶入待转区/分叉口：转向车道的车淡出移除，直行车道的车继续直行通过
      // 环岛车例外：它本来就在环道上，靠这个判据会在环岛入口整批淡出，环岛又变回空路
      const jw = track.junctionRemovalAt(c.z);
      if (jw && !c.ringDir && c.dying == null && track.exitForLane(jw.j, c.lane).dir !== 0) c.dying = 0.7;
      if (c.dying != null) {
        c.dying -= dt;
        if (c.dying <= 0) { this.cars.splice(i, 1); continue; }
      }

      // —— §10.2 变道决策：资格 + 玩家 150–400m 区间随机时刻 + 一生一次 ——
      if (c.canChange && !c.changed && !c.changeState && c.changeCd <= 0) {
        const dz = wrapDelta(c.z - playerZabs);
        if (dz > 150 && dz < 400 && Math.random() < dt * 0.25) {
          let dir = Math.random() < 0.5 ? -1 : 1;
          if (c.lane === 0) dir = 1;                        // 边界只向内（杜绝撞围栏）
          if (c.lane === info.lanes - 1) dir = -1;          // 用实际车道数判界（修复出车道 bug）
          const target = clamp(c.lane + dir, 0, info.lanes - 1);
          if (target === c.lane) {
            c.changeCd = 2.0;
          } else {
            const blocked = this.cars.some(o => o !== c &&
              (o.lane === target || (o.changeState && o.toLane === target)) &&
              Math.abs(wrapDelta(o.z - c.z)) < 30);         // 避让：目标车道 ±30m 有车则放弃
            if (blocked) {
              c.changeCd = 2.0;
            } else {
              c.changeState = 'signal'; c.signalT = 0.5;    // 转向灯预告 0.5s（闪 3 次）
              c.fromLane = c.lane; c.toLane = target; c.blinkSide = dir;
            }
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
        // 目标坐标实时取所在路段车道几何（修复固定 laneWidth 导致的偏出）
        c.x = track.laneCenterAt(c.z, c.fromLane) * (1 - e) + track.laneCenterAt(c.z, c.toLane) * e;
        if (k >= 1) {
          c.lane = c.toLane; c.changed = true;
          c.changeState = null; c.x = track.laneCenterAt(c.z, c.lane);
        }
      } else if (!c.ringDir) {
        c.x = track.laneCenterAt(c.z, c.lane);              // 每帧重导（自愈任何漂移）
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

    // 渲染用：段索引 → 车列表（另出一份只含环岛车的，供水位判定用）
    this.bySeg.clear();
    this.ringBySeg.clear();
    for (const c of this.cars) {
      const si = segIndexAt(c.z);
      let arr = this.bySeg.get(si);
      if (!arr) { arr = []; this.bySeg.set(si, arr); }
      arr.push(c);
      if (c.ringDir) {
        let ra = this.ringBySeg.get(si);
        if (!ra) { ra = []; this.ringBySeg.set(si, ra); }
        ra.push(c);
      }
    }
  }
}
