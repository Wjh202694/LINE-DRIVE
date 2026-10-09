// render.js — 分层渲染器（v2 2026-10-07 第二轮反馈重写）
// 隧道暗化 / 桥塔基底对齐路面 / 船队 25-55m 外不与桥重叠 / 上下坡俯仰 / 匝道双带 grace 标定。
import { CFG, clamp, lerp } from './config.js';
import { PAL } from './palette.js';
import { getTrack, wrapDelta } from './road.js';
import { drawSprite, drawSpriteScaled, drawCurveSign } from './sprites.js';
import { shake, drawFx, drawSpeedLines, drawNitroFlames } from './fx.js';
import { drawBackground } from './bg.js';
import { sideProfile, carLength } from './wire.js';

const MAXP = 512;
const PX = new Float64Array(MAXP), PY = new Float64Array(MAXP),
      PW = new Float64Array(MAXP), PS = new Float64Array(MAXP),
      YW = new Float64Array(MAXP);

const items = [];

const SPAN_KEYS = new Set(['gantry', 'footbridge', 'tower_a', 'tower_b']);

// 护栏 4 条横线组合：[横向符号, 高度因子]（左外/左中/右外/右中）
const RAIL_COMBOS = [[-1, 1], [-1, 0.55], [1, 1], [1, 0.55]];

// 匝道整体渲染缓存（模块级复用）
const RX = new Float64Array(256), RY = new Float64Array(256), RW = new Float64Array(256);
const RI = new Int32Array(256), RL = new Uint8Array(256), RC = new Uint8Array(256);

// —— 匝道整体渲染（v4.8）：整条连续曲线——左右路缘各一条一次绘制的贝塞尔路径 ——
// v4.9：per-段 half/lanes（分岔型扩展段路宽 2.65→6.35、车道 1→3）+ 匝道金币渲染
function drawRamps(ctx, cam, game, D, scr) {
  const track = getTrack();
  const segs = track.segs, N = segs.length, SL = CFG.segLen;
  const baseIdx = Math.floor(cam.z / SL);
  const onRamp = (game.player.brDir || 0) !== 0;
  const alpha = onRamp ? 0.95 : 0.82;               // 玩家不走匝道时稍暗（非当前路径）
  const lwRamp = Math.max(1.2, CFG.lwNear * scr * 1.2);
  for (const j of track.junctions) {
    for (const r of j.ramps) {
      let cnt = 0;
      for (let i = 0; i < r.n && cnt < 255; i++) {
        const absIdx = (j.forkStart + i) % N;
        // 渲染段号 k（相对相机），必须在可视范围内
        const k = ((absIdx - baseIdx) % N + N) % N;
        if (k < 1 || k > D) continue;
        if (Number.isNaN(PX[k]) || Number.isNaN(PY[k])) continue;
        const s = PS[k];
        RX[cnt] = PX[k] + s * r.off[i] * cam.halfW;
        RY[cnt] = PY[k];
        RW[cnt] = s * r.halfArr[i] * cam.halfW;
        RI[cnt] = absIdx;
        RL[cnt] = r.lanesArr[i];
        RC[cnt] = segs[absIdx].coinRamp === r.dir ? 1 : 0;
        cnt++;
      }
      if (cnt < 2) continue;
      ctx.strokeStyle = PAL.line;
      ctx.lineWidth = lwRamp;
      ctx.globalAlpha = alpha;
      // 左路缘：一整条平滑曲线
      ctx.beginPath();
      ctx.moveTo(RX[0] - RW[0], RY[0]);
      for (let i = 0; i < cnt - 2; i++) {
        const cxp = RX[i + 1] - RW[i + 1], cyp = RY[i + 1];
        ctx.quadraticCurveTo(cxp, cyp, (cxp + RX[i + 2] - RW[i + 2]) / 2, (cyp + RY[i + 2]) / 2);
      }
      ctx.lineTo(RX[cnt - 1] - RW[cnt - 1], RY[cnt - 1]);
      ctx.stroke();
      // 右路缘：一整条平滑曲线
      ctx.beginPath();
      ctx.moveTo(RX[0] + RW[0], RY[0]);
      for (let i = 0; i < cnt - 2; i++) {
        const cxp = RX[i + 1] + RW[i + 1], cyp = RY[i + 1];
        ctx.quadraticCurveTo(cxp, cyp, (cxp + RX[i + 2] + RW[i + 2]) / 2, (cyp + RY[i + 2]) / 2);
      }
      ctx.lineTo(RX[cnt - 1] + RW[cnt - 1], RY[cnt - 1]);
      ctx.stroke();
      // 车道虚线（单车道=中央线；扩展后=多车道分隔线）
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = Math.max(0.8, lwRamp * 0.65);
      ctx.beginPath();
      for (let ci = 0; ci < cnt - 1; ci++) {
        if (RI[ci] % 6 >= 2 || RW[ci] <= 3) continue;
        const lanes = RL[ci] || 1;
        if (lanes <= 1) {
          ctx.moveTo(RX[ci], RY[ci]);
          ctx.lineTo(RX[ci + 1], RY[ci + 1]);
        } else {
          const laneW = (RW[ci] * 2) / lanes;
          for (let b = 1; b < lanes; b++) {
            const lb = (b - lanes / 2) * laneW;
            ctx.moveTo(RX[ci] + lb, RY[ci]);
            ctx.lineTo(RX[ci + 1] + lb, RY[ci + 1]);
          }
        }
      }
      ctx.stroke();
      // 匝道金币（金色短线，呼吸闪烁；v4.9：走匝道的奖励）
      let hasCoin = false;
      for (let ci = 0; ci < cnt; ci++) if (RC[ci]) { hasCoin = true; break; }
      if (hasCoin) {
        ctx.globalAlpha = alpha * (0.55 + 0.35 * Math.sin(game.time * 6));
        ctx.strokeStyle = PAL.gold;
        ctx.lineWidth = Math.max(1.4, lwRamp * 0.9);
        ctx.beginPath();
        for (let ci = 0; ci < cnt; ci++) {
          if (!RC[ci]) continue;
          const cxp = RX[ci], cyp = RY[ci];
          const gw = Math.max(3, RW[ci] * 0.55);
          ctx.moveTo(cxp - gw, cyp); ctx.lineTo(cxp + gw, cyp);
        }
        ctx.stroke();
        ctx.strokeStyle = PAL.line;
      }
    }
  }
  ctx.globalAlpha = 1;
}

