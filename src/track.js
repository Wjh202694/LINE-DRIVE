// track.js — 路段系统（§5/M3 + §10.4 修订：路口车道选向）
// 5 类直路段 + 3 类路口路段随机串接；过渡混合 200m；难度曲线随里程。
// 路口（§10.4 修订版）：待转区内「变道选向」——每个出口对应专用车道
// （右转=最右道，直行=中间/左边道…），车道定位即选定路线，弯道动态写入；
// 过了待转区车道锁定；单出口路口任意车道直接转弯，无需选择。
import { CFG, clamp } from './config.js';

export const SECTION_DEFS = {
  city:   { name: '城市街道', lanes: 3, half: 6.35, rails: true,  lamps: true,  buildings: true,  bg: 'city' },
  highway:{ name: '高速公路', lanes: 4, half: 7.6,  rails: true,  lamps: true,  buildings: false, bg: 'city' },
  scurve: { name: 'S 弯山道', lanes: 2, half: 5.4,  rails: true,  lamps: false, buildings: false, bg: 'mountain', bends: 2 },
  desert: { name: '沙漠公路', lanes: 3, half: 7.0,  rails: false, lamps: false, buildings: false, bg: 'desert', cacti: true },
  jLS:    { name: '路口 · 左转/直行', lanes: 3, half: 6.35, rails: true, lamps: true,  buildings: true,  bg: 'city',
            junction: [ { dir: -1, label: '左转' }, { dir: 0, label: '直行' } ] },
  jRS:    { name: '路口 · 直行/右转', lanes: 3, half: 6.35, rails: true, lamps: true,  buildings: true,  bg: 'city',
            junction: [ { dir: 0, label: '直行' }, { dir: 1, label: '右转' } ] },
  jLSR:   { name: '路口 · 左转/直行/右转', lanes: 4, half: 7.6, rails: true, lamps: true, buildings: false, bg: 'city',
            junction: [ { dir: -1, label: '左转' }, { dir: 0, label: '直行' }, { dir: 1, label: '右转' } ] },
};

// 出口→车道分配（§10.4 修订）：右转=最右车道、左转=最左车道、直行=剩余车道；
// 多出口从两端向中间分配，无出口认领的车道并入最接近方向的出口
function assignExitLanes(exits, lanes) {
  const sorted = exits.slice().sort((a, b) => a.dir - b.dir);
  sorted.forEach(e => { e.lanes = []; });
  let left = 0, right = lanes - 1;
  const lefts = sorted.filter(e => e.dir < 0);
  const rights = sorted.filter(e => e.dir > 0).reverse();   // 最右转向先占最右道
  const mids = sorted.filter(e => e.dir === 0);
  for (const e of lefts) { if (left <= right) e.lanes.push(left++); }
  for (const e of rights) { if (left <= right) e.lanes.push(right--); }
  for (const e of mids) { while (left <= right) e.lanes.push(left++); }
  // 兜底：未分到车道的出口并入方向最接近的已分配出口
  for (const e of sorted) {
    if (e.lanes.length === 0) {
      const near = sorted.filter(o => o !== e && o.lanes.length)
        .sort((a, b) => Math.abs(a.dir - e.dir) - Math.abs(b.dir - e.dir))[0];
      if (near) e.lanes = near.lanes.slice();
    }
  }
  return sorted;
}

