// ui.js — HUD / 标题页 / 结算页 / 暂停 / 转向提示（全线稿风，颜色取自 PAL）
import { CFG, clamp } from './config.js';
import { PAL } from './palette.js';
import { drawSprite } from './sprites.js';
import { input } from './input.js';

const MONO = (s, w = 500) => `${w} ${s}px ui-monospace, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace`;

function spaced(ctx, text, cx, y, spacing) {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let x = cx - total / 2;
  for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + spacing; }
  return total;
}

function alignRight(ctx, text, x, y) {
  const w = ctx.measureText(text).width;
  ctx.fillText(text, x - w, y);
}

// 图纸边框 + 角标
function frame(ctx, W, H) {
  const m = 20, l = 14;
  ctx.strokeStyle = PAL.line; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
  ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.moveTo(cx + sx * l, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * l);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// 图签栏（右下角图纸标题块）
function titleBlock(ctx, W, H) {
  const w = 208, h = 56, x = W - 20 - w, y = H - 20 - h;
  ctx.strokeStyle = PAL.line; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.lineTo(x + w, y + 20);
  ctx.moveTo(x + 120, y + 20); ctx.lineTo(x + 120, y + h); ctx.stroke();
  ctx.globalAlpha = 0.9; ctx.fillStyle = PAL.line;
  ctx.font = MONO(11, 700); ctx.fillText('LINE DRIVE', x + 8, y + 14);
  ctx.font = MONO(9); ctx.globalAlpha = 0.55;
  ctx.fillText('图纸世界 · 图纸编号 LD-M1', x + 8, y + 34);
  ctx.fillText('比例 1:1', x + 8, y + 48);
  ctx.fillText('REV A', x + 128, y + 38);
  ctx.globalAlpha = 1;
}

export function drawHUD(ctx, W, H, game) {
  const p = game.player;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAL.line;

  // 速度
  ctx.font = MONO(36, 700);
  const kmh = String(Math.round(p.speed * 3.6));
  ctx.fillText(kmh, 26, 52);
  const kmhW = ctx.measureText(kmh).width;
  ctx.font = MONO(12); ctx.globalAlpha = 0.55;
  ctx.fillText('km/h', 26 + kmhW + 8, 52);
  // 里程 / 得分
  ctx.font = MONO(15);
  ctx.fillText(`${(game.dist / 1000).toFixed(2)} km`, 26, 76);
  const mult = Math.min(3, 1 + game.combo * 0.1);
  if (mult > 1) { ctx.fillStyle = PAL.gold; }
  ctx.fillText(String(Math.floor(game.score)).padStart(7, '0'), 26, 98);
  ctx.fillStyle = PAL.line; ctx.globalAlpha = 1;

  // 连击（顶部中央，脉冲）
  if (game.combo >= 2) {
    const pulse = Math.max(0, 1 - (game.time - game.comboFlashT) / 0.3);
    ctx.font = MONO(26 + pulse * 8, 700);
    ctx.fillStyle = PAL.gold; ctx.textAlign = 'center';
    ctx.fillText(`×${mult.toFixed(1)}`, W / 2, 52);
    ctx.textAlign = 'left'; ctx.fillStyle = PAL.line;
  }

  // 最高分（右上）
  ctx.font = MONO(12); ctx.globalAlpha = 0.5;
  alignRight(ctx, `最高 ${String(game.best).padStart(7, '0')}`, W - 26, 40);
  alignRight(ctx, `最远 ${(game.bestKm / 1000).toFixed(2)} km`, W - 26, 58);
  ctx.globalAlpha = 1;

  // 撞击计数（§10.3）：小车轮廓 ×3，撞一次熄一格
  const iw = 30, igap = 12;
  for (let i = 0; i < CFG.maxImpacts; i++) {
    const ix = W - 26 - (CFG.maxImpacts - i) * (iw + igap);
    const used = i < game.impacts;
    drawSprite(ctx, 'player', ix + iw / 2, 96, iw / 1.94, used ? 0.15 : 0.8, false);
    if (used) {
      ctx.strokeStyle = PAL.danger; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ix + 3, 72); ctx.lineTo(ix + iw - 3, 94);
      ctx.stroke();
    }
  }

  // 氮气条（右下）
  const bw = 150, bx = W - 26 - bw, by = H - 34;
  ctx.font = MONO(10); ctx.globalAlpha = p.nitroOn ? 1 : 0.55;
  alignRight(ctx, 'NITRO', W - 26, by - 6);
  ctx.strokeStyle = PAL.line; ctx.lineWidth = 1.2;
  ctx.strokeRect(bx, by, bw, 9);
  ctx.fillStyle = p.nitroOn ? PAL.gold : PAL.line;
  ctx.globalAlpha = p.nitroOn ? 0.95 : 0.5;
  ctx.fillRect(bx + 1.5, by + 1.5, (bw - 3) * p.nitro, 6);
  ctx.globalAlpha = 1; ctx.fillStyle = PAL.line;

  // FPS
  if (game.showFps) {
    ctx.font = MONO(11); ctx.globalAlpha = 0.45;
    ctx.fillText(`${Math.round(game.fps)} FPS`, 26, H - 26);
    ctx.globalAlpha = 1;
  }

  // 主题流转彩蛋（§3.2A 切题提示「时辰·○○」）
  if (game.themeToastT > 0) {
    const a = Math.min(1, (1.6 - game.themeToastT) / 0.3, game.themeToastT / 0.4);
    ctx.font = MONO(13, 700); ctx.textAlign = 'center';
    ctx.fillStyle = PAL.gold; ctx.globalAlpha = a * 0.9;
    ctx.fillText(`时辰 · ${PAL.name}`, W / 2, 128);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1; ctx.fillStyle = PAL.line;
  }

  // 路段提示（§5 进入新路段）
  if (game.sectToastT > 0) {
    const a = Math.min(1, (1.6 - game.sectToastT) / 0.3, game.sectToastT / 0.4);
    ctx.font = MONO(13); ctx.textAlign = 'center';
    ctx.globalAlpha = a * 0.85;
    ctx.fillText(`路段 · ${game.sectToastName}`, W / 2, 152);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
}

export function drawTitle(ctx, W, H, game) {
  ctx.fillStyle = PAL.bg; ctx.globalAlpha = 0.30;
  ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;

  frame(ctx, W, H);

  // 标题：逐笔写出（每字 0.4s，§6A.1），完成后金色下划线扫过
  const t = game.titleAnimT || 0;
  const chars = 'LINE DRIVE';
  const gap = 14;
  ctx.font = MONO(58, 700);
  const widths = [...chars].map(ch => ctx.measureText(ch).width);
  const tw = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  const titleY = H * 0.40;
  let cx0 = W / 2 - tw / 2;
  ctx.fillStyle = PAL.line;
  [...chars].forEach((ch, i) => {
    const w = widths[i];
    if (ch !== ' ') {
      const k = clamp((t - i * 0.4) / 0.4, 0, 1);
      if (k > 0) {
        ctx.globalAlpha = k;
        ctx.fillText(ch, cx0, titleY + (1 - k) * 14);
      }
    }
    cx0 += w + gap;
  });
  ctx.globalAlpha = 1;

  // 金色下划线扫过 + 笔尖亮点
  const u = clamp((t - 4.2) / 0.6, 0, 1);
  if (u > 0) {
    const uy = titleY + 18, lx = W / 2 - tw / 2;
    ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, uy); ctx.lineTo(lx + tw * u, uy);
    ctx.stroke();
    if (u < 1) {
      ctx.fillStyle = PAL.gold;
      ctx.fillRect(lx + tw * u - 2, uy - 3, 4, 6);
    } else {
      ctx.beginPath();
      ctx.moveTo(lx - 8, uy); ctx.lineTo(lx - 2, uy);
      ctx.moveTo(lx + tw + 2, uy); ctx.lineTo(lx + tw + 8, uy);
      ctx.stroke();
    }
  }

  // 副标与启程提示：下划线完成后淡入
  const late = clamp((t - 4.8) / 0.6, 0, 1);
  if (late > 0) {
    ctx.font = MONO(16); ctx.globalAlpha = 0.75 * late;
    spaced(ctx, '线 条 跑 车 · 图纸世界 M1 原型', W / 2, titleY + 48, 4);
    ctx.globalAlpha = 1;

    ctx.font = MONO(15, 700);
    ctx.globalAlpha = late * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(game.time * 3.9)));
    spaced(ctx, '按 空格 / 触屏 启程', W / 2, titleY + 96, 3);
    ctx.globalAlpha = 1;
  }

  // 操作说明（左下）
  ctx.font = MONO(12); ctx.globalAlpha = 0.5; ctx.textAlign = 'left';
  ctx.fillText('←/→ 或 A/D 变道    ↑ 加速    ↓ 刹车', 36, H - 62);
  ctx.fillText('空格 氮气    P 暂停    C 弯道调试    F 帧率', 36, H - 42);
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;

  // 最高纪录（右上）
  ctx.font = MONO(13);
  alignRight(ctx, `最高分 ${String(game.best).padStart(7, '0')}`, W - 36, 48);
  alignRight(ctx, `最远 ${(game.bestKm / 1000).toFixed(2)} km · 局数 ${game.runs}`, W - 36, 68);

  titleBlock(ctx, W, H);
}

