// sprites.js — 线稿 sprite 定义与预渲染
// 单位：米，y 向上，原点=车底中心。素材图仅作造型参考，全部程序化矢量重绘（§3.2 规则 1）。
// 例外（2026-10-06 用户指定）：主车直接采用参考视频抠出的线稿位图；房屋/仙人掌等
// 素材位图经 trimInk 自动裁墨迹边界，白线遮罩按主题 source-in 染色，保留四档 LOD。
import { PAL, onThemeChanged } from './palette.js';
import playerCarUrl from './assets/playerCar.png';
import house1Url from './assets/orig/house1.jpg';
import house2Url from './assets/orig/house2.jpg';
import house3Url from './assets/orig/house3.jpg';
import house4Url from './assets/orig/house4.jpg';
import cactusAUrl from './assets/orig/cactus_a.jpg';
import cactusBUrl from './assets/orig/cactus_b.jpg';

// —— 小工具 ——
// 倒角矩形（图纸感的"圆角"），顺时针闭合
function rr(x, y, w, h, c = 0.04) {
  c = Math.min(c, w / 2, h / 2);
  return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c],
          [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c], [x + c, y]];
}
// 圆（多边形近似）
function circle(cx, cy, r, n = 12) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return p;
}
// 椭圆（多边形近似，排气口等圆润件）
function ellipse(cx, cy, rx, ry, n = 16) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}
// 右半折线 → 左右对称整条
function mir(pts) {
  const o = pts.slice();
  for (let i = pts.length - 1; i >= 0; i--) o.push([-pts[i][0], pts[i][1]]);
  return o;
}
// 竖向细刻线一排（尾灯栅格 / 百叶等）
function ticks(x1, x2, step, y1, y2) {
  const a = [];
  for (let x = x1; x <= x2 + 1e-6; x += step) a.push([[x, y1], [x, y2]]);
  return a;
}

// —— 主车后视图（对照 four_view_supercar 左下：低趴宽体、鸭尾翼、内嵌贯穿尾灯、
//     大后窗圆角 + 外角大双圈排气 + 中央双列扩散器鳍）——
const PLAYER = {
  w: 1.94, h: 1.22, lw: 0.020,
  lines: [
    // 轮胎（略内收，车身覆盖上沿）
    { pts: mir(rr(-0.90, 0, 0.20, 0.34, 0.05)) },
    // 车身轮廓（右半：保险杠→宽胯→肩→鸭尾→C柱→车顶；宽座舱厚C柱）
    { pts: mir([[0.62, 0.10], [0.86, 0.14], [0.965, 0.36], [0.93, 0.58], [0.855, 0.665],
                [0.80, 0.685], [0.825, 0.725], [0.76, 0.74], [0.58, 0.76],
                [0.52, 0.78], [0.49, 0.94], [0.45, 1.07], [0.40, 1.135], [0, 1.15]]) },
    { pts: [[-0.62, 0.10], [0.62, 0.10]] },                    // 保险杠底缘
    // 鸭尾上沿亮线
    { pts: [[-0.80, 0.73], [0.80, 0.73]], lw: 0.014 },
    // 大后窗（宽阔梯形）
    { pts: [[-0.50, 0.80], [0.50, 0.80], [0.38, 1.04], [-0.38, 1.04], [-0.50, 0.80]], lw: 0.014 },
    // 贯穿尾灯：醒目白条（双描边）+ 端部上挑
    { pts: rr(-0.73, 0.575, 1.46, 0.062, 0.028), lw: 0.026 },
    { pts: [[-0.64, 0.606], [0.64, 0.606]], lw: 0.010 },
    { pts: [[0.67, 0.575], [0.745, 0.645]], lw: 0.013 },
    { pts: [[-0.67, 0.575], [-0.745, 0.645]], lw: 0.013 },
    // 肩线（轮拱顶流向尾灯端部）
    { pts: mir([[0.90, 0.40], [0.79, 0.50], [0.68, 0.555]]), lw: 0.012 },
    // 牌照凹槽
    { pts: rr(-0.20, 0.40, 0.40, 0.13, 0.025), lw: 0.013 },
    // 扩散器（梯形）+ 中央双列鳍
    { pts: [[-0.52, 0.36], [0.52, 0.36], [0.40, 0.12], [-0.40, 0.12], [-0.52, 0.36]], lw: 0.014 },
    ...[-0.12, -0.045, 0.045, 0.12].map(x => ({ pts: [[x, 0.145], [x, 0.345]], lw: 0.012 })),
    // 双出大椭圆排气（外角，双圈）
    { pts: ellipse(0.70, 0.21, 0.105, 0.078), lw: 0.013 },
    { pts: ellipse(0.70, 0.21, 0.062, 0.042), lw: 0.009 },
    { pts: ellipse(-0.70, 0.21, 0.105, 0.078), lw: 0.013 },
    { pts: ellipse(-0.70, 0.21, 0.062, 0.042), lw: 0.009 },
  ],
};

