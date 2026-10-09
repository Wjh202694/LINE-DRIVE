// main.js — 引导、游戏状态机与主循环（v2 2026-10-07 第二轮反馈全量重写）
// 状态：title → running → crashing → crashed
// §10.4（用户明确诉求）：
//  1. 待转区 = 车道选向；玩家变道即预选出口。
//  2. 过门框后强制转向区有 grace 宽限（匝道 70m / S 弯 110m），松手或按反 → 外漂撞护栏。
//  3. 选择直行的玩家过岔路时按左/右 = 直接外漂撞护栏（按岔路架构的应有规则）。
//  4. 直行通过岔路或匝道汇入 = 回主线对应外侧车道。
// §3.3A：相机俯仰随当前段 y 平滑插值（长上坡/长下坡/缓坡）。
// §5#7：跨海大桥侧风扰动；§2.2-2.3：金币/加速带。
import { CFG, clamp, lerp } from './config.js';
import { buildTrack } from './track.js';
import { setTrack, getTrack, wrapZ, segIndexAt, segAt } from './road.js';
import { createPlayer, updatePlayer } from './car.js';
import { Traffic } from './traffic.js';
import { renderWorld } from './render.js';
import { drawHUD, drawTitle, drawCrash, drawPause, drawJunction } from './ui.js';
import { initInput, input, consumeActions } from './input.js';
import { clearFx, updateFx, updateShake, addShake, burstSparks, shatter } from './fx.js';
import { updatePalette, setTheme, consumeSpriteRebuild, THEME_ORDER, THEMES, PAL } from './palette.js';
import { refreshSprites } from './sprites.js';
import { initBg } from './bg.js';
import { startIntro, updateIntro } from './video.js';
import { drawMap, drawGallery, UNLOCKS, unlockedCount } from './menu.js';
import { initAudio, resumeAudio, setEngineState, killEngine,
         sfxOvertake, sfxScrape, sfxHit, sfxCoin, sfxBoost, sfxLane,
         sfxTurnFail, sfxMenu, sfxStart, toggleMute, audioDiag } from './audio.js';

const canvas = document.getElementById('game');
const TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;

function resize() {
  const dpr2 = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(window.innerWidth * dpr2), h = Math.round(window.innerHeight * dpr2);
  W = window.innerWidth; H = window.innerHeight;
  if (canvas.width !== w || canvas.height !== h || dpr !== dpr2) {
    dpr = dpr2;
    canvas.width = w; canvas.height = h;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
}

const store = (() => {
  try { const t = '__ldtest'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; }
  catch { return null; }
})();
const LS = {
  get best() { return store ? +store.getItem('linedrive.best') || 0 : 0; },
  set best(v) { if (store) store.setItem('linedrive.best', v); },
  get bestKm() { return store ? +store.getItem('linedrive.bestKm') || 0 : 0; },
  set bestKm(v) { if (store) store.setItem('linedrive.bestKm', v); },
  get runs() { return store ? +store.getItem('linedrive.runs') || 0 : 0; },
  set runs(v) { if (store) store.setItem('linedrive.runs', v); },
};

const game = {
  state: 'title',
  time: 0, dt: 0, fps: 60, showFps: true,
  player: createPlayer(),
  traffic: new Traffic(),
  cam: { x: 0, z: 0, height: CFG.camHeight, cx: 0, cy: 0, halfW: 0, depth: 1, fov: CFG.fovBase,
         pitch: 0,                                  // 上下坡俯仰（rad）
         yawLocal: 0 },                              // 弯道水平偏航
  introT: 0, startZ: -1,
  dist: 0, score: 0, combo: 0, maxCombo: 0, comboFlashT: -9, overtakes: 0, peak: 0,
  impacts: 0, failReason: null,
  jn: null, turn: null,
  fovBreathT: 0, camYaw: 0, viewYaw: 0, lastPX: 0,
  crashT: 0, newBest: false,
  best: LS.best, bestKm: LS.bestKm, runs: LS.runs,
  themeT: CFG.themeFirst, themeToastT: 0, titleAnimT: 0,
  mainlineAlpha: 1,                       // 主线渲染 alpha（进匝道 3s 淡出 / 汇入前 3s 淡入）
  lastLanes: 3, lastSecName: '城市街道', sectToastT: 0, sectToastName: '', bgScroll: 0,
  aiLaneT: 2, lastCoinSeg: -1, lastBoostSeg: -1,
  pickFlashT: -9, pickKind: '',
  curve: [], curveT: 0,              // §6A.3 本局速度-里程曲线采样
  newUnlock: null,                   // 本局跨过 5km 门槛时的解锁名（结算页提示）
  menuFrom: 'title',                 // map/gallery 的返回目标
};

setTrack(buildTrack());
game.traffic.reset(playerZabs());
initBg();
initInput(canvas);
resize();
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'running') game.state = 'paused'; });

