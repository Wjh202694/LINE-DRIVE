// main.js — 引导、游戏状态机与主循环
// 状态：title（AI 自动驾驶演示）→ running → crashing（画崩演出）→ crashed（测绘报告）→ running …
// §10.3 撞击计数：3 次重创容忍，第 4 次撞毁；§10.4 待转区+按住转向，失败=侧向撞栏直接结束。
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

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;

function resize() {
  const dpr2 = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(window.innerWidth * dpr2), h = Math.round(window.innerHeight * dpr2);
  W = window.innerWidth; H = window.innerHeight;
  if (canvas.width !== w || canvas.height !== h || dpr !== dpr2) {
    dpr = dpr2;
    canvas.width = w; canvas.height = h;       // 重赋值会清空画布，尺寸未变时跳过
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
}

// —— 持久化（隐私模式/受限环境 localStorage 会抛异常，降级为内存存储，不能阻断启动）——
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

// —— 游戏对象 ——
const game = {
  state: 'title',
  time: 0, fps: 60, showFps: true,
  player: createPlayer(),
  traffic: new Traffic(),
  cam: { x: 0, z: 0, height: CFG.camHeight, cx: 0, cy: 0, halfW: 0, depth: 1, fov: CFG.fovBase },
  introT: 0, startZ: -1,
  dist: 0, score: 0, combo: 0, maxCombo: 0, comboFlashT: -9, overtakes: 0, peak: 0,
  impacts: 0, failReason: null,
  steer: { phase: 'none', curve: null, selected: false, progress: 0, startX: 0, graceT: 0 },
  fovBreathT: 0, yaw: 0,
  crashT: 0, newBest: false,
  best: LS.best, bestKm: LS.bestKm, runs: LS.runs,
  themeT: CFG.themeFirst, themeToastT: 0, titleAnimT: 0,
  lastLanes: 3, lastSecName: '城市街道', sectToastT: 0, sectToastName: '', bgScroll: 0,
  aiLaneT: 2,
};

setTrack(buildTrack());
game.traffic.reset(playerZabs());
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
  if (game.state === 'crashed') p.speed = CFG.maxSpeed * 0.5;
  // 重开位置若落在弯道禁行窗内（转向区内撞毁的情形），退到弯前 120m，避免秒判负死循环
  const jw = getTrack().junctionWindowAt(playerZabs());
  if (cw) {
    game.cam.z = wrapZ(cw.waitZ - 120);
    p.speed = CFG.maxSpeed * 0.5;
    game.traffic.reset(playerZabs());
    game.introT = 0.8;
  }
  clearFx();
  game.traffic.reset(playerZabs());
  game.dist = 0; game.score = 0; game.combo = 0; game.maxCombo = 0;
  game.overtakes = 0; game.peak = p.speed; game.newBest = false;
  game.impacts = 0; game.failReason = null;
  game.jn = null;
  game.lastLanes = getTrack().roadInfoAt(playerZabs()).lanes;
  game.startZ = wrapZ(game.cam.z + 260);
  game.introT = 0.8;
  game.state = 'running';
}

function toTitle() {
  game.player.crashed = false;
  game.player.invuln = 0;
  clearFx();
  game.startZ = -1;
  game.titleAnimT = 0;                    // 标题逐笔动画重播（§6A.1）
  game.state = 'title';
}

