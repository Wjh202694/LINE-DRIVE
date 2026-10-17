// crash.js — 撞毁流程：状态切换 + 成绩落盘 + 图鉴解锁判定 + 碎片演出 + 震屏
// 从 main.js 抽出（v5.7 模块化）：转向系统与车流事件都要触发撞毁，
// 放在 main 里就只能靠闭包传 game，拆不开。
// reason = null 表示车流撞击（car 非空），reason = 字符串表示玩法判定失败（撞栏/转向不足/禁按方向键）。
import { CFG } from '../config.js';
import { wrapZ } from '../road.js';
import { sfxHit } from '../audio.js';
import { shatter, addShake } from '../fx.js';
import { UNLOCKS, unlockedCount } from '../menu.js';
import { LS } from '../store.js';

export function doCrash(game, car, reason) {
  game.state = 'crashing';
  game.crashT = 0;
  game.player.crashed = true;
  if (reason) game.failReason = reason;
  game.runs++; LS.runs = game.runs;
  game.newBest = game.score > game.best;
  if (game.newBest) LS.best = Math.floor(game.score);
  // M4：图纸收藏解锁检测（本局跨过 5km 门槛）
  const oldKm = game.bestKm;
  if (game.dist > game.bestKm) { game.bestKm = game.dist; LS.bestKm = game.dist; }
  const nOld = unlockedCount(oldKm), nNew = unlockedCount(game.bestKm);
  if (nNew > nOld) game.newUnlock = UNLOCKS[nNew - 1].name;
  else game.newUnlock = null;
  sfxHit();                                   // M5：撞毁金属音
  const cam = game.cam;
  const ppmP = (cam.depth / CFG.playerZ) * cam.halfW;
  const bx = cam.cx + (game.player.x - cam.x) * (cam.depth / CFG.playerZ) * cam.halfW;
  const by = cam.cy + (cam.depth / CFG.playerZ) * cam.height * cam.halfW;
  const flat = !!reason;
  shatter('player', bx, by, ppmP, 0.6, { flat });
  if (car) {
    car.dead = true;
    const dz = wrapZ(car.z) - cam.z;
    const s = cam.depth / Math.max(dz, 3);
    shatter(car.type.key, cam.cx + s * (car.x - cam.x) * cam.halfW,
            cam.cy + s * cam.height * cam.halfW, s * cam.halfW);
  }
  addShake(flat ? 10 : 14);
}
