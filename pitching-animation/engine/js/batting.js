// 打擊：球棒、雙手握棒、打擊頭盔、揮棒動作（含各種錯誤示範）、投球與擊球的球路
// 座標同投球：Y 向上、+X 朝捕手（本壘後方）、+Z 為三壘側。右打者站在三壘側打擊區、面向 -Z（本壘板）。
// 揮棒時間以「擊球瞬間 = 0」為基準。
import * as THREE from '../vendor/three.module.js';
import { Motion } from './interp.js';
import { Pitcher, solveSkeleton, armAnglesFromTarget } from './rig.js';
import { poseAt, makePitch, EV } from './motions.js';
import { makeBaseball } from './world.js';
import { FLAT } from './terrain.js';
import { Chibi, CHIBI_K, CHIBI_KL, xformUpper, invXformUpper, toonMat, addOutlines } from './chibi.js';

const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y_UP = V(0, 1, 0);
const K = (...p) => p;

export const BAT = { len: 0.84, sweet: 0.68, gripLow: 0.045, gripHigh: 0.128 };
// 本壘板（正確方向：平邊朝投手、尖角朝捕手），擊球區附近的參考點
export const HOME = { front: 18.01, tip: 18.44, mid: 18.2 };

// 球棒方向：yaw 0 = 朝捕手（+X）、90 = 朝本壘板（-Z）、180 = 朝投手、270 = 朝三壘側背後；el 為仰角
export function batDir(yaw, el) {
  const y = yaw * DEG, e = el * DEG;
  return V(Math.cos(e) * Math.cos(y), Math.sin(e), -Math.cos(e) * Math.sin(y));
}

// ─────────────────────────── 外型 ───────────────────────────
export function makeBat(mats) {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.004, 0.019], [0.009, 0.022], [0.016, 0.021], [0.024, 0.0135], [0.04, 0.0125], [0.22, 0.0135],
    [0.32, 0.0155], [0.42, 0.0205], [0.52, 0.0285], [0.60, 0.0325], [0.66, 0.0338], [0.80, 0.034], [0.828, 0.031], [0.837, 0.02], [0.84, 0]];
  const lathe = (pp, segs = 28) => new THREE.LatheGeometry(pp.map(([y, r]) => new THREE.Vector2(r, y)), segs);
  const wood = new THREE.Mesh(lathe(prof), mats.wood);
  const tape = new THREE.Mesh(lathe([[0.022, 0], [0.023, 0.0148], [0.04, 0.0141], [0.22, 0.015], [0.24, 0.0152], [0.241, 0]]), mats.tape);
  const ring = new THREE.Mesh(lathe([[0.555, 0.0], [0.556, 0.0312], [0.585, 0.0335], [0.586, 0]]), mats.stripe);
  for (const m of [wood, tape, ring]) { m.castShadow = true; g.add(m); }
  return g;
}

function makeFist(mat, side) {
  // 局部座標：z = 沿球棒朝棒頭、x = 由手腕往指節（垂直球棒）、球棒軸通過原點；ds = 手背所在的 y 方向
  const g = new THREE.Group();
  const ds = -side;
  const S = new THREE.SphereGeometry(1, 20, 14);
  const add = (geo, pos, scale, quat) => {
    const m = new THREE.Mesh(geo, mat); m.position.copy(pos); if (scale) m.scale.copy(scale); if (quat) m.quaternion.copy(quat);
    m.castShadow = true; g.add(m); return m;
  };
  add(S, V(-0.042, ds * 0.006, 0.002), V(0.042, 0.024, 0.042));            // 手掌
  add(S, V(-0.006, ds * 0.02, 0.0), V(0.02, 0.016, 0.046));                // 指節
  // 四指包住握把
  for (const z of [-0.031, -0.01, 0.011, 0.032]) {
    const tor = new THREE.TorusGeometry(0.0235, 0.0108, 8, 16, Math.PI * 1.45);
    const m = add(tor, V(0, 0, z));
    m.rotation.z = Math.PI * 1.275;   // 缺口朝手腕那側（掌心）
  }
  // 大拇指：在掌心側斜斜往棒頭
  const a = V(-0.035, -ds * 0.022, 0.03), b = V(-0.002, -ds * 0.026, 0.05);
  const d = b.clone().sub(a);
  add(new THREE.CapsuleGeometry(0.0115, d.length(), 4, 10), a.clone().add(b).multiplyScalar(0.5), null, new THREE.Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
  g.userData.wrist = V(-0.088, ds * 0.004, 0);
  return g;
}

function makeHelmet(mats) {
  // 打擊頭盔：比頭大一圈的殼 + 面向投手那一側的護耳 + 短帽簷（頭的局部座標：x 前、z 右）
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.128, 30, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), mats.shell);
  shell.scale.set(1.04, 0.95, 0.98); shell.position.set(-0.008, 0.012, 0);
  const flap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mats.shell);
  flap.scale.set(0.062, 0.072, 0.03); flap.position.set(-0.004, -0.04, -0.112);
  const hole = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), mats.dark);
  hole.scale.set(0.014, 0.014, 0.01); hole.position.set(-0.004, -0.032, -0.138);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.008, 28, 1, false, -Math.PI * 0.3, Math.PI * 0.6), mats.shell);
  brim.position.set(0.035, 0.0, 0); brim.rotation.set(0, Math.PI / 2, -0.14);
  const logo = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mats.logo);
  logo.scale.set(0.022, 0.026, 0.008); logo.position.set(0.0, 0.05, -0.122);
  const vent = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mats.logo);
  vent.scale.set(0.03, 0.006, 0.03); vent.position.set(-0.01, 0.133, 0);
  for (const m of [shell, flap, brim, logo, hole, vent]) { m.castShadow = true; g.add(m); }
  return g;
}

