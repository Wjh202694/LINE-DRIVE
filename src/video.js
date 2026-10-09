// video.js — 开场视频（§6A.5：10s 线稿视频 → 淡出标题页）
// 会话内只播一次（sessionStorage 标记）；点击/按键可跳过；播完自动淡出 0.5s
import introUrl from './assets/video/intro.mp4';

let el = null, active = false, fadeT = 0, fading = false, ready = false;

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
  el.autoplay = true;
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:20;background:#000;opacity:1;transition:none;pointer-events:auto;';
  document.body.appendChild(el);
  active = true;
  ready = true;
  el.play().catch(() => { finish(onDone); });          // 自动播放被策略拒绝 → 直接跳过
  el.onended = () => { fading = true; fadeT = 0.5; };
  el.onerror = () => { finish(onDone); };
  const skip = () => { if (active && !fading) { fading = true; fadeT = 0.5; } };
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);
  active = true;
}
// 主循环每帧调用：处理淡出与移除
export function updateIntro(dt, onDone) {
  if (!active || !el) return;
  if (fading) {
    fadeT -= dt;
    el.style.opacity = String(Math.max(0, fadeT / 0.5));
    if (fadeT <= 0) finish(onDone);
  }
}
function finish(onDone) {
  if (!active) return;
  active = false;
  if (el) { try { el.pause(); } catch { /* 忽略 */ } el.remove(); el = null; }
  onDone && onDone();
}