// —— 障碍车 · 轿车后视（SUV 带车顶行李箱）——
const SEDAN = {
  w: 2.2, h: 1.9, lw: 0.020, cw: 1.84, halfL: 2.1,
  lines: [
    { pts: mir(rr(-0.92, 0, 0.20, 0.36, 0.05)) },
    { pts: mir([[0.62, 0.10], [0.87, 0.16], [0.90, 0.45], [0.885, 0.68], [0.845, 0.80],
                [0.62, 0.865], [0.50, 0.885], [0.46, 1.22], [0.36, 1.285], [0, 1.29]]) },
    { pts: [[-0.62, 0.10], [0.62, 0.10]] },
    { pts: [[-0.56, 1.00], [0.56, 1.00], [0.50, 1.245], [-0.50, 1.245], [-0.56, 1.00]], lw: 0.014 },
    { pts: rr(-0.85, 0.70, 1.70, 0.135, 0.03), lw: 0.014 },
    ...ticks(-0.76, 0.76, 0.095, 0.725, 0.81).map(pts => ({ pts, color: 'danger', lw: 0.010 })),
    { pts: [[-0.87, 0.44], [0.87, 0.44]], lw: 0.014 },
    { pts: [[-0.30, 0.32], [0.30, 0.32], [0.30, 0.40], [-0.30, 0.40], [-0.30, 0.32]], lw: 0.013 },
    { pts: [[-0.55, 1.315], [0.55, 1.315]], lw: 0.014 },
    { pts: rr(-0.64, 1.40, 1.28, 0.44, 0.10), lw: 0.016 },
    { pts: [[-0.60, 1.56], [0.60, 1.56]], lw: 0.011 },
    { pts: mir([[0.88, 1.02], [1.03, 1.06], [1.05, 1.17], [0.93, 1.17], [0.88, 1.10]]), lw: 0.013 },
    { pts: [[-0.20, 0.50], [0.20, 0.50], [0.20, 0.63], [-0.20, 0.63], [-0.20, 0.50]], lw: 0.013 },
  ],
};

