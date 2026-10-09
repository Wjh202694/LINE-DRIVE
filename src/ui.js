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
  ctx.fillText('图纸世界 · 图纸编号 LD-M4', x + 8, y + 34);
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

  // 金币线/加速带拾取反馈（§2.2/§2.3）
  if (game.time - game.pickFlashT < 0.7) {
    const k = 1 - (game.time - game.pickFlashT) / 0.7;
    ctx.font = MONO(17, 700); ctx.textAlign = 'center';
    ctx.fillStyle = PAL.gold; ctx.globalAlpha = k;
    ctx.fillText(game.pickKind === 'boost' ? '加 速 ！' : '+20', W / 2, H * 0.62 - (1 - k) * 26);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1; ctx.fillStyle = PAL.line;
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
    spaced(ctx, '线 条 跑 车 · 图纸世界', W / 2, titleY + 48, 4);
    ctx.globalAlpha = 1;

    ctx.font = MONO(15, 700);
    ctx.globalAlpha = late * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(game.time * 3.9)));
    spaced(ctx, '按 空格 / 触屏 启程', W / 2, titleY + 96, 3);
    ctx.globalAlpha = 1;
  }

  // 操作说明（左下）
  ctx.font = MONO(12); ctx.globalAlpha = 0.5; ctx.textAlign = 'left';
  ctx.fillText('←/→ 或 A/D 变道    ↑ 加速    ↓ 刹车', 36, H - 62);
  ctx.fillText('空格 氮气    P 暂停    M 路线图    G 图鉴    N 静音    F 帧率', 36, H - 42);
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
  const pw = Math.min(600, W - 80), ph = 400;
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

  // 得分
  ctx.font = MONO(15);
  const isBest = game.newBest;
  ctx.fillStyle = isBest ? PAL.gold : PAL.line;
  ctx.fillText(`得分 ${String(Math.floor(game.score)).padStart(7, '0')}${isBest ? '　— 新纪录' : ''}`, px + 32, py + 226);
  ctx.fillStyle = PAL.line;

  // —— §6A.3 本局速度-里程曲线（金色折线，含峰值刻度）——
  if (game.curve && game.curve.length > 2) {
    const cx0 = px + 32, cy0 = py + 244, cw = pw - 64, chh = 54;
    ctx.strokeStyle = PAL.line; ctx.globalAlpha = a * 0.25; ctx.lineWidth = 1;
    ctx.strokeRect(cx0, cy0, cw, chh);
    let dmax = 1;
    for (const p2 of game.curve) dmax = Math.max(dmax, p2.d);
    ctx.strokeStyle = PAL.gold; ctx.globalAlpha = a * 0.9; ctx.lineWidth = 1.6;
    ctx.beginPath();
    game.curve.forEach((p2, i) => {
      const X = cx0 + (p2.d / dmax) * cw;
      const Y = cy0 + chh - clamp(p2.s / CFG.maxSpeed, 0, 1) * (chh - 6) - 3;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    });
    ctx.stroke();
    ctx.globalAlpha = a * 0.45; ctx.font = MONO(9); ctx.fillStyle = PAL.line;
    ctx.fillText('速度-里程曲线', cx0 + 4, cy0 + 11);
    ctx.globalAlpha = a;
  }

  // —— 图纸收藏解锁提示（本局跨过 5km 门槛）——
  if (game.newUnlock) {
    ctx.font = MONO(12, 700); ctx.fillStyle = PAL.gold;
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(game.time * 4));
    ctx.fillText(`◆ 新图纸解锁 · ${game.newUnlock}（G 查看图鉴）`, px + 32, py + ph - 78);
    ctx.globalAlpha = a; ctx.fillStyle = PAL.line;
  }

  // —— 破纪录金章（§6A.3：圆章从 120% 缩到 100% + 纸面震感）——
  if (isBest) {
    // 注意 crashT 在 state→crashed 时冻结于 crashAnim(1.5s)——盖章时刻必须在 1.0~1.5s 的显示窗口内
    const stampT = clamp((game.crashT - 1.25) / 0.25, 0, 1);
    if (stampT > 0) {
      const ease = 1 - Math.pow(1 - stampT, 3);
      const sc = 1.2 - 0.2 * ease;
      const sx0 = px + pw - 78, sy0 = py + 116;
      ctx.save();
      ctx.translate(sx0, sy0);
      ctx.scale(sc, sc);
      ctx.rotate(-0.16);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = PAL.gold;
      ctx.font = MONO(15, 700); ctx.textAlign = 'center';
      ctx.fillText('新 纪 录', 0, -2);
      ctx.font = MONO(8);
      ctx.fillText('NEW RECORD', 0, 14);
      ctx.restore();
      ctx.textAlign = 'left';
      // 盖章瞬间纸面震动
      if (stampT > 0.55 && stampT < 0.95) {
        ctx.fillStyle = PAL.gold; ctx.globalAlpha = a * 0.06;
        ctx.fillRect(px, py, pw, ph);
        ctx.globalAlpha = a;
      }
    }
  }

  // —— 按钮行（§6A.3：再跑一次 / 图鉴 / 回到标题）——
  const by = py + ph - 40;
  const btns = [
    { label: '空格 · 再跑一次', w: 170 },
    { label: 'G · 图鉴', w: 110 },
    { label: 'Esc · 标题', w: 110 },
  ];
  let bx = px + 32;
  ctx.font = MONO(12, 700);
  for (const b of btns) {
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1.2;
    ctx.strokeRect(bx, by - 17, b.w, 24);
    // 默认焦点「再跑一次」金色描边
    if (b.label === '空格 · 再跑一次') {
      ctx.strokeStyle = PAL.gold;
      ctx.strokeRect(bx - 2, by - 19, b.w + 4, 28);
    }
    ctx.fillStyle = PAL.line;
    ctx.fillText(b.label, bx + 12, by);
    bx += b.w + 12;
  }
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

