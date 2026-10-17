// speed.js — 速度与外力系统：所有「当前车速上限」和「环境横向扰动」的来源集中一处
// 从 main.js 抽出（v5.7 模块化）。分散在主循环里时，每加一条路段特性就要往 tickOnce 里插一段，
// 半年后没人说得清「这帧到底被谁限速了」。
//   · 沙漠公路出界 → 35% 极速
//   · 环岛 §4.1 内圈慢外圈快 → 内圈 100 / 外圈 150 km/h（逼近 + 硬钳，见下）
//   · 环岛 §4.2 让行 → 同车道前方有环岛车时收油到前车速度
//   · 跨海大桥侧风 → 横向漂移扰动
import { CFG } from '../config.js';
import { getTrack } from '../road.js';

// —— 环境横向扰动（不涉及速度上限，单独一个出口）——
export function applyEnvironment(game, dt, ri) {
  if (ri.type === 'bridge') {
    // 桥面侧风：振幅随车速线性增长（§5#7）
    game.player.drift += Math.sin(game.time * 0.6 + 2) * CFG.bridgeWind * dt * (game.player.speed / CFG.maxSpeed);
  }
}

// —— 限速通道 ——
// 逼近 + 硬钳：只做指数逼近的话稳态会停在限速以下好几码（油门一直在顶），
// HUD 上写着「限速 150」而表针只到 144，玩家会以为读数坏了。
// cap 必须有限：上限一旦算成 NaN，「只收油不加油」的钳速会变成 p.speed += NaN，
// 整局车速与里程一起变成 NaN，画面直接黑屏（v5.7 实测：让行上限取错字段就复现）。
function capSpeed(p, cap, dt, rate) {
  if (!isFinite(cap)) return;
  if (p.speed <= cap) return;
  p.speed += (cap - p.speed) * Math.min(1, dt * rate);
  if (p.speed > cap) p.speed = cap;
}

export function applySpeedLimits(game, dt, ri, pz) {
  const p = game.player;
  const track = getTrack();

  // 沙漠公路出界减速
  if (ri.type === 'desert' && Math.abs(p.x) > ri.half - 0.55) {
    p.speed = Math.min(p.speed, CFG.maxSpeed * 0.35);
  }

  // v5 环岛 §4.1 内圈慢外圈快：绕岛段是双车道，靠中央岛那侧（内圈）限 100，外侧限 150。
  // 外圈不减速 → 抢时间；内圈过弯半径小更稳但慢。这是环岛路段唯一的核心取舍。
  game.ringLane = track.ringLaneAt(pz, p.brDir, p.x);
  if (game.ringLane) {
    capSpeed(p, game.ringLane === 'inner' ? CFG.ringInnerCap : CFG.ringOuterCap, dt, 6);
  }

  // v5.4 §4.2 让行：环道上同车道已有车 → 收油跟上去。
  // 判定覆盖整条环道匝道（含绕岛段）：让行在这里读起来就是「跟在环岛车后面进环岛」，
  // 而不是抽象的礼让——玩家要做的选择是「抢空车道」还是「跟着一辆走」。
  // 目标是**前车的速度**而不是一个固定低速：环岛的真实约束是车流而不是让行线，
  // 收油到 60 会把玩家钉在爬行速度上（实测整段绕岛都开不上去），读起来像路障而不是让行。
  // +slack：比前车快一点点，慢慢贴上去超掉它——让行才是「一段一段」的而不是永久跟车。
  game.ringYield = 0;
  if (game.jn && game.jn.j.ring && game.jn.phase === 'bend') {
    const lead = game.traffic.ringCarAhead(pz, p.brDir, p.lane);   // { c: 前车, d: 距离 }
    if (lead && lead.c) {
      game.ringYield = lead.d;
      // 本车道限速（还没进绕岛段就没有内/外圈之分，按主线限速）
      const laneCap = game.ringLane === 'inner' ? CFG.ringInnerCap
                    : game.ringLane === 'outer' ? CFG.ringOuterCap
                    : CFG.maxSpeed;
      capSpeed(p, Math.min(laneCap, lead.c.speed + CFG.ringYieldSlack), dt, 3);
    }
  }
}