// —— 障碍车 · 卡车后视（厢式货车）——
const TRUCK = {
  w: 2.45, h: 3.35, lw: 0.020, cw: 2.45, halfL: 4.4,
  lines: [
    { pts: rr(-1.16, 1.00, 2.32, 2.30, 0.07) },
    { pts: rr(-1.08, 1.07, 2.16, 2.16, 0.04), lw: 0.013 },
    { pts: [[0, 1.07], [0, 3.23]], lw: 0.014 },
    { pts: [[-0.30, 1.07], [-0.30, 3.23]], lw: 0.012 },
    { pts: [[0.30, 1.07], [0.30, 3.23]], lw: 0.012 },
    ...[1.30, 2.05, 2.80].flatMap(y => [
      { pts: rr(-0.335, y, 0.07, 0.09, 0.01), lw: 0.010 },
      { pts: rr(0.265, y, 0.07, 0.09, 0.01), lw: 0.010 },
    ]),
    ...ticks(-0.95, 0.83, 0.24, 3.10, 3.10).map(pts => ({ pts: [[pts[0][0], 3.10], [pts[0][0] + 0.13, 3.10]], lw: 0.012 })),
    { pts: [[-0.92, 0.64], [0.92, 0.64], [0.92, 1.00], [-0.92, 1.00], [-0.92, 0.64]], lw: 0.016 },
    { pts: rr(-1.05, 0.44, 2.10, 0.16, 0.03), lw: 0.016 },
    { pts: [[-1.02, 0.48], [-0.90, 0.48], [-0.90, 0.56], [-1.02, 0.56], [-1.02, 0.48]], color: 'danger', lw: 0.011 },
    { pts: [[0.90, 0.48], [1.02, 0.48], [1.02, 0.56], [0.90, 0.56], [0.90, 0.48]], color: 'danger', lw: 0.011 },
    { pts: [[-1.00, 0.02], [-0.72, 0.02], [-0.72, 0.42], [-1.00, 0.42], [-1.00, 0.02]], lw: 0.012 },
    { pts: [[0.72, 0.02], [1.00, 0.02], [1.00, 0.42], [0.72, 0.42], [0.72, 0.02]], lw: 0.012 },
    { pts: rr(-1.02, 0, 0.21, 0.56, 0.04) },
    { pts: rr(-0.77, 0, 0.21, 0.56, 0.04) },
    { pts: mir(rr(-1.02, 0, 0.21, 0.56, 0.04)) },
    { pts: mir(rr(-0.77, 0, 0.21, 0.56, 0.04)) },
    { pts: [[-0.24, 0.68], [0.24, 0.68], [0.24, 0.82], [-0.24, 0.82], [-0.24, 0.68]], lw: 0.013 },
  ],
};

// —— 障碍车 · 公交后视 ——
const BUS = {
  w: 2.45, h: 3.05, lw: 0.020, cw: 2.45, halfL: 5.0,
  lines: [
    { pts: rr(-1.20, 0.35, 2.40, 2.68, 0.16) },
    { pts: [[-1.12, 0.55], [1.12, 0.55]], lw: 0.013 },
    { pts: rr(-1.00, 1.80, 0.90, 0.75, 0.05), lw: 0.014 },
    { pts: rr(0.10, 1.80, 0.90, 0.75, 0.05), lw: 0.014 },
    ...[1.02, 1.075, 1.13].flatMap(x => [
      { pts: [[x, 0.75], [x, 2.60]], lw: 0.010 },
      { pts: [[-x, 0.75], [-x, 2.60]], lw: 0.010 },
    ]),
    { pts: rr(-1.05, 1.28, 2.10, 0.22, 0.03), lw: 0.014 },
    ...ticks(-0.95, 0.95, 0.10, 1.315, 1.465).map(pts => ({ pts, color: 'danger', lw: 0.010 })),
    { pts: [[-0.92, 0.62], [0.92, 0.62], [0.92, 1.16], [-0.92, 1.16], [-0.92, 0.62]], lw: 0.014 },
    { pts: [[-0.28, 0.70], [0.28, 0.70], [0.28, 0.88], [-0.28, 0.88], [-0.28, 0.70]], lw: 0.013 },
    { pts: rr(0.98, 0.58, 0.10, 0.07, 0.01), color: 'danger', lw: 0.011 },
    { pts: rr(-1.08, 0.58, 0.10, 0.07, 0.01), color: 'danger', lw: 0.011 },
    { pts: mir(rr(-1.02, 0, 0.30, 0.52, 0.06)) },
  ],
};

// —— 45° 左后视角变体（对照 extra_obstacle_*_persp45：可见车尾 + 左侧，车头没入远方）——
// ax = 锚点（车尾立面中心）在 def 盒内的世界 x。