export function buildTrack() {
  const N = CFG.segCount, SL = CFG.segLen, L = N * SL;
  const segs = [];
  for (let i = 0; i < N; i++) {
    segs.push({ i, curve: 0, sprites: [], gate: 0, densify: false,
                half: 6.35, lanes: 3, lanesA: 3, lanesB: 3, mix: 1, rails: true, type: 'city' });
  }

  let seed = 20261006;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const sections = [], junctions = [];
  const BLEND = Math.round(200 / SL);
  const waitN = Math.round(CFG.waitZoneLen / SL);   // 待转区 200m
  const bendN = Math.round(250 / SL);               // 路口弯道 250m

  // 路口弯道动态写入（车道选向后道路实时弯曲）
  function setJunctionDir(j, dir) {
    for (let i = 0; i < bendN; i++) {
      const t = clamp(Math.min(i, bendN - 1 - i) / CFG.steerRamp, 0, 1);
      segs[(j.bendStart + i) % N].curve = dir * CFG.steerCurve * (t * t * (3 - 2 * t));
    }
    j.dir = dir;
  }

  // —— 填充直路段 ——
  function fillSection(startSeg, lenSeg, typeKey, prev) {
    const def = SECTION_DEFS[typeKey];
    const endSeg = Math.min(N, startSeg + lenSeg);
    for (let i = startSeg; i < endSeg; i++) {
      const s = segs[i % N];
      const k = clamp((i - startSeg) / BLEND, 0, 1);
      s.half = prev.half + (def.half - prev.half) * k;
      s.lanesA = prev.lanes; s.lanesB = def.lanes; s.mix = k;
      s.lanes = k < 0.5 ? prev.lanes : def.lanes;
      s.rails = k < 0.5 ? prev.rails : def.rails;
      s.type = typeKey;
    }
    for (let i = startSeg + BLEND + 2; i < endSeg - 2; i++) {
      const s = segs[i % N];
      if (def.lamps && i % CFG.lampEvery === 0) {
        s.sprites.push({ key: 'lamp', off: -(s.half + 1.0), flip: false });
        s.sprites.push({ key: 'lamp', off: (s.half + 1.0), flip: true });
      }
      if (def.rails && i % CFG.postEvery === 0) {
        s.sprites.push({ key: 'post', off: -(s.half + 0.30), flip: false });
        s.sprites.push({ key: 'post', off: (s.half + 0.30), flip: true });
      }
      if (def.buildings && i % 10 === 0) {
        const side = (Math.floor(i / 10) % 2) ? 1 : -1;
        s.sprites.push({ key: 'house' + (1 + (Math.floor(i / 10) % 4)), off: side * (s.half + 3.4), flip: side > 0 });
      }
      if (def.cacti && i % 14 === 0) {
        const side = (Math.floor(i / 14) % 2) ? 1 : -1;
        s.sprites.push({ key: 'cactus' + ((Math.floor(i / 14) % 2) ? '_b' : '_a'), off: side * (s.half + 2.4), flip: side > 0 });
      }
    }
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— 填充路口路段：待转区（车道选向）→ 弯道（动态方向）——
  function fillJunction(startSeg, lenSeg, typeKey, prev) {
    const def = SECTION_DEFS[typeKey];
    const endSeg = Math.min(N, startSeg + lenSeg);
    // 属性过渡（同直路段）
    for (let i = startSeg; i < endSeg; i++) {
      const s = segs[i % N];
      const k = clamp((i - startSeg) / BLEND, 0, 1);
      s.half = prev.half + (def.half - prev.half) * k;
      s.lanesA = prev.lanes; s.lanesB = def.lanes; s.mix = k;
      s.lanes = k < 0.5 ? prev.lanes : def.lanes;
      s.rails = k < 0.5 ? prev.rails : def.rails;
      s.type = typeKey;
    }
    // 出口→车道分配
    const exits = assignExitLanes(def.junction, def.lanes);
    // 布点（路侧物）
    for (let i = startSeg + BLEND + 2; i < endSeg - 2; i++) {
      const s = segs[i % N];
      if (def.lamps && i % CFG.lampEvery === 0) {
        s.sprites.push({ key: 'lamp', off: -(s.half + 1.0), flip: false });
        s.sprites.push({ key: 'lamp', off: (s.half + 1.0), flip: true });
      }
      if (def.rails && i % CFG.postEvery === 0) {
        s.sprites.push({ key: 'post', off: -(s.half + 0.30), flip: false });
        s.sprites.push({ key: 'post', off: (s.half + 0.30), flip: true });
      }
      if (def.buildings && i % 10 === 0) {
        const side = (Math.floor(i / 10) % 2) ? 1 : -1;
        s.sprites.push({ key: 'house' + (1 + (Math.floor(i / 10) % 4)), off: side * (s.half + 3.4), flip: side > 0 });
      }
    }
    // 待转区段：车道箭头元数据（渲染层画选向箭头）
    const waitStart = startSeg + BLEND;
    const bendStart = waitStart + waitN;
    const bendEnd = Math.min(endSeg - 4, bendStart + bendN);
    for (let i = waitStart; i < bendStart; i++) {
      segs[i % N].junction = { exits: exits.map(e => ({ dir: e.dir, label: e.label, lanes: e.lanes.slice() })) };
      segs[i % N].densify = true;
    }
    segs[waitStart % N].gate = 1;                    // 待转区门框（虚线横线）
    // 预告牌
    const signSeg = segs[(waitStart - 30 + N) % N];
    signSeg.sprites.push({ key: 'sign', off: signSeg.half + 1.35, flip: false });
    // 路口记录（弯道方向待车道选定后写入；默认 = 最接近直行的出口）
    const straight = exits.slice().sort((a, b) => Math.abs(a.dir) - Math.abs(b.dir))[0];
    const j = { freeChoice: exits.length > 1, exits,
                waitStart, bendStart, bendEnd,
                waitZ: waitStart * SL, bendZ: bendStart * SL, endZ: bendEnd * SL,
                dir: straight.dir, resolved: false };
    junctions.push(j);
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— S 弯：预写双向缓曲走廊（纯驾驶段，无选择无门框）——
  function fillSCurveBends(startSeg, lenSeg, prev) {
    const b1s = startSeg + Math.round(lenSeg * 0.18);
    const b1e = startSeg + Math.round(lenSeg * 0.46);
    const b2s = startSeg + Math.round(lenSeg * 0.54);
    const b2e = startSeg + Math.round(lenSeg * 0.82);
    const dir = rnd() < 0.5 ? -1 : 1;
    const writeBend = (s0, s1, d) => {
      const n = s1 - s0;
      for (let i = 0; i < n; i++) {
        const t = clamp(Math.min(i, n - 1 - i) / (n * 0.3), 0, 1);
        segs[(s0 + i) % N].curve = d * CFG.steerCurve * (t * t * (3 - 2 * t));
      }
    };
    writeBend(b1s, b1e, dir);
    writeBend(b2s, b2e, -dir);
  }

  // —— 序列 ——
  let prev = fillSection(0, Math.round(800 / SL), 'city', { half: 6.35, lanes: 3, rails: true });
  let cur = Math.round(800 / SL), lastType = 'city';
  const pool = ['highway', 'scurve', 'desert', 'jLS', 'jRS', 'jLSR', 'highway', 'scurve', 'jRS', 'desert', 'jLS'];
  while (cur < N - 300) {
    const km = (cur * SL) / 1000;
    let type = pool[(rnd() * pool.length) | 0];
    if (type === lastType) type = pool[(rnd() * pool.length) | 0];
    if (km > 10 && (type === 'scurve' || rnd() < 0.2)) type = 'scurve';  // 大师段：弯道权重提升
    const def = SECTION_DEFS[type];
    let lenSeg = Math.round((650 + rnd() * 450) / SL);
    if (def.junction) lenSeg = Math.max(lenSeg, Math.round((200 + 250 + 200) / SL));  // 路口最小长度
    if (type === 'scurve') lenSeg = Math.max(lenSeg, Math.round(1000 / SL));
    if (def.junction) prev = fillJunction(cur, lenSeg, type, prev);
    else {
      prev = fillSection(cur, lenSeg, type, prev);
      if (def.bends) fillSCurveBends(cur, lenSeg);
    }
    cur += lenSeg;
    lastType = type;
  }

  // —— 查询 ——
  function roadInfoAt(zAbs) {
    const s = segs[Math.floor((((zAbs % L) + L) % L) / SL) % N];
    return { half: s.half, lanes: s.lanes, type: s.type };
  }
  function laneCenterAt(zAbs, lane) {
    const info = roadInfoAt(zAbs);
    const laneW = ((info.half - 0.9) * 2) / info.lanes;
    return (lane - (info.lanes - 1) / 2) * laneW;
  }
  function sectionAt(zAbs) {
    const z = ((zAbs % L) + L) % L;
    for (const s of sections) if (z >= s.startZ && z < s.endZ) return s;
    return sections[sections.length - 1];
  }
  function sectionBlendAt(zAbs) {
    const z = ((zAbs % L) + L) % L;
    let i = 0;
    for (let j = 0; j < sections.length; j++) {
      if (z >= sections[j].startZ && z < sections[j].endZ) { i = j; break; }
      i = sections.length - 1;
    }
    const s = sections[i];
    const prev = sections[(i - 1 + sections.length) % sections.length];
    if (sections.length > 1 && z - s.startZ < 200) {
      return { a: prev, b: s, k: clamp((z - s.startZ) / 200, 0, 1) };
    }
    return { a: s, b: null, k: 1 };
  }
  // 路口窗：待转区 + 弯道（禁行障碍车；车道选向发生地）
  function junctionWindowAt(zAbs) {
    for (const j of junctions) {
      const d = ((zAbs - j.waitZ) % L + L) % L;
      if (d < j.endZ - j.waitZ) return { j, d };
    }
    return null;
  }
  function exitForLane(j, lane) {
    return j.exits.find(e => e.lanes.includes(lane)) || j.exits[0];
  }
  function nextJunctionStart(zAbs) {
    let best = null, bd = Infinity;
    for (const j of junctions) {
      const d = ((j.waitZ - 350 - zAbs) % L + L) % L;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }
  // 车道选向实时写入（待转区内变道即改弯道方向）
  function setJunctionDir(j, dir) {
    if (j.dir === dir) return;
    setJunctionDirWrite(j, dir);
  }
  function setJunctionDirWrite(j, dir) {
    for (let i = 0; i < bendN; i++) {
      const t = clamp(Math.min(i, bendN - 1 - i) / CFG.steerRamp, 0, 1);
      segs[(j.bendStart + i) % N].curve = dir * CFG.steerCurve * (t * t * (3 - 2 * t));
    }
    j.dir = dir;
  }

  return { segs, length: L, sections, junctions,
           roadInfoAt, laneCenterAt, sectionAt, sectionBlendAt,
           junctionWindowAt, exitForLane, nextJunctionStart, setJunctionDir };
}
