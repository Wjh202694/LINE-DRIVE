// fx.js — 特效：金色火花 / 撞毁碎线 / 速度线 / 氮气尾焰 / 屏幕震动（§5A.2-5A.4）
import { PAL } from './palette.js';
import { segmentsOf } from './sprites.js';
import { CFG } from './config.js';

// —— 屏幕震动 ——
export const shake = { mag: 0 };
export function addShake(m) { shake.mag = Math.max(shake.mag, m); }
export function updateShake(dt) { shake.mag *= Math.exp(-dt * 6); if (shake.mag < 0.05) shake.mag = 0; }

// —— 金色火花（剐蹭/重创）——
const sparks = [];
export function burstSparks(x, y, dir, n = 12) {
  for (let i = 0; i < n; i++) {
    const ang = (Math.random() - 0.5) * 1.6 + (dir > 0 ? -0.4 : Math.PI + 0.4);
    const sp = 180 + Math.random() * 320;
    sparks.push({
      x, y, vx: Math.cos(ang) * sp * dir, vy: -Math.abs(Math.sin(ang)) * sp - 60,
      life: 0.3 + Math.random() * 0.25, tot: 0,
    });
  }
}
// —— 撞毁碎线（主车/障碍车轮廓解构，"车毁=画崩"）——
const pieces = [];
// opts.flat = 侧向撞栏演出（§10.5）：飞散偏扁、沿切线、低重力滑移
export function shatter(key, anchorX, anchorY, ppm, impactYm = 0.6, opts = {}) {
  const segs = segmentsOf(key);
  const flat = !!opts.flat;
  for (const [x1, y1, x2, y2] of segs) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const ox = cx, oy = cy - impactYm;
    const L = Math.hypot(ox, oy) || 0.3;
    const sp = flat ? 1.5 + Math.random() * 2.5 : 2.5 + Math.random() * 5.5;
    pieces.push({
      cx, cy, dx, dy, ax: anchorX, ay: anchorY, ppm,
      x: cx, y: cy,
      vx: flat
        ? (Math.random() - 0.5) * 5                       // 扁：沿切线（横向）滑移
        : (ox / L) * sp + (Math.random() - 0.5) * 2,
      vy: flat
        ? 0.4 + Math.random() * 1.2                       // 几乎不上抛
        : (oy / L) * sp * 0.6 + 2.5 + Math.random() * 3,
      om: (Math.random() - 0.5) * (flat ? 4 : 9), ang: 0,
      life: (flat ? 0.55 : 0.7) + Math.random() * 0.7, tot: 0,
      grav: flat ? 2.0 : 9.8,
    });
  }
}
export function clearFx() { sparks.length = 0; pieces.length = 0; }

export function updateFx(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.tot += dt;
    if (s.tot > s.life) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 900 * dt;
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.tot += dt;
    if (p.tot > p.life) { pieces.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= (p.grav || 9.8) * dt;  // 米空间，y 向上
    p.ang += p.om * dt;
  }
}

export function drawFx(ctx, time) {
  // 火花（金色短线）
  if (sparks.length) {
    ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of sparks) {
      const k = 1 - s.tot / s.life;
      ctx.globalAlpha = k;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // 碎线（随当前调色板主线色，渐隐 = "失去墨"）
  if (pieces.length) {
    ctx.strokeStyle = PAL.line; ctx.lineCap = 'round';
    for (const p of pieces) {
      const k = 1 - p.tot / p.life;
      ctx.globalAlpha = k * 0.95;
      ctx.lineWidth = 2.2 * Math.max(0.4, k);
      const c = Math.cos(p.ang), s = Math.sin(p.ang);
      const hx = p.dx / 2, hy = p.dy / 2;
      const px = p.ax + p.x * p.ppm, py = p.ay - p.y * p.ppm;
      ctx.beginPath();
      ctx.moveTo(px + (hx * c - hy * s) * p.ppm, py - (hx * s + hy * c) * p.ppm);
      ctx.lineTo(px - (hx * c - hy * s) * p.ppm, py + (hx * s + hy * c) * p.ppm);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// —— 速度线（氮气 FOV 拉宽配套，画面边缘放射短线）——
const slines = [];
for (let i = 0; i < 26; i++) slines.push({ ang: Math.random() * Math.PI * 2, r: Math.random(), sp: 0.7 + Math.random() * 0.8 });

export function drawSpeedLines(ctx, W, H, intensity, time) {
  if (intensity <= 0.01) return;
  const cx = W / 2, cy = H * CFG.horizon;
  const Rmax = Math.hypot(W, H) * 0.62;
  ctx.strokeStyle = PAL.line; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const l of slines) {
    l.r += l.sp * intensity * 0.09;
    if (l.r > 1) { l.r = 0.25 + Math.random() * 0.1; l.ang = Math.random() * Math.PI * 2; }
    const r0 = l.r * Rmax, r1 = r0 + 26 + 60 * intensity;
    ctx.globalAlpha = intensity * 0.30 * Math.min(1, (l.r - 0.2) * 2);
    ctx.moveTo(cx + Math.cos(l.ang) * r0, cy + Math.sin(l.ang) * r0 * 0.9);
    ctx.lineTo(cx + Math.cos(l.ang) * r1, cy + Math.sin(l.ang) * r1 * 0.9);
  }
  ctx.stroke(); ctx.globalAlpha = 1;
}

// —— 氮气尾焰（金色线条拖尾，双排气口；位置对齐视频主车外角排气）——
export function drawNitroFlames(ctx, bx, by, ppm, speedPct, time) {
  const len = (34 + speedPct * 66) * (0.85 + Math.random() * 0.3);
  ctx.strokeStyle = PAL.gold; ctx.lineCap = 'round';
  for (const side of [-0.61, 0.61]) {
    const x0 = bx + side * ppm, y0 = by - 0.36 * ppm;
    for (let j = 0; j < 2; j++) {
      ctx.globalAlpha = (j === 0 ? 0.85 : 0.45) * (0.7 + Math.random() * 0.3);
      ctx.lineWidth = j === 0 ? 2.4 : 1.3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let t = 1; t <= 5; t++) {
        const k = t / 5;
        ctx.lineTo(x0 + Math.sin(time * 34 + t * 1.9 + side * 7) * 4.5 * k,
                   y0 + k * len);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