// ─────────────────────────── 揮棒動作 ───────────────────────────
// 擊球點（甜蜜點位置）與擊球瞬間的球棒角度，依進壘位置不同
export const CONTACT = {
  middle: { C: [17.90, 0.90, 0.0], yaw: 80, el: -20 },
  inside: { C: [17.66, 0.92, 0.17], yaw: 112, el: -14 },
  outside: { C: [18.12, 0.86, -0.20], yaw: 62, el: -26 },
  high: { C: [17.84, 1.12, 0.0], yaw: 84, el: -6 },
  low: { C: [17.95, 0.60, 0.0], yaw: 76, el: -38 },
};

function setKey(keys, t, v) { const out = keys.filter(k => Math.abs(k[0] - t) > 1e-6); out.push([t, v]); return out.sort((a, b) => a[0] - b[0]); }
function mapKeys(keys, t0, t1, fn) { return keys.map(([t, v]) => (t >= t0 && t <= t1) ? [t, fn(v, t)] : [t, v]); }
function dropKeys(keys, t0, t1) { return keys.filter(([t]) => t < t0 || t > t1); }

export function swingChannels(o = {}) {
  const c = {};
  // 骨盆：準備 → 往後蓄力（重心到後腳、髖部往內收）→ 跨步 → 前腳落地後髖部爆發轉開 → 前腳撐住
  c['pel.x'] = K([-2.2, 18.30], [-1.15, 18.30], [-0.50, 18.36], [-0.38, 18.375], [-0.25, 18.33], [-0.15, 18.25], [-0.08, 18.215], [0, 18.195], [0.15, 18.175], [0.5, 18.16], [1.0, 18.16]);
  c['pel.y'] = K([-2.2, 0.875], [-1.15, 0.875], [-0.45, 0.865], [-0.25, 0.855], [-0.15, 0.838], [-0.05, 0.846], [0, 0.856], [0.2, 0.882], [0.6, 0.902], [1.0, 0.905]);
  c['pel.z'] = K([-2.2, 0.84], [-0.15, 0.84], [0, 0.85], [0.3, 0.875], [1.0, 0.88]);
  c['pel.yaw'] = K([-2.2, 90], [-1.15, 90], [-0.45, 83], [-0.25, 82], [-0.15, 89], [-0.08, 108], [-0.04, 126], [0, 145], [0.06, 158], [0.15, 172], [0.35, 186], [1.0, 188]);
  c['pel.tilt'] = K([-2.2, 18], [-0.15, 18], [0, 16], [0.2, 10], [0.6, 6], [1.0, 6]);
  c['pel.roll'] = K([-2.2, 0], [-0.45, 2], [-0.15, -2], [0, -4], [0.3, 0], [1.0, 0]);
  // 軀幹相對骨盆：肩膀晚一步轉（肩髖分離）、擊球時後肩略低（側彎）
  c['tr.twist'] = K([-2.2, 0], [-1.15, 0], [-0.45, -12], [-0.25, -14], [-0.15, -24], [-0.08, -27], [-0.04, -18], [0, -4], [0.06, 6], [0.15, 14], [0.35, 22], [1.0, 20]);
  c['tr.flex'] = K([-2.2, 7], [-0.15, 7], [0, 9], [0.15, 6], [0.5, 2], [1.0, 2]);
  c['tr.bend'] = K([-2.2, 0], [-0.45, 2], [-0.15, -4], [-0.06, -10], [0, -17], [0.08, -14], [0.25, -6], [0.6, -2], [1.0, -2]);
  // 後腳：前腳掌為軸轉動（腳跟離地、膝蓋往內帶）
  c['rf.x'] = K([-2.2, 18.62], [0, 18.62], [0.15, 18.605], [1.0, 18.59]);
  c['rf.y'] = K([-2.2, 0], [1.0, 0]);
  c['rf.z'] = K([-2.2, 0.66], [0, 0.66], [0.2, 0.655], [1.0, 0.65]);
  c['rf.yaw'] = K([-2.2, 93], [-0.10, 93], [-0.04, 100], [0, 114], [0.1, 138], [0.3, 156], [1.0, 158]);
  c['rf.pitch'] = K([-2.2, 0], [-0.10, 0], [-0.04, 7], [0, 22], [0.08, 44], [0.2, 58], [0.4, 62], [1.0, 62]);
  c['rk.yaw'] = K([-2.2, 0], [-0.15, 0], [0, 24], [0.2, 32], [1.0, 28]);
  c['rk.up'] = K([-2.2, 0], [1.0, 0]);
  // 前腳：輕輕跨出、腳尖先著地、腳跟踩下；之後撐住，收尾時腳尖略為打開
  c['lf.x'] = K([-2.2, 17.98], [-0.45, 17.98], [-0.35, 17.945], [-0.25, 17.86], [-0.18, 17.805], [-0.15, 17.795], [1.0, 17.795]);
  c['lf.y'] = K([-2.2, 0], [-0.45, 0], [-0.38, 0.03], [-0.30, 0.052], [-0.23, 0.03], [-0.18, 0.004], [-0.15, 0], [1.0, 0]);
  c['lf.z'] = K([-2.2, 0.66], [-0.45, 0.66], [-0.15, 0.655], [1.0, 0.655]);
  c['lf.yaw'] = K([-2.2, 86], [-0.45, 86], [-0.15, 81], [0.05, 82], [0.2, 94], [1.0, 99]);
  c['lf.pitch'] = K([-2.2, 0], [-0.45, 0], [-0.38, 12], [-0.22, 12], [-0.17, 7], [-0.10, 0], [1.0, 0]);
  c['lk.yaw'] = K([-2.2, 0], [1.0, 0]);
  c['lk.up'] = K([-2.2, 0], [-0.45, 0], [-0.32, 14], [-0.2, 7], [-0.15, 0], [1.0, 0]);
  // 準備姿勢：輕微律動
  c['breath'] = K([-2.2, 1], [-1.2, 1], [-0.7, 0]);

  // 球棒：握把末端（knob）的世界座標 + 球棒方向（yaw/仰角）
  c['k.x'] = K([-2.2, 18.40], [-1.15, 18.40], [-0.45, 18.49], [-0.25, 18.50], [-0.15, 18.495], [-0.10, 18.43], [-0.06, 18.27], [-0.03, 18.07],
    [0.04, 17.70], [0.08, 17.69], [0.14, 17.77], [0.25, 17.93], [0.45, 18.0], [1.0, 18.0]);
  c['k.y'] = K([-2.2, 1.12], [-1.15, 1.12], [-0.45, 1.165], [-0.25, 1.17], [-0.15, 1.15], [-0.10, 1.10], [-0.06, 1.03], [-0.03, 1.0],
    [0.04, 1.06], [0.08, 1.10], [0.14, 1.22], [0.25, 1.40], [0.45, 1.46], [1.0, 1.46]);
  c['k.z'] = K([-2.2, 0.47], [-1.15, 0.47], [-0.45, 0.51], [-0.25, 0.52], [-0.15, 0.52], [-0.10, 0.50], [-0.06, 0.46], [-0.03, 0.47],
    [0.04, 0.64], [0.08, 0.72], [0.14, 0.90], [0.25, 1.0], [0.45, 1.0], [1.0, 1.0]);
  c['b.yaw'] = K([-2.2, 20], [-1.15, 20], [-0.45, 12], [-0.25, 10], [-0.15, 5], [-0.10, -6], [-0.06, -2], [-0.04, 14],
    [0.03, 128], [0.06, 168], [0.10, 210], [0.17, 258], [0.30, 300], [0.5, 318], [1.0, 322]);
  c['b.el'] = K([-2.2, 56], [-1.15, 56], [-0.45, 51], [-0.25, 50], [-0.15, 45], [-0.10, 26], [-0.06, 6], [-0.04, -6],
    [0.03, -18], [0.07, -6], [0.12, 8], [0.2, 18], [0.35, 16], [0.6, 12], [1.0, 12]);

  // 打者離本壘板的距離（整個人往三壘側移）
  const dz = o.dz ?? 0.08;
  for (const k of ['pel.z', 'rf.z', 'lf.z', 'k.z']) c[k] = c[k].map(([t, v]) => [t, v + dz]);
  const ct = { ...(CONTACT[o.loc || 'middle']), ...(o.contact || {}) };
  let attack = o.attack ?? 10, speed = o.speed ?? 30;

  // 時間重新分配：投手抬腿時開始蓄力、投手跨步落地時開始跨步（落地前的階段整體拉長）
  const remap = (t) => t >= -0.15 ? t : t >= -0.45 ? -0.15 + (t + 0.15) * 2 : t >= -1.15 ? -0.75 + (t + 0.45) * (0.85 / 0.7) : t - 0.45;
  for (const k of Object.keys(c)) c[k] = c[k].map(([t, v]) => [remap(t), v]);

  // 站距（只影響準備姿勢的示範）：narrow 太窄、wide 太寬
  if (o.stance === 'narrow') {
    c['lf.x'] = c['lf.x'].map(([t, v]) => [t, v + 0.15]); c['rf.x'] = c['rf.x'].map(([t, v]) => [t, v - 0.13]);
    c['pel.y'] = c['pel.y'].map(([t, v]) => [t, v + 0.03]);
  }
  if (o.stance === 'wide') {
    c['lf.x'] = c['lf.x'].map(([t, v]) => [t, v - 0.24]); c['rf.x'] = c['rf.x'].map(([t, v]) => [t, v + 0.2]);
    c['pel.y'] = c['pel.y'].map(([t, v]) => [t, v - 0.09]);
  }
  // ── 錯誤示範 ──
  if (o.style === 'chop') {
    // 往下砍：手和棒頭一直留在高處，最後才往下劈
    attack = -20;
    c['k.y'] = mapKeys(c['k.y'], -0.11, -0.01, v => v + 0.13);
    c['b.el'] = setKey(setKey(c['b.el'], -0.06, 28), -0.04, 14);
    ct.el = (ct.el ?? -24) - 6;
    c['k.y'] = mapKeys(c['k.y'], 0.03, 1.0, (v, t) => v - 0.12 * Math.min(1, t / 0.1));
    c['b.el'] = mapKeys(c['b.el'], 0.03, 0.3, v => v - 18);
    c['tr.bend'] = mapKeys(c['tr.bend'], -0.07, 0.1, v => v * 0.3);
  }
  if (o.style === 'uppercut') {
    // 撈：後肩掉很低、手先往下沉再往上撈
    attack = 34;
    c['k.y'] = mapKeys(c['k.y'], -0.11, -0.01, v => v - 0.16);
    c['b.el'] = setKey(setKey(c['b.el'], -0.06, -14), -0.04, -26);
    ct.el = (ct.el ?? -24) - 8;
    c['tr.bend'] = mapKeys(c['tr.bend'], -0.1, 0.12, v => v * 2.0);
    c['pel.roll'] = mapKeys(c['pel.roll'], -0.15, 0.1, v => v - 6);
    c['k.y'] = mapKeys(c['k.y'], 0.03, 1.0, (v, t) => v + 0.12 * Math.min(1, t / 0.12));
    c['k.x'] = mapKeys(c['k.x'], 0.03, 0.2, v => v + 0.07);
    c['b.el'] = mapKeys(c['b.el'], 0.03, 0.3, v => v + 18);
    c['tr.flex'] = mapKeys(c['tr.flex'], -0.1, 0.3, v => v - 8);
  }
  if (o.style === 'arms') {
    // 只用手臂：重心不移動、髖部幾乎不轉、後腳不轉，手臂硬甩
    c['pel.x'] = K([-2.2, 18.30], [1.0, 18.30]);
    c['pel.y'] = K([-2.2, 0.875], [1.0, 0.88]);
    c['pel.yaw'] = K([-2.2, 90], [-0.08, 90], [0, 104], [0.15, 116], [0.4, 122], [1.0, 122]);
    c['tr.twist'] = K([-2.2, 0], [-0.08, 0], [0, 16], [0.15, 40], [0.4, 52], [1.0, 50]);
    c['rf.yaw'] = K([-2.2, 93], [1.0, 93]); c['rf.pitch'] = K([-2.2, 0], [1.0, 0]); c['rk.yaw'] = K([-2.2, 0], [1.0, 0]);
    for (const k of ['lf.x', 'lf.y', 'lf.yaw', 'lf.pitch', 'lk.up']) c[k] = K([-2.2, c[k][0][1]], [1.0, c[k][0][1]]);
    c['tr.bend'] = mapKeys(c['tr.bend'], -0.2, 1.0, v => v * 0.4);
    c['k.x'] = mapKeys(c['k.x'], -1.6, -0.11, () => 18.40);
    c['k.y'] = mapKeys(c['k.y'], -1.6, -0.11, () => 1.12);
    speed = 21; attack = 4;
    // 身體沒轉，手伸不到前面：擊球點被擠到後面、收棒也收不完整
    ct.C = [18.04, 0.90, 0.04]; ct.yaw = 70; ct.el = -22;
    c['k.x'] = mapKeys(c['k.x'], 0.03, 1.0, v => v + 0.26);
    c['k.z'] = mapKeys(c['k.z'], 0.03, 1.0, v => v - 0.12);
    c['b.yaw'] = mapKeys(c['b.yaw'], 0.03, 1.0, v => 90 + (v - 90) * 0.75);
  }
  if (o.style === 'cast') {
    // 手太早推出去（甩棒）：手離身體很遠、棒頭繞一大圈，速度慢又打不準
    c['k.z'] = mapKeys(c['k.z'], -0.11, -0.01, (v, t) => v - 0.2 * Math.sin(Math.PI * (t + 0.11) / 0.12));
    c['k.x'] = mapKeys(c['k.x'], -0.11, -0.01, v => v + 0.06);
    c['b.yaw'] = setKey(setKey(setKey(c['b.yaw'], -0.10, 18), -0.06, 46), -0.04, 62);
    c['b.el'] = setKey(setKey(c['b.el'], -0.06, -2), -0.04, -12);
    speed = 22; attack = 0;
  }
  if (o.style === 'noBrace') {
    // 前腳沒撐住：身體一直往前滑、前膝彎下去，頭跟著往前衝
    c['pel.x'] = K([-2.2, 18.30], [-1.15, 18.30], [-0.50, 18.36], [-0.38, 18.375], [-0.25, 18.33], [-0.15, 18.24], [-0.08, 18.17], [0, 18.10], [0.15, 18.02], [0.5, 17.98], [1.0, 17.98]).map(([t, v]) => [remap(t), v]);
    c['pel.y'] = K([-2.2, 0.875], [-1.15, 0.875], [-0.45, 0.865], [-0.25, 0.855], [-0.15, 0.835], [0, 0.815], [0.2, 0.81], [0.6, 0.83], [1.0, 0.83]).map(([t, v]) => [remap(t), v]);
    c['pel.yaw'] = mapKeys(c['pel.yaw'], -0.05, 1.0, v => v - 12);
    c['tr.flex'] = mapKeys(c['tr.flex'], -0.05, 1.0, v => v + 8);
    c['k.x'] = mapKeys(c['k.x'], 0.0, 1.0, v => v - 0.06);
    speed = 25;
  }

  if (o.style === 'stomp') {
    // 用力跺腳：前腳抬很高，再重重踩下去，身體跟著往下一沉、往前晃
    c['lf.y'] = K([-2.2, 0], [-0.45, 0], [-0.38, 0.07], [-0.30, 0.16], [-0.25, 0.16], [-0.18, 0.015], [-0.15, 0], [1.0, 0]).map(([t, v]) => [remap(t), v]);
    c['lk.up'] = K([-2.2, 0], [-0.45, 0], [-0.33, 42], [-0.25, 40], [-0.18, 6], [-0.15, 0], [1.0, 0]).map(([t, v]) => [remap(t), v]);
    c['lf.pitch'] = K([-2.2, 0], [-0.45, 0], [-0.33, 18], [-0.25, 16], [-0.19, 0], [1.0, 0]).map(([t, v]) => [remap(t), v]);
    const bump = (t, a, w) => a * Math.exp(-(((t + 0.16) / w) ** 2));
    c['pel.y'] = mapKeys(c['pel.y'], -0.3, 0.2, (v, t) => v - bump(t, 0.04, 0.06));
    c['tr.flex'] = mapKeys(c['tr.flex'], -0.3, 0.3, (v, t) => v + bump(t, 9, 0.08));
    speed = 26;
  }
  if (o.style === 'lockKnee') {
    // 前膝硬鎖住：前腳落地後膝蓋完全打直、骨盆被頂高，轉身卡卡的
    c['lf.x'] = mapKeys(c['lf.x'], -0.3, 1.0, (v, t) => v - 0.1 * Math.min(1, (t + 0.3) / 0.15));
    c['pel.y'] = mapKeys(c['pel.y'], -0.35, 1.0, (v, t) => v + 0.04 * Math.min(1, Math.max(0, (t + 0.35) / 0.15)));
    c['pel.x'] = mapKeys(c['pel.x'], -0.35, 1.0, (v, t) => v + 0.03 * Math.min(1, Math.max(0, (t + 0.35) / 0.15)));
    c['pel.yaw'] = mapKeys(c['pel.yaw'], -0.05, 1.0, v => v - 10);
    speed = 26;
  }

  // 跨步大小：small 小跨步、large 大跨步、none 不跨步（腳尖輕點）
  if (o.stride && o.stride !== 'normal') {
    const f = { small: 0.45, large: 1.7, none: 0.05 }[o.stride] ?? 1;
    c['lf.x'] = c['lf.x'].map(([t, v]) => [t, 17.98 + (v - 17.98) * f]);
    c['lf.y'] = c['lf.y'].map(([t, v]) => [t, v * Math.min(1, 0.3 + f * 0.7)]);
    c['pel.x'] = c['pel.x'].map(([t, v]) => [t, t > -0.5 ? v + (1 - f) * 0.045 * Math.min(1, (t + 0.5) / 0.35) : v]);
    if (o.stride === 'large') c['pel.y'] = c['pel.y'].map(([t, v]) => [t, t > -0.3 ? v - 0.035 * Math.min(1, (t + 0.3) / 0.15) : v]);
  }
  // 手的走法：bring 跨步時把手一起帶向投手；push 手往外推（提早與身體分開）
  if (o.hands === 'bring') {
    c['k.x'] = dropKeys(c['k.x'], -1.2, -0.09); c['k.x'].push([-1.2, 18.42], [-0.6, 18.38], [-0.35, 18.30], [-0.16, 18.25], [-0.11, 18.22]);
    c['k.x'].sort((a, b) => a[0] - b[0]);
    c['tr.twist'] = mapKeys(c['tr.twist'], -0.6, -0.05, v => v * 0.45);
    speed = 24;
  }
  if (o.hands === 'push') {
    c['k.z'] = mapKeys(c['k.z'], -0.5, -0.02, (v, t) => v - 0.2 * Math.sin(Math.PI * Math.min(1, (t + 0.5) / 0.5)));
    c['k.x'] = mapKeys(c['k.x'], -0.5, -0.08, (v, t) => v - 0.08 * Math.min(1, (t + 0.5) / 0.3));
    c['b.yaw'] = setKey(setKey(c['b.yaw'], -0.10, 22), -0.06, 48);
    speed = 22; attack = 2;
  }
  // 刻意扭很大：前肩、骨盆收很多，接著趕不上球（場景用較晚的擊球時間表現）
  if (o.style === 'overtwist') {
    c['tr.twist'] = mapKeys(c['tr.twist'], -1.2, -0.05, v => v * 1.9);
    c['pel.yaw'] = mapKeys(c['pel.yaw'], -1.2, -0.12, v => 90 + (v - 90) * 1.8);
    c['k.x'] = mapKeys(c['k.x'], -0.9, -0.12, v => v + 0.06);
    c['k.z'] = mapKeys(c['k.z'], -0.9, -0.12, v => v + 0.05);
  }
  // 不揮棒：一樣準備、跨步，但球不好就把球棒留住、放掉這一球
  if (o.take) {
    const tm = new Motion(c);
    const hold = (name, keys) => { const v0 = tm.get(name, -0.15); c[name] = dropKeys(c[name], -0.149, 99).concat(keys.map(([t, v]) => [t, typeof v === 'function' ? v(v0) : v])); };
    hold('pel.yaw', [[-0.06, v => v + 2], [0.15, v => v + 4], [0.7, 92], [1.0, 91]]);
    hold('tr.twist', [[-0.06, v => v], [0.3, -10], [0.8, -3], [1.0, -2]]);
    hold('tr.bend', [[0.2, -2], [1.0, 0]]);
    hold('pel.x', [[0.0, v => v], [0.5, v => v + 0.02], [1.0, v => v + 0.03]]);
    hold('pel.y', [[0.0, v => v + 0.01], [0.6, 0.865], [1.0, 0.87]]);
    hold('rf.yaw', [[1.0, 93]]); hold('rf.pitch', [[1.0, 0]]); hold('rk.yaw', [[1.0, 0]]);
    hold('lf.yaw', [[1.0, 84]]);
    for (const n of ['k.x', 'k.y', 'k.z']) hold(n, [[-0.05, v => v], [0.25, v => v], [0.9, v => v + (n === 'k.y' ? -0.03 : n === 'k.x' ? -0.06 : -0.03)], [1.0, v => v + (n === 'k.y' ? -0.03 : n === 'k.x' ? -0.07 : -0.03)]]);
    hold('b.yaw', [[0.0, v => v + 2], [0.4, 14], [1.0, 20]]);
    hold('b.el', [[0.0, v => v + 2], [0.4, 50], [1.0, 55]]);
    ct.ball = null;
    return { c, ct, attack, speed, take: true };
  }

  // 擊球瞬間附近：由甜蜜點的位置、速度與仰角（攻擊角）反推握把位置，讓甜蜜點剛好通過擊球點
  c['b.yaw'] = setKey(c['b.yaw'], 0, ct.yaw);
  c['b.el'] = setKey(c['b.el'], 0, ct.el);
  const tmp = new Motion({ y: c['b.yaw'], e: c['b.el'] });
  const C = V(...ct.C);
  const hd = batDir(ct.yaw + 90, 0);
  const vdir = hd.multiplyScalar(Math.cos(attack * DEG)).add(V(0, Math.sin(attack * DEG), 0));
  for (const dt of [-0.012, 0, 0.012]) {
    const ss = C.clone().add(vdir.clone().multiplyScalar(speed * dt * (dt < 0 ? 1.0 : 0.92)));
    const D = batDir(tmp.get('y', dt), tmp.get('e', dt));
    const kn = ss.sub(D.multiplyScalar(BAT.sweet));
    c['k.x'] = setKey(c['k.x'], dt, kn.x); c['k.y'] = setKey(c['k.y'], dt, kn.y); c['k.z'] = setKey(c['k.z'], dt, kn.z);
  }
  // 球心在棒面前方（沿揮棒方向偏一個球＋棒的半徑），不是在球棒裡面
  const ball = C.clone().add(vdir.clone().multiplyScalar(0.071));
  ct.ball = ball.toArray();
  return { c, ct, attack, speed };
}