export function drawCrash(ctx, W, H, game) {
  if (game.crashT < 1.0) return;
  const a = Math.min(1, (game.crashT - 1.0) / 0.4);
  const pw = Math.min(520, W - 80), ph = 296;
  const px = (W - pw) / 2, py = (H - ph) / 2 - 10;

  ctx.fillStyle = PAL.bg; ctx.globalAlpha = 0.78 * a;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a;

  ctx.strokeStyle = PAL.line; ctx.lineWidth = 1.5;
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 8, py + 8, pw - 16, ph - 16);

  ctx.fillStyle = PAL.line; ctx.textBaseline = 'alphabetic';
  ctx.font = MONO(15, 700);
  ctx.fillText('测 绘 报 告', px + 32, py + 44);
  ctx.font = MONO(13);
  alignRight(ctx, `No.${String(game.runs).padStart(4, '0')}`, px + pw - 32, py + 44);

  ctx.beginPath(); ctx.moveTo(px + 32, py + 58); ctx.lineTo(px + pw - 32, py + 58); ctx.stroke();

  // 里程（最大字）
  const km = (game.dist / 1000).toFixed(2);
  ctx.font = MONO(60, 700);
  ctx.fillText(km, px + 32, py + 136);
  const kmW = ctx.measureText(km).width;
  ctx.font = MONO(18);
  ctx.fillText('km', px + 40 + kmW, py + 136);
  ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px + 32, py + 152); ctx.lineTo(px + 212, py + 152); ctx.stroke();

  // 三栏小计
  ctx.font = MONO(13); ctx.fillStyle = PAL.line;
  ctx.fillText(`超车 ${game.overtakes}`, px + 32, py + 186);
  ctx.fillText(`最高连击 ${game.maxCombo}`, px + 148, py + 186);
  ctx.fillText(`峰值 ${Math.round(game.peak * 3.6)} km/h`, px + 290, py + 186);

  // 失败原因（转向失败等，§10.4）
  if (game.failReason) {
    ctx.fillStyle = PAL.danger; ctx.font = MONO(12);
    ctx.fillText(`结束原因 · ${game.failReason}`, px + 32, py + 205);
    ctx.fillStyle = PAL.line;
  }

  // 得分 / 新纪录
  ctx.font = MONO(15);
  const isBest = game.newBest;
  ctx.fillStyle = isBest ? PAL.gold : PAL.line;
  ctx.fillText(`得分 ${String(Math.floor(game.score)).padStart(7, '0')}${isBest ? '　— 新纪录' : ''}`, px + 32, py + 226);
  ctx.fillStyle = PAL.line;

  // 提示
  ctx.font = MONO(13);
  ctx.globalAlpha = a * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(game.time * 3.9)));
  spaced(ctx, '空格 再跑一次 · Esc 标题', px + pw / 2, py + ph - 30, 2);
  ctx.globalAlpha = 1;
}