// 撞毁（撞击第 4 次 / 转向失败侧撞）：车毁=画崩
function doCrash(car, reason) {
  game.state = 'crashing';
  game.crashT = 0;
  game.player.crashed = true;
  if (reason) game.failReason = reason;
  game.runs++; LS.runs = game.runs;
  game.newBest = game.score > game.best;
  if (game.newBest) LS.best = Math.floor(game.score);
  if (game.dist > game.bestKm) { game.bestKm = game.dist; LS.bestKm = game.dist; }

  const cam = game.cam;
  const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
  const bx = cam.cx + (game.player.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
  const by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
  const flat = reason === '撞上护栏';                 // 侧向撞栏：扁碎线沿切线（§10.5）
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

// —— 路口状态机（§10.4 修订版：车道选向）——
// 待转区内「变道即选向」：每个出口对应专用车道，车道定位实时预览弯道方向；
// 过了待转区车道锁定，随弯道行驶；单出口路口任意车道直接通过，无需选择。
function updateJunction() {
  const track = getTrack();
  const jw = track.junctionWindowAt(playerZabs());
  if (!jw) { game.jn = null; return; }
  const { j } = jw;
  const exit = track.exitForLane(j, game.player.lane);
  if (playerZabs() < j.bendZ) {
    track.setJunctionDir(j, exit.dir);            // 待转区内变道 = 实时改弯道方向
    game.jn = { j, phase: 'wait', exit };
  } else {
    game.jn = { j, phase: 'bend', exit };         // 车道锁定（主循环抑制变道）
  }
}

// —— AI 自动驾驶（标题页演示；自动应对弯道）——
function aiInput(dt, cw) {
  const p = game.player;
  game.aiLaneT -= dt;
  if (game.aiLaneT <= 0) {
    game.aiLaneT = 3 + Math.random() * 4;
    if (Math.random() < 0.7) {
      const dir = p.lane === 0 ? 1 : p.lane === CFG.lanes - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
      p.lane += dir;
    }
  }
  // AI 在路口待转区随机变道演示选向
  const jnw = getTrack().junctionWindowAt(playerZabs());
  if (jnw && playerZabs() < jnw.j.bendZ && Math.random() < dt * 0.5) {
    const info = getTrack().roadInfoAt(playerZabs());
    const dir = game.player.lane === 0 ? 1 : game.player.lane === info.lanes - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
    game.player.lane = clamp(game.player.lane + dir, 0, info.lanes - 1);
  }
  return {
    up: p.speed < CFG.maxSpeed * 0.55, down: false, nitro: false,
    laneL: false, laneR: false,
    holdDir: cw ? cw.dir : 0,
  };
}

// —— 主循环 ——
let lastT = performance.now();
function tickOnce(dt) {
  if (window.__LD && window.__LD.freeze) return;   // 测试冻结：保留最后一帧
  game.time += dt;
  game.fps = lerp(game.fps, 1 / dt, 0.06);

  const cam = game.cam;
  cam.cx = W / 2; cam.cy = H * CFG.horizon; cam.halfW = W / 2;

  // —— 主题流转（§3.2A：环形顺序 45–75s 随机，3s 插值；量化跨步重建 sprite）——
  updatePalette(dt);
  if (consumeSpriteRebuild()) refreshSprites();
  game.themeT -= dt;
  if (game.themeT <= 0) {
    const idx = THEME_ORDER.indexOf(PAL.key);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
    game.themeToastT = 1.6;               // 「时辰·○○」彩蛋提示
    game.themeT = CFG.themeGapMin + Math.random() * (CFG.themeGapMax - CFG.themeGapMin);
  }
  game.themeToastT = Math.max(0, game.themeToastT - dt);
  if (game.state === 'title') game.titleAnimT += dt;

  // —— 输入 ——
  const acts = consumeActions();
  let laneL = false, laneR = false;
  for (const a of acts) {
    if (a === 'start') {
      if (game.state === 'title' || game.state === 'crashed') beginRun();
    } else if (a === 'pause') {
      if (game.state === 'running') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'running';
    } else if (a === 'title') {
      if (game.state === 'running' || game.state === 'crashed' || game.state === 'paused') toTitle();
    } else if (a === 'toggleFps') game.showFps = !game.showFps;
    else if (a === 'curveMode') {
      // 跳到下一个弯道的预告牌前（测试用）
      const next = getTrack().nextJunctionStart(playerZabs());
      if (next) {
        game.cam.z = wrapZ(next.waitZ - 350);
        game.player.speed = CFG.maxSpeed * 0.5;
        game.traffic.reset(playerZabs());
        game.introT = 0.8;
        game.jn = null;                         // 瞬移后清陈旧状态
      }
    } else if (a === 'laneL') laneL = true;
    else if (a === 'laneR') laneR = true;
    else if (a === 'nitroBurst') {
      if (game.state === 'running') { game.player.nitro = Math.max(game.player.nitro, 0.99); game.player.nitroOn = true; }
    }
  }

  const p = game.player;
  const curveAhead = segAt(game.cam.z + 60).curve;

  if (game.state === 'title' || game.state === 'running') {
    const track = getTrack();
    updateJunction();
    // 路口弯道内车道锁定（§10.4 修订：过了待转区不能自由变道）
    if (game.jn && game.jn.phase === 'bend') { laneL = false; laneR = false; }
    // 车道数随路段变化：重映射当前车道索引（§5）
    const ri = track.roadInfoAt(playerZabs());
    if (ri.lanes !== game.lastLanes) {
      p.lane = clamp(Math.round((p.lane * (ri.lanes - 1)) / Math.max(1, game.lastLanes - 1)), 0, ri.lanes - 1);
      game.lastLanes = ri.lanes;
    }
    p.laneMax = ri.lanes;
    const laneX = track.laneCenterAt(playerZabs(), p.lane);

    if (game.state === 'title') {
      updatePlayer(p, aiInput(dt), dt, curveAhead, laneX, ri.type === 'desert');
      advanceWorld(dt);
      game.traffic.update(dt, p, playerZabs(), Infinity, []);   // 演示模式车流照常
    } else {
      p.nitroOn = input.nitro && p.nitro > 0.05 && p.speed > CFG.maxSpeed * 0.3;
      updatePlayer(p, { up: input.up, down: input.down, nitro: input.nitro, laneL, laneR, holdDir: input.left ? -1 : input.right ? 1 : 0 }, dt, curveAhead, laneX, ri.type === 'desert');

      // 沙漠公路出界减速（§5：无护栏，冲出路肩判定）
      if (ri.type === 'desert' && Math.abs(p.x) > ri.half - 0.55) {
        p.speed = Math.min(p.speed, CFG.maxSpeed * 0.35);
      }

      advanceWorld(dt);
      game.dist += p.speed * dt;
      game.peak = Math.max(game.peak, p.speed);
      const mult = Math.min(3, 1 + game.combo * 0.1);
      game.score += p.speed * dt * mult;

      const events = [];
      game.traffic.update(dt, p, playerZabs(), game.dist, events);
      for (const ev of events) processEvent(ev);
      game.introT = Math.max(0, game.introT - dt);

      // 路段提示（§5 进入新路段）
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

  // —— 相机通道（滞后 + fov + 弯道偏航）——
  cam.x += (p.x - cam.x) * (1 - Math.exp(-dt / CFG.camLagTau));
  let fovTarget = p.nitroOn ? CFG.fovNitro : CFG.fovBase;
  if (game.fovBreathT > 0) {                            // 转向完成呼吸 62→58→62
    game.fovBreathT = Math.max(0, game.fovBreathT - dt);
    fovTarget -= 4 * Math.sin(Math.PI * (1 - game.fovBreathT / 0.6));
  }
  cam.fov += (fovTarget - cam.fov) * (1 - Math.exp(-dt / CFG.fovTau));
  setFov(cam.fov);

  // 偏航（看向弯内 §4A.1）：转向区增益 ×1.6；幅度收敛（参考视频：视角平稳）
  const curveAhead2 = segAt(game.cam.z + 60).curve;
  const gain = game.jn && game.jn.phase === 'bend' ? CFG.curveGain : 1;
  const yawT = clamp(-curveAhead2 * (p.speed / CFG.maxSpeed) * 0.03 * gain, -0.035, 0.035);
  game.yaw += (yawT - game.yaw) * (1 - Math.exp(-dt / 0.25));
  cam.cx = W / 2 + game.yaw * W;

  // —— 画质自适应 ——
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

  // —— 渲染 ——
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
  }
  if (game.state === 'paused') drawPause(ctx, W, H);
}

function loop(t) {
  const dt = clamp((t - lastT) / 1000, 0.001, 0.05);
  lastT = t;
  try {
    tickOnce(dt);
  } catch (e) {
    // 任何单帧异常都不能静默打断 rAF 链（曾导致主循环死亡、标题动画停播）
    window.__LDerr = String(e && e.stack || e).slice(0, 400);
    if (!window.__LDerrSeen) { window.__LDerrSeen = true; console.error('[LD] frame error:', e); }
  }
  requestAnimationFrame(loop);
}

function advanceWorld(dt) {
  game.cam.z = wrapZ(game.cam.z + game.player.speed * dt);
  game.bgScroll += game.player.speed * dt;    // 背景视差滚动累积
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
    }
  } else if (ev.type === 'scrape') {
    game.combo = 0;
    p.speed *= CFG.scrapeSlow;
    addShake(3);
    const cam = game.cam;
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    burstSparks(bx + ev.side * 0.95 * ppmP, cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW - 0.5 * ppmP, ev.side, 10);
  } else if (ev.type === 'hit') {
    const cam = game.cam;
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    const by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
    if (ev.grace) {
      // 教学期（§5A.5）：不计数，按重剐蹭处理
      game.combo = 0;
      p.speed = Math.max(p.speed * 0.7, ev.car.speed - 1);
      addShake(5);
      burstSparks(bx, by - 0.9 * ppmP, 0, 14);
    } else {
      // §10.3 撞击计数：第 4 次撞毁
      game.impacts++;
      game.combo = 0;
      if (game.impacts > CFG.maxImpacts) {
        doCrash(ev.car, null);
      } else {
        p.speed = Math.max(p.speed * CFG.hitFloor, ev.car.speed - 1);
        p.invuln = CFG.hitInvuln;
        addShake(8);
        burstSparks(bx, by - 0.9 * ppmP, 0, 20);
      }
    }
  }
}

requestAnimationFrame(loop);

// 开发调试钩子（M1 实测用，发布版可移除）：
// step(n) 手动泵 n 帧（面板被遮挡 rAF 暂停时也能确定性测试）
// 开发调试钩子（M1 实测用，发布版可移除）：
// step(n) 手动泵 n 帧（面板被遮挡 rAF 暂停时也能确定性测试）
window.__LD = {
  game, input, CFG, track: getTrack(),
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tickOnce(dt); },
  pal: { setTheme, THEMES, THEME_ORDER },
};