export function makeSwing(o = {}) {
  const { c, ct, attack, speed, take } = swingChannels(o);
  return new Motion(c, {
    events: { LOAD: -1.6, STRIDE: -0.75, PLANT: -0.15, CONTACT: 0 },
    props: { kind: 'swing', contact: ct, attack, speed, headLim: 112, ground: FLAT, style: o.style || 'good', loc: o.loc || 'middle', take: !!take },
  });
}

// 投手出手點（預設投球動作）
let _rel = null;
export function releasePoint() {
  if (!_rel) _rel = solveSkeleton(poseAt(makePitch(), EV.BR)).rArm.ball.clone();
  return _rel.clone();
}

// ─────────────────────────── 打者演員 ───────────────────────────
export class Batter {
  constructor(scene, opts = {}) {
    this.chibi = !!opts.chibi;
    this.pitcher = this.chibi ? new Chibi({ colors: opts.colors, castShadow: opts.castShadow, headR: opts.headR, number: opts.number }) : new Pitcher({ colors: opts.colors, castShadow: opts.castShadow });
    this.root = new THREE.Group();
    this.root.add(this.pitcher.group);
    scene.add(this.root);
    const P = this.pitcher;
    const M = (color, part) => {
      const m = this.chibi ? toonMat(color, part) : new THREE.MeshLambertMaterial({ color });
      m.userData.part = part; m.userData.baseEmissive = new THREE.Color(0, 0, 0);
      P.mats.push(m); return m;
    };
    this.batMats = { wood: M(opts.batColor || (this.chibi ? '#D9A86A' : '#C9995E'), 'bat'), tape: M('#2A2F33', 'bat'), stripe: M('#FE7F2D', 'bat') };
    this.bat = makeBat(this.batMats);
    P.group.add(this.bat);
    this.fistR = makeFist(P.M.skinR, +1); this.fistL = makeFist(P.M.skinL, -1);
    P.group.add(this.fistR, this.fistL);
    (P.parts.armR = P.parts.armR || []).push(...this.fistR.children);
    (P.parts.armL = P.parts.armL || []).push(...this.fistL.children);
    if (this.chibi) {
      // Q 版：骨架以錨點縮放成小朋友，再往本壘板靠一點，讓甜蜜點仍在本壘板上方
      this.T = { A: V(18.30, 0, 0.82), k: opts.k || CHIBI_K, kL: opts.kL || CHIBI_KL, tr: opts.tr ? V(...opts.tr) : V(-0.11, 0, -0.25), off: V() };
      this.batScale = { r: this.T.k * 1.5 * (opts.batR || 1), l: this.T.k * 1.12 * (opts.batL || 1) };
      this.bat.scale.set(this.batScale.r, this.batScale.l, this.batScale.r);
      P.group.remove(this.fistR, this.fistL);
      this.fistR = P.makeMitt(+1); this.fistL = P.makeMitt(-1);
      addOutlines(this.bat, P.outlines);
      this.helmet = P.makeHelmet(opts.helmetColor || '#233D4D');
    } else {
      this.helmet = makeHelmet({ shell: M(opts.helmetColor || '#233D4D', 'head'), dark: M('#0c151c', 'head'), logo: M('#FE7F2D', 'head') });
      P.group.add(this.helmet);
    }
    P.capGroup.visible = false;
    P.handR.visible = false; P.handL.visible = false; P.gloveMesh.visible = false;
    P.setGlove = () => {};    // 打者不戴手套
    this.ball = makeBaseball();
    scene.add(this.ball);
    this.ball.visible = false;
    this.medball = null; this.waterbag = null;
    this.motion = null;
    this.offset = V(0, 0, 0);
    this.pitch = null;
    this.mirror = false;
  }
  // 左打：整個人以 z = 0（本壘板中線）鏡像
  setMirror(on) { this.mirror = !!on; this.root.scale.z = on ? -1 : 1; }
  setMotion(m) { this.motion = m; }
  // 投球：{ rel:[x,y,z] 出手點, tRel 出手時間（揮棒時間）, cross:[x,y,z] 球經過的點, tCross, hit:{ev,la,spray} 或 null }
  setPitch(p) {
    if (p === this.pitch) return;
    this.pitch = p;
    this.battedCache = null;
  }

