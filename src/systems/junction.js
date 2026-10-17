// junction.js — 路口系统：出口选择状态机 + 主线淡出/淡入通道 + 车道锁 + 横向目标
// 从 main.js 抽出（v5.7 模块化）。四件事原本散在主循环的四个位置、互相引用 game.jn，
// 现在收在一个模块里——改「过门框后怎么办」只需要看这一个文件。
import { CFG, clamp } from '../config.js';

// —— 出口选择状态机（§10.4）——
// 待转区：玩家变道 → 预选出口（保持 p.lane 不变，玩家自己控制车道）
// 过门框：以当前车道锁定出口（道路几何已固定）
// 分叉后：匝道玩家沿出口方向行驶；分岔型（split）到收心点瞬时切回新主线
export function updateJunction(game, track, pz) {
  const p = game.player;
  const jw = track.junctionWindowAt(pz);
  if (!jw) { game.jn = null; return; }
  const { j, phase } = jw;
  if (phase === 'wait') {
    // 待转区：当前车道对应的出口 = 玩家选的出口（不再强制搬到外车道）
    game.jn = { j, phase: 'wait', exit: track.exitForLane(j, p.lane) };
  } else {
    // 过分叉点：以当前车道锁定出口（道路几何已固定）
    if (!j.chosen) j.chosen = track.exitForLane(j, p.lane);
    const E = j.chosen;
    game.jn = { j, phase: 'bend', exit: E };
    if (pz >= j.forkZ && E.dir !== 0) {
      p.brDir = E.dir;
      // v5 环岛右绕：段类型不是 split，但出口语义是「新主干道」（track.js 里给出口打了 E.split）
      if (E.split) {
        // v4.10 分岔新主干道：收心点切换 player 到新主干道（brDir=0），但淡入慢慢发生
        // - off=0 时几何重合：车辆不"被拉"，但渲染层把新主线 alpha 缓升起来
        // - 整个吸收距离 = splitAbsorbM（5s × 当前速度，约 110-150m），期间 mlTarget 从 0 升到 1
        // - 全程 p.brDir=0（玩家已在新主线）
        if (pz >= j.doneZ - 4 && !p.absorbed) {
          p.absorbed = true;
          p.absorbedT = game.time;
          p.brDir = 0;
          const ri2 = track.roadInfoAt(pz);
          p.lane = Math.floor((ri2.lanes - 1) / 2);
          game.lastLanes = ri2.lanes;
          j.chosen = null;
        }
      } else if (pz >= j.mergeZ - 6) {                   // 汇入型：直接切回主线（同时设 mlTarget=1 触发淡入）
        p.brDir = 0;
        j.chosen = null;
      }
    }
  }
}

// —— 主线淡出/淡入通道（v4.5 + v4.9 + v4.10 + v5）——
// mainlineAlpha 决定主线路面画多亮，bgAlpha 决定背景/对向车/船画多亮。
// v5 环岛：分叉后主线要淡出（中央留给岛），但**背景不能跟着淡**——
// 否则绕岛 600m 全程只剩两条白线、黑成一片。普通匝道仍沿用旧行为。
export function updateJunctionAlphas(game, dt, track, pz) {
  const p = game.player;
  let mlTarget = 1;
  const onRamp = p.brDir !== 0 && game.jn && game.jn.phase === 'bend';
  const jExit = game.jn ? game.jn.exit : null;
  const absorbedSplit = p.absorbed && !!jExit && !!jExit.split;
  if (onRamp) {
    const j = game.jn.j;
    if (jExit && jExit.split) {
      mlTarget = 0;                                  // v4.9 split 弯出段：老路淡出保持
    } else {
      const distToMerge = ((j.mergeZ - pz) % track.length + track.length) % track.length;
      const fadeDist = Math.max(60, p.speed * 3.2);   // 3 秒 × 当前速度（下限 60m）
      mlTarget = distToMerge > fadeDist ? 0 : 1;
    }
  } else if (absorbedSplit) {
    // v4.10 split 收心后：车已切到新主线，按时间 0→1 渐入（5s 略长于淡出的 3s，视觉感知淡入更慢）
    const since = game.time - (p.absorbedT || game.time);
    mlTarget = clamp(since / 5.0, 0, 1);
  }
  const rate = dt / 3;
  game.mainlineAlpha += clamp(mlTarget - game.mainlineAlpha, -rate, rate);
  game.bgAlpha = (onRamp && game.jn.j.ring) ? 1 : game.mainlineAlpha;
}

// —— 车道锁 ——
// 待转区内可变道选向；过门框后单车道匝道锁死变道。
// 环岛绕岛段是双车道，**必须放开**：那是内圈/外圈的选择入口。
export function laneChangeAllowed(game, track, pz) {
  const jn = game.jn;
  if (!jn || jn.phase === 'wait') return true;        // 非路口 / 待转区：正常变道
  if (jn.phase !== 'bend') return true;
  const rr = track.rampInfoAt(pz, game.player.brDir);
  return !!rr && rr.lanes >= 2;
}

// —— 横向目标 x ——
// 主线：车道中心；匝道：环道中线 + 车道偏移。
// v5 环岛的关键前提：绕岛段是双车道，laneX 必须带车道偏移，
// 否则玩家被钉死在环道中线上，「内圈慢 / 外圈快」就没有可选的左右两侧
// （单车道匝道偏移为 0，行为不变）。顺带维护 p.laneMax。
export function updateLaneTarget(game, track, pz) {
  const p = game.player;
  if (p.brDir) {
    const r = track.rampInfoAt(pz, p.brDir);
    if (r) {
      p.laneMax = r.lanes;
      if (p.lane > r.lanes - 1) p.lane = r.lanes - 1;
      return r.off + (p.lane - (r.lanes - 1) / 2) * CFG.laneWidth;
    }
  }
  return track.laneCenterAt(pz, p.lane);
}