// —— 路口/转向 HUD（§10.4 + 2026-10-07 修订：车道选向 + 按住转向）——
function drawArrow(ctx, x, y, dir, s = 1) {
  ctx.beginPath();
  ctx.moveTo(x - dir * 26 * s, y);
  ctx.lineTo(x + dir * 18 * s, y);
  ctx.moveTo(x + dir * 8 * s, y - 11 * s); ctx.lineTo(x + dir * 20 * s, y); ctx.lineTo(x + dir * 8 * s, y + 11 * s);
  ctx.stroke();
}

// 待转区：各出口对应车道说明 + 当前车道走向；
// 匝道/弯道：按住转向提示 + 金线进度弧 + 未按住红色警告
export function drawJunction(ctx, W, H, game) {
  const jn = game.jn;
  const turn = game.turn;
  if (game.state !== 'running') return;
  const cx = W / 2;
  ctx.save();
  ctx.textAlign = 'center';

  // 强制转向区提示（优先级最高）
  if (turn && turn.dir) {
    const holding = (input.left && turn.dir === -1) || (input.right && turn.dir === 1);
    ctx.font = MONO(15, 700);
    ctx.fillStyle = holding ? PAL.gold : PAL.danger;
    ctx.globalAlpha = holding ? 0.95 : 0.6 + 0.4 * Math.sin(game.time * 14);
    const label = turn.dir < 0 ? '按住 ← 过弯' : '按住 → 过弯';
    ctx.fillText(label, cx, 96);
    ctx.globalAlpha = 1; ctx.fillStyle = PAL.line;
    if (!holding) {
      ctx.font = MONO(12); ctx.fillStyle = PAL.danger;
      ctx.fillText('松手将撞上护栏！', cx, 118);
      ctx.fillStyle = PAL.line;
    }
    // —— 转向完成条（v4.10）：按住方向键积累进度；3/4 处阈值刻度，出弯时低于阈值 = 失败 ——
    const prog = game.player.turnProg || 0;
    const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;
    const R = 30, CY = 196;
    // 底弧（灰）
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(cx, CY, R, A0, A0 + SWEEP);
    ctx.stroke();
    // 完成弧（按住时金色，未按变暗）——按已完成比例
    ctx.strokeStyle = holding ? PAL.gold : PAL.line;
    ctx.lineWidth = 4;
    ctx.globalAlpha = holding ? 0.95 : 0.35;
    ctx.beginPath();
    ctx.arc(cx, CY, R, A0, A0 + SWEEP * prog);
    ctx.stroke();
    // 3/4 阈值刻度线（红——未达标则出弯判定失败）
    const thA = A0 + SWEEP * 0.75;
    const thx = Math.cos(thA), thy = Math.sin(thA);
    ctx.strokeStyle = prog >= 0.75 ? PAL.line : PAL.danger;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(cx + thx * (R - 8), CY + thy * (R - 8));
    ctx.lineTo(cx + thx * (R + 8), CY + thy * (R + 8));
    ctx.stroke();
    // 达标指示（弧端点小圆点）
    if (prog >= 0.75) {
      ctx.fillStyle = PAL.line;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx + thx * R, CY + thy * R, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  if (!jn) { ctx.restore(); return; }
  const j = jn.j;

  if (jn.phase === 'wait') {
    ctx.font = MONO(13, 700); ctx.fillStyle = PAL.gold; ctx.globalAlpha = 0.9;
    ctx.fillText('前方岔路 · 车道选向', cx, 116);
    ctx.font = MONO(12); ctx.fillStyle = PAL.line; ctx.globalAlpha = 0.85;
    let yy = 142;
    for (const e of j.exits) {
      const lanesStr = e.lanes.length > 1
        ? `第 ${e.lanes[0] + 1}-${e.lanes[e.lanes[e.lanes.length - 1] !== undefined ? e.lanes.length - 1 : 0] + 1} 车道`
        : `第 ${e.lanes[0] + 1} 车道`;
      ctx.fillText(`${e.label} → ${lanesStr}`, cx, yy);
      yy += 20;
    }
    // 当前车道的走向高亮
    const cur = j.exits.find(e => e.lanes.includes(game.player.lane));
    if (cur) {
      ctx.fillStyle = PAL.gold; ctx.font = MONO(13, 700);
      ctx.fillText(`当前车道 → ${cur.label}${cur.dir !== 0 ? '（须按住方向过弯）' : ''}`, cx, yy + 6);
    }
    ctx.globalAlpha = 1;
  } else if (jn.phase === 'bend') {
    const E = jn.exit;
    ctx.font = MONO(12); ctx.fillStyle = PAL.line; ctx.globalAlpha = E.dir !== 0 ? 0.75 : 0.55;
    ctx.fillText(E.dir !== 0 ? `岔路 ${E.label} · 匝道行驶中` : '岔路直行通过 · 车道锁定', cx, 116);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
