// 兒童打擊課程的其他角色動作：教練（站立、低手拋球）、不拿球棒的居家練習（屁股往後、掉球接球、摸打擊座、丟飛盤）
// 都是一般比例的骨架動作，畫面上由 Q 版角色（chibi.js）縮放呈現。
import * as THREE from '../vendor/three.module.js';
import { Motion } from './interp.js';
import { addIkArmKeys } from './motions.js';
import { swingChannels } from './batting.js';
import { FLAT } from './terrain.js';

const DEG = Math.PI / 180;
const K = (...p) => p;

// 站立的基本通道（原點、面向 yaw 方向）
function standChannels(yaw = 0, o = {}) {
  const c = {};
  const y = yaw * DEG, f = [Math.cos(y), -Math.sin(y)], r = [Math.sin(y), Math.cos(y)];   // 前方、右方（x, z）
  const at = (fw, rt) => [fw * f[0] + rt * r[0], fw * f[1] + rt * r[1]];
  const [rx, rz] = at(0.05, 0.16), [lx, lz] = at(0.07, -0.16);
  c['pel.x'] = K([-9, 0]); c['pel.y'] = K([-9, o.pelY ?? 0.95]); c['pel.z'] = K([-9, 0]);
  c['pel.yaw'] = K([-9, yaw]); c['pel.tilt'] = K([-9, o.tilt ?? 6]);
  c['tr.twist'] = K([-9, 0]); c['tr.flex'] = K([-9, o.flex ?? 4]); c['tr.bend'] = K([-9, 0]);
  c['rf.x'] = K([-9, rx]); c['rf.z'] = K([-9, rz]); c['rf.y'] = K([-9, 0]); c['rf.yaw'] = K([-9, yaw - 8]); c['rf.pitch'] = K([-9, 0]);
  c['lf.x'] = K([-9, lx]); c['lf.z'] = K([-9, lz]); c['lf.y'] = K([-9, 0]); c['lf.yaw'] = K([-9, yaw + 8]); c['lf.pitch'] = K([-9, 0]);
  c['breath'] = K([-9, 1], [9, 1]);
  return c;
}

// 教練：站著看、雙手自然垂下或叉腰
export function makeCoach(o = {}) {
  const c = standChannels(o.yaw || 0, { pelY: 0.96 });
  const keys = [];
  for (const t of [-9, 9]) {
    keys.push({ t, side: 'r', target: o.hips ? [0.02, -0.33, 0.27] : [0.0, -0.5, 0.24], pole: o.hips ? [-1, 0, 0.6] : [-0.2, 0, 1] });
    keys.push({ t, side: 'l', target: o.hips ? [0.02, -0.33, -0.27] : [0.0, -0.5, -0.24], pole: o.hips ? [-1, 0, -0.6] : [-0.2, 0, -1] });
  }
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'coach', ground: FLAT, look: o.look || [18.0, 0.6, 0.3], headLim: 110 } });
}

// 教練低手拋球：右手由後往前擺，release 時出手（時間 0）
export function makeToss(o = {}) {
  const c = standChannels(o.yaw || 0, { pelY: 0.9, tilt: 16, flex: 12 });
  c['pel.y'] = K([-9, 0.9], [-0.5, 0.9], [-0.15, 0.88], [0.1, 0.9], [0.6, 0.92]);
  c['tr.twist'] = K([-9, 0], [-0.45, -14], [-0.1, -4], [0.15, 8], [0.6, 2]);
  const keys = [];
  const R = [[-9, [0.12, -0.42, 0.24]], [-0.8, [0.12, -0.42, 0.24]], [-0.4, [-0.22, -0.42, 0.26]], [-0.15, [0.02, -0.52, 0.22]],
    [0.0, [0.3, -0.36, 0.16]], [0.12, [0.42, -0.14, 0.12]], [0.45, [0.3, -0.3, 0.18]], [1.2, [0.12, -0.42, 0.24]]];
  for (const [t, target] of R) keys.push({ t, side: 'r', target, pole: [-0.4, 0, 1] });
  for (const t of [-9, 9]) keys.push({ t, side: 'l', target: [0.18, -0.3, -0.16], pole: [-0.2, -0.5, -1] });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'toss', release: 0, ground: FLAT, look: o.look || [18.0, 0.6, 0.3], headLim: 110 } });
}

