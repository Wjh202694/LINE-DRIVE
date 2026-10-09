// audio.js — M5 WebAudio 合成（§3.3/§5 音效清单：引擎、变道、撞毁、连击、拾取）
// 所有效果在用户首次点击后才解锁（浏览器自动播放策略）

let actx = null, masterGain = null, muted = false;
let engineOsc = null, engineOsc2 = null, engineGain = null, engineTarget = 0;
let lastBeat = 0;

function ensure() {
  if (actx) return actx;
  // 注意：无音频设备/无用户手势的环境下 new AudioContext() 可能抛错——必须防御，
  // 否则顶层 initAudio() 会中断 main.js 模块执行（曾导致整页不启动）
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { actx = null; return null; }
  try {
    masterGain = actx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(actx.destination);

    // 引擎嗡鸣（两个失谐振荡器合成"粗柴油味"）
    engineOsc = actx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
    engineOsc2 = actx.createOscillator(); engineOsc2.type = 'triangle'; engineOsc2.frequency.value = 92;
    const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600;
    engineGain = actx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(filt); engineOsc2.connect(filt); filt.connect(engineGain); engineGain.connect(masterGain);
    engineOsc.start(); engineOsc2.start();     // 振荡器必须 start 才会发声
  } catch (e) {
    console.error('[audio] init failed:', e);
    actx = null;
  }
  return actx;
}

function blip(freq, dur, type = 'sine', gain = 0.3) {
  if (!actx || muted || !masterGain) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = actx.createGain(); g.gain.value = 0; o.connect(g); g.connect(masterGain);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}

function filterSweep(f1, f2, dur, gain = 0.4) {
  if (!actx || muted || !masterGain) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sawtooth';
  const g = actx.createGain(); g.gain.value = 0;
  const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = f1;
  o.connect(filt); filt.connect(g); g.connect(masterGain);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  filt.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.6);
  o.start(t); o.stop(t + dur + 0.05);
}

export function initAudio() { ensure(); }
// 每次用户手势都尝试解锁（幂等；某些浏览器首次 resume 需要多个手势或不同手势类型；iOS 还有 'interrupted' 态）
export function resumeAudio() {
  ensure();
  if (actx && actx.state !== 'running') { try { actx.resume(); } catch { /* 忽略 */ } }
}
// 诊断（调试/自检用）
export function audioDiag() {
  return { state: actx ? actx.state : 'none', muted, master: masterGain ? masterGain.gain.value : null,
           engine: engineGain ? engineGain.gain.value : null };
}

// v2（用户反馈）：持续嗡鸣静默——引擎声只跟随"加速度"反馈：
//   加速中 → 引擎"增大声"（增益 ∝ 加速度，音调上抬）；减速中 → "减小声"（音调下压）；匀速 → 静默
export function setEngineState(speed, nitro, accel = 0) {
  if (!actx) return;
  const a = Math.abs(accel);
  const speeding = a > 0.8;                        // 死区：微小速度波动不发声
  // 基频随车速（提供速度感），加速 +18Hz 提亮 / 减速 -14Hz 压暗
  const base1 = 58 + (Math.min(speed, 80) / 80) * 70;
  const base2 = 90 + (Math.min(speed, 80) / 80) * 78;
  const f1 = base1 + (speeding ? (accel > 0 ? 18 : -14) : 0) + (nitro ? 26 : 0);
  const f2 = base2 + (speeding ? (accel > 0 ? 24 : -18) : 0) + (nitro ? 40 : 0);
  const t = actx.currentTime;
  engineOsc.frequency.setTargetAtTime(f1, t, 0.12);
  engineOsc2.frequency.setTargetAtTime(f2, t, 0.12);
  // 增益：匀速 = 0（静默）；加速/减速按强度映射（上限 0.26）
  const target = speeding ? Math.min(0.26, a * 0.022) : 0;
  engineGain.gain.setTargetAtTime(target, t, speeding ? 0.10 : 0.30);   // 起音快、收音缓
}
export function killEngine() { if (engineGain && actx) engineGain.gain.setTargetAtTime(0, actx.currentTime, 0.1); }

export function sfxOvertake(combo = 0) {
  // §3.3 连击升调：do 上行
  if (!actx) return;
  const t = actx.currentTime;
  const base = 440 * Math.pow(1.06, Math.min(combo, 12));
  for (let i = 0; i < 3; i++) {
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = base * (1 + i * 0.18);
    const g = actx.createGain(); g.gain.value = 0; o.connect(g); g.connect(masterGain);
    g.gain.setValueAtTime(0, t + i * 0.04);
    g.gain.linearRampToValueAtTime(0.18, t + i * 0.04 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.18);
    o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.2);
  }
}

export function sfxScrape() {                       // 剐蹭/减速：低频短促
  blip(180, 0.18, 'square', 0.18);
  blip(140, 0.22, 'sine', 0.12);
}
export function sfxHit() {                          // 撞毁：低频嗡 + 玻璃
  filterSweep(800, 60, 0.6, 0.45);
  for (let i = 0; i < 6; i++) blip(800 + i * 120, 0.08, 'square', 0.1);
}
export function sfxCoin() {                         // 金币：do 上行
  blip(880, 0.08, 'sine', 0.22);
  blip(1320, 0.08, 'sine', 0.15);
}
export function sfxBoost() {                        // 加速带：do 上行
  blip(440, 0.10, 'sawtooth', 0.18);
  blip(660, 0.10, 'sawtooth', 0.18);
  blip(880, 0.14, 'sawtooth', 0.18);
}
export function sfxLane() {                         // 变道 whoosh：短滤波扫描
  filterSweep(1200, 300, 0.18, 0.12);
}
export function sfxTurnFail() {                     // 转向失败下行
  blip(220, 0.3, 'square', 0.25);
  blip(165, 0.3, 'square', 0.2);
  blip(110, 0.5, 'square', 0.15);
}
export function sfxMenu() {                        // 菜单切换
  blip(660, 0.05, 'sine', 0.12);
}
export function sfxStart() {                        // 起跑：发动机 rpm 上行
  blip(220, 0.08, 'sawtooth', 0.2);
  setTimeout(() => blip(330, 0.10, 'sawtooth', 0.2), 80);
  setTimeout(() => blip(440, 0.12, 'sawtooth', 0.2), 160);
}

export function toggleMute() {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.55;
  return muted;
}