// 轿车 45°：尾立面在左，侧身向右上收进；尾灯包角、后轮拱贴角是关键识别特征
const SEDAN_Q = {
  w: 2.95, h: 1.95, lw: 0.020, ax: -0.805,
  lines: [
    // 尾立面（窄， foreshortened）
    { pts: rr(-1.38, 0.06, 1.15, 1.46, 0.10) },
    { pts: [[-1.28, 0.98], [-0.34, 0.98], [-0.38, 1.38], [-1.24, 1.38], [-1.28, 0.98]], lw: 0.013 }, // 后窗梯形
    { pts: rr(-1.31, 0.74, 1.09, 0.11, 0.025), lw: 0.013 },   // 贯穿尾灯
    { pts: [[-1.22, 0.795], [-0.40, 0.795]], color: 'danger', lw: 0.011 },
    // 尾灯包角延伸到侧身（强识别特征）
    { pts: [[-0.23, 0.74], [0.10, 0.785]], color: 'danger', lw: 0.011 },
    { pts: [[-1.30, 0.40], [-0.29, 0.40]], lw: 0.012 },       // 保险杠缝线
    { pts: rr(-0.95, 0.48, 0.30, 0.13, 0.02), lw: 0.011 },    // 牌照
    // 侧身三线（顶盖弧/腰带/裙线，向前上方收进）
    { pts: [[-0.23, 1.52], [0.40, 1.585], [1.10, 1.615], [1.42, 1.615]] },   // 顶盖
    { pts: [[-0.23, 0.98], [1.42, 1.075]] },                  // 腰线
    { pts: [[-0.23, 0.08], [1.42, 0.175]] },                  // 裙线
    { pts: [[1.42, 0.175], [1.42, 1.615]], lw: 0.014 },       // 前端截断
    // 侧窗（浅带，圆角，B 柱分隔）
    { pts: [[-0.14, 1.10], [1.30, 1.185], [1.30, 1.44], [-0.14, 1.375], [-0.14, 1.10]], lw: 0.012 },
    { pts: [[0.52, 1.135], [0.52, 1.405]], lw: 0.011 },       // B 柱
    // 门缝 + 把手
    { pts: [[0.62, 0.20], [0.66, 1.06]], lw: 0.010 },
    { pts: [[0.72, 0.86], [0.88, 0.875]], lw: 0.010 },
    // 后轮拱（贴角）+ 轮胎
    { pts: rr(-0.82, 0, 0.36, 0.37, 0.06) },
    { pts: [[-0.90, 0.36], [-0.82, 0.55], [-0.64, 0.62], [-0.46, 0.55], [-0.38, 0.36]], lw: 0.012 },
    // 前轮拱 hint
    { pts: [[1.02, 0.30], [1.10, 0.47], [1.26, 0.52]], lw: 0.011 },
  ],
};

// 卡车 45°：尾立面在右，车厢向左上收进，驾驶室在最左远端
const TRUCK_Q = {
  w: 4.4, h: 3.4, lw: 0.020, ax: 0.825,
  lines: [
    // 厢体尾立面
    { pts: rr(0.20, 0.72, 1.25, 2.35, 0.06) },
    { pts: rr(0.28, 0.80, 1.09, 2.19, 0.04), lw: 0.013 },
    { pts: [[0.825, 0.80], [0.825, 2.99]], lw: 0.013 },
    { pts: [[0.51, 0.80], [0.51, 2.99]], lw: 0.011 },
    { pts: [[1.14, 0.80], [1.14, 2.99]], lw: 0.011 },
    ...[1.15, 1.95, 2.70].map(y => ({ pts: rr(0.475, y, 0.07, 0.09, 0.01), lw: 0.010 })),
    ...[1.15, 1.95, 2.70].map(y => ({ pts: rr(1.11, y, 0.07, 0.09, 0.01), lw: 0.010 })),
    // 底盘 + 保险杠
    { pts: [[0.30, 0.44], [1.35, 0.44], [1.35, 0.72], [0.30, 0.72], [0.30, 0.44]], lw: 0.014 },
    { pts: rr(0.15, 0.28, 1.35, 0.15, 0.02), lw: 0.014 },
    { pts: [[0.18, 0.31], [0.30, 0.31], [0.30, 0.40], [0.18, 0.40], [0.18, 0.31]], color: 'danger', lw: 0.010 },
    { pts: [[1.35, 0.31], [1.47, 0.31], [1.47, 0.40], [1.35, 0.40], [1.35, 0.31]], color: 'danger', lw: 0.010 },
    // 双轮 ×2
    { pts: rr(0.30, 0, 0.19, 0.52, 0.03) }, { pts: rr(0.52, 0, 0.19, 0.52, 0.03) },
    { pts: rr(0.91, 0, 0.19, 0.52, 0.03) }, { pts: rr(1.13, 0, 0.19, 0.52, 0.03) },
    // 侧身（向左上收进）
    { pts: [[0.20, 3.07], [-1.95, 3.18]] },                  // 厢顶线
    { pts: [[0.20, 0.72], [-1.95, 0.83]] },                  // 厢底线
    { pts: [[-1.95, 0.83], [-1.95, 3.18]], lw: 0.014 },      // 厢体前端
    { pts: [[-0.55, 0.758], [-0.55, 3.098]], lw: 0.011 },    // 侧板竖缝
    { pts: [[-1.30, 0.798], [-1.30, 3.138]], lw: 0.011 },
    { pts: [[0.20, 0.55], [-1.95, 0.64]], lw: 0.012 },       // 底架纵梁
    // 驾驶室（远端，风挡斜面）
    { pts: [[-1.95, 3.18], [-2.22, 2.72], [-2.48, 2.66], [-2.54, 2.42], [-2.58, 1.05], [-1.95, 0.83]], lw: 0.014 },
    { pts: [[-2.44, 2.50], [-2.10, 2.55], [-2.02, 2.05], [-2.02, 1.55], [-2.50, 1.48], [-2.48, 2.35], [-2.44, 2.50]], lw: 0.011 }, // 侧窗
    { pts: circle(-2.28, 0.32, 0.32), lw: 0.013 },
    { pts: circle(-2.28, 0.32, 0.13), lw: 0.010 },
  ],
};