// ─────── 不拿球棒的練習（右打者站位，與 makeSwing 相同的位置） ───────
// 屁股往後碰軟墊（髖鉸鏈），再回到打擊預備
// mode：good 屁股往後、舒服能轉；fold 腰折得太低；squat 整個人蹲下去不動
export function makeHinge(mode = 'good') {
  const c = swingChannels({}).c;
  for (const k of Object.keys(c)) if (!k.startsWith('k.') && !k.startsWith('b.')) c[k] = [[-9, new Motion({ x: c[k] }).get('x', -2.4)]];
  const z0 = c['pel.z'][0][1], y0 = c['pel.y'][0][1];
  const P = { good: [0.13, -0.02, 38], fold: [0.2, 0.03, 78], squat: [0.06, -0.2, 22] }[mode];
  c['pel.z'] = K([-9, z0], [0, z0], [0.9, z0 + P[0]], [1.6, z0 + P[0]], [2.5, z0], [9, z0]);
  c['pel.y'] = K([-9, y0 + 0.04], [0, y0 + 0.04], [0.9, y0 + P[1]], [1.6, y0 + P[1]], [2.5, y0], [9, y0]);
  c['pel.tilt'] = K([-9, 6], [0, 6], [0.9, P[2]], [1.6, P[2]], [2.5, 18], [9, 18]);
  c['tr.flex'] = K([-9, 2], [0.9, 4], [2.5, 7], [9, 7]);
  const keys = [];
  for (const t of [-9, 9]) {
    keys.push({ t, side: 'r', target: [0.14, -0.13, -0.12], pole: [0, -1, 1] });
    keys.push({ t, side: 'l', target: [0.17, -0.17, 0.12], pole: [0, -1, -1] });
  }
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'drill', ground: FLAT, look: [1.5, 1.6, 0.4], headLim: 112 } });
}

function drillBase() {
  const c = swingChannels({}).c;
  for (const k of Object.keys(c)) if (k.startsWith('k.') || k.startsWith('b.')) delete c[k];
  return c;
}

// 掉球接球：前手拿球伸到本壘板上方，放手，後手轉過來接住，雙手在前面會合
export function makeDropCatch() {
  const c = drillBase();
  const W = [17.95, 0.78, 0.08];
  const keys = [];
  // 前手（左）：先伸到本壘板上方，放球後留在原處，最後和右手會合
  keys.push({ t: -2.6, side: 'l', target: [0.42, -0.24, 0.02], pole: [0, -1, -0.6] });
  keys.push({ t: -1.0, side: 'l', world: W, wpole: [0, -1, 0.5] });
  keys.push({ t: -0.2, side: 'l', world: W, wpole: [0, -1, 0.5] });
  keys.push({ t: 0.05, side: 'l', world: [17.86, 0.6, 0.12], wpole: [0, -1, 0.5] });
  keys.push({ t: 0.6, side: 'l', world: [17.82, 0.62, 0.2], wpole: [0, -1, 0.5] });
  // 後手（右）：在後肩附近，轉身時往前擺到球掉下的位置接球
  for (const [t, tg] of [[-2.6, [0.1, -0.12, 0.22]], [-0.6, [0.08, -0.12, 0.24]], [-0.12, [0.25, -0.3, 0.2]]]) keys.push({ t, side: 'r', target: tg, pole: [-0.3, -1, 0.6] });
  keys.push({ t: 0.04, side: 'r', world: [17.88, 0.55, 0.1], wpole: [0, -1, 0.6] });
  keys.push({ t: 0.6, side: 'r', world: [17.84, 0.6, 0.16], wpole: [0, -1, 0.6] });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'drill', ground: FLAT, look: [17.95, 0.5, 0.1], headLim: 112, drop: { t: -0.2, from: W, catchT: 0.04 } } });
}

