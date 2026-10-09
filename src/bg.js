// bg.js — 背景层（§5 背景随路段绑定 + §3.3B 素材接入）
// 城市=天际线位图条带；群山=山峦位图双层（p1_mountain_far/mid）+ 程序化兜底；
// 沙漠=程序沙丘；海洋=波浪线阵列 + 货船/灯塔剪影（跨海大桥 §5#7）。
// 夜/暮主题叠加天体带（p1_sky_celestial）与飞鸟群（p2_dynamic_dots 简笔化）。
// 过渡：路段混合系数驱动 alpha + 横向漂移（旧景漂出左、新景漂入右）。
import { PAL } from './palette.js';
import skylineUrl from './assets/orig/skyline.jpg';
import mtnFarUrl from './assets/orig/mtn_far.jpg';
import mtnMidUrl from './assets/orig/mtn_mid.jpg';
import celestialUrl from './assets/orig/celestial.jpg';
import shipAUrl from './assets/orig/ship_a.jpg';
import shipBUrl from './assets/orig/ship_b.jpg';
import lighthouseUrl from './assets/orig/lighthouse.jpg';

// 白线 JPG → 白+alpha 遮罩（亮度转 alpha，可降采样；四角检测自动反色——反色坑兜底）
function processLineArt(img, knee, gain, maxSide = 1536) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(img.width * k));
  cv.height = Math.max(2, Math.round(img.height * k));
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0, cv.width, cv.height);
  const d = c.getImageData(0, 0, cv.width, cv.height);
  // 四角亮度采样：白底黑线（反色图）→ 先反色再转 alpha；反转图残余灰底用动态 knee 抹掉
  const w = cv.width, hgt = cv.height;
  const corners = [0, (w - 6) * 4, (hgt - 6) * w * 4, ((hgt - 6) * w + w - 6) * 4];
  const cornerAvg = corners.reduce((a, o) => a + d.data[o], 0) / 4;
  const inv = cornerAvg > 128;
  const kneeEff = inv ? Math.max(knee, 255 - cornerAvg + 16) : knee;
  for (let i = 0; i < d.data.length; i += 4) {
    let lum = d.data[i];
    if (inv) lum = 255 - lum;
    d.data[i] = 255; d.data[i + 1] = 255; d.data[i + 2] = 255;
    d.data[i + 3] = Math.min(255, Math.max(0, (lum - kneeEff) * gain));
  }
  c.putImageData(d, 0, 0);
  return cv;
}

// 遮罩按主题线色染色（缓存 key 防重复）
const tints = new Map();
function tinted(mask) {
  const key = PAL.key + ':' + (mask.__id || (mask.__id = Math.random().toString(36).slice(2)));
  let cv = tints.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = mask.width; cv.height = mask.height;
    const c = cv.getContext('2d');
    c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = PAL.line;
    c.fillRect(0, 0, cv.width, cv.height);
    tints.set(key, cv);
    if (tints.size > 24) { const k0 = tints.keys().next().value; tints.delete(k0); }
  }
  return cv;
}

let ready = false;
const M = {};                       // 遮罩集合
// knee 46 + gain 2.2——条带图边缘常有 30-40 的 JPEG 噪底，25 会在天空留灰带
function load(url, id, maxSide) {
  const img = new Image();
  img.onload = () => { M[id] = processLineArt(img, 46, 2.2, maxSide); ready = true; };
  img.src = url;
}
export function initBg() {
  load(skylineUrl, 'skyline', 1536);
  load(mtnFarUrl, 'mtnFar', 1536);
  load(mtnMidUrl, 'mtnMid', 1536);
  load(celestialUrl, 'celestial', 1536);
  load(shipAUrl, 'shipA', 640);
  load(shipBUrl, 'shipB', 640);
  load(lighthouseUrl, 'lighthouse', 512);
}
export function bgRefresh() { tints.clear(); }