function playerZabs() { return wrapZ(game.cam.z + CFG.playerZ); }

function setFov(fov) {
  game.cam.fov = fov;
  game.cam.depth = 1 / Math.tan((fov * Math.PI) / 360);
}

function beginRun() {
  const p = game.player;
  p.crashed = false;
  p.invuln = 1.0;
  p.brDir = 0; p.turn = null; p.turnT = 0;
  p.absorbed = false; p.absorbedT = 0;
  p.turnProg = 0; p.turnZoneTotal = 100; p.inTurn = false; p.lastTurnDir = undefined;
  for (const j of getTrack().junctions) j.chosen = null;
  if (game.state === 'crashed') p.speed = CFG.maxSpeed * 0.5;
  const jw = getTrack().junctionWindowAt(playerZabs());
  if (jw) {
    game.cam.z = wrapZ(jw.j.waitZ - 120);
    p.speed = CFG.maxSpeed * 0.5;
    game.traffic.reset(playerZabs());
    game.introT = 0.8;
  }
  clearFx();
  game.traffic.reset(playerZabs());
  game.dist = 0; game.score = 0; game.combo = 0; game.maxCombo = 0;
  game.overtakes = 0; game.peak = p.speed; game.newBest = false;
  game.impacts = 0; game.failReason = null;
  game.jn = null; game.turn = null;
  game.mainlineAlpha = 1;
  game.lastCoinSeg = -1; game.lastBoostSeg = -1;
  game.curve = []; game.curveT = 0;
  game.newUnlock = null;
  game.lastLanes = getTrack().roadInfoAt(playerZabs()).lanes;
  game.startZ = wrapZ(game.cam.z + 260);
  game.introT = 0.8;
  game.state = 'running';
}

function toTitle() {
  game.player.crashed = false;
  game.player.invuln = 0;
  game.player.brDir = 0; game.player.turn = null;
  game.player.absorbed = false; game.player.absorbedT = 0;
  for (const j of getTrack().junctions) j.chosen = null;
  clearFx();
  game.startZ = -1;
  game.titleAnimT = 0;
  game.state = 'title';
}