// 摸打擊座：雙手往前伸、胸口在本壘板上方，先用前手摸、再轉胸用後手摸；不站起來
export function makeTeeTouch() {
  const c = drillBase();
  const st = (k) => new Motion({ x: c[k] }).get('x', -2.4);
  for (const k of Object.keys(c)) c[k] = [[-9, st(k)]];
  const T = [17.95, 0.62, 0.12];
  c['pel.tilt'] = K([-9, 32]); c['pel.y'] = K([-9, st('pel.y') - 0.02]);
  c['pel.yaw'] = K([-9, 92], [0.4, 95], [1.4, 112], [2.2, 125], [3.0, 125], [3.8, 95], [9, 95]);
  c['tr.twist'] = K([-9, -4], [0.4, -2], [1.4, 18], [2.2, 30], [3.0, 30], [3.8, 0], [9, 0]);
  c['tr.flex'] = K([-9, 12]);
  c['rf.pitch'] = K([-9, 0], [1.2, 0], [2.2, 30], [3.0, 30], [3.8, 0]); c['rf.yaw'] = K([-9, 93], [1.2, 93], [2.2, 118], [3.0, 118], [3.8, 93]);
  const keys = [];
  keys.push({ t: -9, side: 'l', target: [0.4, -0.3, 0.02], pole: [0, -1, -0.6] });
  keys.push({ t: 0.5, side: 'l', world: T, wpole: [0, -1, 0.4] });
  keys.push({ t: 1.0, side: 'l', target: [0.42, -0.28, -0.04], pole: [0, -1, -0.6] });
  keys.push({ t: 9, side: 'l', target: [0.4, -0.3, -0.06], pole: [0, -1, -0.6] });
  keys.push({ t: -9, side: 'r', target: [0.4, -0.3, 0.06], pole: [0, -1, 0.6] });
  keys.push({ t: 1.2, side: 'r', target: [0.42, -0.3, 0.04], pole: [0, -1, 0.6] });
  keys.push({ t: 2.2, side: 'r', world: T, wpole: [0, -1, 0.4] });
  keys.push({ t: 3.0, side: 'r', world: T, wpole: [0, -1, 0.4] });
  keys.push({ t: 9, side: 'r', target: [0.4, -0.3, 0.06], pole: [0, -1, 0.6] });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'drill', ground: FLAT, look: [17.95, 0.3, 0.12], headLim: 112, tee: T } });
}

// 丟飛盤：後手（右）拿飛盤，轉身丟出去；手心朝上 → 手臂伸直 → 手心朝下
export function makeFrisbee() {
  const c = drillBase();
  const keys = [];
  for (const [t, tg, pro] of [[-2.6, [0.0, -0.05, 0.3], -70], [-0.6, [-0.06, -0.04, 0.32], -70], [-0.1, [0.18, -0.22, 0.2], -80],
    [0.0, [0.42, -0.2, 0.06], -40], [0.05, [0.5, -0.16, -0.08], 10], [0.2, [0.38, -0.05, -0.32], 80], [0.6, [0.25, 0.0, -0.36], 80]]) {
    keys.push({ t, side: 'r', target: tg, pole: [-0.3, -1, 0.5], pro });
  }
  for (const [t, tg] of [[-2.6, [0.22, -0.22, -0.14]], [0.0, [0.16, -0.26, -0.22]], [0.6, [0.08, -0.28, -0.26]]]) keys.push({ t, side: 'l', target: tg, pole: [-0.2, -1, -0.8] });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'drill', ground: FLAT, look: [1.5, 1.2, 0.4], headLim: 112, release: 0.05 } });
}
