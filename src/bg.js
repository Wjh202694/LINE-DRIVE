// bg.js — 背景层（§5 背景随路段绑定）
// 城市天际线（素材位图条带）/ 群山三折线（§3.3B 程序化）/ 沙丘双曲线（程序化）
// 过渡：路段混合系数驱动 alpha + 横向漂移（旧景漂出左、新景漂入右，§5 更新）
import { PAL } from './palette.js';
import skylineUrl from './assets/orig/skyline.jpg';

let skylineMask = null;      // 白线+alpha 遮罩
let skylineTinted = null, skylineTintKey = '';
let ready = false;

export function initBg() {
  const img = new Image();
  img.onload = () => {
    skylineMask = processLineArt(img, 25, 1.8);
    ready = true;
    bgRefresh();
  };
  img.src = skylineUrl;
}

// 白线 JPG → 白+alpha 遮罩（亮度转 alpha）
function processLineArt(img, knee, gain) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = d.data[i];
    d.data[i] = 255; d.data[i + 1] = 255; d.data[i + 2] = 255;
    d.data[i + 3] = Math.min(255, Math.max(0, (lum - knee) * gain));
  }
  c.putImageData(d, 0, 0);
  return cv;
}

// 主题换色：遮罩 source-in 染成当前线色（main 在量化跨步时调用）
export function bgRefresh() {
  if (!skylineMask) return;
  const cv = document.createElement('canvas');
  cv.width = skylineMask.width; cv.height = skylineMask.height;
  const c = cv.getContext('2d');
  c.drawImage(skylineMask, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = PAL.line;
  c.fillRect(0, 0, cv.width, cv.height);
  skylineTinted = cv; skylineTintKey = PAL.key;
}

// 程序山脊（群山）/ 沙丘（沙漠）：确定性正弦叠加，seed 随路段实例
function ridgeY(wx, seed, f) {
  return Math.sin(wx * f + seed) * 0.5 +
         Math.sin(wx * f * 2.7 + seed * 0.13) * 0.3 +
         Math.sin(wx * f * 0.41 + seed * 0.07 + 5) * 0.2;
}
function duneY(wx, seed, f) {
  return Math.sin(wx * f + seed) * 0.65 + Math.sin(wx * f * 0.31 + seed * 0.05 + 2) * 0.35;
}

function drawSkyline(ctx, W, H, cy, scroll, alpha, drift) {
  if (!skylineTinted) return;
  const h = H * 0.17;
  const w = h * (skylineTinted.width / skylineTinted.height);
  let off = -((scroll * 0.05) % w); if (off > 0) off -= w;
  ctx.globalAlpha = alpha;
  for (let x = off - w + drift; x < W + drift; x += w) {
    ctx.drawImage(skylineTinted, x, cy - h + 1, w, h);
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

function drawSectionBg(ctx, W, H, cy, sec, alpha, drift, scroll) {
  if (alpha <= 0.02 || !sec) return;
  if (sec.bg === 'city') drawSkyline(ctx, W, H, cy, scroll, alpha, drift);
  else if (sec.bg === 'mountain') drawRidges(ctx, W, H, cy, scroll, sec.seed, alpha, drift, false);
  else if (sec.bg === 'desert') drawRidges(ctx, W, H, cy, scroll, sec.seed, alpha, drift, true);
}

export function drawBackground(ctx, W, H, cy, game, track) {
  const scroll = game.bgScroll || 0;
  const b2 = track.sectionBlendAt(game.cam.z);
  if (b2.b && b2.k < 1) {
    // 旧景漂出左、新景漂入右（§5）
    drawSectionBg(ctx, W, H, cy, b2.a, 1 - b2.k, b2.k * W * 0.22, scroll);
    drawSectionBg(ctx, W, H, cy, b2.b, b2.k, -(1 - b2.k) * W * 0.22, scroll);
  } else {
    drawSectionBg(ctx, W, H, cy, b2.a, 1, 0, scroll);
  }
}