// 程序山脊（兜底）/ 沙丘：确定性正弦叠加
function ridgeY(wx, seed, f) {
  return Math.sin(wx * f + seed) * 0.5 +
         Math.sin(wx * f * 2.7 + seed * 0.13) * 0.3 +
         Math.sin(wx * f * 0.41 + seed * 0.07 + 5) * 0.2;
}
function duneY(wx, seed, f) {
  return Math.sin(wx * f + seed) * 0.65 + Math.sin(wx * f * 0.31 + seed * 0.05 + 2) * 0.35;
}

// 位图条带平铺（天际线/山峦/天体）：h 为屏高比例
function drawStrip(ctx, W, cy, scroll, mask, alpha, drift, hK, par, yOff = 0) {
  if (!mask || alpha <= 0.02) return;
  const cv = tinted(mask);
  const h = H() * hK;
  const w = h * (cv.width / cv.height);
  let off = -((scroll * par) % w); if (off > 0) off -= w;
  ctx.globalAlpha = alpha;
  for (let x = off - w + drift; x < W + drift; x += w) {
    ctx.drawImage(cv, x, cy - h + yOff, w, h);
  }
  ctx.globalAlpha = 1;
}
let _H = 0;
function H() { return _H; }

// 海洋：三层波浪线（近快远慢）+ 货船/灯塔剪影
function drawOcean(ctx, W, H, cy, scroll, alpha, drift, time) {
  ctx.strokeStyle = PAL.line;
  const rows = [
    { par: 0.02, amp: 2.2, base: 10, a: 0.35, f: 0.020, lw: 1 },
    { par: 0.045, amp: 3.4, base: 26, a: 0.55, f: 0.014, lw: 1.2 },
    { par: 0.085, amp: 5.0, base: 46, a: 0.8, f: 0.009, lw: 1.4 },
  ];
  for (const r of rows) {
    ctx.globalAlpha = alpha * r.a;
    ctx.lineWidth = r.lw;
    ctx.beginPath();
    for (let sx = -drift; sx <= W - drift; sx += 14) {
      const wx = sx + scroll * r.par;
      const y = cy + r.base + Math.sin(wx * r.f + r.base * 7 + time * (0.4 + r.par * 8)) * r.amp
                      + Math.sin(wx * r.f * 2.9 + 2) * r.amp * 0.4;
      if (sx === -drift) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }
  // 货船 ×2（视差极慢）+ 灯塔（闪烁点光）
  drawOceanProp(ctx, W, cy, scroll, alpha, 'shipA', 0.028, 0.22, 17, 4.2, time, drift);
  drawOceanProp(ctx, W, cy, scroll, alpha, 'shipB', 0.04, 0.34, 41, 3.4, time, drift);
  drawOceanProp(ctx, W, cy, scroll, alpha, 'lighthouse', 0.018, 0.30, 240, 5.4, time, drift);
}
function drawOceanProp(ctx, W, cy, scroll, alpha, id, par, hK, seedOff, baseDn, time, drift) {
  const mask = M[id];
  if (!mask || alpha <= 0.02) return;
  const cv = tinted(mask);
  const h = H() * hK;
  const w = h * (cv.width / cv.height);
  const span = W + w * 2;
  let x = -((scroll * par + seedOff * 500) % span); if (x > 0) x -= span;
  x += drift;
  const y = cy + baseDn + Math.sin((scroll * par + seedOff) * 0.05) * 2;
  ctx.globalAlpha = alpha * (id === 'lighthouse' ? 0.8 : 0.75);
  ctx.drawImage(cv, x, y - h, w, h);
  if (id === 'lighthouse') {
    const bl = 0.5 + 0.5 * Math.sin(time * 2.4);
    ctx.globalAlpha = alpha * bl;
    ctx.fillStyle = PAL.gold;
    ctx.beginPath(); ctx.arc(x + w * 0.5, y - h * 0.86, 1.6 + bl, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 飞鸟群（§3.3B P2 动态点缀：单折线双翼，3 帧扑翼）
function drawBirds(ctx, W, cy, alpha, time) {
  if (alpha <= 0.02) return;
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = alpha * 0.6;
  for (let i = 0; i < 5; i++) {
    const t = time * (14 + i * 2) + i * 173;
    const x = ((t * (16 + i * 3)) % (W + 220)) - 110;
    const y = cy - H() * (0.09 + 0.05 * Math.sin(t * 0.02 + i)) - i * 9;
    const s = 3.2 + (i % 3);
    const flap = Math.sin(time * 9 + i * 1.7);
    ctx.beginPath();
    ctx.moveTo(x - s, y + flap * s * 0.45);
    ctx.lineTo(x, y);
    ctx.lineTo(x + s, y + flap * s * 0.45);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRidges(ctx, W, H, cy, scroll, seed, alpha, drift, smooth) {
  const defs = smooth
    ? [ { par: 0.03, amp: H * 0.05, base: H * 0.045, a: 0.50, f: 0.0016 },
        { par: 0.07, amp: H * 0.08, base: H * 0.015, a: 0.85, f: 0.0026 } ]
    : [ { par: 0.025, amp: H * 0.07, base: H * 0.050, a: 0.40, f: 0.0011 },
        { par: 0.050, amp: H * 0.10, base: H * 0.030, a: 0.65, f: 0.0021 },
        { par: 0.090, amp: H * 0.13, base: H * 0.010, a: 0.90, f: 0.0033 } ];
  ctx.strokeStyle = PAL.line;
  for (const L of defs) {
    ctx.globalAlpha = alpha * L.a;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let sx = -drift; sx <= W - drift; sx += 18) {
      const wx = sx + scroll * L.par + seed * 137;
      const n = smooth ? duneY(wx, seed, L.f) : ridgeY(wx, seed, L.f);
      const y = cy - L.base - (n * 0.5 + 0.5) * L.amp;
      if (sx === -drift) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSectionBg(ctx, W, H, cy, sec, alpha, drift, scroll, time) {
  if (alpha <= 0.02 || !sec) return;
  const night = PAL.key === 'ink' || PAL.key === 'dusk';
  if (sec.bg === 'city') {
    drawStrip(ctx, W, cy, scroll, M.skyline, alpha, drift, 0.17, 0.05);
    if (night) drawStrip(ctx, W, cy, scroll, M.celestial, alpha * 0.4, drift * 0.6, 0.20, 0.02, -H * 0.10);
  } else if (sec.bg === 'mountain') {
    drawStrip(ctx, W, cy, scroll, M.mtnFar, alpha * 0.55, drift * 0.7, 0.16, 0.02);
    drawStrip(ctx, W, cy, scroll, M.mtnMid, alpha * 0.85, drift, 0.20, 0.055);
    if (!M.mtnFar) drawRidges(ctx, W, H, cy, scroll, sec.seed, alpha, drift, false);
    if (night) drawStrip(ctx, W, cy, scroll, M.celestial, alpha * 0.4, drift * 0.5, 0.20, 0.015, -H * 0.11);
  } else if (sec.bg === 'desert') {
    drawRidges(ctx, W, H, cy, scroll, sec.seed, alpha, drift, true);
    if (night) drawStrip(ctx, W, cy, scroll, M.celestial, alpha * 0.45, drift * 0.5, 0.22, 0.015, -H * 0.10);
  } else if (sec.bg === 'ocean') {
    drawOcean(ctx, W, H, cy, scroll, alpha, drift, time);
  }
}

export function drawBackground(ctx, W, H, cy, game, track, mlA = 1) {
  _H = H;
  const scroll = game.bgScroll || 0;
  const time = game.time || 0;
  const b2 = track.sectionBlendAt(game.cam.z);
  const night = PAL.key === 'ink' || PAL.key === 'dusk';
  if (night && (b2.a?.bg !== 'ocean')) drawBirds(ctx, W, cy, mlA, time);
  if (b2.b && b2.k < 1) {
    // 旧景漂出左、新景漂入右（§5）
    drawSectionBg(ctx, W, H, cy, b2.a, (1 - b2.k) * mlA, b2.k * W * 0.22, scroll, time);
    drawSectionBg(ctx, W, H, cy, b2.b, b2.k * mlA, -(1 - b2.k) * W * 0.22, scroll, time);
  } else {
    drawSectionBg(ctx, W, H, cy, b2.a, mlA, 0, scroll, time);
  }
}
