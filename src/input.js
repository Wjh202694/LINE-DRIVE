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
      case 'KeyF': actions.push('toggleFps'); break;
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
    const now = performance.now();
    if (now - lastTapT < 300) actions.push('nitroBurst');   // 双击氮气
    lastTapT = now;
    holdTimer = setTimeout(() => { input.up = true; }, 180); // 长按加速
    // 按住左右半屏 = 按住方向（转向区 §10.4 移动端）
    if (t.clientX < innerWidth / 2) { input.left = true; input.right = false; }
    else { input.right = true; input.left = false; }
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
    touchId = null; clearTimeout(holdTimer); input.up = false;
    input.left = false; input.right = false;
    const dt = performance.now() - touchT0;
    if (!swiped && dt < 180) {
      const w = window.innerWidth;
      if (touchX0 < w * 0.33) actions.push('laneL');
      else if (touchX0 > w * 0.67) actions.push('laneR');
      else actions.push('start');
    }
  };
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });
}