  // 一般比例的球棒（給手臂 IK 用；Q 版時不含位移）
  batAdult(t) {
    const m = this.motion;
    const k = V(m.get('k.x', t), m.get('k.y', t), m.get('k.z', t));
    if (!this.chibi) k.add(this.offset);
    const D = batDir(m.get('b.yaw', t), m.get('b.el', t));
    return { knob: k, D, gL: k.clone().add(D.clone().multiplyScalar(BAT.gripLow)), gR: k.clone().add(D.clone().multiplyScalar(BAT.gripHigh)) };
  }
  // 畫面上的球棒（Q 版時已縮放、含位移）
  batAt(t, noOffset = false) {
    const m = this.motion;
    const D = batDir(m.get('b.yaw', t), m.get('b.el', t));
    let k, L = BAT.len, S = BAT.sweet, g1 = BAT.gripLow, g2 = BAT.gripHigh;
    if (this.chibi) {
      const T = { ...this.T, off: this.T.tr.clone().add(noOffset ? V() : this.offset) };
      k = xformUpper(V(m.get('k.x', t), m.get('k.y', t), m.get('k.z', t)), V(m.get('pel.x', t), m.get('pel.y', t), m.get('pel.z', t)), T);
      L *= this.batScale.l; S *= this.batScale.l; g1 *= this.T.k; g2 *= this.T.k;
    } else k = V(m.get('k.x', t), m.get('k.y', t), m.get('k.z', t)).add(noOffset ? V() : this.offset);
    return { knob: k, D, sweet: k.clone().add(D.clone().multiplyScalar(S)), tip: k.clone().add(D.clone().multiplyScalar(L)),
      gL: k.clone().add(D.clone().multiplyScalar(g1)), gR: k.clone().add(D.clone().multiplyScalar(g2)) };
  }
  // 某一瞬間甜蜜點前方的球心位置（擊球點；不含位移）
  contactBall(t = 0, up = 0) {
    const a = this.batAt(t, true), b = this.batAt(t + 0.004, true);
    const dir = b.sweet.clone().sub(a.sweet).normalize();
    const r = 0.0366 + 0.034 * (this.chibi ? this.batScale.r : 1);
    return a.sweet.clone().add(dir.multiplyScalar(r)).add(V(0, up, 0));
  }

