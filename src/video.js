// video.js — 开场视频（§6A.5：10s 线稿视频 → 淡出标题页）
// 会话内只播一次（sessionStorage 标记）；点击/按键可跳过；播完自动淡出 0.5s
import introUrl from './assets/video/intro.mp4';

const FADE = 0.5;
let el = null, active = false, fading = false, fadeT = 0;

export function introActive() { return active; }

export function startIntro(onDone) {
  try {
    if (sessionStorage.getItem('linedrive.introSeen')) { onDone && onDone(); return; }
    sessionStorage.setItem('linedrive.introSeen', '1');
  } catch { /* 隐私模式：每次都播 */ }
  el = document.createElement('video');
  el.src = introUrl;
  el.muted = true;
  el.playsInline = true;
  el.playsinline = true;       // iOS 老内核用小写属性
  el.autoplay = true;
  el.preload = 'auto';
  el.disablePictureInPicture = true;
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:20;background:#000;opacity:0;transition:none;pointer-events:auto;';
  document.body.appendChild(el);

  // 等首帧解码完再淡入，避免出现"黑→闪一下→画面"的撕裂
  const onCanPlay = () => {
    if (!el || !active) return;
    el.play().catch(() => finish(onDone));   // 自动播放被策略拒绝 → 直接跳过
  };
  el.addEventListener('canplay', onCanPlay, { once: true });
  el.addEventListener('ended', () => { fading = true; fadeT = FADE; }, { once: true });
  el.onerror = () => { finish(onDone); };
  // 兜底：3s 内还没 canplay（极少见，比如卡死），强制尝试播放
  setTimeout(() => { if (el && active && el.paused) onCanPlay(); }, 3000);

  const skip = () => { if (active && !fading) { fading = true; fadeT = FADE; } };
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);
  active = true;
}

// 主循环每帧调用：处理淡出与移除
export function updateIntro(dt, onDone) {
  if (!active || !el) return;
  if (fading) {
    fadeT -= dt;
    el.style.opacity = String(Math.max(0, fadeT / FADE));
    if (fadeT <= 0) finish(onDone);
    return;
  }
  // 淡入（canplay 后 0.3s），避免视频首帧出现时的黑屏闪烁
  if (!el.paused && el.style.opacity !== '1') {
    const cur = parseFloat(el.style.opacity || '0');
    el.style.opacity = String(Math.min(1, cur + dt / 0.3));
  }
}

function finish(onDone) {
  if (!active) return;
  active = false;
  if (el) { try { el.pause(); } catch { /* 忽略 */ } el.remove(); el = null; }
  onDone && onDone();
}
