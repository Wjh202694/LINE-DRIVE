// road.js — 赛道容器 + 伪 3D 投影（segment-projection，§4.1/§4.2 road.js）
import { CFG, ROAD_HALF } from './config.js';

let track = null;
export function setTrack(t) { track = t; }
export function getTrack() { return track; }

export function wrapZ(z) { const L = track.length; return ((z % L) + L) % L; }
export function wrapDelta(d) {
  const L = track.length;
  d = ((d % L) + L) % L;
  return d > L / 2 ? d - L : d;
}
export function segIndexAt(z) { return Math.floor(wrapZ(z) / CFG.segLen) % track.segs.length; }
export function segAt(z) { return track.segs[segIndexAt(z)]; }

// 相机：{ x, z, height, cx, cy, halfW, depth }
// 输出：scale（1/m）、x/y（屏幕 px，横向偏移 L 米时加 scale*L*halfW）、w（半路宽投影 px）
export function project(cam, xWorld, yWorld, zWorld, out) {
  const s = cam.depth / (zWorld - cam.z);
  out.scale = s;
  out.x = cam.cx + s * (xWorld - cam.x) * cam.halfW;
  out.y = cam.cy + s * (cam.height - yWorld) * cam.halfW;
  out.w = s * ROAD_HALF * cam.halfW;
  return out;
}