  // 由球棒位置反求兩隻手臂（上手 = 右手、下手 = 左手）
  armIK(pose, bat) {
    const S0 = solveSkeleton(pose);
    const D = bat.D;
    const perp = (v) => { const p = v.clone().sub(D.clone().multiplyScalar(v.dot(D))); return p.lengthSq() < 1e-8 ? V(0, -1, 0) : p.normalize(); };
    const sides = [['r', +1, bat.gR], ['l', -1, bat.gL]];
    const tgt = {};
    for (const [s, side, g] of sides) {
      const sh = side > 0 ? S0.rArm.sh : S0.lArm.sh;
      tgt[s] = { g, x: perp(g.clone().sub(sh)) };
    }
    const poleOf = (S, side) => S.U.clone().multiplyScalar(-1).add(S.R.clone().multiplyScalar(side > 0 ? 0.45 : -0.25)).add(S.F.clone().multiplyScalar(side > 0 ? -0.1 : 0.1)).normalize();
    const apply = (S, s, side, wristT) => {
      const ang = armAnglesFromTarget(S, side, wristT, poleOf(S, side));
      const a = side > 0 ? pose.ra : pose.la;
      a.abd = ang.abd; a.hz = ang.hz; a.er = ang.er; a.ef = ang.ef; a.pro = 0; a.wf = 0;
    };
    const wristOf = (s) => tgt[s].g.clone().add(tgt[s].x.clone().multiplyScalar(-0.088));
    for (const [s, side] of sides) apply(S0, s, side, wristOf(s));
    let S1 = solveSkeleton(pose);
    // 第二輪：以手肘到握點的方向當作前臂方向
    for (const [s, side] of sides) {
      const arm = side > 0 ? S1.rArm : S1.lArm;
      tgt[s].x = perp(tgt[s].g.clone().sub(arm.elbow));
    }
    for (const [s, side] of sides) apply(S0, s, side, wristOf(s));
    // 修正肩胛骨位移造成的誤差
    S1 = solveSkeleton(pose);
    for (const [s, side] of sides) {
      const arm = side > 0 ? S1.rArm : S1.lArm;
      const want = wristOf(s);
      apply(S0, s, side, want.clone().add(want.clone().sub(arm.wrist)));
    }
  }

