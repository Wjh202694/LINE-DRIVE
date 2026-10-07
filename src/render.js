// render.js — 分层渲染器：灭点参考 → 道路线稿 → 护栏 → 路侧物 → 障碍车 → 主车 → 特效
// 全部程序化线条，线宽三档 + 大气透视（§3.2），颜色一律取自 PAL。
// §10.1：近裁剪面（车 z<8m 不画）、zKey=round(z*10) 稳定排序、sprite 绘制取整。
import { CFG, clamp, lerp } from './config.js';
import { PAL } from './palette.js';
import { getTrack, wrapDelta } from './road.js';
import { drawSprite, drawSpriteScaled } from './sprites.js';
import { shake, drawFx, drawSpeedLines, drawNitroFlames } from './fx.js';
import { drawBackground } from './bg.js';
import { sideProfile, carLength } from './wire.js';

// 段边界投影缓存（模块级复用，避免 GC）
const MAXP = 512;
const PX = new Float64Array(MAXP), PY = new Float64Array(MAXP),
      PW = new Float64Array(MAXP), PS = new Float64Array(MAXP);

// 待绘 sprite：z = 相对相机距离（m），按 zKey 稳定排序后由远及近绘制
const items = [];

// 车体 3D 混合绘制（§7A.2/§7A.3）：后脸位图随 cos(θ) 压缩 + 侧影线稿随 sin(θ) 浮现
// θ = 相对偏航（透视项 + viewYaw 状态源 + 自身变道角），连续无跳变
const CARHW = { player: 0.97, sedan: 0.92, truck: 1.225, bus: 1.225 };
function drawCar3D(ctx, cam, game, key, type, sx, yBase, ppm, alpha, relYaw) {
  const th = clamp(relYaw, -1.35, 1.35);
  const sn = Math.sin(th), cs = Math.cos(th);
  const outward = Math.sign(sx - cam.cx) || 1;
  const len = carLength(type);

  // 侧面线稿（先画，垫底）：从车尾外缘向画面中心延伸
  const sideAlpha = clamp(Math.abs(sn) * 1.7 - 0.06, 0, 1) * alpha;
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
        const u = (poly[i][0] + len / 2) / len;              // 0=车尾 1=车头
        const X = xRear - outward * u * lw;
        const Y = yBase - poly[i][1] * ppm;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 后脸位图（随 cos 压缩；cos 在 ±77° 钳制下 ≥0.22，永不消失）
  drawSpriteScaled(ctx, key, sx, yBase, ppm, alpha, Math.max(0.22, cs));
}

// 障碍车相对偏航：透视项（横向/纵深）+ 全局 viewYaw + 自身变道偏角
function obstacleRelYaw(cam, c, zrel, game) {
  const persp = Math.atan2(c.x - cam.x, Math.max(zrel, 4)) * 0.9;
  const own = clamp((c.x - getTrack().laneCenterAt(c.z, c.lane)) * 0.22, -0.3, 0.3);
  return (game.viewYaw || 0) * 0.5 + persp + own;
}