// 公交 45°：尾立面在左，侧身向右上；弧形尾窗带 + 侧窗带 + 双轮
const BUS_Q = {
  w: 3.7, h: 3.15, lw: 0.020, ax: -0.75,
  lines: [
    // 尾立面
    { pts: rr(-1.35, 0.28, 1.20, 2.55, 0.16) },
    { pts: [[-1.24, 1.92], [-0.28, 1.92], [-0.32, 2.48], [-1.20, 2.48], [-1.24, 1.92]], lw: 0.013 }, // 弧顶尾窗带
    { pts: [[-1.24, 2.28], [-0.30, 2.28]], lw: 0.010 },
    // 尾灯塔（两角竖排）
    { pts: rr(-1.30, 1.32, 0.15, 0.46, 0.03), color: 'danger', lw: 0.011 },
    { pts: rr(-0.37, 1.32, 0.15, 0.46, 0.03), color: 'danger', lw: 0.011 },
    { pts: [[-1.18, 0.58], [0.16, 0.58], [0.16, 1.14], [-1.18, 1.14], [-1.18, 0.58]], lw: 0.012 }, // 机器盖
    { pts: rr(-0.62, 0.66, 0.55, 0.18, 0.02), lw: 0.011 },   // 牌照
    // 侧身
    { pts: [[-0.15, 2.83], [0.60, 2.885], [1.50, 2.925], [2.10, 2.94]] },  // 顶线
    { pts: [[-0.15, 1.22], [2.10, 1.34]] },                  // 腰线
    { pts: [[-0.15, 0.30], [2.10, 0.415]] },                 // 裙线
    { pts: [[2.10, 0.415], [2.10, 2.94]], lw: 0.014 },       // 前端截断
    { pts: [[-0.06, 1.85], [2.00, 1.955], [2.00, 2.62], [-0.06, 2.54], [-0.06, 1.85]], lw: 0.012 }, // 侧窗带
    ...[0.55, 1.10].map(x => ({ pts: [[x, 1.89 + x * 0.03], [x, 2.57 + x * 0.03]], lw: 0.010 })), // 窗柱
    { pts: [[1.52, 0.46], [1.95, 0.49], [1.95, 1.90], [1.52, 1.87], [1.52, 0.46]], lw: 0.012 }, // 乘客门
    // 轮拱 + 轮胎
    { pts: rr(-1.12, 0, 0.36, 0.40, 0.06) },
    { pts: [[-1.18, 0.42], [-1.10, 0.61], [-0.92, 0.67], [-0.76, 0.61], [-0.68, 0.42]], lw: 0.012 },
    { pts: rr(1.62, 0.05, 0.36, 0.40, 0.06), lw: 0.012 },
    { pts: [[1.55, 0.47], [1.64, 0.66], [1.82, 0.72], [1.98, 0.66], [2.05, 0.47]], lw: 0.011 },
  ],
};

