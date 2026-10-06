// palette.js — 全局调色板（§3.2A 四主题昼夜流转）
// 「夜→晨→昼→暮」环形切换，3s RGB 逐帧插值；插值结果按 1/21 步进量化，
// 量化跨步时置 dirty → main 调 refreshSprites() 重建 sprite（§10.1 根因 4：避免逐帧微闪）。
export const THEME_ORDER = ['ink', 'blue', 'paper', 'dusk'];

export const THEMES = {
  ink:   { key: 'ink',   name: '墨夜', bg: '#000000', line: '#FFFFFF', gold: '#D4AF37', danger: '#FF3B30' },
  blue:  { key: 'blue',  name: '蓝图', bg: '#0B2545', line: '#BEE3F8', gold: '#E8C96A', danger: '#FF5A4E' },
  paper: { key: 'paper', name: '宣纸', bg: '#F5F0E6', line: '#1A1A1A', gold: '#B8860B', danger: '#C0392B' },
  dusk:  { key: 'dusk',  name: '黛暮', bg: '#14202B', line: '#E8DCC8', gold: '#E8963C', danger: '#FF6B4A' },
};

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
for (const t of Object.values(THEMES)) {
  t.rgb = { bg: hex2rgb(t.bg), line: hex2rgb(t.line), gold: hex2rgb(t.gold), danger: hex2rgb(t.danger) };
}

const KEYS = ['bg', 'line', 'gold', 'danger'];

// 对外只读的字符串字段（每帧同步，渲染层直接取用）
export const PAL = { key: 'ink', name: '墨夜', bg: '#000000', line: '#FFFFFF', gold: '#D4AF37', danger: '#FF3B30' };

const state = { from: THEMES.ink, to: THEMES.ink, t: 1, dur: 3 };
const cur = {};                       // k -> [r,g,b] 连续插值
let sig = '';                         // 量化签名
let dirty = false;                    // 跨步 → sprite 需重建
const hooks = [];
export function onThemeChanged(fn) { hooks.push(fn); }

function computeCur() {
  for (const k of KEYS) {
    const a = state.from.rgb[k], b = state.to.rgb[k];
    cur[k] = [a[0] + (b[0] - a[0]) * state.t, a[1] + (b[1] - a[1]) * state.t, a[2] + (b[2] - a[2]) * state.t];
  }
}
function quantSig() {
  return KEYS.map(k => cur[k].map(v => Math.round(v / 12)).join(',')).join('|');
}
function syncStrings() {
  for (const k of KEYS) {
    const c = cur[k].map(v => Math.round(v));
    PAL[k] = `rgb(${c[0]},${c[1]},${c[2]})`;
  }
}
function settle(to) {
  state.from = to; state.to = to; state.t = 1;
  computeCur(); syncStrings();
  PAL.key = to.key; PAL.name = to.name;
  sig = quantSig(); dirty = true;
}

// 每帧调用：推进插值；返回本帧是否跨过量化步（需重建 sprite）
export function updatePalette(dt) {
  if (state.t >= 1) return false;
  state.t = Math.min(1, state.t + dt / state.dur);
  computeCur();
  const s = quantSig();
  if (s !== sig) { sig = s; dirty = true; }
  syncStrings();
  return dirty;
}
export function consumeSpriteRebuild() {
  const d = dirty; dirty = false;
  return d;
}

// 切主题：instant=true 直接落定（测试/开局），否则 3s 过渡
export function setTheme(key, instant = false) {
  const to = THEMES[key] || THEMES.ink;
  if (instant) {
    settle(to);
    hooks.forEach(f => f());
  } else {
    // 从当前混色出发过渡（中断上一次过渡也不跳变）
    computeCur();
    state.from = { rgb: { bg: cur.bg.slice(), line: cur.line.slice(), gold: cur.gold.slice(), danger: cur.danger.slice() } };
    state.to = to; state.t = 0;
    PAL.key = to.key; PAL.name = to.name;
  }
}

settle(THEMES.ink);