export function renderWorld(ctx, W, H, game) {
  const cam = game.cam;
  const track = getTrack();
  const segs = track.segs, N = segs.length, SL = CFG.segLen, LOOP = N * SL;
  const baseIdx = Math.floor(cam.z / SL);
  const frac = (cam.z % SL) / SL;
  const baseSeg = segs[baseIdx % N];

  // —— 背景 ——
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(-30, -30, W + 60, H + 60);

  ctx.save();
  if (shake.mag > 0) ctx.translate((Math.random() * 2 - 1) * shake.mag, (Math.random() * 2 - 1) * shake.mag);

  // —— 图纸灭点参考（≤8% alpha 的放射线 + 地平线）——
  const vpx = cam.cx, vpy = cam.cy;
  ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
  ctx.globalAlpha = 0.28;
  ctx.beginPath(); ctx.moveTo(0, vpy); ctx.lineTo(W, vpy); ctx.stroke();
  ctx.globalAlpha = 0.055;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) { ctx.moveTo(vpx, vpy); ctx.lineTo((i / 8) * W, H + 40); }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // —— 超宽屏图纸边框（§4.3：16:9 基准，两侧加图纸规则线）——
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

  // —— 背景层（§5：随路段绑定，混合过渡）——
  drawBackground(ctx, W, H, cam.cy, game, track);

  // —— 段循环：投影 + 曲率累积 ——
  let x = 0, dx = -(baseSeg.curve * frac);
  const D = Math.min(game.drawDist || CFG.drawDist, MAXP - 2);
  const scr = H / 1080;
  items.length = 0;

  // 蓝图入场：0.8s 内道路从灭点向镜头"画"出来（远→近揭示）
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
    PY[k] = cam.cy + s * cam.height * cam.halfW;
    PW[k] = s * segs[(baseIdx + k) % N].half * cam.halfW;   // 路半宽随路段渐变（§5）
    PS[k] = s;
    x += dx;
    dx += segs[(baseIdx + k) % N].curve;
  }

  // 启程金线的相对距离（0 = 相机处）
  const dzStart = game.startZ >= 0 ? ((game.startZ - cam.z) % LOOP + LOOP) % LOOP : -1;

  // 蓝图入场：揭示前缘的"笔尖"高亮横线（§3.2.4 记忆点）
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

  // —— 道路线稿（近 → 远）——
  for (let k = 1; k <= D; k++) {
    if (Number.isNaN(PX[k]) || Number.isNaN(PX[k + 1])) continue;
    const x1 = PX[k], y1 = PY[k], w1 = PW[k];
    const x2 = PX[k + 1], y2 = PY[k + 1], w2 = PW[k + 1];
    const zrel = (k - frac) * SL;
    if (y1 > H + 120) continue;                      // 完全甩出屏幕底（防超大坐标）
    if (k < hideNear) continue;                      // 入场动画未揭示到

    const t = k / D;
    let a = CFG.fogNear + (CFG.fogFar - CFG.fogNear) * t * t;
    if (hideNear >= 0 && k < hideNear + 8) a = Math.min(1, a * 1.6);   // 入场前缘增亮
    const lw = Math.max(0.7, (CFG.lwNear + (CFG.lwFar - CFG.lwNear) * t) * scr);
    const seg = segs[(baseIdx + k) % N];

    ctx.strokeStyle = PAL.line;
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;

    // 路缘实线
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x2 - w2, y2);
    ctx.moveTo(x1 + w1, y1); ctx.lineTo(x2 + w2, y2);
    ctx.stroke();

    // 车道虚线（10m 实 20m 虚；过渡区新旧车道线交叉淡化，§5）
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

    // 护栏（双横线 + 立柱；沙漠路段无护栏；转向区立柱逐段加密 = 危险暗示 §10.5）
    if (seg.rails && w1 > 2.5) {
      const ro = (seg.half + CFG.railOff) / seg.half;
      const rh1 = PS[k] * CFG.railH * cam.halfW, rh2 = PS[k + 1] * CFG.railH * cam.halfW;
      ctx.globalAlpha = a * 0.9;
      ctx.lineWidth = Math.max(0.7, lw * 0.7);
      ctx.beginPath();
      ctx.moveTo(x1 - w1 * ro, y1 - rh1); ctx.lineTo(x2 - w2 * ro, y2 - rh2);
      ctx.moveTo(x1 + w1 * ro, y1 - rh1); ctx.lineTo(x2 + w2 * ro, y2 - rh2);
      ctx.moveTo(x1 - w1 * ro, y1 - rh1 * 0.55); ctx.lineTo(x2 - w2 * ro, y2 - rh2 * 0.55);
      ctx.moveTo(x1 + w1 * ro, y1 - rh1 * 0.55); ctx.lineTo(x2 + w2 * ro, y2 - rh2 * 0.55);
      ctx.stroke();
      if (seg.i % CFG.postEvery === 0 || seg.curve !== 0) {
        ctx.beginPath();
        ctx.moveTo(x1 - w1 * ro, y1); ctx.lineTo(x1 - w1 * ro, y1 - rh1);
        ctx.moveTo(x1 + w1 * ro, y1); ctx.lineTo(x1 + w1 * ro, y1 - rh1);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 待转区：边缘加密线（§10.5）
    if (seg.densify && w1 > 3) {
      const ib = (seg.half - 0.55) / seg.half;
      ctx.globalAlpha = a * 0.75;
      ctx.lineWidth = Math.max(0.7, lw * 0.55);
      ctx.beginPath();
      ctx.moveTo(x1 - w1 * ib, y1); ctx.lineTo(x2 - w2 * ib, y2);
      ctx.moveTo(x1 + w1 * ib, y1); ctx.lineTo(x2 + w2 * ib, y2);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 待转门框：横跨路面的虚线（区域宣告 §10.5）
    if (seg.gate !== 0 && w1 > 3) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = Math.max(1.2, 2 * scr);
      ctx.beginPath();
      for (let d = 0; d < 7; d++) {
        const u0 = -1 + (2 * d) / 7, u1 = -1 + (2 * (d + 0.6)) / 7;
        ctx.moveTo(x1 + w1 * u0, y1); ctx.lineTo(x1 + w1 * u1, y1);
      }
      ctx.stroke();
      ctx.strokeStyle = PAL.line;
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
    }

    // 路口待转区：车道选向箭头（每出口对应车道，金色，§10.4 修订）
    if (seg.junction && w1 > 10) {
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
          const al = Math.max(6, 0.55 * ppiA);
          ctx.beginPath();
          if (e.dir === 0) {
            // 直行：竖线 + 头
            ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - al);
            ctx.moveTo(ax - al * 0.22, ay - al * 0.62); ctx.lineTo(ax, ay - al); ctx.lineTo(ax + al * 0.22, ay - al * 0.62);
          } else {
            // 转向：折线 + 头
            const d = e.dir;
            ctx.moveTo(ax, ay - al * 0.1); ctx.lineTo(ax, ay - al * 0.55); ctx.lineTo(ax + d * al * 0.55, ay - al * 0.95);
            ctx.moveTo(ax + d * al * 0.3, ay - al * 0.98); ctx.lineTo(ax + d * al * 0.58, ay - al * 0.93); ctx.lineTo(ax + d * al * 0.5, ay - al * 0.68);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = a;
    }

    // 启程金线
    if (dzStart >= zrel && dzStart < zrel + SL) {
      const f = (dzStart - zrel) / SL;
      const gx = lerp(x1, x2, f), gy = lerp(y1, y2, f), gw = lerp(w1, w2, f);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = Math.max(1.5, 2.6 * scr);
      ctx.beginPath(); ctx.moveTo(gx - gw, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
      ctx.strokeStyle = PAL.line;
    }

    // 收集 sprite（路灯/反光柱/预告牌/障碍车）
    if (y1 < H + 2600) {
      const ppi = PS[k] * cam.halfW;
      const zNear = zrel;
      for (const sp of seg.sprites) {
        if (zNear < 2.5) continue;                   // §10.1 近裁剪（路侧物）
        items.push({ key: sp.key, x: x1 + ppi * sp.off, y: y1, ppm: ppi, flip: sp.flip, a, z: zNear, blink: null });
      }
      const cars = game.traffic.bySeg.get((baseIdx + k) % N);
      if (cars) {
        for (const c of cars) {
          if (c.dead) continue;
          const f = clamp(wrapDelta(c.z - (baseIdx + k) * SL) / SL, 0, 1);
          const cz = wrapDelta(c.z - cam.z);
          if (cz < CFG.playerZ - 1.1) continue;      // 近裁剪：越过主车平面滑出屏幕后再消失
          // 尺寸用车自身距离连续计算（段边界量化会造成"抽帧"式跳变）
          const ppiCar = (cam.depth / cz) * cam.halfW;
          // 超车立体感（§7A.3）：相对偏航驱动后脸压缩 + 侧影浮现，全程连续
          const relYaw = obstacleRelYaw(cam, c, cz, game);
          const blink = c.changeState
            ? { on: c.changeState === 'moving' || Math.floor(c.signalT * 12) % 2 === 0, side: c.blinkSide }
            : null;
          items.push({
            key: c.type.key,
            x: lerp(x1, x2, f) + ppiCar * c.x, y: lerp(y1, y2, f),
            ppm: ppiCar, flip: false, a, z: cz, blink,
            car3d: { relYaw, type: c.type.key },
          });
        }
      }
    }
  }

  // —— sprite 由远及近（zKey 稳定排序，§10.1）——
  for (const it of items) it.zKey = Math.round(it.z * 10);
  items.sort((a, b) => b.zKey - a.zKey);             // JS sort 稳定：同键不交换
  for (const it of items) {
    if (it.car3d) {
      drawCar3D(ctx, cam, game, it.key, it.car3d.type, it.x, it.y, it.ppm, it.a, it.car3d.relYaw);
    } else {
      drawSprite(ctx, it.key, it.x, it.y, it.ppm, it.a, it.flip);
    }
    // 变道转向灯（侧后方金色短线，闪 3 次 §10.2）
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

  // —— 主车（§7A.3：viewYaw 单一状态源，后脸+侧影混合）——
  const p = game.player;
  if (!p.crashed && game.introT <= 0) {
    const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
    const bx = cam.cx + (p.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
    let by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
    by += Math.sin(game.time * 23) * (p.speed / CFG.maxSpeed) * 1.6;
    const blink = p.invuln > 0 ? (Math.sin(p.blinkT * 50) > 0 ? 1 : 0.25) : 1;

    if (p.nitroOn) drawNitroFlames(ctx, bx, by, ppmP, p.speed / CFG.maxSpeed, game.time);

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(p.tilt - segs[(baseIdx + 8) % N].curve * (p.speed / CFG.maxSpeed) * 0.02);
    drawCar3D(ctx, cam, game, 'player', 'player', 0, 0, ppmP, blink, game.viewYaw || 0);
    ctx.restore();
  }

  // —— 特效与速度线 ——
  drawFx(ctx, game.time);
  const spd = p.speed / CFG.maxSpeed;
  const intensity = p.crashed ? 0 : clamp((spd - 0.68) / 0.32, 0, 1) * 0.5 + (p.nitroOn ? 0.8 : 0);
  drawSpeedLines(ctx, W, H, Math.min(1, intensity), game.time);

  ctx.restore();
  ctx.globalAlpha = 1;
}