export function drawPause(ctx, W, H) {
  ctx.fillStyle = PAL.bg; ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  ctx.fillStyle = PAL.line; ctx.textAlign = 'center';
  ctx.font = MONO(20, 700);
  ctx.fillText('已暂停', W / 2, H / 2 - 8);
  ctx.font = MONO(13); ctx.globalAlpha = 0.6;
  ctx.fillText('按 P 继续', W / 2, H / 2 + 20);
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}

// —— 转向系统 HUD（§10.4：方向提示 / 选定打勾 / 进度弧）——
function drawArrow(ctx, x, y, dir, s = 1) {
  ctx.beginPath();
  ctx.moveTo(x - dir * 26 * s, y);
  ctx.lineTo(x + dir * 18 * s, y);
  ctx.moveTo(x + dir * 8 * s, y - 11 * s); ctx.lineTo(x + dir * 20 * s, y); ctx.lineTo(x + dir * 8 * s, y + 11 * s);
  ctx.stroke();
}

export function drawSteer(ctx, W, H, game) {
  const s = game.steer;
  if (!s || s.phase === 'none' || !s.curve || game.state !== 'running') return;
  const dir = s.curve.dir;
  const cx = W / 2;
  ctx.save();
  ctx.textAlign = 'left'; ctx.lineCap = 'round';

  if (s.phase === 'wait') {
    // 待转区：方向提示 + 选定打勾
    ctx.strokeStyle = PAL.line; ctx.fillStyle = PAL.line;
    ctx.font = MONO(13); ctx.globalAlpha = 0.7;
    ctx.fillText('弯 道 待 转 区', cx - 150, 116);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    drawArrow(ctx, cx - 150 + 8, 146, dir, 1.5);
    ctx.font = MONO(17, 700);
    ctx.fillText(dir > 0 ? '按住 → 完成转向' : '按住 ← 完成转向', cx - 110, 152);
    if (s.selected) {
      ctx.strokeStyle = PAL.gold; ctx.fillStyle = PAL.gold;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 104, 176); ctx.lineTo(cx - 96, 184); ctx.lineTo(cx - 80, 166);
      ctx.stroke();
      ctx.font = MONO(13); ctx.fillText('已选定 · 金线已画入', cx - 68, 182);
    } else {
      ctx.strokeStyle = PAL.line; ctx.fillStyle = PAL.line;
      ctx.font = MONO(13);
      ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(game.time * 5));
      ctx.fillText('按一次方向键选定', cx - 104, 180);
      ctx.globalAlpha = 1;
    }
  } else if (s.phase === 'active') {
    // 转向区：左下角进度弧（区间行进度）+ 按住状态
    const frac = clamp(s.progress, 0, 1);
    const held = dir > 0 ? input.right : input.left;
    const acx = 108, acy = H - 108, r = 40;
    ctx.lineWidth = 2; ctx.strokeStyle = PAL.line; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(acx, acy, r, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = PAL.gold; ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(acx, acy, r, Math.PI * 0.75, Math.PI * 0.75 + frac * Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = held ? PAL.gold : PAL.danger;
    ctx.font = MONO(13, 700); ctx.textAlign = 'center';
    ctx.fillText(held ? '转 向 中' : '按 住 方 向 键 ！', acx, acy + 5);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}
