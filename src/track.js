// track.js — 路段系统 v3（2026-10-07 用户第二轮反馈全量重写）
// 1. 路口=固定双分支几何：直行主线 + 单车道匝道同时存在；玩家在待转区变道→预选出口；
//    过门框后强制转向区有 grace 宽限（匝道弯曲前 14 段 ≈ 70m 不计外漂）；
//    弯段按住方向过弯，松手/按反 → 外漂撞护栏直接结束；直行通过岔路按左右 = 外漂撞护栏。
// 2. 景物几何贴合路面：路灯/树/建筑/桥塔/船等所有 sprite 的 off 均基于 s.half，
//    路口过渡段（lanesA≠lanesB）只布外侧常驻物件，匝道走廊清空保护。
// 3. 路段长度：城市/沙漠≥1500m，跨海大桥≥1500m（含桥塔段），岔路/弯道按需，循环总长放大。
// 4. 新增隧道段（tunnel）：进入光圈→隧道壁肋骨线+顶灯序列→出隧道亮斑→背景淡入。
// 5. 长上下坡：hills 用 sin 叠加，相机俯仰随当前段 y 倾斜；新增独享的 upslope/downslope 类型段。
import { CFG, clamp, lerp } from './config.js';

export const SECTION_DEFS = {
  city:    { name: '城市街道', lanes: 3, half: 6.35, rails: true,  lamps: true,  buildings: true, trees: true, bg: 'city' },
  highway: { name: '高速公路', lanes: 4, half: 7.6,  rails: true,  lamps: true,  poles: true, gantry: true, oncoming: true, bg: 'city' },
  scurve:  { name: 'S 弯山道', lanes: 2, half: 5.4,  rails: true,  lamps: false, buildings: false, bg: 'mountain', bends: 2, windmill: true },
  desert:  { name: '沙漠公路', lanes: 3, half: 7.0,  rails: false, lamps: false, buildings: false, bg: 'desert', cacti: true },
  bridge:  { name: '跨海大桥', lanes: 4, half: 7.6,  rails: false, gold: true, lamps: false, buildings: false, bg: 'ocean', towers: true, oncoming: true, ships: true },
  tunnel:  { name: '隧道',     lanes: 3, half: 5.6,  rails: true,  lamps: false, buildings: false, bg: 'mountain', tunnel: true },
  upslope: { name: '长上坡',   lanes: 3, half: 6.35, rails: true,  lamps: true,  bg: 'mountain', slope: 1 },
  downslope:{ name: '长下坡',  lanes: 3, half: 6.35, rails: true,  lamps: true,  bg: 'mountain', slope: -1 },
  jLS:     { name: '岔路 · 直行/左转', lanes: 3, half: 6.35, rails: true, lamps: true, buildings: true, bg: 'city',
             junction: [ { dir: -1, label: '左转' }, { dir: 0, label: '直行' } ] },
  jRS:     { name: '岔路 · 直行/右转', lanes: 3, half: 6.35, rails: true, lamps: true, buildings: true, bg: 'city',
             junction: [ { dir: 0, label: '直行' }, { dir: 1, label: '右转' } ] },
  jLSR:    { name: '岔路 · 左转/直行/右转', lanes: 4, half: 7.6, rails: true, lamps: false, buildings: false, bg: 'city',
             junction: [ { dir: -1, label: '左转' }, { dir: 0, label: '直行' }, { dir: 1, label: '右转' } ] },
  // v4.9 新增：分岔 · 新主干道——走匝道不汇回主道，单车道扩展为 3 车道成为新主干道
  jSplit:  { name: '分岔 · 新主干道', lanes: 3, half: 6.35, rails: true, lamps: true, buildings: true, bg: 'city', split: true,
             junction: [ { dir: 0, label: '直行' }, { dir: 1, label: '新路线' } ] },
};

// 出口→车道分配（深拷贝防御污染）
function assignExitLanes(exits, lanes) {
  const sorted = exits.slice().sort((a, b) => a.dir - b.dir);
  for (const e of sorted) e.lanes = [];
  let left = 0, right = lanes - 1;
  const lefts = sorted.filter(e => e.dir < 0), rights = sorted.filter(e => e.dir > 0).reverse(), mids = sorted.filter(e => e.dir === 0);
  for (const e of lefts) { if (left <= right) e.lanes.push(left++); }
  for (const e of rights) { if (left <= right) e.lanes.push(right--); }
  for (const e of mids) { while (left <= right) e.lanes.push(left++); }
  return sorted;
}

