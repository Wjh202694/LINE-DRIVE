// menu.js — M4 菜单层：选关地图（§6 等距街区 + 路段节点金色虚线）+ 图纸收藏图鉴（§5 每 5km 解锁）
import { PAL } from './palette.js';
import { CFG, clamp } from './config.js';
import cityIsoUrl from './assets/orig/city_iso.jpg';
import carFourUrl from './assets/orig/car_fourview.jpg';
import carXrayUrl from './assets/orig/car_black.jpg';
import house1TvUrl from './assets/orig/house1_threeview.jpg';
import housesFourUrl from './assets/orig/houses_four.jpg';
import skylineUrl from './assets/orig/skyline.jpg';
import mtnFarUrl from './assets/orig/mtn_far.jpg';
import windmillUrl from './assets/orig/windmill.jpg';
import shipAUrl from './assets/orig/ship_a.jpg';
import towerAUrl from './assets/orig/tower_a.jpg';
import cactusAUrl from './assets/orig/cactus_a.jpg';
import forkSignUrl from './assets/orig/fork_sign.jpg';

const MONO = (s, w = 500) => `${w} ${s}px ui-monospace, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace`;

// —— 图片异步加载缓存 ——
const imgs = new Map();
function img(key, url) {
  let rec = imgs.get(key);
  if (!rec) { rec = { el: new Image(), ok: false }; rec.el.onload = () => { rec.ok = true; }; rec.el.src = url; imgs.set(key, rec); }
  return rec;
}
img('cityIso', cityIsoUrl);

// —— 图纸收藏定义（§5 里程碑奖励：每 5km 解锁一页）——
export const UNLOCKS = [
  { km: 0,  name: '城市街道 · 立面',   key: 'skyline',     url: skylineUrl },
  { km: 5,  name: '三居室住宅 · 三视图', key: 'house1tv',   url: house1TvUrl },
  { km: 10, name: '超级跑车 · 四视图',  key: 'carFour',     url: carFourUrl },
  { km: 15, name: '街区规划 · 等距图', key: 'cityIso',     url: cityIsoUrl },
  { km: 20, name: '跑车 · 透视线稿',    key: 'carXray',     url: carXrayUrl },
  { km: 25, name: '四栋住宅 · 全景',    key: 'housesFour',  url: housesFourUrl },
  { km: 30, name: '远山轮廓 · 图层',    key: 'mtnFar',      url: mtnFarUrl },
  { km: 35, name: '风车 · 正视图',      key: 'windmill',    url: windmillUrl },
  { km: 40, name: '跨海大桥 · 桥塔',    key: 'towerA',      url: towerAUrl },
  { km: 45, name: '货船 · 剪影',        key: 'shipA',       url: shipAUrl },
  { km: 50, name: '沙漠 · 仙人掌',      key: 'cactusA',     url: cactusAUrl },
  { km: 55, name: '岔路提示牌 · 正稿',  key: 'forkSign',    url: forkSignUrl },
];
export function unlockedCount(bestM) { return UNLOCKS.filter(u => bestM >= u.km * 1000).length; }

// —— 公共：图纸边框 ——
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

