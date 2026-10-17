// steering.js — 转向系统（§10.4）：强制转向区的判定、完成条与失败判定
// 从 main.js 抽出（v5.7 模块化）。这块逻辑有两个耦合点特别值得独立成模块：
//   1. 转向完成条要向前扫描「本转向区非 grace 段的总长」，需要 track.segs ——
//      和主循环里的相机/车流毫不相干，却长期挤在同一个函数体里。
//   2. 失败判定的三种情境（匝道弯 / 单出口直行路口 / S 弯）判据各不相同，
//      放在一起才看得出「什么算违规」是一条规则而不是三条巧合。
import { CFG, clamp } from '../config.js';
import { wrapZ } from '../road.js';
import { input } from '../input.js';
import { sfxTurnFail } from '../audio.js';
import { doCrash } from './crash.js';

// 判定当前处于哪个强制转向区（匝道弯段 brDir≠0 / S 弯主线），并推进转向完成条。
// 出弯时完成度 < 75% → 「转向力度不足」撞毁；全程按住则完成条随行驶平滑涨满。
export function updateSteering(game, dt, track, pz) {
  const p = game.player;
  const turnNow = track.turnAt(pz, p.brDir);
  game.turn = turnNow;
  p.turn = turnNow;

  const dirChanged = turnNow && p.lastTurnDir !== undefined && turnNow.dir !== p.lastTurnDir;
  if (turnNow && (!p.inTurn || dirChanged)) {
    // 进入转向区（或弯曲方向切换 = 新转向区）：扫描该区非 grace 段总长作为完成条满值基准
    p.turnProg = 0;
    p.inTurn = true;
    p.turnZoneTotal = 100;
    const segs = track.segs, N = segs.length;
    const i0 = Math.floor(wrapZ(pz) / CFG.segLen);
    let len = 0;
    for (let k = 0; k < 200; k++) {
      const s = segs[(i0 + k) % N];
      const tr = p.brDir ? (s.turnRamp ? s.turnRamp[p.brDir] : null) : s.turn;
      if (!tr || tr.dir !== turnNow.dir) break;
      if (!tr.grace) len += CFG.segLen;
    }
    p.turnZoneTotal = Math.max(40, len);
  }

  if (turnNow) {
    const holdOk = game.state === 'running'
      ? ((turnNow.dir === -1 && input.left) || (turnNow.dir === 1 && input.right))
      : true;                                              // 标题页 AI 演示恒成功
    if (!turnNow.grace && holdOk) {
      p.turnProg = clamp((p.turnProg || 0) + (p.speed * dt) / p.turnZoneTotal, 0, 1);
    }
    p.lastTurnDir = turnNow.dir;
  } else if (p.inTurn) {
    // 出弯判定：完成度 < 75% → 转向失败
    if (game.state === 'running') {
      if ((p.turnProg || 0) < 0.75) { sfxTurnFail(); doCrash(game, null, '转向力度不足'); }
      else game.fovBreathT = 0.6;                          // 成功反馈：fov 呼吸
    }
    p.inTurn = false; p.turnProg = 0; p.lastTurnDir = undefined;
  }
}

// —— §10.4 违规判定：三类情境 ——
// (A) 匝道弯曲段 / (C) S 弯主线：grace 期外未按正确方向 → 外漂撞护栏
// (B) 直行过**只有一个出口**的路口（无岔路可走）：按 ←/→ 即外漂。
//     有岔路（freeChoice）时 ←/→ 是合法的选道，不罚——否则正常变道会被判成撞毁。
export function checkSteerCrash(game, laneX, ri, laneL, laneR) {
  if (game.state !== 'running') return;
  const p = game.player;
  const jn = game.jn;
  if (game.turn && !game.turn.grace) {
    // (A)(C)：有 turn 但没在 grace 期
    const lim = game.turn.half - 0.45;
    if (Math.abs(p.x - laneX) > lim) doCrash(game, null, '冲出弯道撞上护栏');
  } else if (jn && jn.phase === 'bend' && !jn.j.freeChoice && jn.exit.dir === 0 && !laneL && !laneR) {
    // (B)：laneL/laneR 是边沿事件，但玩家也可能一直按住方向键持续"提醒"，
    //     所以用 input.left/input.right 实时判定
    if ((input.left || input.right) && !p.brDir) {
      const lim = ri.half - 0.45;
      if (Math.abs(p.x - laneX) > 0.6) doCrash(game, null, '直行通过禁止按左右键');
    }
  }
}
