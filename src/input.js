// input.js — 键盘 + 触屏（桌面：←→↑↓+空格；移动：左右半屏滑动转向、长按加速、双击氮气）
export const input = { up: false, down: false, nitro: false, left: false, right: false };
export const actions = [];            // 边沿事件队列：'start' 'pause' 'laneL' 'laneR' 'nitroBurst' 'title' 'toggleFps' 'curveMode'
export function consumeActions() { return actions.splice(0); }

let touchId = null, touchX0 = 0, touchT0 = 0, swiped = false, lastTapT = 0, holdTimer = null;

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': input.left = true; actions.push('laneL'); break;
      case 'ArrowRight': case 'KeyD': input.right = true; actions.push('laneR'); break;
      case 'ArrowUp': case 'KeyW': input.up = true; break;
      case 'ArrowDown': case 'KeyS': input.down = true; break;
      case 'Space':
        input.nitro = true;
        actions.push('start');   // 状态机在 title/crashed 才消费
        break;
      case 'KeyP': actions.push('pause'); break;
      case 'Escape': actions.push('title'); break;
      case 'KeyM': actions.push('map'); break;
      case 'KeyG': actions.push('gallery'); break;
      case 'KeyF': actions.push('toggleFps'); break;
      case 'KeyN': actions.push('mute'); break;
      case 'KeyC': actions.push('curveMode'); break;
      case 'Enter': actions.push('start'); break;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.down = false;
    if (e.code === 'Space') input.nitro = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  });

  // —— 触屏 ——
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier; touchX0 = t.clientX; touchT0 = performance.now(); swiped = false;
    const W2 = innerWidth, H2 = innerHeight;
    // 顶部 1/6 单击 = 暂停
    if (t.clientY < H2 / 6) { actions.push('pause'); lastTapT = performance.now(); return; }
    // 右下 1/4 = 暂停按钮区域（防误触，）
    if (t.clientX > W2 * 0.82 && t.clientY > H2 * 0.65) { actions.push('pause'); return; }
    // 双击 = 氮气
    const now = performance.now();
    if (now - lastTapT < 300) actions.push('nitroBurst');
    lastTapT = now;
    // 上半屏 = 加速；下半屏 = 刹车（不分左右）
    if (t.clientY < H2 / 2) { input.up = true; input.down = false; }
    else { input.down = true; input.up = false; }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchId === null || swiped) return;
    const t = [...e.changedTouches].find(t => t.identifier === touchId);
    if (!t) return;
    const dx = t.clientX - touchX0;
    if (dx > 26) { actions.push('laneR'); swiped = true; }
    else if (dx < -26) { actions.push('laneL'); swiped = true; }
    if (!swiped) {
      if (t.clientX < innerWidth / 2) { input.left = true; input.right = false; }
      else { input.right = true; input.left = false; }
    }
  }, { passive: false });

  const end = (e) => {
    e.preventDefault();
    if (![...e.changedTouches].some(t => t.identifier === touchId)) return;
    touchId = null; input.up = false; input.down = false; input.left = false; input.right = false;
    const dt = performance.now() - touchT0;
    const w = window.innerWidth;
    if (!swiped && dt < 180) {
      if (touchX0 < w * 0.33) actions.push('laneL');
      else if (touchX0 > w * 0.67) actions.push('laneR');
      // 中间单击 = 暂停（避免误触，按钮区单击已用）
    }
  };
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });
  // 双指 tap = 暂停
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { e.preventDefault(); actions.push('pause'); }
  }, { passive: false });
}
