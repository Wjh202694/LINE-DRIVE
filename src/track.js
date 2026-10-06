// track.js — 路段系统（§5/M3）：5 类路段模板随机串接 + 难度曲线 + 200m 过渡混合
// 城市街道 / 高速公路 / S 弯山道 / 沙漠公路 / 岔路；环岛与跨海大桥需专属机制，后续里程碑。
// 每段存储 half（路半宽，过渡区线性渐变）/ lanesA·lanesB·mix（车道数切换混合）/ rails / type。
// 转向节段（§10.4）由 S 弯与岔路路段生成；岔路为自由方向选择（选定后动态写入弯道）。
import { CFG, clamp } from './config.js';

export const SECTION_DEFS = {
  city:    { name: '城市街道', lanes: 3, half: 6.35, rails: true,  lamps: true,  buildings: true,  bg: 'city' },
  highway: { name: '高速公路', lanes: 4, half: 7.6,  rails: true,  lamps: true,  buildings: false, bg: 'city' },
  scurve:  { name: 'S 弯山道', lanes: 2, half: 5.4,  rails: true,  lamps: false, buildings: false, bg: 'mountain', zones: 2 },
  desert:  { name: '沙漠公路', lanes: 3, half: 7.0,  rails: false, lamps: false, buildings: false, bg: 'desert', cacti: true },
  fork:    { name: '岔路',     lanes: 3, half: 6.35, rails: true,  lamps: true,  buildings: false, bg: 'city', zones: 1, freeDir: true },
};

export function buildTrack() {
  const N = CFG.segCount, SL = CFG.segLen, L = N * SL;
  const segs = [];
  for (let i = 0; i < N; i++) {
    segs.push({ i, curve: 0, sprites: [], gate: 0, densify: false,
                half: 6.35, lanes: 3, lanesA: 3, lanesB: 3, mix: 1, rails: true, type: 'city' });
  }

  let seed = 20261006;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const sections = [], curves = [];
  const BLEND = Math.round(200 / SL);                 // 过渡混合 200m
  const waitN = Math.round(CFG.waitZoneLen / SL);
  const steerN = Math.round(CFG.steerZoneLen / SL);

  // —— 转向节段（§10.4 机制复用：门框/加密/预告牌/曲率缓入缓出）——
  function addSteerZone(S, dir, freeDir) {
    const waitStart = S - waitN, steerEnd = S + steerN;
    for (let i = 0; i < steerN; i++) {
      const t = clamp(Math.min(i, steerN - 1 - i) / CFG.steerRamp, 0, 1);
      segs[(S + i) % N].curve = dir * CFG.steerCurve * (t * t * (3 - 2 * t));
    }
    segs[waitStart % N].gate = dir;
    for (let i = waitStart + 1; i < S; i++) segs[i % N].densify = true;
    const signSeg = segs[(waitStart - 30 + N) % N];
    signSeg.sprites.push({ key: 'sign', off: signSeg.half + 1.35, flip: dir < 0 });
    const c = { dir, freeDir: !!freeDir, S, waitStart, steerEnd,
                startZ: S * SL, waitZ: waitStart * SL, endZ: steerEnd * SL };
    curves.push(c);
    return c;
  }

  // 岔路选定后动态写入弯道方向（道路随选择转弯）
  function setForkCurve(c, dir) {
    for (let i = 0; i < steerN; i++) {
      const t = clamp(Math.min(i, steerN - 1 - i) / CFG.steerRamp, 0, 1);
      segs[(c.S + i) % N].curve = dir * CFG.steerCurve * (t * t * (3 - 2 * t));
    }
    c.dir = dir;
  }

  // —— 填充一个路段：逐段属性 + 过渡混合 + 路侧物布点 ——
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
    // 路侧物（过渡段内不布点，避免属性跳变）
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
      if (def.buildings && i % 10 === 0) {            // 城市建筑贴片 50m 交替双侧
        const side = (Math.floor(i / 10) % 2) ? 1 : -1;
        s.sprites.push({ key: 'house' + (1 + (Math.floor(i / 10) % 4)), off: side * (s.half + 3.4), flip: side > 0 });
      }
      if (def.cacti && i % 14 === 0) {                // 沙漠仙人掌 70m 交替
        const side = (Math.floor(i / 14) % 2) ? 1 : -1;
        s.sprites.push({ key: 'cactus' + ((Math.floor(i / 14) % 2) ? '_b' : '_a'), off: side * (s.half + 2.4), flip: side > 0 });
      }
    }
    // 转向节段
    if (def.zones) {
      const minStart = startSeg + BLEND + waitN + 6;
      const positions = def.zones === 2 && lenSeg >= 180
        ? [startSeg + Math.round(lenSeg * 0.24), startSeg + Math.round(lenSeg * 0.66)]
        : [startSeg + Math.round(lenSeg * 0.5)];
      for (let S of positions) {
        S = clamp(S, minStart, endSeg - steerN - 4);
        if (S - waitN < minStart - waitN - 6) continue;
        addSteerZone(S, rnd() < 0.5 ? -1 : 1, def.freeDir);
      }
    }
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— 序列：城市教学 800m → 池内随机串接（不连续同类；10km 后 S 弯权重提升）——
  let prev = fillSection(0, Math.round(800 / SL), 'city', { half: 6.35, lanes: 3, rails: true });
  let cur = Math.round(800 / SL), lastType = 'city';
  while (cur < N - steerN - 60) {
    const km = (cur * SL) / 1000;
    const pool = ['highway', 'scurve', 'desert', 'fork'].filter(t => t !== lastType);
    let type = pool[(rnd() * pool.length) | 0];
    if (km > 10 && rnd() < 0.35) type = 'scurve';    // 大师段：S 弯权重提升（§5 难度曲线）
    let lenSeg = Math.round((650 + rnd() * 450) / SL);
    const def = SECTION_DEFS[type];
    if (def.zones) lenSeg = Math.max(lenSeg, Math.round(900 / SL));
    prev = fillSection(cur, lenSeg, type, prev);
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
  // 背景混合：进入路段后 200m 内与上一路段渐变（§5 旧景漂出/新景漂入）
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
  function curveWindowAt(zAbs) {
    for (const c of curves) {
      const d = ((zAbs - c.waitZ) % L + L) % L;
      if (d < c.endZ - c.waitZ) return c;
    }
    return null;
  }
  function nextCurveStart(zAbs) {
    let best = null, bd = Infinity;
    for (const c of curves) {
      const d = ((c.waitZ - 350 - zAbs) % L + L) % L;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  return { segs, length: L, sections, curves, roadInfoAt, laneCenterAt, sectionAt,
           sectionBlendAt, curveWindowAt, nextCurveStart, setForkCurve };
}