const laneCenterFor = (half, lanes, lane) => ((lane - (lanes - 1) / 2) * ((half - 0.9) * 2)) / lanes;

export function buildTrack(seedIn = 20261007) {
  const N = CFG.segCount, SL = CFG.segLen, L = N * SL;
  const segs = [];
  for (let i = 0; i < N; i++) {
    segs.push({ i, curve: 0, y: 0, sprites: [], gate: 0, densify: false,
                half: 6.35, lanes: 3, lanesA: 3, lanesB: 3, mix: 1, rails: true, gold: false,
                coin: -1, boost: -1, coinRamp: 0, type: 'city', slope: 0,
                tunnel: 0, shipKey: null, shipOff: 0, shipSeed: 0, noRailL: 0, noRailR: 0 });
  }

  let seed = seedIn;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ss = t => t * t * (3 - 2 * t);

  const sections = [], junctions = [], sbTurn = [];
  const BLEND = Math.round(200 / SL);
  const waitN = Math.round(CFG.waitZoneLen / SL);       // 待转区 200m
  const rampA = CFG.rampSegs, rampB = CFG.mergeSegs;    // 匝道分流/汇入段数
  const RAMP_GRACE = 14;                                // 分叉后 grace 段数（70m），按扭不外漂

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
      s.gold = def.gold || false;
      s.type = typeKey;
      s.slope = def.slope || 0;
    }
    // 装饰物布点：所有 off 都基于 s.half，永不偏离路面
    for (let i = startSeg + BLEND + 2; i < endSeg - 2; i++) {
      const s = segs[i % N];
      // 隧道段特殊绘制：肋骨线 + 顶灯带 + 暗化处理
      if (def.tunnel) {
        if (i % 2 === 0) {
          s.sprites.push({ key: 'tunnel_rib', off: -(s.half + 0.05), flip: false });
          s.sprites.push({ key: 'tunnel_rib', off: (s.half + 0.05), flip: false });
        }
        if (i % 2 === 0) s.tunnel = 1;
        // 顶灯带（程序化绘制，sprites 不直接处理）
      } else {
        if (def.lamps && i % CFG.lampEvery === 0) {
          const ka = (i / CFG.lampEvery) % 2 < 1 ? 'lamp_a' : 'lamp_b';
          s.sprites.push({ key: ka, off: -(s.half + 1.0), flip: false });
          s.sprites.push({ key: ka, off: (s.half + 1.0), flip: true });
        }
        if (def.poles && i % (CFG.lampEvery * 2) === CFG.lampEvery) {
          s.sprites.push({ key: 'pole', off: -(s.half + 1.6), flip: false });
          s.sprites.push({ key: 'pole', off: (s.half + 1.6), flip: true });
        }
        if (def.rails && i % CFG.postEvery === 0) {
          s.sprites.push({ key: 'post', off: -(s.half + 0.30), flip: false });
          s.sprites.push({ key: 'post', off: (s.half + 0.30), flip: true });
        }
        if (def.buildings && i % 12 === 0) {
          const side = (Math.floor(i / 12) % 2) ? 1 : -1;
          s.sprites.push({ key: 'house' + (1 + (Math.floor(i / 12) % 4)), off: side * (s.half + 3.4), flip: side > 0 });
        }
        if (def.trees && i % 9 === 4) {
          const side = (Math.floor(i / 9) % 2) ? 1 : -1;
          s.sprites.push({ key: (i % 18 === 4) ? 'tree_a' : 'tree_b', off: side * (s.half + 2.2), flip: side > 0 });
        }
        if (def.cacti && i % 18 === 0) {
          const side = (Math.floor(i / 18) % 2) ? 1 : -1;
          const key = (i % 72 === 0) ? 'dead_tree' : 'cactus' + ((Math.floor(i / 18) % 2) ? '_b' : '_a');
          s.sprites.push({ key, off: side * (s.half + 2.6), flip: side > 0 });
        }
        if (def.gantry && i % 100 === 50) {
          s.sprites.push({ key: (i % 200 === 50) ? 'gantry' : 'footbridge', off: 0, flip: false });
        }
        // 跨海大桥：桥塔放置在路面中央（v4.3 增大 3 倍后塔身成为路中主景物）
        if (def.towers && i % 50 === 0) {
          const key = (i % 100 === 0) ? 'tower_a' : 'tower_b';
          s.sprites.push({ key, off: 0, flip: false });
          // 桥墩基座（路面两侧下方，0.4m 高度的细条）
          s.sprites.push({ key: 'post', off: -(s.half + 4.4), flip: false });
          s.sprites.push({ key: 'post', off: (s.half + 4.4), flip: true });
        }
        if (def.windmill && i % 80 === 30) {
          const side = (Math.floor(i / 80) % 2) ? 1 : -1;
          s.sprites.push({ key: 'windmill', off: side * (s.half + 9.0), flip: side > 0 });
        }
        // 跨海大桥：船队分布在桥两侧 25-55m 外（不和桥重叠或挨太近）
        if (def.ships && i % 24 === 12) {
          const side = (Math.floor(i / 24) % 2) ? 1 : -1;
          const seedOff = rnd();
          s.shipKey = (i % 48 === 12) ? 'ship_a' : 'ship_b';
          s.shipOff = side * (s.half + 28 + seedOff * 28);
          s.shipSeed = (i + Math.floor(seedOff * 1000)) & 0xffff;
        }
        // 金币线 + 加速带：所有非沙漠/隧道段通用
        if (i % 60 === 10 && s.coin < 0 && s.boost < 0) {
          const lane = (Math.floor(i / 60) * 3 + ((Math.floor(i / 60) % 2) ? 1 : 0)) % s.lanesB;
          for (let c = 0; c < 6 && i + c < endSeg - 2; c++) segs[(i + c) % N].coin = lane;
        }
        if (i % 150 === 80 && s.coin < 0 && s.boost < 0) {
          const lane = Math.floor(i / 150) % s.lanesB;
          for (let c = 0; c < 7 && i + c < endSeg - 2; c++) segs[(i + c) % N].boost = lane;
        }
      }
    }
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— 岔路：固定双分支几何（90° 大弯道）；匝道弯曲段带 grace；路段中心段外不布物件 ——
  function fillJunction(startSeg, lenSeg, typeKey, prev) {
    const def = SECTION_DEFS[typeKey];
    const endSeg = Math.min(N, startSeg + lenSeg);
    for (let i = startSeg; i < endSeg; i++) {
      const s = segs[i % N];
      const k = clamp((i - startSeg) / BLEND, 0, 1);
      s.half = prev.half + (def.half - prev.half) * k;
      s.lanesA = prev.lanes; s.lanesB = def.lanes; s.mix = k;
      s.lanes = k < 0.5 ? prev.lanes : def.lanes;
      s.rails = k < 0.5 ? prev.rails : def.rails;
      s.gold = false;
      s.type = typeKey;
    }
    // 深拷贝：多次 buildTrack 不会污染模块级 def.junction 的 lanes 字段
    const exits = assignExitLanes(def.junction.map(e => ({ dir: e.dir, label: e.label })), def.lanes);
    const waitStart = startSeg + BLEND + 10;
    const forkStart = waitStart + waitN;
    const isSplit = !!def.split;
    const holdN = CFG.splitHoldN, retN = CFG.splitRetN;
    const rampLen = isSplit ? (rampA + holdN + retN) : (rampA + rampB);
    const mergeEnd = forkStart + rampLen;
    const halfAfter = ((def.lanes - 1) * 3.7) / 2 + 0.8;

    // 匝道几何：
    // · 汇入型（jLS/jRS/jLSR）：S 形——弯出 0→R + 弯回 R→0（回到外车道，汇入主线）
    // · 分岔型（jSplit，v4.9）：弯出 0→R + 平直 R + 收心扩展 R→0——off 最终为 0（与主线中心重合），
    //   同时 half 2.65→def.half、lanes 1→def.lanes（单车道扩展为 3 车道新主干道）
    const ramps = [];
    for (const e of exits) {
      if (e.dir === 0) continue;
      const startOff = laneCenterFor(def.half, def.lanes, e.dir > 0 ? def.lanes - 1 : 0);
      const R = isSplit ? CFG.splitDiv : CFG.forkDiv;
      const n = rampLen;
      const off = new Float64Array(n);
      const crs = new Float64Array(n);
      const halfArr = new Float64Array(n);
      const lanesArr = new Uint8Array(n);
      if (isSplit) {
        const expStart = rampA + holdN + 20;             // 扩展起点（收心段前 20 段开始扩宽）
        for (let i = 0; i < n; i++) {
          let mag;
          if (i < rampA) {
            mag = Math.abs(startOff) + R * (1 - Math.cos(Math.PI / 2 * Math.min(1, i / Math.max(1, rampA - 1))));
          } else if (i < rampA + holdN) {
            mag = Math.abs(startOff) + R;                 // 平直段
          } else {
            const t3 = Math.min(1, (i - rampA - holdN) / Math.max(1, retN - 1));
            mag = (Math.abs(startOff) + R) * Math.cos(Math.PI / 2 * t3);  // 收心 → 0
          }
          off[i] = e.dir * mag;
          // 路宽扩展：收心段开始后逐渐 2.65 → def.half
          if (i >= expStart) {
            const te = Math.min(1, (i - expStart) / Math.max(1, n - 1 - expStart));
            const kk = te * te * (3 - 2 * te);
            halfArr[i] = CFG.rampHalf + (def.half - CFG.rampHalf) * kk;
            lanesArr[i] = kk > 0.5 ? def.lanes : 1;
          } else {
            halfArr[i] = CFG.rampHalf;
            lanesArr[i] = 1;
          }
        }
      } else {
        // 汇入型 S 形（v4.6 修复版）
        for (let i = 0; i < n; i++) {
          const t1 = Math.min(1, i / Math.max(1, rampA - 1));
          const t2 = Math.min(1, (i - rampA) / Math.max(1, rampB - 1));
          const mag = i < rampA
            ? R * (1 - Math.cos(Math.PI / 2 * t1))       // 0 → R（弯出）
            : R * Math.cos(Math.PI / 2 * t2);            // R → 0（弯回，衔接上一段末值）
          off[i] = e.dir * (Math.abs(startOff) + mag);
        }
        for (let i = 0; i < n; i++) { halfArr[i] = CFG.rampHalf; lanesArr[i] = 1; }
      }
      for (let i = 0; i < n; i++) {
        crs[i] = (off[Math.min(i + 1, n - 1)] - off[i]) / SL;
      }
      ramps.push({ dir: e.dir, off, crs, halfArr, lanesArr, half: CFG.rampHalf, startOff, n, R, isSplit });
      e.ramp = true;
    }

    // 布点（路侧物）：匝道弯离侧在 [分叉前 16, 汇入后 20] 清空——绝不把物件放在匝道走廊里
    const rampDirs = exits.filter(e => e.dir !== 0).map(e => e.dir);
    const clearFrom = forkStart - 16, clearTo = mergeEnd + 20;
    for (let i = startSeg + BLEND + 2; i < endSeg - 2; i++) {
      const s = segs[i % N];
      const inRampClear = i >= clearFrom && i <= clearTo;
      const lampSide = (i % (CFG.lampEvery * 2) < CFG.lampEvery) ? -1 : 1;
      if (def.lamps && i % CFG.lampEvery === 0 && !(inRampClear && rampDirs.includes(lampSide))) {
        s.sprites.push({ key: 'lamp_a', off: -(s.half + 1.0), flip: false });
        s.sprites.push({ key: 'lamp_a', off: (s.half + 1.0), flip: true });
      }
      if (def.rails && i % CFG.postEvery === 0) {
        s.sprites.push({ key: 'post', off: -(s.half + 0.30), flip: false });
        s.sprites.push({ key: 'post', off: (s.half + 0.30), flip: true });
      }
      if (def.buildings && i % 12 === 0) {
        const side = (Math.floor(i / 12) % 2) ? 1 : -1;
        if (!(inRampClear && rampDirs.includes(side))) {
          s.sprites.push({ key: 'house' + (1 + (Math.floor(i / 12) % 4)), off: side * (s.half + 3.6), flip: side > 0 });
        }
      }
    }
    // 待转区段：车道选向箭头 + densify 边缘加密
    for (let i = waitStart; i < forkStart; i++) {
      segs[i % N].junction = { exits: exits.map(e => ({ dir: e.dir, label: e.label, lanes: e.lanes.slice() })) };
      segs[i % N].densify = true;
    }
    segs[waitStart % N].gate = 1;                    // 待转区门框（虚线）
    segs[forkStart % N].gate = 2;                    // 分叉点门框（实线金门）
    const signSeg = segs[(waitStart - 40 + N) % N];
    signSeg.sprites.push({ key: 'fork_sign', off: signSeg.half + 2.4, flip: false });

    // 分叉后主线收窄（左 L-1 道），汇入前拓宽回 L 道
    for (let i = 0; i < 26; i++) {
      const s = segs[(forkStart + i) % N];
      const k = ss(i / 25);
      s.lanesA = def.lanes; s.lanesB = def.lanes - 1; s.mix = k;
      s.lanes = k < 0.5 ? def.lanes : def.lanes - 1;
      s.half = lerp(def.half, halfAfter, k);
    }
    for (let i = 0; i < 26; i++) {
      const s = segs[(mergeEnd - 26 + i) % N];
      const k = ss(i / 25);
      s.lanesA = def.lanes - 1; s.lanesB = def.lanes; s.mix = k;
      s.lanes = k < 0.5 ? def.lanes - 1 : def.lanes;
      s.half = lerp(halfAfter, def.half, k);
    }
    // 匝道逐段数据挂载：渲染双带 + 玩家匝道行驶 + 强制转向区（含 grace）
    for (const r of ramps) {
      for (let i = 0; i < r.n; i++) {
        const s = segs[(forkStart + i) % N];
        (s.br || (s.br = [])).push({ dir: r.dir, off: r.off[i], cr: r.crs[i], half: r.halfArr[i], rails: true, lanes: r.lanesArr[i] });
        // 端头淡入：split 尾端不淡出（与主线重合交接）；汇入型尾端淡出
        const fade = i < 8 ? i / 8 : (r.isSplit ? 1 : (i > r.n - 18 ? Math.max(0, (r.n - 1 - i) / 17) : 1));
        (s.brFade || (s.brFade = {}))[r.dir] = fade;
        // v4.9：匝道金币——每 3 段布一枚（密集，奖励选择匝道的玩家）
        if (i >= 6 && i < r.n - 24 && i % 3 === 1) s.coinRamp = r.dir;
        // v4.8：两弧都强制按住方向键——按键方向 = 弧的弯曲方向（crs 符号）
        if (Math.abs(r.crs[i]) > 0.0011) {
          const bendDir = r.crs[i] > 0 ? 1 : -1;
          // grace：第一弧前 RAMP_GRACE 段 + 第二弧（或平直段后收心弧）前 8 段
          const turnSeg = r.isSplit ? (rampA + holdN) : rampA;
          const inGrace = i < RAMP_GRACE || (i >= turnSeg && i < turnSeg + 8);
          (s.turnRamp || (s.turnRamp = {}))[r.dir] = { dir: bendDir, half: r.halfArr[i], grace: inGrace };
        }
      }
    }
    // 匝道区主线护栏缺口（v4.5）：入口前 12 段 ~ 汇入后 12 段，同侧主线护栏不画
    // —— 用户要求"匝道出入口不要出现护栏"，让车自然驶入/驶出
    for (let i = forkStart - 12; i < mergeEnd + 12; i++) {
      const s = segs[((i % N) + N) % N];
      for (const r of ramps) {
        if (r.dir > 0) s.noRailR = 1;
        else s.noRailL = 1;
      }
    }
    const j = { freeChoice: exits.length > 1, exits, ramps,
                waitStart, forkStart, mergeEnd,
                waitZ: waitStart * SL, forkZ: forkStart * SL, mergeZ: mergeEnd * SL,
                split: isSplit, doneZ: mergeEnd * SL,
                chosen: null };
    junctions.push(j);
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— S 弯：双向强制弯（grace 延长到 22 段 = 110m 让玩家有反应时间）——
  function fillSCurveBends(startSeg, lenSeg, typeKey) {
    const def = SECTION_DEFS[typeKey];
    const bendN = Math.round(320 / SL);
    const b1s = startSeg + Math.round(lenSeg * 0.14);
    const b2s = startSeg + Math.round(lenSeg * 0.58);
    const dir = rnd() < 0.5 ? -1 : 1;
    const writeBend = (s0, d) => {
      for (let i = 0; i < bendN; i++) {
        const t = clamp(Math.min(i, bendN - 1 - i) / 18, 0, 1);
        const s = segs[(s0 + i) % N];
        s.curve = d * CFG.steerCurve * ss(t);
        s.turn = { dir: d, half: def.half, grace: i < 22 };
      }
      const signSeg = segs[(s0 - 40 + N) % N];
      signSeg.sprites.push({ key: 'csign', off: signSeg.half + 1.6, flip: d < 0 });
      sbTurn.push({ z0: s0 * SL, z1: (s0 + bendN) * SL, dir: d });
    };
    writeBend(b1s, dir);
    writeBend(b2s, -dir);
  }

  // —— 长上下坡（upslope/downslope）：坡高 ±14m，相机俯仰随当前 y 平滑插值 ——
  function fillSlope(startSeg, lenSeg, typeKey, prev) {
    const def = SECTION_DEFS[typeKey];
    const endSeg = Math.min(N, startSeg + lenSeg);
    const sign = def.slope;
    const peak = sign * 15;    // m 高度（v4.9 恢复 8→15：长坡视角效果要"持续可感"）
    for (let i = startSeg; i < endSeg; i++) {
      const s = segs[i % N];
      const k = clamp((i - startSeg) / BLEND, 0, 1);
      s.half = prev.half + (def.half - prev.half) * k;
      s.lanesA = prev.lanes; s.lanesB = def.lanes; s.mix = k;
      s.lanes = k < 0.5 ? prev.lanes : def.lanes;
      s.rails = k < 0.5 ? prev.rails : def.rails;
      s.gold = false;
      s.type = typeKey;
      s.slope = sign;
      // 三角波：起点 0 → 中点峰值 → 终点 0
      const t = (i - startSeg) / lenSeg;
      const env = Math.sin(Math.PI * clamp(t, 0, 1));
      s.y = env * peak;
      // v4.8：删除上下坡段的弯道预告牌——预告牌只在真的有弯道时才出现（用户反馈"提示牌出现但无弯"）
    }
    // 上下坡段布路灯
    for (let i = startSeg + BLEND + 2; i < endSeg - 2; i++) {
      const s = segs[i % N];
      if (i % CFG.lampEvery === 0) {
        s.sprites.push({ key: 'lamp_a', off: -(s.half + 1.0), flip: false });
        s.sprites.push({ key: 'lamp_a', off: (s.half + 1.0), flip: true });
      }
      if (i % CFG.postEvery === 0) {
        s.sprites.push({ key: 'post', off: -(s.half + 0.30), flip: false });
        s.sprites.push({ key: 'post', off: (s.half + 0.30), flip: true });
      }
      // 金币线 + 加速带
      if (i % 60 === 10 && s.coin < 0 && s.boost < 0) {
        const lane = (Math.floor(i / 60) * 3 + ((Math.floor(i / 60) % 2) ? 1 : 0)) % s.lanesB;
        for (let c = 0; c < 6 && i + c < endSeg - 2; c++) segs[(i + c) % N].coin = lane;
      }
      if (i % 150 === 80 && s.coin < 0 && s.boost < 0) {
        const lane = Math.floor(i / 150) % s.lanesB;
        for (let c = 0; c < 7 && i + c < endSeg - 2; c++) segs[(i + c) % N].boost = lane;
      }
    }
    sections.push({ type: typeKey, name: def.name, bg: def.bg,
                    startZ: startSeg * SL, endZ: endSeg * SL, seed: Math.floor(rnd() * 1e6) });
    return { half: def.half, lanes: def.lanes, rails: def.rails };
  }

  // —— 起伏系统（v4.2）：
  //   - 沙漠（desert）：每隔 ~150m 出现一个短促的三角波颠簸（±6m，与上下坡峰值相当但持续时间短）
  //   - 其他直路段：基本为 0（不持续抖）
  //   - 强制转向区/上下坡/隧道/岔路：完全压平
  function fillHills() {
    const flat = new Float64Array(N);
    for (const j of junctions) {
      const a = Math.max(0, j.waitStart - 50), b = Math.min(N, j.mergeEnd + 30);
      for (let i = a; i < b; i++) flat[i % N] = 1;
    }
    for (const sb of sbTurn) {
      const a = Math.max(0, Math.floor(sb.z0 / SL) - 40), b = Math.min(N, Math.ceil(sb.z1 / SL) + 40);
      for (let i = a; i < b; i++) flat[i % N] = 1;
    }
    for (let i = 0; i < N; i++) {
      const s = segs[i];
      // v4.9 修复：upslope/downslope/tunnel 保持各自 fillSlope/fillSection 设置的 y（此前误写 s.y=0 导致长坡消失）
      if (s.type === 'upslope' || s.type === 'downslope' || s.tunnel) continue;
      if (flat[i]) { s.y = 0; continue; }
      const env = Math.min(1, Math.min(i > 43 ? 1 : i / 43, i < N - 44 ? 1 : (N - i) / 44));
      if (s.type === 'desert') {
        // 沙漠颠簸：每 ~200m 一个三角波（每 40 段 1 个，振幅 5m，0→peak→0 共 100m）
        // 比 upslope/downslope 短促一半，镜头俯仰 5*0.03=0.15 rad ≈ ±8.6°（短促、干净）
        const mod = i % 40;
        let bump = 0;
        if (mod >= 12 && mod <= 32) {
          const t = (mod - 12) / 20;           // 0..1
          bump = 5 * Math.sin(Math.PI * t);
        }
        s.y = env * bump;
      } else {
        s.y = 0;                                // 其他路段不抖
      }
    }
  }

  // —— 序列（按 8 段总长约 6km 排布，每段 ≥1500m 含大桥/隧道/上下坡）——
  let prev = fillSection(0, Math.round(1000 / SL), 'city', { half: 6.35, lanes: 3, rails: true });
  let cur = Math.round(1000 / SL), lastType = 'city', lastSpecialEnd = CFG.firstCurveZ / SL;
  // 11 段固定序列：保证每圈 3 岔路 + 1 S 弯 + 1 大桥 + 1 沙漠 + 1 隧道 + 1 上坡 + 1 下坡
  const seq = ['scurve', 'jRS', 'bridge', 'desert', 'tunnel', 'jLS', 'upslope', 'jSplit', 'downslope', 'jLSR', 'highway'];
  let seqI = 0;
  while (cur < N - 250) {
    const km = (cur * SL) / 1000;
    // 序列强制：保证每圈含全套要素
    let type = seq[seqI % seq.length];
    seqI++;
    // 弯道低频化只在序列当前位置是 highway/junction/scurve 时不强制
    // 保持场景类型（bridge/tunnel/desert/upslope/downslope）始终出现
    if (cur < lastSpecialEnd + CFG.curveGapMin / SL && ['jRS','jLS','jLSR','scurve'].includes(type)) {
      // 太密才退化为 highway
      type = 'highway';
    }
    if (type === 'bridge' && km < 3) type = 'highway';                  // 大桥 3km 后才出现
    if (type === 'scurve' && cur < CFG.firstCurveZ / SL) type = 'highway';
    const def = SECTION_DEFS[type];
    let lenSeg;
    if (def.junction) lenSeg = Math.round((1100 + rnd() * 500) / SL);   // 岔路 1100-1600m
    else if (def.bends) lenSeg = Math.round((900 + rnd() * 400) / SL);    // S 弯
    else if (def.tunnel) lenSeg = Math.round(450 / SL);                    // 隧道
    else if (def.slope) lenSeg = Math.round((700 + rnd() * 300) / SL);     // 上下坡
    else lenSeg = Math.round((900 + rnd() * 700) / SL);                   // 直段 900-1600m
    // 剩余空间不足 → 降级
    const space = N - 60 - cur;
    if (cur + lenSeg > N - 60) {
      if ((def.junction && space < Math.round(2200 / SL)) || (def.bends && space < Math.round(1800 / SL))) {
        type = 'highway'; lenSeg = space;
      } else if (def.tunnel && space < Math.round(600 / SL)) {
        type = 'highway'; lenSeg = space;
      } else if (def.slope && space < Math.round(800 / SL)) {
        type = 'highway'; lenSeg = space;
      } else {
        lenSeg = space;
      }
    }
    if (lenSeg < 40) break;
    const defFinal = SECTION_DEFS[type];
    if (defFinal.junction) {
      prev = fillJunction(cur, lenSeg, type, prev);
      lastSpecialEnd = cur + BLEND + 10 + waitN + rampA + rampB;
    } else if (defFinal.slope) {
      prev = fillSlope(cur, lenSeg, type, prev);
    } else {
      prev = fillSection(cur, lenSeg, type, prev);
      if (defFinal.bends) { fillSCurveBends(cur, lenSeg, type); lastSpecialEnd = cur + lenSeg; }
    }
    cur += lenSeg;
    lastType = type;
  }
  if (cur < N - 20) prev = fillSection(cur, N - cur, 'city', prev);
  fillHills();

  // —— 查询（保持兼容）——
  function segAtZ(zAbs) { return segs[Math.floor((((zAbs % L) + L) % L) / SL) % N]; }
  function roadInfoAt(zAbs) {
    const s = segAtZ(zAbs);
    return { half: s.half, lanes: s.lanes, type: s.type, gold: s.gold, slope: s.slope, tunnel: !!s.tunnel };
  }
  function laneCenterAt(zAbs, lane) {
    const s = segAtZ(zAbs);
    return lerp(laneCenterFor(s.half, s.lanesA, lane), laneCenterFor(s.half, s.lanesB, lane), s.mix);
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
    const prevS = sections[(i - 1 + sections.length) % sections.length];
    if (sections.length > 1 && z - s.startZ < 200) {
      return { a: prevS, b: s, k: clamp((z - s.startZ) / 200, 0, 1) };
    }
    return { a: s, b: null, k: 1 };
  }
  function junctionWindowAt(zAbs) {
    const z = ((zAbs % L) + L) % L;
    for (const j of junctions) {
      if (z >= j.waitZ && z < j.mergeZ) return { j, phase: z < j.forkZ ? 'wait' : 'branch', inWait: z < j.forkZ };
    }
    return null;
  }
  function junctionRemovalAt(zAbs) {
    const z = ((zAbs % L) + L) % L;
    for (const j of junctions) {
      if (z >= j.waitZ && z < j.forkZ + 30 * SL) return { j };
    }
    return null;
  }
  function exitForLane(j, lane) { return j.exits.find(e => e.lanes.includes(lane)) || j.exits[0]; }
  function rampInfoAt(zAbs, dir) {
    const z = ((zAbs % L) + L) % L;
    for (const j of junctions) {
      if (z < j.forkZ || z >= j.mergeZ) continue;
      const r = j.ramps.find(r => r.dir === dir);
      if (!r) return null;
      const u = (z - j.forkZ) / SL;
      const i = clamp(Math.floor(u), 0, r.n - 1);
      const o2 = r.off[Math.min(i + 1, r.n - 1)];
      return { off: lerp(r.off[i], o2, u - i), cr: r.crs[i], half: r.half };
    }
    return null;
  }
  function turnAt(zAbs, brDir) {
    if (brDir) {
      const r = rampInfoAt(zAbs, brDir);
      if (!r) return null;
      const s = segAtZ(zAbs);
      const tr = s.turnRamp ? s.turnRamp[brDir] : null;
      return tr ? { dir: tr.dir, half: tr.half, grace: tr.grace } : null;
    }
    const s = segAtZ(zAbs);
    return s.turn ? { dir: s.turn.dir, half: s.turn.half, grace: s.turn.grace } : null;
  }
  function effCurveAt(zAbs, brDir) {
    if (brDir) { const r = rampInfoAt(zAbs, brDir); if (r) return r.cr; }
    return segAtZ(zAbs).curve;
  }
  // 当前 z 处的坡度（用于相机俯仰/视野高度补偿）
  function slopeAt(zAbs) {
    const z = ((zAbs % L) + L) % L;
    const idx = Math.floor(z / SL) % N;
    return segs[idx].y;
  }
  function nextJunctionStart(zAbs) {
    let best = null, bd = Infinity;
    for (const j of junctions) {
      const d = ((j.waitZ - 350 - zAbs) % L + L) % L;
      if (d < bd) { bd = d; best = j; }
    }
    for (const sb of sbTurn) {
      const d = ((sb.z0 - 350 - zAbs) % L + L) % L;
      if (d < bd) { bd = d; best = { waitZ: sb.z0 }; }
    }
    return best;
  }

  return { segs, length: L, sections, junctions,
           roadInfoAt, laneCenterAt, sectionAt, sectionBlendAt,
           junctionWindowAt, junctionRemovalAt, exitForLane,
           rampInfoAt, turnAt, effCurveAt, slopeAt, nextJunctionStart };
}
