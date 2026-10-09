// config.js — 全局常量与手感参数（集中一处，便于 M1 调校）

export const CFG = {
  // —— 相机（§4.3A 的 M1 子集：xOffset 滞后 + fov 通道）——
  fovBase: 62,            // 水平视场角
  fovNitro: 68,           // 氮气时拉宽
  fovTau: 0.4,            // fov 平滑时间常数
  camHeight: 2.2,         // 相机离地高度 m（车更大更贴地，参考转弯视频构图）
  horizon: 0.40,          // 地平线在屏幕高度的比例（俯仰的 M1 近似）
  playerZ: 6.5,           // 主车碰撞平面位于相机前方 m
  camLagTau: 0.2,         // 相机横向滞后（拖拽感，§4.3A xOffset 通道）

  // —— 道路 ——
  segLen: 5,              // 段长 m
  segCount: 2600,         // 段数（循环跑道 13km，容下 11 类段落）
  lanes: 3,
  laneWidth: 3.7,
  shoulder: 0.8,          // 路肩宽 m
  drawDist: 300,          // 每帧绘制段数（§4.3 ≤300）
  railOff: 0.45, railH: 0.75,   // 护栏：离路缘偏移 / 栏顶高
  lampEvery: 8,           // 每 8 段（40m）双侧成排路灯（参考转弯视频）
  postEvery: 4,           // 护栏柱间隔（20m）

  // —— 线宽三档与大气透视（§3.2，1080p 基准按屏高缩放）——
  lwNear: 2.5, lwFar: 1.0,
  fogNear: 1.0, fogFar: 0.35,

  // —— 主车（§2.4 街机手感）——
  carW: 1.9, carL: 4.2, carH: 1.34,
  maxSpeed: 220 / 3.6,          // 61.1 m/s
  nitroSpeed: 252 / 3.6,
  accel: (100 / 3.6) / 3.5,     // 0-100km/h 3.5s
  brakeMul: 1.6,                // 刹车 = 加速 ×1.6
  coastDecel: 2.4,              // 松油门滑行减速
  laneShift: 0.16,              // 变道插值 160ms（§8）
  nitroDrain: 0.30, nitroRegen: 0.06, nitroOvertake: 0.18,
  centrifugal: 4.0,             // 弯道离心漂移系数（配合 steerCurve=0.011 量级）

  // —— 车流 ——
  trafficBase: 8, trafficMax: 12, teachDensity: 4,

  // —— 碰撞与撞击计数（§10.3：取消相对速度秒杀，第 4 次撞击才撞毁）——
  maxImpacts: 3,          // 容忍 3 次重创，第 4 次撞毁
  graceDist: 500,         // 前 500m 教学保护：撞击只按剐蹭处理
  scrapeSlow: 0.85,       // 剐蹭速度保留
  hitFloor: 0.30,         // 重创后速度下限比例
  hitInvuln: 2.0,         // 重创无敌 s
  crashAnim: 1.5,         // 撞毁演出时长 s（完整版 2.8s 属 M4）

  // —— 转向系统（§10.4 + 2026-10-07 修订：固定双分支岔路 + 按住转向）——
  curveGapMin: 400, curveGapMax: 900,   // 弯段间隔 m（岔路是核心选择玩法，保持存在感）
  firstCurveZ: 800,       // 首个弯道位置 m（教学直道后尽快接触选择玩法）
  waitZoneLen: 200,       // 待转区 m（无障碍车，车道选向）
  rampSegs: 32,           // 匝道分流段数（160m，弯离主线；短促=大离开角）
  mergeSegs: 48,          // 匝道汇入段数（240m，缓回主线，逐渐对齐）
  rampHalf: 2.65,         // 匝道半宽（单车道 3.7m + 路肩 0.8m）
  forkDiv: 30,            // 匝道峰值横向偏移增量 m（v4.6：7.5→30，真正的大弯视觉）
  // —— 分岔·新主干道（v4.9）：单车道匝道扩展为 3 车道新主干道 ——
  splitDiv: 20,           // 分岔匝道峰值偏移（比汇入型近——要收心回中心）
  splitHoldN: 30,         // 分岔平直段数（150m，无按键自由行驶）
  splitRetN: 56,          // 分岔收心+扩展段数（280m，off→0 且 half→6.35）
  steerCurve: 0.011,      // S 弯峰值曲率（每段朝向增量；缓弧 ~23°）
  steerDisp: 1.4,         // 转向区横向位移 m（保留参数）
  steerGrace: 0.35,       // 进入强制转向区后允许的反应宽限 s
  steerDrift: 3.5,        // 松手/按反时的向外漂移速度 m/s（~1.4s 撞栏）
  curveGain: 1.6,         // 转向区视角偏航增益
  barrierX: 5.35,         // 撞栏边界（保留参数）

  // —— 金币线 / 加速带（§2.2/§2.3）——
  coinScore: 20,          // 金币 +20/枚
  boostKick: 6.0,         // 加速带瞬时速度增量 m/s
  boostNitro: 0.15,       // 加速带氮气回充

  // —— 跨海大桥（§5#7）——
  bridgeWind: 0.5,        // 桥面侧风横向加速度 m/s²（满速时）

  // —— 主题流转（§3.2A，M2）——
  themeFirst: 60,         // 开局墨夜，首次切换 s
  themeGapMin: 45, themeGapMax: 75,
  themeDur: 3,            // 主题过渡时长 s
};

export const ROAD_HALF = (CFG.lanes * CFG.laneWidth) / 2 + CFG.shoulder; // 6.35m
export const LANE_C = (i) => (i - (CFG.lanes - 1) / 2) * CFG.laneWidth;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
