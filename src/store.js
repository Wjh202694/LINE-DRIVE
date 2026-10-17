// store.js — 成绩持久化（最高分 / 最远里程 / 局数），隐私模式下静默降级为内存值
// 从 main.js 抽出：撞毁流程（systems/crash.js）要写盘，游戏对象初始化也要读盘，
// 两边共用同一个访问器，避免各自 try/catch localStorage。
const store = (() => {
  try { const t = '__ldtest'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; }
  catch { return null; }
})();

export const LS = {
  get best() { return store ? +store.getItem('linedrive.best') || 0 : 0; },
  set best(v) { if (store) store.setItem('linedrive.best', v); },
  get bestKm() { return store ? +store.getItem('linedrive.bestKm') || 0 : 0; },
  set bestKm(v) { if (store) store.setItem('linedrive.bestKm', v); },
  get runs() { return store ? +store.getItem('linedrive.runs') || 0 : 0; },
  set runs(v) { if (store) store.setItem('linedrive.runs', v); },
};