// —— 路灯（锚点 = 杆底中心；flip 用于右侧）——
const LAMP = {
  w: 2.7, h: 7.35, lw: 0.030,
  lines: [
    { pts: rr(-0.26, 0.12, 0.52, 0.55, 0.03) },
    { pts: [[-0.10, 0], [0.10, 0], [0.10, 0.12], [-0.10, 0.12], [-0.10, 0]], lw: 0.022 },
    { pts: [[-0.105, 0.67], [-0.075, 5.9], [0.075, 5.9], [0.105, 0.67]] },
    { pts: [[-0.07, 5.9], [0.15, 6.55], [0.65, 6.95], [1.30, 7.10]] },
    { pts: [[0.07, 5.85], [0.28, 6.44], [0.72, 6.82], [1.32, 6.97]], lw: 0.022 },
    { pts: rr(1.42, 6.98, 1.10, 0.26, 0.06), lw: 0.024 },
    ...ticks(1.50, 2.42, 0.115, 6.86, 6.98).map(pts => ({ pts, lw: 0.016 })),
  ],
};

// —— 护栏反光柱 ——
const POST = {
  w: 0.2, h: 0.62, lw: 0.045,
  lines: [
    { pts: [[0, 0], [0, 0.52]] },
    { pts: [[-0.07, 0.52], [0.07, 0.52]], lw: 0.03 },
    { pts: rr(-0.035, 0.40, 0.07, 0.08, 0.008), color: 'gold', lw: 0.035 },
  ],
};

// —— 弯道预告牌（对照 p0_sign：双柱矩形牌 + 法兰底座；牌面弧形箭头，flip = 左弯）——
const SIGN = {
  w: 3.7, h: 4.15, lw: 0.030,
  lines: [
    { pts: [[-1.28, 0], [-1.28, 2.12]], lw: 0.045 },          // 双柱
    { pts: [[1.28, 0], [1.28, 2.12]], lw: 0.045 },
    { pts: rr(-1.52, 0, 0.48, 0.14, 0.02), lw: 0.024 },       // 法兰底座
    { pts: rr(1.04, 0, 0.48, 0.14, 0.02), lw: 0.024 },
    { pts: rr(-1.72, 2.06, 3.44, 1.66, 0.20) },               // 牌面双框
    { pts: rr(-1.60, 2.18, 3.20, 1.42, 0.14), lw: 0.016 },
    { pts: [[-0.95, 2.86], [-0.35, 2.74], [0.30, 2.80], [0.78, 3.02], [1.02, 3.30]], lw: 0.055 }, // 弧形箭头（右弯）
    { pts: [[0.62, 3.24], [1.05, 3.33], [0.94, 2.94]], lw: 0.055 },
  ],
};

// —— 主车位图 def（直接套用视频建模）：就绪前回退矢量版 playerVec ——
const PLAYER_BM = { bitmap: true, w: 1.94, h: 1.33, ax: 0, fallback: 'playerVec' };

export const DEFS = {
  player: PLAYER_BM, playerVec: PLAYER, sedan: SEDAN, truck: TRUCK, bus: BUS,
  sedan_q: SEDAN_Q, truck_q: TRUCK_Q, bus_q: BUS_Q,
  lamp: LAMP, post: POST, sign: SIGN,
};

// —— 位图注册：加载 → 亮度转 alpha（白线遮罩）→ trimInk 裁墨迹边界 → 四档 LOD ——
// 就绪前 getSprite/segmentsOf 回退到矢量 def（playerVec）或跳过绘制
const bitmapDefs = [];
function registerBitmap(key, url, worldW, opts = {}) {
  const img = new Image();
  img.onload = () => {
    const mask = processLineArt(img, 25, 1.8);          // JPG 白线黑底 → 白+alpha（玩家 PNG 幂等）
    const trim = trimInk(mask, 25);
    const def = { bitmap: true, img: trim.cv, srcW: trim.w, srcH: trim.h,
                  w: worldW, h: worldW * trim.h / trim.w, ax: 0, ...opts };
    bitmapDefs.push(def);
    DEFS[key] = def;
    refreshSprites();
  };
  img.src = url;
}

