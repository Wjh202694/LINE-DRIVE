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
  segCount: 1400,         // 段数（循环跑道 7km）
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
  centrifugal: 0.045,           // 弯道离心漂移系数（M1 弯道调试用）

  // —— 车流 ——
  trafficBase: 8, trafficMax: 12, teachDensity: 4,

  // —— 碰撞与撞击计数（§10.3：取消相对速度秒杀，第 4 次撞击才撞毁）——
  maxImpacts: 3,          // 容忍 3 次重创，第 4 次撞毁
  graceDist: 500,         // 前 500m 教学保护：撞击只按剐蹭处理
  scrapeSlow: 0.85,       // 剐蹭速度保留
  hitFloor: 0.30,         // 重创后速度下限比例
  hitInvuln: 2.0,         // 重创无敌 s
  crashAnim: 1.5,         // 撞毁演出时长 s（完整版 2.8s 属 M4）

  // —— 转向系统（§10.4 + 2026-10-06 视频参考：舒缓大弧线、低频出现）——
  curveGapMin: 2600, curveGapMax: 4200, // 弯段间隔 m（低频；首弯 1500m）
  firstCurveZ: 1500,      // 首个弯道位置 m
  waitZoneLen: 200,       // 待转区 m（无障碍车）
  steerZoneLen: 300,      // 转向区 m（长弧线）
  steerCurve: 1.0,        // 转向区峰值曲率（缓）
  steerRamp: 12,          // 曲率 ease-in-out 渐入渐出段数（消除折角）
  steerDisp: 1.4,         // 转向区横向位移 m（车身基本居中，参考视频）
  steerGrace: 0.35,       // 进入转向区后允许的反应宽限 s
  steerDrift: 3.5,        // 松手/按反时的离心外漂速度 m/s（~1.6s 撞栏）
  curveGain: 1.6,         // 转向区视角偏航增益
  barrierX: 5.35,         // 撞栏边界（车身中心，路缘 6.35 - 半车宽）

  // —— 主题流转（§3.2A，M2）——
  themeFirst: 60,         // 开局墨夜，首次切换 s
  themeGapMin: 45, themeGapMax: 75,
  themeDur: 3,            // 主题过渡时长 s
};

export const ROAD_HALF = (CFG.lanes * CFG.laneWidth) / 2 + CFG.shoulder; // 6.35m
export const LANE_C = (i) => (i - (CFG.lanes - 1) / 2) * CFG.laneWidth;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