  // 投出去的球（到擊球點或繼續飛向捕手）
  pitchPos(t) {
    const p = this.pitch;
    const rel = V(...p.rel), cr = V(...p.cross);
    const T = p.tCross - p.tRel, g = -9.8;
    const v = cr.clone().sub(rel).multiplyScalar(1 / T); v.y -= 0.5 * g * T;
    const dt = t - p.tRel;
    const pos = rel.clone().add(v.clone().multiplyScalar(dt)); pos.y += 0.5 * g * dt * dt;
    return { pos, v: v.clone().add(V(0, g * dt, 0)) };
  }

  battedSim() {
    if (this.battedCache) return this.battedCache;
    const h = this.pitch.hit;
    const pos = V(...this.pitch.cross);
    const la = h.la * DEG, sp = (h.spray || 0) * DEG;
    const vel = V(-Math.cos(la) * Math.cos(sp), Math.sin(la), Math.cos(la) * Math.sin(sp)).multiplyScalar(h.ev);
    const dt = 1 / 240, samples = [], r = 0.037, k = h.drag ?? 0.0045;
    let T = 0, landed = null;
    for (let i = 0; i < 240 * 7; i++) {
      samples.push(pos.clone());
      const sp2 = vel.length();
      vel.add(vel.clone().multiplyScalar(-k * sp2 * dt));
      vel.y += -9.8 * dt;
      pos.add(vel.clone().multiplyScalar(dt));
      if (pos.y < r) {
        if (landed === null) landed = { t: T, pos: pos.clone() };
        pos.y = r; vel.y = Math.abs(vel.y) * 0.38; vel.x *= 0.62; vel.z *= 0.62;
        if (vel.y < 0.4) vel.y = 0;
      }
      if (pos.y <= r + 1e-4 && vel.y === 0) { vel.x *= 1 - 1.6 * dt; vel.z *= 1 - 1.6 * dt; }
      T += dt;
    }
    this.battedCache = { samples, dt, landed };
    return this.battedCache;
  }

