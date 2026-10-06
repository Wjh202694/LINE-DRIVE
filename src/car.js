// car.js — 主车状态机（车道吸附变道 / 街机速度模型 / 氮气 / 弯道漂移）
import { CFG, LANE_C, clamp } from './config.js';

export function createPlayer() {
  return {
    lane: 1, x: 0, speed: CFG.maxSpeed * 0.5,
    nitro: 1, nitroOn: false,
    invuln: 0, tilt: 0, drift: 0,
    crashed: false, blinkT: 0,
  };
}

// input: { up, down, nitro, laneL, laneR, holdDir }（laneL/laneR 为边沿触发；holdDir: -1/0/+1 按住的方向键）
// steer: { active, dir, rate, apex } 转向区状态（§10.4）；laneX: 当前路段车道中心（车道数随路段变化 §5）
// freeEdge: 沙漠路段自由路肩——最外车道继续按住同方向键可驶入沙地（§5 出界减速）
export function updatePlayer(p, input, dt, curveAhead, steer, laneX, freeEdge) {
  const speedPct = p.speed / CFG.maxSpeed;

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

  // —— 横向：转向区 = 持续位移模式；常态 = 车道吸附 ——
  if (steer && steer.active) {
    if (input.holdDir === steer.dir) {
      p.x += steer.dir * steer.rate * dt;       // 按住：向弯内匀速位移
      const apex = steer.apex || 4.65;          // 弯心线（路缘 - 余量），不可越过
      p.x = clamp(p.x, -apex, apex);
    } else {
      p.x -= steer.dir * CFG.steerDrift * dt;   // 松手/按反：离心外漂（~1.6s 到护栏）
    }
    p.tilt += (steer.dir * 0.05 - p.tilt) * Math.min(1, dt * 8);  // 车身微倾（参考视频：转弯时车身平稳）
  } else {
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
  p.drift *= Math.exp(-dt / 0.6);
  p.drift = clamp(p.drift, -1.15, 1.15);

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