// 白线 JPG → 白+alpha 遮罩（亮度转 alpha）
function processLineArt(img, knee, gain) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = d.data[i];
    d.data[i] = 255; d.data[i + 1] = 255; d.data[i + 2] = 255;
    d.data[i + 3] = Math.min(255, Math.max(0, (lum - knee) * gain));
  }
  c.putImageData(d, 0, 0);
  return cv;
}

// 裁墨迹边界：扫描遮罩 alpha>30 的包围盒
function trimInk(img, knee = 25) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      if (d[(y * cv.width + x) * 4 + 3] > knee) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = cv.width - 1; y1 = cv.height - 1; }
  const tcv = document.createElement('canvas');
  tcv.width = x1 - x0 + 1; tcv.height = y1 - y0 + 1;
  tcv.getContext('2d').drawImage(cv, x0, y0, tcv.width, tcv.height, 0, 0, tcv.width, tcv.height);
  return { cv: tcv, w: tcv.width, h: tcv.height };
}

registerBitmap('player', playerCarUrl, 1.94);
registerBitmap('house1', house1Url, 4.8);
registerBitmap('house2', house2Url, 4.4);
registerBitmap('house3', house3Url, 5.2);
registerBitmap('house4', house4Url, 4.6);
registerBitmap('cactus_a', cactusAUrl, 1.3);
registerBitmap('cactus_b', cactusBUrl, 1.6);

// —— 预渲染：四档 LOD（32/64/128/256 px/m，§10.1 根因 3）——
// 对数空间相邻两层交叉淡化（重叠带 ≥10%），杜绝层级跳变；绘制坐标取整（根因 2）。
const TIERS = [32, 64, 128, 256];
const MINLW = [0.030, 0.022, 0.016, 0];
const MARGIN = 0.06;
const cache = new Map();

function renderDef(def, ppm, minLw = 0) {
  const W = Math.ceil((def.w + MARGIN * 2) * ppm);
  const H = Math.ceil((def.h + MARGIN) * ppm);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.setTransform(ppm, 0, 0, -ppm, (def.w / 2 + MARGIN) * ppm, (def.h + MARGIN * 0.5) * ppm);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const ln of def.lines) {
    c.strokeStyle = PAL[ln.color || 'line'];
    c.lineWidth = Math.max(ln.lw || def.lw, minLw);
    c.beginPath();
    const pts = ln.pts;
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }
  return cv;
}

export function refreshSprites() { cache.clear(); }
onThemeChanged(refreshSprites);
// TODO M3（§10.1 根因 4）：主题插值时量化到 1/255 步进，同色帧跳过重绘。

// 位图 tier：绘制原始遮罩 → source-in 染成当前主题线色
function buildBitmapTier(def, ppm) {
  const W = Math.ceil((def.w + MARGIN * 2) * ppm);
  const H = Math.ceil((def.h + MARGIN) * ppm);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.drawImage(def.img, 0, 0, def.srcW, def.srcH, MARGIN * ppm, MARGIN * ppm, def.w * ppm, def.h * ppm);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = PAL.line;
  c.fillRect(0, 0, W, H);
  return cv;
}

function getSprite(key, tier) {
  const k = key + '@' + tier;
  let cv = cache.get(k);
  if (!cv) {
    const def = DEFS[key];
    if (!def) return getSprite('playerVec', tier);
    if (def.bitmap) {
      if (!def.img) {
        // 位图未就绪：有矢量兜底则用兜底，否则本帧跳过绘制（绝不能让 drawImage 吃到 undefined）
        return def.fallback ? getSprite(def.fallback, tier) : null;
      }
      cv = buildBitmapTier(def, TIERS[tier]);
    } else {
      cv = renderDef(def, TIERS[tier], MINLW[tier]);
    }
    cache.set(k, cv);
  }
  return cv;
}