  ballAt(t) {
    const p = this.pitch;
    if (!p || t < p.tRel) return null;
    if (t <= p.tCross || !p.hit) {
      const { pos } = this.pitchPos(t);
      if (pos.y < 0.037) pos.y = 0.037;
      return pos.add(this.offset);
    }
    const b = this.battedSim();
    const f = (t - p.tCross) / b.dt;
    const i = Math.min(b.samples.length - 2, Math.floor(f)), s = Math.min(1, f - i);
    return b.samples[i].clone().lerp(b.samples[i + 1], s).add(this.offset);
  }

  lookTarget(t) {
    const p = this.pitch;
    const relDefault = releasePoint();
    if (!p) return relDefault.add(this.offset.clone().setY(0));
    if (t < p.tRel) return V(...p.rel);
    const tt = Math.min(t, p.tCross);
    const b = this.pitchPos(tt).pos.add(this.offset);
    // 擊球後頭留在擊球點一下下，再慢慢抬起來看球
    if (t > p.tCross + 0.18 && p.hit) {
      const s = Math.min(1, (t - p.tCross - 0.18) / 0.5);
      return b.lerp(this.ballAt(t), s * s * (3 - 2 * s) * 0.8);
    }
    return b;
  }

  update(t, o = {}) {
    const m = this.motion;
    if (!m) return null;
    const pose = poseAt(m, t);
    let look = o.look || this.lookTarget(t);
    if (!look.isVector3) look = V(...look);
    let S, bat;
    if (this.chibi) {
      this.T.off = this.T.tr.clone().add(this.offset);
      pose.head.look = invXformUpper(look, V(pose.pel.x, pose.pel.y, pose.pel.z), this.T).toArray();
      this.armIK(pose, this.batAdult(t));
      S = this.pitcher.update(pose, this.T);
      bat = this.batAt(t);
    } else {
      for (const f of [pose.rf, pose.lf]) { f.x += this.offset.x; f.z += this.offset.z; }
      pose.pel.x += this.offset.x; pose.pel.z += this.offset.z;
      const ground = pose.ground;
      if (this.offset.x || this.offset.z) pose.ground = (x, z) => ground(x - this.offset.x, z - this.offset.z);
      pose.head.look = look.toArray();
      bat = this.batAt(t);
      this.armIK(pose, bat);
      S = this.pitcher.update(pose);
    }
    this.S = S; this.batNow = bat;
    // 球棒
    this.bat.position.copy(bat.knob);
    this.bat.quaternion.setFromUnitVectors(Y_UP, bat.D);
    this.bat.visible = o.showBat !== false;
    // 雙手握拳包住握把
    for (const [fist, g, arm] of [[this.fistR, bat.gR, S.rArm], [this.fistL, bat.gL, S.lArm]]) {
      const z = bat.D.clone();
      let x = g.clone().sub(arm.wrist); x.sub(z.clone().multiplyScalar(x.dot(z))).normalize();
      const y = z.clone().cross(x).normalize();
      fist.position.copy(g);
      fist.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      fist.visible = o.showBat !== false;
    }
    this.pitcher.handR.visible = o.showBat === false; this.pitcher.handL.visible = o.showBat === false;
    // 頭盔
    if (!this.chibi) { this.helmet.position.copy(S.head); this.helmet.quaternion.copy(S.qH); }
    // 球
    const bp = o.showBall === false ? null : this.ballAt(t);
    this.ball.visible = !!bp && (!this.pitch.hideAfter || t < this.pitch.hideAfter);
    if (bp) { this.ball.position.copy(bp); this.ball.rotation.set(t * 50, 0, t * 30); if (this.mirror) this.ball.position.z *= -1; }
    return S;
  }
}
