// car.js — 主车状态机（车道吸附变道 / 街机速度模型 / 氮气 / 弯道漂移）
import { CFG, clamp } from './config.js';

export function createPlayer() {
  return {
    lane: 1, x: 0, speed: CFG.maxSpeed * 0.5,
    nitro: 1, nitroOn: false,
    invuln: 0, tilt: 0, drift: 0,
    crashed: false, blinkT: 0,
    absorbed: false, absorbedT: 0,         // v4.10：split 收心后切到新主线（brDir=0），新主线开始淡入
    turnProg: 0, turnZoneTotal: 100,       // v4.11 转向完成条（按住时按路程/总长逐渐填充；出弯 <75% 失败）
    inTurn: false, lastTurnDir: undefined,
  };
}

// input: { up, down, nitro, laneL, laneR, holdDir }（laneL/laneR 为边沿触发）
// laneX: 当前路径中心（主线车道中心或匝道中心线，含坡道/岔路）
// freeEdge: 沙漠路段自由路肩——最外车道继续按住同方向键可驶入沙地（§5 出界减速）
export function updatePlayer(p, input, dt, curveAhead, laneX, freeEdge) {
  const speedPct = p.speed / CFG.maxSpeed;

  // —— §10.4 强制转向区行为 ——
  // turn.dir = ±1 意味着这是弯曲段（匝道弯曲 / S 弯），须按住方向；grace 期内不计外漂。
  // 此外 main.js 还会对"直行过岔路"额外判按 ←/→，这里只负责 turn 状态下的横向反馈。
  if (p.turn && p.turn.dir) {
    p.turnT = (p.turnT || 0) + dt;
    if (input.holdDir === p.turn.dir) {
      p.drift *= Math.exp(-dt / 0.12);                  // 按住：贴线
    } else if (!p.turn.grace && p.turnT > CFG.steerGrace) {
      const rate = CFG.steerDrift * (input.holdDir === -p.turn.dir ? 1.8 : 1);
      p.drift += -p.turn.dir * rate * dt;
    }
  } else {
    p.turnT = 0;
  }

  // —— 速度模型：油门 / 刹车 / 滑行 ——
  const max = p.nitroOn ? CFG.nitroSpeed : CFG.maxSpeed;
  let a;
  if (input.up) {
    const taper = 1 - 0.55 * speedPct * speedPct;   // 高速阻力，保住 0-100 3.5s
    a = CFG.accel * (p.nitroOn ? 1.8 : 1) * taper;
  } else if (input.down) {
    a = -CFG.accel * CFG.brakeMul;
  } else {
    a = -CFG.coastDecel;
  }
  p.speed = clamp(p.speed + a * dt, 0, max);
  if (p.speed > max) p.speed += (max - p.speed) * Math.min(1, dt * 2); // 氮气结束自然回落

  // —— 横向：车道吸附 + 自由路肩（沙漠）——
  {
    if (input.laneL && p.lane > 0) p.lane--;
    if (input.laneR && p.lane < (p.laneMax || 3) - 1) p.lane++;
    // 自由路肩（沙漠）：已到最外车道且继续按住同方向 → 驶出路面
    p.edge = p.edge || 0;
    const atEdgeR = freeEdge && p.lane === (p.laneMax || 3) - 1 && input.holdDir === 1;
    const atEdgeL = freeEdge && p.lane === 0 && input.holdDir === -1;
    if (atEdgeR) p.edge = Math.min(2.6, p.edge + 3.2 * dt);
    else if (atEdgeL) p.edge = Math.max(-2.6, p.edge - 3.2 * dt);
    else p.edge *= Math.exp(-dt / 0.7);       // 松手缓慢回路面
    const targetX = (laneX || 0) + p.drift + p.edge;
    const prevX = p.x;
    p.x += (targetX - p.x) * (1 - Math.exp(-dt / (CFG.laneShift / 3)));
    const latV = (p.x - prevX) / Math.max(dt, 1e-4);
    p.tilt += (clamp(latV * 0.028, -0.13, 0.13) - p.tilt) * Math.min(1, dt * 10);
    // 常态弯道离心漂移（调试/过弯）
    p.drift -= curveAhead * speedPct * CFG.centrifugal * dt * 60 * 0.1;
  }
  // 常态外演回中；强制转向区未按住时不衰减（让外漂持续积累直到撞栏）
  if (!(p.turn && p.turn.dir && input.holdDir !== p.turn.dir)) p.drift *= Math.exp(-dt / 0.6);
  // 强制转向区内放宽钳制：外漂必须能冲出护栏距离（2.3m+），否则撞栏判定永不触发
  p.drift = clamp(p.drift, p.turn ? -8 : -1.15, p.turn ? 8 : 1.15);

  // —— 氮气计量 ——
  if (p.nitroOn) {
    p.nitro -= CFG.nitroDrain * dt;
    if (p.nitro <= 0) { p.nitro = 0; p.nitroOn = false; }
  } else {
    p.nitro = Math.min(1, p.nitro + CFG.nitroRegen * dt);
  }

  // —— 无敌帧闪烁 ——
  p.invuln = Math.max(0, p.invuln - dt);
  p.blinkT += dt;
}