// —— 选关地图（§6：等距街区底图 + 节点=路段，金色虚线连接；含当前位置）——
export function drawMap(ctx, W, H, game, track) {
  ctx.fillStyle = PAL.bg; ctx.globalAlpha = 0.92;
  ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  frame(ctx, W, H);

  // 等距街区底图（居中淡色，§6 "等距街区鸟瞰作选关地图底图"）
  const iso = imgs.get('cityIso');
  if (iso && iso.ok) {
    const iw = Math.min(W * 0.62, iso.el.width);
    const ih = iw * iso.el.height / iso.el.width;
    ctx.globalAlpha = 0.14;
    ctx.drawImage(iso.el, (W - iw) / 2, H * 0.5 - ih / 2, iw, ih);
    ctx.globalAlpha = 1;
  }

  // 标题
  ctx.fillStyle = PAL.line; ctx.textAlign = 'center';
  ctx.font = MONO(22, 700);
  ctx.fillText('路 线 图', W / 2, 62);
  ctx.font = MONO(12); ctx.globalAlpha = 0.55;
  ctx.fillText(`· 无 尽 环 线 · 全 程 ${(track.length / 1000).toFixed(1)} km · 循环跑道 ·`, W / 2, 84);
  ctx.globalAlpha = 1;

  // 节点蛇形布局：每行 4 个
  const secs = track.sections;
  const cols = 4;
  const rows = Math.ceil(secs.length / cols);
  const gridW = Math.min(W - 160, 1080);
  const x0 = (W - gridW) / 2;
  const y0 = 150;
  const rowH = Math.min((H - y0 - 130) / Math.max(rows, 1), 150);
  const colW = gridW / cols;
  const nodeW = Math.min(colW - 34, 190), nodeH = 74;

  // 当前段索引
  const secIdxNow = secs.findIndex(s => game.cam.z >= s.startZ && game.cam.z < s.endZ);
  const idx = secIdxNow >= 0 ? secIdxNow : secs.length - 1;

  const nodePos = secs.map((s, i) => {
    const r = Math.floor(i / cols), c = (r % 2 === 0) ? i % cols : cols - 1 - (i % cols);   // 蛇形
    return { x: x0 + c * colW + colW / 2, y: y0 + r * rowH + nodeH / 2, i };
  });

  // 金色虚线连接
  ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  for (let i = 0; i < nodePos.length - 1; i++) {
    const a = nodePos[i], b = nodePos[i + 1];
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // 末节点回到首节点（环线）
  const la = nodePos[nodePos.length - 1], fb = nodePos[0];
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(la.x, la.y); ctx.lineTo(la.x + 30, la.y + 40); ctx.lineTo(fb.x - 30, fb.y - 40); ctx.lineTo(fb.x, fb.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 节点
  ctx.textAlign = 'center';
  for (const p of nodePos) {
    const s = secs[p.i];
    const isNow = p.i === idx;
    const pulse = isNow ? 0.75 + 0.25 * Math.sin(game.time * 4) : 1;
    // 卡片
    ctx.strokeStyle = isNow ? PAL.gold : PAL.line;
    ctx.lineWidth = isNow ? 2.4 : 1.2;
    ctx.globalAlpha = isNow ? pulse : 0.75;
    ctx.strokeRect(p.x - nodeW / 2, p.y - nodeH / 2, nodeW, nodeH);
    ctx.globalAlpha = isNow ? 0.16 : 0.06;
    ctx.fillStyle = isNow ? PAL.gold : PAL.line;
    ctx.fillRect(p.x - nodeW / 2, p.y - nodeH / 2, nodeW, nodeH);
    ctx.globalAlpha = isNow ? 0.95 : 0.8;
    ctx.fillStyle = isNow ? PAL.gold : PAL.line;
    ctx.font = MONO(14, isNow ? 700 : 500);
    ctx.fillText(s.name, p.x, p.y - 6);
    ctx.font = MONO(11); ctx.globalAlpha = 0.55;
    ctx.fillText(`起 ${(s.startZ / 1000).toFixed(1)}km · 长 ${((s.endZ - s.startZ) / 1000).toFixed(1)}km`, p.x, p.y + 16);
    if (isNow) {
      ctx.globalAlpha = 0.95;
      ctx.font = MONO(11, 700);
      ctx.fillText('▼ 你在这里', p.x, p.y - nodeH / 2 - 8);
    }
  }
  ctx.globalAlpha = 1;

  // 底部
  ctx.font = MONO(12); ctx.globalAlpha = 0.5;
  ctx.fillText('金色虚线 = 环线路径 · 金色边框 = 当前路段', W / 2, H - 58);
  ctx.font = MONO(13, 700); ctx.globalAlpha = 0.85;
  const blink = 0.5 + 0.5 * Math.sin(game.time * 3.5);
  ctx.globalAlpha = 0.35 + 0.55 * blink;
  ctx.fillText('M / Esc  返回', W / 2, H - 34);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// —— 图纸收藏图鉴（§5 每 5km 解锁一页；§6 车库/图鉴）——
export function drawGallery(ctx, W, H, game) {
  ctx.fillStyle = PAL.bg; ctx.globalAlpha = 0.94;
  ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  frame(ctx, W, H);

  const bestM = Math.max(game.bestKm || 0, game.dist || 0);
  const have = unlockedCount(bestM);

  ctx.fillStyle = PAL.line; ctx.textAlign = 'center';
  ctx.font = MONO(22, 700);
  ctx.fillText('图 纸 收 藏', W / 2, 62);
  ctx.font = MONO(12); ctx.globalAlpha = 0.55;
  ctx.fillText(`已解锁 ${have} / ${UNLOCKS.length} · 每 5 km 解锁一页（最远 ${(bestM / 1000).toFixed(2)} km）`, W / 2, 84);
  ctx.globalAlpha = 1;

  // 卡片网格 4×3
  const cols = 4, rows = Math.ceil(UNLOCKS.length / cols);
  const gridW = Math.min(W - 140, 1180);
  const x0 = (W - gridW) / 2;
  const y0 = 116;
  const colW = gridW / cols;
  const rowH = Math.min((H - y0 - 90) / rows, 210);
  const cw = colW - 26, ch = rowH - 22;

  for (let i = 0; i < UNLOCKS.length; i++) {
    const u = UNLOCKS[i];
    const unlocked = bestM >= u.km * 1000;
    const c = i % cols, r = Math.floor(i / cols);
    const x = x0 + c * colW + 13, y = y0 + r * rowH + 11;

    ctx.strokeStyle = unlocked ? PAL.line : PAL.line;
    ctx.lineWidth = unlocked ? 1.6 : 1;
    ctx.globalAlpha = unlocked ? 0.9 : 0.35;
    ctx.strokeRect(x, y, cw, ch);
    if (!unlocked) {
      // 未解锁：斜线斑纹
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      for (let d = 0; d < cw + ch; d += 16) {
        ctx.moveTo(x + Math.max(0, d - ch), y + Math.min(d, ch));
        ctx.lineTo(x + Math.min(d, cw), y + Math.max(0, d - cw));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (unlocked) {
      const rec = img(u.key, u.url);
      if (rec.ok) {
        // 缩略图（contain 适配上半区）
        const pad = 8;
        const areaW = cw - pad * 2, areaH = ch - 40;
        const k = Math.min(areaW / rec.el.width, areaH / rec.el.height);
        const iw = rec.el.width * k, ih = rec.el.height * k;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(rec.el, x + pad + (areaW - iw) / 2, y + pad + (areaH - ih) / 2, iw, ih);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = PAL.line; ctx.font = MONO(11, 700);
      ctx.globalAlpha = 0.9;
      ctx.fillText(u.name, x + cw / 2, y + ch - 12);
      ctx.fillStyle = PAL.gold; ctx.font = MONO(9);
      ctx.globalAlpha = 0.75;
      ctx.fillText(`解锁于 ${u.km} km`, x + cw / 2, y + ch - 1);
      ctx.globalAlpha = 1; ctx.fillStyle = PAL.line;
    } else {
      ctx.fillStyle = PAL.line; ctx.font = MONO(26, 700);
      ctx.globalAlpha = 0.30;
      ctx.fillText('?', x + cw / 2, y + ch / 2 + 2);
      ctx.font = MONO(11);
      ctx.fillText(`达成 ${u.km} km 解锁`, x + cw / 2, y + ch / 2 + 30);
      ctx.globalAlpha = 1;
    }
  }

  ctx.font = MONO(13, 700);
  const blink = 0.5 + 0.5 * Math.sin(game.time * 3.5);
  ctx.globalAlpha = 0.35 + 0.55 * blink;
  ctx.fillText('G / Esc  返回', W / 2, H - 34);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