function doCrash(car, reason) {
  game.state = 'crashing';
  game.crashT = 0;
  game.player.crashed = true;
  if (reason) game.failReason = reason;
  game.runs++; LS.runs = game.runs;
  game.newBest = game.score > game.best;
  if (game.newBest) LS.best = Math.floor(game.score);
  // M4：图纸收藏解锁检测（本局跨过 5km 门槛）
  const oldKm = game.bestKm;
  if (game.dist > game.bestKm) { game.bestKm = game.dist; LS.bestKm = game.dist; }
  const nOld = unlockedCount(oldKm), nNew = unlockedCount(game.bestKm);
  if (nNew > nOld) game.newUnlock = UNLOCKS[nNew - 1].name;
  else game.newUnlock = null;
  sfxHit();                                   // M5：撞毁金属音
  const cam = game.cam;
  const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
  const bx = cam.cx + (game.player.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
  const by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
  const flat = !!reason;
  shatter('player', bx, by, ppmP, 0.6, { flat });
  if (car) {
    car.dead = true;
    const dz = wrapZ(car.z) - cam.z;
    const s = cam.depth / Math.max(dz, 3);
    shatter(car.type.key, cam.cx + s * (car.x - cam.x) * cam.halfW,
            cam.cy + s * cam.height * cam.halfW, s * cam.halfW);
  }
  addShake(flat ? 10 : 14);
}

// —— 路口状态机 ——
// 待转区：玩家变道 → 预选出口（保持 p.lane 不变，玩家自己控制车道）
// 过门框：匝道玩家 p.lane=出口车道（已被玩家选好），直行玩家 p.lane=对应车道（也已被选好）
// 分叉后主线路段少一车道（匝道占用），需要重新映射 lane 索引
function updateJunction() {
  const track = getTrack();
  const p = game.player;
  const pz = playerZabs();
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
      if (j.split) {
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

// —— AI 自动驾驶 ——
function aiInput(dt) {
  const p = game.player;
  const track = getTrack();
  game.aiLaneT -= dt;
  const pz = playerZabs();
  const jw = track.junctionWindowAt(pz);
  if (game.aiLaneT <= 0 && !jw) {
    game.aiLaneT = 3 + Math.random() * 4;
    if (Math.random() < 0.7) {
      const L = game.lastLanes || 3;
      const dir = p.lane === 0 ? 1 : p.lane === L - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
      p.lane += dir;
    }
  }
  // 待转区 AI 偏好直行
  if (jw && jw.phase === 'wait' && Math.random() < dt * 0.5) {
    const exit = track.exitForLane(jw.j, p.lane);
    if (exit.dir !== 0 && Math.random() < 0.8) {
      const straight = jw.j.exits.find(e => e.dir === 0);
      if (straight) p.lane = straight.lanes[0];
    }
  }
    // 强制转向区 AI 自动按正确方向
    let holdDir = input.left ? -1 : input.right ? 1 : 0;
    const tz = track.turnAt(pz, p.brDir);
    if (tz) holdDir = tz.dir;
    // 主线直行过岔路期间：AI 不按左右
    if (game.jn && game.jn.phase === 'branch' && game.jn.exit.dir === 0) holdDir = 0;
    return {
    up: p.speed < CFG.maxSpeed * 0.55, down: false, nitro: false,
    laneL: false, laneR: false, holdDir,
  };
}

// —— 主循环 ——
let lastT = performance.now();
function tickOnce(dt) {
  if (window.__LD && window.__LD.freeze) return;
  game.time += dt; game.dt = dt;
  game.fps = lerp(game.fps, 1 / dt, 0.06);

  const cam = game.cam;
  cam.cx = W / 2; cam.cy = H * CFG.horizon; cam.halfW = W / 2;

  updatePalette(dt);
  if (consumeSpriteRebuild()) refreshSprites();
  game.themeT -= dt;
  if (game.themeT <= 0) {
    const idx = THEME_ORDER.indexOf(PAL.key);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
    game.themeToastT = 1.6;
    game.themeT = CFG.themeGapMin + Math.random() * (CFG.themeGapMax - CFG.themeGapMin);
  }
  game.themeToastT = Math.max(0, game.themeToastT - dt);
  if (game.state === 'title') game.titleAnimT += dt;
  game.pickFlashT = Math.max(-9, game.pickFlashT - dt);

  // —— 输入 ——
  const acts = consumeActions();
  let laneL = false, laneR = false;
  for (const a of acts) {
    if (a === 'start') {
      if (game.state === 'title' || game.state === 'crashed') { beginRun(); sfxStart(); resumeAudio(); }
    } else if (a === 'pause') {
      if (game.state === 'running') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'running';
      if (game.state === 'paused') sfxMenu();
    } else if (a === 'title') {
      if (game.state === 'map' || game.state === 'gallery') { game.state = game.menuFrom; }
      else if (game.state === 'running' || game.state === 'crashed' || game.state === 'paused') toTitle();
    } else if (a === 'map') {
      // M4：路线图（从标题/结算/暂停进入；再按返回）
      if (game.state === 'map') game.state = game.menuFrom;
      else if (game.state === 'title' || game.state === 'crashed' || game.state === 'paused') {
        game.menuFrom = game.state; game.state = 'map';
      }
      sfxMenu();
    } else if (a === 'gallery') {
      // M4：图纸收藏图鉴
      if (game.state === 'gallery') game.state = game.menuFrom;
      else if (game.state === 'title' || game.state === 'crashed' || game.state === 'paused') {
        game.menuFrom = game.state; game.state = 'gallery';
      }
      sfxMenu();
    } else if (a === 'toggleFps') game.showFps = !game.showFps;
    else if (a === 'mute') { toggleMute(); sfxMenu(); }
    else if (a === 'curveMode') {
      const next = getTrack().nextJunctionStart(playerZabs());
      if (next) {
        game.cam.z = wrapZ(next.waitZ - 350);
        game.player.speed = CFG.maxSpeed * 0.5;
        game.traffic.reset(playerZabs());
        game.introT = 0.8;
        game.jn = null; game.turn = null;
      }
    } else if (a === 'laneL') { laneL = true; sfxLane(); }
    else if (a === 'laneR') { laneR = true; sfxLane(); }
    else if (a === 'nitroBurst') {
      if (game.state === 'running') { game.player.nitro = Math.max(game.player.nitro, 0.99); game.player.nitroOn = true; }
    }
  }

  const p = game.player;
  const track = getTrack();

  if (game.state === 'title' || game.state === 'running') {
    updateJunction();
    // 强制转向区判定：匝道弯曲段（brDir != 0）/ S 弯主线（turn.dir != 0）
    game.turn = track.turnAt(playerZabs(), p.brDir);
    p.turn = game.turn;
    // —— 转向完成条（v4.11）：按住方向键时按"走过的路程 ÷ 转向区总长"逐渐填充；出弯时 <3/4 判定失败 ——
    // 全程按住 = 条随行驶从 0 平滑涨到 1（不是瞬间拉满）
    {
      const turnNow = game.turn;
      const dirChanged = turnNow && p.lastTurnDir !== undefined && turnNow.dir !== p.lastTurnDir;
      if (turnNow && (!p.inTurn || dirChanged)) {
        // 进入转向区（或弯曲方向切换 = 新转向区）：扫描该区非 grace 段总长作为完成条满值基准
        p.turnProg = 0;
        p.inTurn = true;
        p.turnZoneTotal = 100;
        const segs2 = track.segs, N2 = segs2.length;
        const i0 = Math.floor(wrapZ(playerZabs()) / CFG.segLen);
        let len = 0;
        for (let k = 0; k < 200; k++) {
          const s2 = segs2[(i0 + k) % N2];
          const tr = p.brDir ? (s2.turnRamp ? s2.turnRamp[p.brDir] : null) : s2.turn;
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
          if ((p.turnProg || 0) < 0.75) { sfxTurnFail(); doCrash(null, '转向力度不足'); }
          else game.fovBreathT = 0.6;                            // 成功反馈：fov 呼吸
        }
        p.inTurn = false; p.turnProg = 0; p.lastTurnDir = undefined;
      }
    }
    // —— 主线淡出/淡入通道（v4.5 + v4.9 + v4.10）——
    {
      let mlTarget = 1;
      const onRamp = p.brDir !== 0 && game.jn && game.jn.phase === 'bend';
      const absorbedSplit = p.absorbed && game.jn && game.jn.j && game.jn.j.split;
      if (onRamp) {
        const j = game.jn.j;
        if (j.split) {
          mlTarget = 0;                                  // v4.9 split 弯出段：老路淡出保持
        } else {
          const pzNow = playerZabs();
          const distToMerge = ((j.mergeZ - pzNow) % track.length + track.length) % track.length;
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
    }
    // 待转区内可变道选向；过门框后 laneL/R 锁死
    if (game.jn && game.jn.phase === 'wait') {
      // laneL/R 正常处理（让玩家换车道）
    } else if (game.jn && game.jn.phase === 'branch') {
      laneL = false; laneR = false;          // 匝道单车道不可换道
    } else {
      // 非路口段正常变道
    }
    // 车道数随路段变化时重映射当前车道索引（但 jn 期间跳过——匝道玩家车道已锁定）
    const ri = track.roadInfoAt(playerZabs());
    if (ri.lanes !== game.lastLanes && !game.jn) {
      p.lane = clamp(Math.round((p.lane * (ri.lanes - 1)) / Math.max(1, game.lastLanes - 1)), 0, ri.lanes - 1);
      game.lastLanes = ri.lanes;
    } else if (ri.lanes !== game.lastLanes) {
      // 出口/匝道期间：lane 钳到新路段范围，但不主动重映射
      p.lane = clamp(p.lane, 0, ri.lanes - 1);
      game.lastLanes = ri.lanes;
    }
    p.laneMax = ri.lanes;
    // 横向目标：匝道中心线 / 主线车道中心 / 隧道不变
    let laneX;
    if (p.brDir) {
      const r = track.rampInfoAt(playerZabs(), p.brDir);
      laneX = r ? r.off : track.laneCenterAt(playerZabs(), p.lane);
    } else {
      laneX = track.laneCenterAt(playerZabs(), p.lane);
    }

    if (game.state === 'title') {
      updatePlayer(p, aiInput(dt), dt, track.effCurveAt(game.cam.z + 60, p.brDir), laneX, ri.type === 'desert');
      advanceWorld(dt);
      game.traffic.update(dt, p, playerZabs(), Infinity, []);
    } else {
      p.nitroOn = input.nitro && p.nitro > 0.05 && p.speed > CFG.maxSpeed * 0.3;
      updatePlayer(p, { up: input.up, down: input.down, nitro: input.nitro, laneL, laneR, holdDir: input.left ? -1 : input.right ? 1 : 0 },
                   dt, track.effCurveAt(game.cam.z + 60, p.brDir), laneX, ri.type === 'desert');

      // —— §10.4 强制转向区撞栏判定 ——
      // 三类情境：
      // (A) 匝道弯曲段：grace 期外未按正确方向 → 外漂
      // (B) 主线直行过岔路：phase='branch' 且车道对应的是直行出口 → 按 ←/→ 即外漂
      // (C) S 弯主线：grace 期外未按正确方向 → 外漂
      if (game.state === 'running') {
        const inBranch = game.jn && game.jn.phase === 'branch';
        if (game.turn && !game.turn.grace) {
          // (A)(C)：有 turn 但没在 grace 期
          const lim = game.turn.half - 0.45;
          if (Math.abs(p.x - laneX) > lim) doCrash(null, '冲出弯道撞上护栏');
        } else if (inBranch && game.jn.exit.dir === 0 && !laneL && !laneR) {
          // (B)：直行过岔路时玩家按了 ←/→ → laneL/laneR 是边沿事件；
          //     但玩家也可能一直按住 ←/→ 方向键持续"提醒"，所以用 input.left/input.right 实时判定
          if ((input.left || input.right) && !p.brDir) {
            const lim = ri.half - 0.45;
            if (Math.abs(p.x - laneX) > 0.6) doCrash(null, '直行通过禁止按左右键');
          }
        }
      }

      // 沙漠公路出界减速
      if (ri.type === 'desert' && Math.abs(p.x) > ri.half - 0.55) {
        p.speed = Math.min(p.speed, CFG.maxSpeed * 0.35);
      }
      // 跨海大桥侧风
      if (ri.type === 'bridge') {
        p.drift += Math.sin(game.time * 0.6 + 2) * CFG.bridgeWind * dt * (p.speed / CFG.maxSpeed);
      }

      advanceWorld(dt);
      game.dist += p.speed * dt;
      // §6A.3 速度-里程曲线采样（每 0.25s 一点，上限 900 点）
      game.curveT += dt;
      if (game.curveT >= 0.25) {
        game.curveT = 0;
        if (game.curve.length < 900) game.curve.push({ d: game.dist, s: p.speed });
      }
      game.peak = Math.max(game.peak, p.speed);
      const mult = Math.min(3, 1 + game.combo * 0.1);
      game.score += p.speed * dt * mult;

      // 金币线 / 加速带拾取
      const segP = segAt(playerZabs());
      if (segP.coin >= 0 && game.lastCoinSeg !== segP.i &&
          Math.abs(p.x - track.laneCenterAt(playerZabs(), segP.coin)) < 1.7) {
        game.lastCoinSeg = segP.i;
        game.score += CFG.coinScore;
        game.pickFlashT = game.time; game.pickKind = 'coin';
        sfxCoin();
      }
      // v4.9 匝道金币：玩家在对应匝道上且贴近匝道中心线时拾取
      if (segP.coinRamp && p.brDir === segP.coinRamp && game.lastCoinSeg !== segP.i) {
        const rinfo = track.rampInfoAt(playerZabs(), p.brDir);
        if (rinfo && Math.abs(p.x - rinfo.off) < 2.0) {
          game.lastCoinSeg = segP.i;
          game.score += CFG.coinScore;
          game.pickFlashT = game.time; game.pickKind = 'coin';
          sfxCoin();
        }
      }
      if (segP.boost >= 0 && game.lastBoostSeg !== segP.i &&
          Math.abs(p.x - track.laneCenterAt(playerZabs(), segP.boost)) < 1.8) {
        game.lastCoinSeg = segP.i;
        game.lastBoostSeg = segP.i;
        const max = p.nitroOn ? CFG.nitroSpeed : CFG.maxSpeed;
        p.speed = Math.min(max * 1.05, p.speed + CFG.boostKick);
        p.nitro = Math.min(1, p.nitro + CFG.boostNitro);
        game.pickFlashT = game.time; game.pickKind = 'boost';
        sfxBoost();
      }

      const events = [];
      game.traffic.update(dt, p, playerZabs(), game.dist, events);
      for (const ev of events) processEvent(ev);
      game.introT = Math.max(0, game.introT - dt);

      // 路段提示
      const sec = track.sectionAt(playerZabs());
      if (sec.name !== game.lastSecName) {
        game.lastSecName = sec.name;
        game.sectToastName = sec.name;
        game.sectToastT = 1.6;
      }
    }
  } else if (game.state === 'crashing') {
    game.crashT += dt;
    updateFx(dt * (game.crashT < 0.4 ? 0.25 : 1));
    if (game.crashT > CFG.crashAnim) game.state = 'crashed';
  } else if (game.state === 'crashed') {
    updateFx(dt);
  } else if (game.state === 'paused') {
    /* 冻结 */
  }

  // —— 相机通道：fov + 水平偏航（看向弯内）+ 俯仰（随上下坡）——
  // 匝道段收紧相机横向滞后（横向速度可达 12m/s，0.2s 滞后会把主车甩出屏幕）
  const camTau = p.brDir ? 0.06 : CFG.camLagTau;
  cam.x += (p.x - cam.x) * (1 - Math.exp(-dt / camTau));
  let fovTarget = p.nitroOn ? CFG.fovNitro : CFG.fovBase;
  if (game.fovBreathT > 0) {
    game.fovBreathT = Math.max(0, game.fovBreathT - dt);
    fovTarget -= 4 * Math.sin(Math.PI * (1 - game.fovBreathT / 0.6));
  }
  cam.fov += (fovTarget - cam.fov) * (1 - Math.exp(-dt / CFG.fovTau));
  setFov(cam.fov);

  // 水平偏航：看向弯内（匝道用近+远点曲率均值让 90° 大弯视觉连贯）；
  // 强制转向区增益 ×1.6
  const crNow = track.effCurveAt(game.cam.z + 30, p.brDir);
  const crFar = track.effCurveAt(game.cam.z + 90, p.brDir);
  const effCr = p.brDir ? (crNow + crFar) * 0.5 : crNow;
  const inTurn = !!(game.turn || (game.jn && game.jn.phase === 'branch' && p.brDir));
  const gain = inTurn ? CFG.curveGain : 1;
  // 90° 大弯每 5m 段 crs 累加 ≈ 0.3 rad/m；钳制 ±0.12 避免主车被视线偏移推出画面
  const yawT = clamp(-effCr * (p.speed / CFG.maxSpeed) * 8.0 * gain, -0.12, 0.12);
  game.camYaw += (yawT - game.camYaw) * (1 - Math.exp(-dt / 0.18));
  cam.cx = W / 2 + game.camYaw * W;

  // §7A.3 viewYaw 单一状态源
  const latVel = (p.x - (game.lastPX ?? p.x)) / Math.max(dt, 1e-4);
  game.lastPX = p.x;
  const viewYawT = game.camYaw * 1.08 + clamp(latVel * 0.010, -0.30, 0.30);
  game.viewYaw += (viewYawT - game.viewYaw) * (1 - Math.exp(-dt / 0.2));

  // §3.3A 俯仰（v4.9 按用户要求）：上坡 → 视角持续向下移动（俯视坡面）；下坡 → 视角向上抬高（仰视）
  const yHere = track.slopeAt(playerZabs());
  const pitchT = clamp(-yHere * 0.028, -0.34, 0.34);   // 上坡 y>0 → pitch 负 → cy 上移 = 俯视
  game.cam.pitch += (pitchT - game.cam.pitch) * (1 - Math.exp(-dt / 0.45));
  cam.cy = H * CFG.horizon + game.cam.pitch * H * 0.42;
  cam.height = CFG.camHeight - yHere * 0.4;             // 相机随上下坡微降/微升

  // 画质自适应
  game.qT = (game.qT || 0) + dt;
  if (game.qT > 2) {
    game.qT = 0;
    const d = game.drawDist || CFG.drawDist;
    if (game.fps < 38 && d > 140) game.drawDist = d - 60;
    else if (game.fps < 48 && d > 180) game.drawDist = d - 40;
    else if (game.fps > 57 && d < CFG.drawDist) game.drawDist = Math.min(CFG.drawDist, d + 40);
  }

  if (game.state !== 'crashing' && game.state !== 'crashed') updateFx(dt);
  updateShake(dt);

  // M5：引擎声跟随加速度（用户反馈 v2：匀速静默，加速"增大声"/减速"减小声"）
  // 放在 tickOnce 内使其可被 __LD.step 手动驱动（后台 tab 的 rAF 会被节流）
  if (game.state === 'title' || game.state === 'running' || game.state === 'paused') {
    const acc = (game.player.speed - (game.lastSpeed ?? game.player.speed)) / Math.max(dt, 1e-4);
    game.lastSpeed = game.player.speed;
    game.speedAccel = game.speedAccel == null ? acc : game.speedAccel + (acc - game.speedAccel) * Math.min(1, dt * 8);
    setEngineState(game.player.speed, !!game.player.nitroOn, game.speedAccel);
  } else {
    killEngine();
  }

  // —— 渲染 ——
  if (!window.__LD?.headless) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderWorld(ctx, W, H, game);
    if (game.state === 'running' || game.state === 'paused') {
      drawHUD(ctx, W, H, game);
      drawJunction(ctx, W, H, game);
    } else if (game.state === 'title') {
      drawTitle(ctx, W, H, game);
    } else if (game.state === 'crashing' || game.state === 'crashed') {
      drawHUD(ctx, W, H, game);
      drawCrash(ctx, W, H, game);
    } else if (game.state === 'map') {
      // M4：路线图覆盖层（底层保留实时演示画面）
      if (game.menuFrom === 'title') drawTitle(ctx, W, H, game);
      drawMap(ctx, W, H, game, getTrack());
    } else if (game.state === 'gallery') {
      if (game.menuFrom === 'title') drawTitle(ctx, W, H, game);
      drawGallery(ctx, W, H, game);
    }
    if (game.state === 'paused') drawPause(ctx, W, H);
  }
  // 开场视频（§6A.5：叠在标题页之上，播完/跳过后淡出移除）
  updateIntro(dt, () => { /* 视频结束：标题页已在底层实时运行，无需切换 */ });

  // —— M5：移动端适配（§4.3 竖屏提示 + 首局触控引导）——
  if (!window.__LD?.headless) {
    if (H > W * 1.05) {
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.88;
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      ctx.fillStyle = PAL.line; ctx.textAlign = 'center';
      ctx.font = '16px ui-monospace, monospace';
      ctx.fillText('请 横 屏 游 玩', W / 2, H / 2 - 8);
      ctx.font = '11px ui-monospace, monospace'; ctx.globalAlpha = 0.6;
      ctx.fillText('ROTATE YOUR DEVICE', W / 2, H / 2 + 18);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    } else if (TOUCH && game.state === 'running' && game.dist < 260) {
      const aT = clamp(1 - game.dist / 260, 0, 1);
      ctx.font = '13px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.globalAlpha = aT * 0.8; ctx.fillStyle = PAL.line;
      ctx.fillText('上滑区 加速 · 下滑区 刹车 · 左右滑 变道 · 双击 氮气 · 双指 暂停', W / 2, H * 0.72);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }
}

function loop(t) {
  const dt = clamp((t - lastT) / 1000, 0.001, 0.05);
  lastT = t;
  try {
    tickOnce(dt);
  } catch (e) {
    window.__LDerr = String(e && e.stack || e).slice(0, 400);
    if (!window.__LDerrSeen) { window.__LDerrSeen = true; console.error('[LD] frame error:', e); }
  }
  requestAnimationFrame(loop);
}

function advanceWorld(dt) {
  game.cam.z = wrapZ(game.cam.z + game.player.speed * dt);
  game.bgScroll += game.player.speed * dt;
}

function processEvent(ev) {
  const p = game.player;
  if (ev.type === 'overtake') {
    game.overtakes++;
    if (ev.close) {
      game.combo++;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      game.comboFlashT = game.time;
      game.score += 50 * Math.min(3, 1 + game.combo * 0.1);
      p.nitro = Math.min(1, p.nitro + CFG.nitroOvertake);
      sfxOvertake(game.combo);
    }
  } else if (ev.type === 'scrape') {
    game.combo = 0;
    p.speed *= CFG.scrapeSlow;
    addShake(3);
    const cam = game.cam;
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    burstSparks(bx + ev.side * 0.95 * ppmP, cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW - 0.5 * ppmP, ev.side, 10);
    sfxScrape();
  } else if (ev.type === 'hit') {
    const cam = game.cam;
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    const by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
    if (ev.grace) {
      game.combo = 0;
      p.speed = Math.max(p.speed * 0.7, ev.car.speed - 1);
      addShake(5);
      burstSparks(bx, by - 0.9 * ppmP, 0, 14);
      sfxScrape();
    } else {
      game.impacts++;
      game.combo = 0;
      if (game.impacts > CFG.maxImpacts) doCrash(ev.car, null);
      else {
        p.speed = Math.max(p.speed * CFG.hitFloor, ev.car.speed - 1);
        p.invuln = CFG.hitInvuln;
        addShake(8);
        burstSparks(bx, by - 0.9 * ppmP, 0, 20);
        sfxHit();
      }
    }
  }
}

requestAnimationFrame(loop);

// —— M4：开场视频（§6A.5 会话内只播一次；标题页在底层实时预热，播完淡出即是 live 画面）——
startIntro(null);
// —— M5：音频初始化（首次用户手势解锁 AudioContext）——
initAudio();
// 每次手势都尝试 resume（幂等加固：自动播放策略要求真实用户手势，且部分浏览器需要多个手势）
window.addEventListener('pointerdown', () => resumeAudio());
window.addEventListener('keydown', () => resumeAudio());

// 开发调试钩子
window.__LD = {
  game, input, CFG, track: getTrack(),
  step: (n = 1, dt = 1 / 60) => {
    const f = window.__LD.freeze; window.__LD.freeze = false;
    for (let i = 0; i < n; i++) tickOnce(dt);
    window.__LD.freeze = f;
  },
  pal: { setTheme, THEMES, THEME_ORDER },
  audio: { mute: toggleMute, resume: resumeAudio, diag: audioDiag },
  goto: (z) => {
    game.cam.z = wrapZ(z);
    game.player.speed = CFG.maxSpeed * 0.5;
    game.traffic.reset(playerZabs());
    game.jn = null; game.turn = null; game.introT = 0.3;
  },
  jump: (type) => {
    const track = getTrack();
    for (const s of track.sections) {
      if (s.type === type) { window.__LD.goto(s.startZ + 50); return; }
    }
  },
  crash: (reason) => doCrash(null, reason || '调试撞毁'),
  rebuild: (seed) => {
    // 重新构建轨道需刷新页面（ESM 模块缓存）；这里仅跳转
    window.__LD.goto(0);
  },
};