// 车体三段视角混合（§7A.2/§7A.3 + v4 后45°素材）
const CARHW = { player: 0.97, sedan: 0.92, truck: 1.225, bus: 1.225 };
const QKEY = { player: 'player_q', sedan: 'sedan_q', truck: 'truck_q', bus: 'bus_q' };
function drawCar3D(ctx, cam, game, key, type, sx, yBase, ppm, alpha, relYaw) {
  const th = clamp(Math.abs(relYaw), 0, 1.35);
  const sn = Math.sin(th), cs = Math.cos(th);
  const outward = Math.sign(sx - cam.cx) || Math.sign(relYaw) || 1;
  const len = carLength(type);

  const sideAlpha = clamp((th - 0.42) / 0.42, 0, 1) * alpha;
  if (sideAlpha > 0.03) {
    const prof = sideProfile(type);
    const lw = len * Math.abs(sn) * ppm;
    const xRear = sx + outward * cs * ((CARHW[type] || 0.95) * ppm);
    ctx.globalAlpha = sideAlpha;
    ctx.strokeStyle = PAL.line;
    ctx.lineWidth = Math.max(1, ppm * 0.013);
    ctx.beginPath();
    for (const poly of prof) {
      for (let i = 0; i < poly.length; i++) {
        const u = (poly[i][0] + len / 2) / len;
        const X = xRear - outward * u * lw;
        const Y = yBase - poly[i][1] * ppm;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
    }
    ctx.stroke();
  }
  const qAlpha = clamp((th - 0.28) / 0.34, 0, 1) * alpha;
  if (qAlpha > 0.02 && ppm > 2.2) {
    const vectorQ = type !== 'player';
    drawSpriteScaled(ctx, QKEY[type], sx, yBase, ppm, qAlpha, 1, vectorQ ? outward > 0 : outward < 0);
  }
  const rearA = clamp(1 - (th - 0.30) / 0.32, 0, 1) * alpha;
  if (rearA > 0.02) {
    drawSpriteScaled(ctx, key, sx, yBase, ppm, rearA, Math.max(0.30, cs));
  }
  ctx.globalAlpha = 1;
}

function obstacleRelYaw(cam, c, zrel, game) {
  const persp = Math.atan2(c.x - cam.x, Math.max(zrel, 4)) * 0.9;
  const own = clamp((c.x - getTrack().laneCenterAt(c.z, c.lane)) * 0.22, -0.3, 0.3);
  return (game.viewYaw || 0) * 0.5 + persp + own;
}

// 对向车流（高速/大桥）
function drawOncoming(ctx, cam, frac, game, D) {
  const track = getTrack();
  const sec = track.sectionAt(game.cam.z + 60);
  if (!sec || (sec.type !== 'highway' && sec.type !== 'bridge')) return;
  const half = track.roadInfoAt(game.cam.z + 60).half;
  const off = -(half + 2.6);
  const span = 520;
  for (let i = 0; i < 6; i++) {
    const zr = span - ((i * 97.3 + game.time * (26 + i * 5)) % span) + 8;
    if (zr < 3 || zr > Math.min(480, D * CFG.segLen)) continue;
    const kf = zr / CFG.segLen + frac;
    const k0 = Math.floor(kf), f = kf - k0;
    if (k0 < 0 || k0 + 1 > D + 1 || Number.isNaN(PX[k0]) || Number.isNaN(PX[k0 + 1])) continue;
    const sx = lerp(PX[k0], PX[k0 + 1], f) + lerp(PS[k0], PS[k0 + 1], f) * off * cam.halfW;
    const sy = lerp(PY[k0], PY[k0 + 1], f);
    const ppm = lerp(PS[k0], PS[k0 + 1], f) * cam.halfW;
    const t = zr / (D * CFG.segLen);
    const a = (CFG.fogNear + (CFG.fogFar - CFG.fogNear) * t * t) * (zr < 14 ? zr / 14 : 1);
    drawSprite(ctx, 'oncoming', sx, sy, ppm, a * (game.mainlineAlpha != null ? game.mainlineAlpha : 1), false);
  }
}

// 船队（跨海大桥）：分布于桥两侧 25-55m，zKey 排序 + 横向中心线超出桥路面范围
function drawShips(ctx, cam, frac, game, D) {
  const track = getTrack();
  const segs = track.segs;
  const baseIdx = Math.floor(cam.z / CFG.segLen);
  const mlA = game.mainlineAlpha != null ? game.mainlineAlpha : 1;
  for (let k = 1; k <= D; k++) {
    const zrel = (k - frac) * CFG.segLen;
    if (zrel < 3 || zrel > Math.min(580, D * CFG.segLen)) continue;
    const k0 = Math.floor(zrel / CFG.segLen + frac);
    if (k0 < 0 || k0 + 1 > D + 1) continue;
    const seg = segs[(baseIdx + k) % segs.length];
    if (!seg.shipKey) continue;
    // 船横向中心 = 路面中心 + shipOff（始终 > half + 25；不会与桥重叠）
    const sxBase = lerp(PX[k0], PX[k0 + 1], 0.5);
    const syBase = lerp(PY[k0], PY[k0 + 1], 0.5);
    const s = (PS[k0] + PS[k0 + 1]) * 0.5;
    const sx = sxBase + s * seg.shipOff * cam.halfW;
    const ppm = s * cam.halfW * 0.7;
    const t = zrel / (D * CFG.segLen);
    const a = (CFG.fogNear + (CFG.fogFar - CFG.fogNear) * t * t) * (zrel < 14 ? zrel / 14 : 1) * mlA;
    // 让船随时间缓慢上下浮动（视觉错觉）
    const yWobble = Math.sin(game.time * 1.2 + seg.shipSeed * 0.01) * 1.2 * ppm;
    drawSprite(ctx, seg.shipKey, sx, syBase + yWobble, ppm * 0.6, a, false);
  }
}

// 隧道顶灯带（程序化：每隔 2 段画一对金色短线 + 路面向上金线）
function drawTunnelTopLights(ctx, cam, D, baseIdx, baseFrac) {
  const track = getTrack();
  const segs = track.segs;
  ctx.strokeStyle = PAL.gold;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  for (let k = 2; k < D; k += 2) {
    const seg = segs[(baseIdx + k) % segs.length];
    if (!seg.tunnel) continue;
    const zrel = (k - baseFrac) * CFG.segLen;
    const zNext = zrel + 2 * CFG.segLen;
    if (zrel < 2) continue;
    const ppi1 = PS[k] * cam.halfW, ppi2 = PS[Math.min(k + 1, D)] * cam.halfW;
    const yBase1 = PY[k], yBase2 = PY[Math.min(k + 1, D)];
    ctx.beginPath();
    ctx.moveTo(PX[k], yBase1 - 3.2 * ppi1);
    ctx.lineTo(PX[Math.min(k + 1, D)], yBase2 - 3.2 * ppi2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// 暗化背景层（隧道内）：将画布蒙一层纯底色 + 极弱光带
function drawTunnelDarken(ctx, W, H, darken) {
  if (darken <= 0) return;
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.65 * darken;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

export function renderWorld(ctx, W, H, game) {
  const cam = game.cam;
  const track = getTrack();
  const segs = track.segs, N = segs.length, SL = CFG.segLen, LOOP = N * SL;
  const baseIdx = Math.floor(cam.z / SL);
  const frac = (cam.z % SL) / SL;
  const baseSeg = segs[baseIdx % N];

  // 背景（隧道段不画远景，留黑）
  const hereSeg = segs[Math.floor(((cam.z + CFG.playerZ) % LOOP + LOOP) % LOOP / SL) % N];
  const inTunnel = !!hereSeg.tunnel;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(-30, -30, W + 60, H + 60);

  ctx.save();
  if (shake.mag > 0) ctx.translate((Math.random() * 2 - 1) * shake.mag, (Math.random() * 2 - 1) * shake.mag);

  // 图纸灭点参考（隧道内不画）
  if (!inTunnel) {
    const vpx = cam.cx, vpy = cam.cy;
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.28;
    ctx.beginPath(); ctx.moveTo(0, vpy); ctx.lineTo(W, vpy); ctx.stroke();
    ctx.globalAlpha = 0.055;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) { ctx.moveTo(vpx, vpy); ctx.lineTo((i / 8) * W, H + 40); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const designW = H * 16 / 9;
  if (W > designW + 60) {
    const lx = (W - designW) / 2, rx = W - lx;
    ctx.strokeStyle = PAL.line; ctx.globalAlpha = 0.20; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, 24); ctx.lineTo(lx, H - 24);
    ctx.moveTo(rx, 24); ctx.lineTo(rx, H - 24);
    for (let y = 24; y <= H - 24; y += 48) {
      ctx.moveTo(lx, y); ctx.lineTo(lx + 8, y);
      ctx.moveTo(rx, y); ctx.lineTo(rx - 8, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 背景层（隧道内不画远景）
  if (!inTunnel) drawBackground(ctx, W, H, cam.cy, game, track, game.mainlineAlpha != null ? game.mainlineAlpha : 1);

  // 段循环：投影 + 曲率累积 + 坡道高程
  let x = 0, dx = -(baseSeg.curve * frac);
  const yCam = lerp(segs[baseIdx % N].y, segs[(baseIdx + 1) % N].y, frac);
  const D = Math.min(game.drawDist || CFG.drawDist, MAXP - 2);
  const scr = H / 1080;
  items.length = 0;

  const introK = game.introT > 0 ? 1 - game.introT / 0.8 : 1;
  const hideNear = game.introT > 0 ? Math.floor(D * (1 - introK)) : -1;

  for (let k = 0; k <= D + 1; k++) {
    const zrel = (k - frac) * SL;
    if (zrel <= 0.01) {
      PX[k] = NaN;
      x += dx; dx += segs[(baseIdx + k) % N].curve;
      continue;
    }
    const s = cam.depth / zrel;
    PX[k] = cam.cx + s * (x - cam.x) * cam.halfW;
    YW[k] = segs[(baseIdx + k) % N].y;
    PY[k] = cam.cy + s * (cam.height + yCam - YW[k]) * cam.halfW;
    PW[k] = s * segs[(baseIdx + k) % N].half * cam.halfW;
    PS[k] = s;
    x += dx;
    dx += segs[(baseIdx + k) % N].curve;
  }

  const dzStart = game.startZ >= 0 ? ((game.startZ - cam.z) % LOOP + LOOP) % LOOP : -1;

  if (game.introT > 0 && hideNear > 2 && hideNear + 1 <= D && !Number.isNaN(PX[hideNear])) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = Math.max(1.5, 2.4 * scr);
    ctx.beginPath();
    ctx.moveTo(PX[hideNear] - PW[hideNear], PY[hideNear]);
    ctx.lineTo(PX[hideNear] + PW[hideNear], PY[hideNear]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawOncoming(ctx, cam, frac, game, D);
  drawShips(ctx, cam, frac, game, D);

  // 道路线稿循环
  for (let k = 1; k <= D; k++) {
    if (Number.isNaN(PX[k]) || Number.isNaN(PX[k + 1])) continue;
    const x1 = PX[k], y1 = PY[k], w1 = PW[k];
    const x2 = PX[k + 1], y2 = PY[k + 1], w2 = PW[k + 1];
    const zrel = (k - frac) * SL;
    if (y1 > H + 120) continue;
    if (k < hideNear) continue;

    const t = k / D;
    let a = CFG.fogNear + (CFG.fogFar - CFG.fogNear) * t * t;
    if (hideNear >= 0 && k < hideNear + 8) a = Math.min(1, a * 1.6);
    // v4.5：主线渲染 alpha = fog × mainlineAlpha（玩家进匝道后主线 3s 淡出，汇入前 3s 淡入）
    a *= (game.mainlineAlpha != null ? game.mainlineAlpha : 1);
    const lw = Math.max(0.7, (CFG.lwNear + (CFG.lwFar - CFG.lwNear) * t) * scr);
    const seg = segs[(baseIdx + k) % N];
    // 主线完全淡出时跳过主线段绘制（匝道改为段循环后整体渲染，不再依赖本循环）
    if (a < 0.015) continue;

    ctx.strokeStyle = PAL.line;
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;

    // 路缘实线（大桥 = 金色桥缘；v4.7 平滑曲线：段端点作控制点、相邻中点作路径点）
    const px0 = PX[k - 1], py0 = PY[k - 1], pw0 = PW[k - 1];
    const havePrev = !Number.isNaN(px0);
    ctx.strokeStyle = seg.gold ? PAL.gold : PAL.line;
    ctx.globalAlpha = seg.gold ? a * 0.9 : a;
    ctx.beginPath();
    if (havePrev) {
      // 左缘：mid(k-1,k) → Q(左缘k) → mid(k,k+1)
      ctx.moveTo(((px0 - pw0) + (x1 - w1)) / 2, (py0 + y1) / 2);
      ctx.quadraticCurveTo(x1 - w1, y1, ((x1 - w1) + (x2 - w2)) / 2, (y1 + y2) / 2);
      // 右缘
      ctx.moveTo(((px0 + pw0) + (x1 + w1)) / 2, (py0 + y1) / 2);
      ctx.quadraticCurveTo(x1 + w1, y1, ((x1 + w1) + (x2 + w2)) / 2, (y1 + y2) / 2);
    } else {
      ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
      ctx.moveTo(x1 + w1, y1); ctx.lineTo(x2 + w2, y2);
    }
    ctx.stroke();
    ctx.strokeStyle = PAL.line;
    ctx.globalAlpha = a;

    // 车道虚线
    if (w1 > 4 && seg.i % 6 < 2) {
      const sets = [];
      if (seg.lanesA !== seg.lanesB && seg.mix < 1) sets.push({ lanes: seg.lanesA, a: 1 - seg.mix });
      sets.push({ lanes: seg.lanesB, a: seg.mix });
      for (const st of sets) {
        if (st.a <= 0.04) continue;
        const laneW = ((seg.half - 0.9) * 2) / st.lanes;
        ctx.globalAlpha = a * st.a;
        ctx.beginPath();
        for (let b = 1; b < st.lanes; b++) {
          const lb = ((b - st.lanes / 2) * laneW) / seg.half;
          ctx.moveTo(x1 + w1 * lb, y1); ctx.lineTo(x2 + w2 * lb, y2);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = a;
    }

    // 主线护栏（双横线 + 立柱；v4.7 平滑曲线 + v4.5 匝道出入口无护栏）
    if (seg.rails && w1 > 2.5) {
      const gapL = seg.noRailL || 0;
      const gapR = seg.noRailR || 0;
      const ro = (seg.half + CFG.railOff) / seg.half;
      const rh1 = PS[k] * CFG.railH * cam.halfW, rh2 = PS[k + 1] * CFG.railH * cam.halfW;
      ctx.globalAlpha = a * 0.9;
      ctx.lineWidth = Math.max(0.7, lw * 0.7);
      ctx.beginPath();
      // 4 条横线（左右 × 上/中），平滑曲线：mid(k-1,k) → Q(k) → mid(k,k+1)
      for (const rc of RAIL_COMBOS) {
        const sx = rc[0], hf = rc[1];
        if ((sx < 0 && gapL) || (sx > 0 && gapR)) continue;
        const X1 = x1 + sx * (w1 + CFG.railOff * PS[k] * cam.halfW);
        const X2 = x2 + sx * (w2 + CFG.railOff * PS[k + 1] * cam.halfW);
        const Y1 = y1 - hf * rh1, Y2 = y2 - hf * rh2;
        if (havePrev) {
          const X0 = px0 + sx * (pw0 + CFG.railOff * PS[k - 1] * cam.halfW);
          const Y0 = py0 - hf * PS[k - 1] * CFG.railH * cam.halfW;
          ctx.moveTo((X0 + X1) / 2, (Y0 + Y1) / 2);
          ctx.quadraticCurveTo(X1, Y1, (X1 + X2) / 2, (Y1 + Y2) / 2);
        } else {
          ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2);
        }
      }
      ctx.stroke();
      // 缺口处的端头立柱（标记匝道"入口端"——车从端头"穿过"）
      if (gapL) { ctx.beginPath(); ctx.moveTo(x1 - w1 * ro, y1 - rh1 * 0.55); ctx.lineTo(x1 - w1 * ro, y1); ctx.stroke(); }
      if (gapR) { ctx.beginPath(); ctx.moveTo(x1 + w1 * ro, y1 - rh1 * 0.55); ctx.lineTo(x1 + w1 * ro, y1); ctx.stroke(); }
      // 非缺口区的常规立柱
      if (!gapL || !gapR) {
        if (seg.i % CFG.postEvery === 0 || seg.curve !== 0 || seg.turn) {
          ctx.beginPath();
          if (!gapL) { ctx.moveTo(x1 - w1 * ro, y1); ctx.lineTo(x1 - w1 * ro, y1 - rh1); }
          if (!gapR) { ctx.moveTo(x1 + w1 * ro, y1); ctx.lineTo(x1 + w1 * ro, y1 - rh1); }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 匝道路面渲染移至段循环后（v4.8：整条连续曲线一次绘制，不再逐段小块拼接）

    // 待转区：边缘加密线（v4.7 平滑曲线）
    if (seg.densify && w1 > 3) {
      const ib = (seg.half - 0.55) / seg.half;
      ctx.globalAlpha = a * 0.75;
      ctx.lineWidth = Math.max(0.7, lw * 0.55);
      ctx.beginPath();
      if (havePrev) {
        ctx.moveTo(((px0 - pw0 * ib) + (x1 - w1 * ib)) / 2, (py0 + y1) / 2);
        ctx.quadraticCurveTo(x1 - w1 * ib, y1, ((x1 - w1 * ib) + (x2 - w2 * ib)) / 2, (y1 + y2) / 2);
        ctx.moveTo(((px0 + pw0 * ib) + (x1 + w1 * ib)) / 2, (py0 + y1) / 2);
        ctx.quadraticCurveTo(x1 + w1 * ib, y1, ((x1 + w1 * ib) + (x2 + w2 * ib)) / 2, (y1 + y2) / 2);
      } else {
        ctx.moveTo(x1 - w1 * ib, y1); ctx.lineTo(x2 - w2 * ib, y2);
        ctx.moveTo(x1 + w1 * ib, y1); ctx.lineTo(x2 + w2 * ib, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 门框
    if (seg.gate !== 0 && w1 > 3) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.2, 2 * scr);
      ctx.beginPath();
      if (seg.gate === 1) {
        for (let d = 0; d < 7; d++) {
          const u0 = -1 + (2 * d) / 7, u1 = -1 + (2 * (d + 0.6)) / 7;
          ctx.moveTo(x1 + w1 * u0, y1); ctx.lineTo(x1 + w1 * u1, y1);
        }
      } else {
        ctx.moveTo(x1 - w1, y1); ctx.lineTo(x1 + w1, y1);
      }
      ctx.stroke();
      ctx.strokeStyle = PAL.line;
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 待转区箭头
    if (seg.junction && w1 > 10 && seg.i % 6 < 3) {
      const laneW = ((seg.half - 0.9) * 2) / seg.lanes;
      const ppiA = PS[k] * cam.halfW;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(game.time * 5);
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.2, 1.8 * scr);
      ctx.lineCap = 'round';
      for (const e of seg.junction.exits) {
        for (const lane of e.lanes) {
          const lm = (lane - (seg.lanes - 1) / 2) * laneW;
          const ax = x1 + w1 * (lm / seg.half), ay = y1;
          const al = clamp(0.55 * ppiA, 6, 46 * scr);
          ctx.beginPath();
          if (e.dir === 0) {
            ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - al);
            ctx.moveTo(ax - al * 0.22, ay - al * 0.62); ctx.lineTo(ax, ay - al); ctx.lineTo(ax + al * 0.22, ay - al * 0.62);
          } else {
            const d = e.dir;
            ctx.moveTo(ax, ay - al * 0.1); ctx.lineTo(ax, ay - al * 0.55); ctx.lineTo(ax + d * al * 0.55, ay - al * 0.95);
            ctx.moveTo(ax + d * al * 0.3, ay - al * 0.98); ctx.lineTo(ax + d * al * 0.58, ay - al * 0.93); ctx.lineTo(ax + d * al * 0.5, ay - al * 0.68);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = a;
      ctx.lineCap = 'butt';
    }

    // 金币线
    if (seg.coin >= 0 && w1 > 4) {
      const laneW = ((seg.half - 0.9) * 2) / seg.lanes;
      const lm = (seg.coin - (seg.lanes - 1) / 2) * laneW;
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(game.time * 6 + seg.i);
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.2, 1.7 * scr);
      ctx.beginPath();
      ctx.moveTo(x1 + w1 * (lm / seg.half), y1); ctx.lineTo(x2 + w2 * (lm / seg.half), y2);
      ctx.stroke();
      ctx.strokeStyle = PAL.line;
      ctx.globalAlpha = a;
    }

    // 加速带
    if (seg.boost >= 0 && w1 > 4) {
      const laneW = ((seg.half - 0.9) * 2) / seg.lanes;
      const lm = (seg.boost - (seg.lanes - 1) / 2) * laneW;
      const ppiB = PS[k] * cam.halfW;
      const bx = x1 + w1 * (lm / seg.half), by = y1;
      const chW = Math.max(3, ppiB * 0.9), chH = Math.max(2, ppiB * 0.34);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.2, 1.8 * scr);
      ctx.beginPath();
      ctx.moveTo(bx - chW / 2, by - chH * 0.2); ctx.lineTo(bx, by - chH * 0.9); ctx.lineTo(bx + chW / 2, by - chH * 0.2);
      ctx.stroke();
      ctx.strokeStyle = PAL.line;
      ctx.globalAlpha = a;
    }

    if (dzStart >= zrel && dzStart < zrel + SL) {
      const f = (dzStart - zrel) / SL;
      const gx = lerp(x1, x2, f), gy = lerp(y1, y2, f), gw = lerp(w1, w2, f);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = Math.max(1.5, 2.6 * scr);
      ctx.beginPath(); ctx.moveTo(gx - gw, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
      ctx.strokeStyle = PAL.line;
    }

    // 收集 sprite：路灯/树/龙门架/桥塔/预告牌/障碍车/隧道肋骨
    if (y1 < H + 2600) {
      const ppi = PS[k] * cam.halfW;
      const zNear = zrel;
      for (const sp of seg.sprites) {
        if (zNear < (SPAN_KEYS.has(sp.key) ? 1.5 : 2.5)) continue;
        items.push({ key: sp.key, x: x1 + ppi * sp.off, y: y1, ppm: ppi, flip: sp.flip, a, z: zNear, blink: null });
      }
      const cars = game.traffic.bySeg.get((baseIdx + k) % N);
      if (cars) {
        for (const c of cars) {
          if (c.dead) continue;
          const f = clamp(wrapDelta(c.z - (baseIdx + k) * SL) / SL, 0, 1);
          const cz = wrapDelta(c.z - cam.z);
          if (cz < CFG.playerZ - 1.1) continue;
          const ppiCar = (cam.depth / cz) * cam.halfW;
          const rawYaw = obstacleRelYaw(cam, c, cz, game);
          if (c.smYaw == null || Math.abs(rawYaw - c.smYaw) > 1.2) c.smYaw = rawYaw;
          else c.smYaw += (rawYaw - c.smYaw) * (1 - Math.exp(-(game.dt || 0.016) / 0.15));
          const blink = c.changeState
            ? { on: c.changeState === 'moving' || Math.floor(c.signalT * 12) % 2 === 0, side: c.blinkSide }
            : null;
          const dieA = c.dying != null ? clamp(c.dying / 0.7, 0, 1) : 1;
          items.push({
            key: c.type.key,
            x: lerp(x1, x2, f) + ppiCar * c.x, y: lerp(y1, y2, f),
            ppm: ppiCar, flip: false, a: a * dieA, z: cz, blink,
            car3d: { relYaw: c.smYaw, type: c.type.key },
          });
        }
      }
    }
  }

  // —— 匝道整体渲染（v4.8：整条连续曲线，段循环后绘制）——
  drawRamps(ctx, cam, game, D, scr);

  // 隧道段：在道路绘制之后再叠加顶灯带 + 暗化层
  if (inTunnel) drawTunnelTopLights(ctx, cam, D, baseIdx, frac);

  for (const it of items) it.zKey = Math.round(it.z * 10);
  items.sort((x, y) => y.zKey - x.zKey);
  for (const it of items) {
    if (it.car3d) {
      drawCar3D(ctx, cam, game, it.key, it.car3d.type, it.x, it.y, it.ppm, it.a, it.car3d.relYaw);
    } else if (it.key === 'csign') {
      drawCurveSign(ctx, it.x, it.y, it.ppm, it.a, it.flip);
    } else if (it.key === 'tunnel_rib') {
      // 隧道肋骨线：随距离亮度的暗化下绘制双柱
      ctx.globalAlpha = it.a * (inTunnel ? 1 : 0.3);
      ctx.strokeStyle = PAL.line;
      ctx.lineWidth = Math.max(1, 0.04 * it.ppm);
      const h = 3.5 * it.ppm;
      ctx.beginPath();
      ctx.moveTo(it.x, it.y); ctx.lineTo(it.x, it.y - h);
      ctx.stroke();
      // 横梁（连到另一侧）
      const other = (it.flip ? -1 : 1);
      ctx.beginPath();
      ctx.moveTo(it.x, it.y - h * 0.7); ctx.lineTo(it.x - 5 * it.ppm * other, it.y - h * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      drawSprite(ctx, it.key, it.x, it.y, it.ppm, it.a, it.flip);
    }
    if (it.blink && it.blink.on) {
      const bx = it.x + it.blink.side * 0.8 * it.ppm;
      const by = it.y - 0.55 * it.ppm;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.5, 0.10 * it.ppm);
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + it.blink.side * 0.16 * it.ppm, by - 0.10 * it.ppm);
      ctx.moveTo(bx, by); ctx.lineTo(bx + it.blink.side * 0.16 * it.ppm, by + 0.10 * it.ppm);
      ctx.stroke();
    }
  }

  // 隧道内蒙暗层（在最顶层之后才盖，避免覆盖主车/特效）
  if (inTunnel) drawTunnelDarken(ctx, W, H, 1);

  const p = game.player;
  if (!p.crashed && game.introT <= 0) {
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    const kP = CFG.playerZ / SL + frac;
    const k0 = Math.floor(kP), kf = kP - k0;
    const yP = lerp(YW[Math.min(k0, MAXP - 1)], YW[Math.min(k0 + 1, MAXP - 1)], kf);
    let by = cam.cy + (cam.depth / CFG.playerZ) * (cam.height + yCam - yP) * cam.halfW;
    // 不再叠 sin(time) 颠簸——俯仰/路面起伏已通过 cam.pitch 表达
    const blink = p.invuln > 0 ? (Math.sin(p.blinkT * 50) > 0 ? 1 : 0.25) : 1;

    if (p.nitroOn) drawNitroFlames(ctx, bx, by, ppmP, p.speed / CFG.maxSpeed, game.time);

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(p.tilt - segs[(baseIdx + 8) % N].curve * (p.speed / CFG.maxSpeed) * 0.02);
    drawCar3D(ctx, cam, game, 'player', 'player', 0, 0, ppmP, blink, game.viewYaw || 0);
    ctx.restore();
  }

  drawFx(ctx, game.time);
  const spd = p.speed / CFG.maxSpeed;
  const intensity = p.crashed ? 0 : clamp((spd - 0.68) / 0.32, 0, 1) * 0.5 + (p.nitroOn ? 0.8 : 0);
  drawSpeedLines(ctx, W, H, Math.min(1, intensity), game.time);

  ctx.restore();
  ctx.globalAlpha = 1;
}