// 带 X 轴缩放的绘制（车体后脸随视角旋转压缩，§7A.3）
export function drawSpriteScaled(ctx, key, x, yBase, ppm, alpha, scaleX) {
  const def = DEFS[key];
  if (!def || Math.abs(scaleX) < 0.05 || alpha <= 0.02 || ppm < 1.2) return;
  const tier = Math.min(TIERS.length - 1, Math.max(0, Math.round(Math.log2(ppm / TIERS[0]))));
  const cv = getSprite(key, tier);
  if (!cv) return;
  const w = (def.w + MARGIN * 2) * ppm * scaleX;
  const h = (def.h + MARGIN) * ppm;
  ctx.globalAlpha = alpha;
  ctx.drawImage(cv, x - w / 2, yBase - h, w, h);
  ctx.globalAlpha = 1;
}

export function drawSprite(ctx, key, x, yBase, ppm, alpha = 1, flip = false) {
  if (alpha <= 0.02 || ppm < 1.2) return;
  const def = DEFS[key];
  if (!def) return;                            // 位图尚未注册完成：本帧跳过（首帧常见，勿抛）
  const w = (def.w + MARGIN * 2) * ppm;      // 尺寸连续（取整会造成步进"抽帧感"）
  const h = (def.h + MARGIN) * ppm;
  if (w < 1.5 || h < 1.5) return;
  const axPx = ((def.ax || 0) + def.w / 2 + MARGIN) * ppm;

  // 对数分层：仅在每个切换点 ±6% 的窄带内交叉淡化（其余区间单层，避免双层鬼影）
  const t = Math.min(TIERS.length - 1, Math.max(0, Math.log2(ppm / TIERS[0])));
  const i0 = Math.min(TIERS.length - 2, Math.floor(t));
  const f = t - i0;
  const blend = f > 0.94 ? (f - 0.94) / 0.06 : 0;

  const drawOne = (tier, a) => {
    if (a <= 0.02) return;
    const cv = getSprite(key, tier);
    if (!cv) return;                            // 位图未就绪且无兜底：跳过本帧
    ctx.globalAlpha = a;
    if (flip) {
      ctx.save(); ctx.translate(x, yBase); ctx.scale(-1, 1);
      ctx.drawImage(cv, -axPx, -h, w, h); ctx.restore();
    } else {
      ctx.drawImage(cv, Math.round(x - axPx), Math.round(yBase - h), w, h);
    }
  };
  drawOne(i0 + 1, alpha * blend);
  drawOne(i0, alpha * (1 - blend));
  ctx.globalAlpha = 1;
}

// 撞毁碎线（§5A.4）：位图主车按墨迹网格采样生成线段；矢量 sprite 逐折线拆段
function segmentsFromBitmap(def) {
  const cols = 16, rows = 11;
  const cw = 160, ch = Math.max(4, Math.round(160 * def.h / def.w));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d');
  c.drawImage(def.img, 0, 0, def.srcW, def.srcH, 0, 0, cw, ch);
  const d = c.getImageData(0, 0, cw, ch).data;
  const segs = [];
  const mw = def.w / cols, mh = def.h / rows;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const px = Math.floor((rx + 0.5) * cw / cols);
      const py = Math.floor((ry + 0.5) * ch / rows);
      if (d[(py * cw + px) * 4 + 3] > 70) {
        const x0 = -def.w / 2 + rx * mw, y0 = def.h - (ry + 1) * mh;  // y 向上
        segs.push([x0 + mw * 0.12, y0 + mh * 0.5, x0 + mw * 0.88, y0 + mh * 0.5]);
      }
    }
  }
  return segs;
}

export function segmentsOf(key) {
  const def = DEFS[key];
  if (def && def.bitmap) {
    if (def.img) return segmentsFromBitmap(def);
    key = 'playerVec';                                          // 位图未就绪 → 矢量兜底
  }
  const segs = [];
  for (const ln of DEFS[key].lines) {
    const p = ln.pts;
    for (let i = 1; i < p.length; i++) {
      segs.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
    }
  }
  return segs;
}
