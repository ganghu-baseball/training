// 髖關節訓練動作（右投手；站立的動作以前腳＝左腳支撐）
// 1 仰躺髖關節旋轉：抱膝 → 躺下 → 髖膝 90 度 → 小腿像雨刷往外轉開、再轉回來
// 2 單腳抬膝 ⇄ 前傾 T 字
// 3 收尾姿勢 → 用前腳髖關節轉回抬膝
// 4 單腳飛機（手放頭後）：T 字姿勢下胸口、骨盆打開再回來
// 5 單腳飛機＋彈力帶：雙手伸直拉住彈力帶，跟著胸口一起轉
import * as THREE from '../vendor/three.module.js';
import { Motion, pchip } from './interp.js';
import { DIM, quatYZX, solveSkeleton } from './rig.js';
import { addIkArmKeys, poseAt } from './motions.js';
import { FLAT } from './terrain.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const K = (...p) => p;

function pelQuat(tilt, yaw = 0, roll = 0, spin = 0) {
  const q = quatYZX(-roll * DEG, yaw * DEG, -tilt * DEG);
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin * DEG));
  return q;
}

// 由想要的腳踝位置反推腳的目標點（前腳掌），腳的方向用 yaw / pitch（度）
function ballFromAnkle(A, yaw, pitch) {
  const y = yaw * DEG, p = pitch * DEG;
  const fw0 = V(Math.cos(y), 0, -Math.sin(y));
  const fw = fw0.clone().multiplyScalar(Math.cos(p)).add(V(0, -Math.sin(p), 0));
  const up = V(0, Math.cos(p), 0).add(fw0.clone().multiplyScalar(Math.sin(p)));
  return A.clone().add(fw.multiplyScalar(DIM.ballFwd)).sub(up.multiplyScalar(DIM.ankleH));
}

// 腳踝軌跡 → 腳目標通道（密集取樣，曲線路徑才準）
// ankleAt(t, pelvis) 回傳世界座標的腳踝；pelvis = { P0, q }
function legChannels(c, side, ankleAt, yawKeys, pitchKeys, t0, t1, dt = 0.05) {
  const pm = new Motion(c);
  const fyaw = pchip(yawKeys), fpit = pchip(pitchKeys);
  const X = [], Y = [], Z = [], YA = [], PI = [];
  const n = Math.round((t1 - t0) / dt);
  for (let i = 0; i <= n; i++) {
    const t = t0 + i * dt;
    const q = pelQuat(pm.get('pel.tilt', t, 0), pm.get('pel.yaw', t, 0), pm.get('pel.roll', t, 0), pm.get('pel.spin', t, 0));
    const P0 = V(pm.get('pel.x', t, 0), pm.get('pel.y', t, 0), pm.get('pel.z', t, 0));
    const A = ankleAt(t, { P0, q });
    const yaw = fyaw(t), pitch = fpit(t);
    const b = ballFromAnkle(A, yaw, pitch);
    X.push([t, b.x]); Y.push([t, b.y]); Z.push([t, b.z]); YA.push([t, yaw]); PI.push([t, pitch]);
  }
  c[side + 'f.x'] = X; c[side + 'f.y'] = Y; c[side + 'f.z'] = Z; c[side + 'f.yaw'] = YA; c[side + 'f.pitch'] = PI;
}

// 相對骨盆的腳踝關鍵影格（骨盆座標：x 前、y 沿脊椎往上、z 右；原點＝骨盆中心）
function localAnkle(keys) {
  const fx = pchip(keys.map(([t, p]) => [t, p[0]])), fy = pchip(keys.map(([t, p]) => [t, p[1]])), fz = pchip(keys.map(([t, p]) => [t, p[2]]));
  return (t, { P0, q }) => P0.clone().add(V(fx(t), fy(t), fz(t)).applyQuaternion(q));
}

function constFoot(c, side, A, yaw, pitch, t1) {
  const b = ballFromAnkle(A, yaw, pitch);
  c[side + 'f.x'] = K([0, b.x], [t1, b.x]); c[side + 'f.y'] = K([0, b.y], [t1, b.y]); c[side + 'f.z'] = K([0, b.z], [t1, b.z]);
  c[side + 'f.yaw'] = K([0, yaw], [t1, yaw]); c[side + 'f.pitch'] = K([0, pitch], [t1, pitch]);
}

// 雙手在胸前併攏（像投球準備姿勢）
const HANDS_SET = [
  { side: 'r', target: [0.24, -0.30, 0.045], pole: [-0.2, -1, 1] },
  { side: 'l', target: [0.24, -0.30, -0.045], pole: [-0.2, -1, -1] },
];
const at = (list, ts) => ts.flatMap(t => list.map(k => ({ ...k, t })));

// ───────── 1 仰躺髖關節旋轉 ─────────
export function makeHipSupine() {
  const c = {};
  // 階段：坐著抱膝 → 躺下 → 手打開 → 髖膝 90 度 → 雨刷 ×3
  const T = { sit: 1.2, down: 3.0, open0: 3.6, open1: 4.6, wiper: 5.2, rep: 3.2, reps: 3 };
  const end = T.wiper + T.rep * T.reps + 0.8;
  T.end = end;
  c['pel.x'] = K([0, 0], [end, 0]); c['pel.z'] = K([0, 0], [end, 0]); c['pel.yaw'] = K([0, 0], [end, 0]);
  c['pel.y'] = K([0, 0.10], [T.sit, 0.10], [T.down, 0.115], [end, 0.115]);
  c['pel.tilt'] = K([0, -12], [T.sit, -12], [(T.sit + T.down) / 2, -52], [T.down, -90], [end, -90]);
  c['tr.flex'] = K([0, 18], [T.sit, 18], [(T.sit + T.down) / 2, 9], [T.down, 0], [end, 0]);
  c['head.pitch'] = K([0, -24], [T.sit, -24], [T.down, -12], [end, -10]);
  // 左腳：伸直平放在地上
  constFoot(c, 'l', V(0.89, 0.08, -0.12), 14, -72, end);
  c['lk.up'] = K([0, 88], [end, 88]);
  // 右腳：抱膝 → 90/90 → 小腿以膝蓋為圓心左右擺（往外＝髖內旋）
  const knee90 = V(0, 0.115 + DIM.thigh, DIM.hipHalf);
  const th = [[0, 0], [T.wiper, 0]];
  for (let i = 0; i < T.reps; i++) {
    const s = T.wiper + i * T.rep;
    th.push([s + 1.2, 34], [s + 1.6, 34], [s + 2.8, 0], [s + T.rep, 0]);
  }
  th.push([end, 0]);
  const fth = pchip(th);
  const hug = pchip([[0, 0], [T.sit, 0], [T.down, 1], [T.open0, 1], [T.open1, 2], [end, 2]]);
  const sitA = V(0.42, 0.12, 0.12), lieA = V(0.25, 0.38, 0.11), midA = V(0.36, 0.27, 0.12);
  const ankleAt = (t) => {
    const h = hug(t);
    if (h <= 1) {
      // 坐 → 躺（手一直抱著膝蓋）
      const u = h;
      return u < 0.5 ? sitA.clone().lerp(midA, u / 0.5) : midA.clone().lerp(lieA, (u - 0.5) / 0.5);
    }
    const a90 = knee90.clone().add(V(Math.cos(fth(t) * DEG), 0, Math.sin(fth(t) * DEG)).multiplyScalar(DIM.shank));
    return lieA.clone().lerp(a90, Math.min(1, h - 1));
  };
  const yawK = [[0, 0], [T.open0, 0], [T.open1, 0]];
  for (const [t, v] of th) if (t > T.open1) yawK.push([t, -v]);
  legChannels(c, 'r', ankleAt, yawK, [[0, 18], [T.sit, 18], [T.down, -40], [T.open0, -40], [T.open1, -90], [end, -90]], 0, end, 0.05);
  c['rk.up'] = K([0, 55], [T.sit, 55], [T.down, 85], [end, 88]);
  // 手：抱住右小腿（膝蓋下方）→ 往兩側打開平放
  c['ra.abd'] = K([T.open1, 88], [end, 88]); c['ra.hz'] = K([T.open1, -14], [end, -14]); c['ra.er'] = K([T.open1, 10], [end, 10]); c['ra.ef'] = K([T.open1, 12], [end, 12]);
  c['la.abd'] = K([T.open1, 88], [end, 88]); c['la.hz'] = K([T.open1, -14], [end, -14]); c['la.er'] = K([T.open1, 10], [end, 10]); c['la.ef'] = K([T.open1, 12], [end, 12]);
  const tmp = new Motion(c, { props: { ground: FLAT, headRel: true } });
  const keys = [];
  for (const t of [0, T.sit, (T.sit + T.down) / 2, T.down, T.open0]) {
    const S = solveSkeleton(poseAt(tmp, t));
    const Kn = S.rLeg.knee, A = S.rLeg.ankle;
    const p = Kn.clone().lerp(A, 0.28);
    const down = t >= T.down ? V(0, -0.5, 0) : V(0, -0.3, 0);
    keys.push({ t, side: 'r', world: p.clone().add(V(0.0, 0.0, 0.058)).toArray(), wpole: down.clone().add(V(0, 0, 1)).toArray() });
    keys.push({ t, side: 'l', world: p.clone().add(V(0.0, 0.0, -0.058)).toArray(), wpole: down.clone().add(V(0, 0, -1)).toArray() });
  }
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'hip', ground: FLAT, headRel: true }, events: T });
}

// ───────── 2 單腳抬膝 ⇄ 前傾 T 字 ─────────
export function makeKneeToT() {
  const c = {};
  const S0 = 0, S1 = 0.8, U1 = 1.6, U2 = 2.4, T1 = 3.8, T2 = 4.6, U3 = 6.0, U4 = 6.8, T3 = 8.2, T4 = 9.0, U5 = 10.4, U6 = 11.2, E1 = 12.0, E2 = 12.6;
  const stand = { x: -0.02, y: 0.95, z: 0.0, tilt: 4, roll: 0 }, up = { x: 0.0, y: 0.95, z: -0.06, tilt: 2, roll: 2 }, tee = { x: -0.07, y: 0.92, z: -0.06, tilt: 76, roll: 0 };
  const seq = [[S0, stand], [S1, stand], [U1, up], [U2, up], [T1, tee], [T2, tee], [U3, up], [U4, up], [T3, tee], [T4, tee], [U5, up], [U6, up], [E1, stand], [E2, stand]];
  for (const k of ['x', 'y', 'z', 'tilt', 'roll']) c['pel.' + k] = seq.map(([t, p]) => [t, p[k]]);
  c['pel.yaw'] = K([0, 0], [E2, 0]);
  c['tr.flex'] = seq.map(([t, p]) => [t, p === tee ? 6 : 2]);
  c['head.pitch'] = seq.map(([t, p]) => [t, p === tee ? 30 : -4]);
  // 左腳（支撐腳）
  constFoot(c, 'l', V(0.0, 0.07, -0.10), 0, 0, E2);
  c['lk.up'] = K([0, 0], [E2, 0]);
  // 右腳：站地 → 抬膝 → 往後伸成 T 字
  const SL = [0.02, -0.88, 0.11], UL = [0.44, -0.43, 0.10], TL = [-0.07, -0.885, 0.09], MID = [0.12, -0.66, 0.10];
  const lk = [[S0, SL], [S1, SL], [U1, UL], [U2, UL], [(U2 + T1) / 2, MID], [T1, TL], [T2, TL], [(T2 + U3) / 2, MID], [U3, UL], [U4, UL],
    [(U4 + T3) / 2, MID], [T3, TL], [T4, TL], [(T4 + U5) / 2, MID], [U5, UL], [U6, UL], [E1, SL], [E2, SL]];
  const pitch = seq.map(([t, p]) => [t, p === tee ? 95 : p === up ? 32 : 0]);
  legChannels(c, 'r', localAnkle(lk), [[0, 0], [E2, 0]], pitch, 0, E2, 0.05);
  // 站地時腳底貼平
  c['rf.y'] = c['rf.y'].map(([t, v]) => [t, (t <= S1 || t >= E1) ? 0 : v]);
  c['rk.up'] = seq.map(([t, p]) => [t, p === tee ? -80 : 0]);
  addIkArmKeys(c, at(HANDS_SET, [0, E2]));
  return new Motion(c, { props: { kind: 'hip', ground: FLAT, headRel: true }, events: { UP: U1, T: T1 } });
}

// ───────── 3 收尾姿勢 → 用前腳髖關節轉回抬膝 ─────────
export function makeFinishReturn() {
  const c = {};
  const F = { x: -0.10, y: 0.84, z: 0.03, yaw: 5, tilt: 42, roll: -4, flex: 38, twist: 12, bend: 6, hp: 38 };
  const U = { x: 0.02, y: 0.94, z: 0.05, yaw: -85, tilt: 4, roll: 2, flex: 2, twist: 0, bend: 0, hp: 0 };
  const seq = [[0, F], [1.0, F], [2.5, U], [3.5, U], [4.8, F], [5.6, F], [7.1, U], [8.4, U]];
  const end = 8.4;
  for (const k of ['x', 'y', 'z', 'yaw', 'tilt', 'roll']) c['pel.' + k] = seq.map(([t, p]) => [t, p[k]]);
  c['tr.flex'] = seq.map(([t, p]) => [t, p.flex]); c['tr.twist'] = seq.map(([t, p]) => [t, p.twist]); c['tr.bend'] = seq.map(([t, p]) => [t, p.bend]);
  c['head.pitch'] = seq.map(([t, p]) => [t, p.hp]);
  constFoot(c, 'l', V(-0.03, 0.07, 0.0), -40, 0, end);
  c['lk.up'] = K([0, 0], [end, 0]);
  // 右腳：後方抬高（收尾）→ 從身體下方往前帶 → 抬膝
  const FL = [-0.56, -0.40, 0.11], UL = [0.44, -0.43, 0.10], ML = [0.04, -0.66, 0.10];
  const lk = [[0, FL], [1.0, FL], [1.75, ML], [2.5, UL], [3.5, UL], [4.15, ML], [4.8, FL], [5.6, FL], [6.35, ML], [7.1, UL], [8.4, UL]];
  const yawK = seq.map(([t, p]) => [t, p === F ? 0 : -85]);
  const pitK = [[0, 100], [1.0, 100], [1.75, 20], [2.5, 32], [3.5, 32], [4.15, 20], [4.8, 100], [5.6, 100], [6.35, 20], [7.1, 32], [8.4, 32]];
  legChannels(c, 'r', localAnkle(lk), yawK, pitK, 0, end, 0.05);
  c['rk.up'] = [[0, -80], [1.0, -80], [1.75, -10], [2.5, 0], [3.5, 0], [4.15, -10], [4.8, -80], [5.6, -80], [6.35, -10], [7.1, 0], [8.4, 0]];
  // 手：收尾時右手在左膝外側、手套收在胸前 → 抬膝時雙手在胸前併攏
  const tmp = new Motion(c, { props: { ground: FLAT, headRel: true } });
  const keys = [];
  for (const t of [0, 1.0, 4.8, 5.6]) {
    const S = solveSkeleton(poseAt(tmp, t));
    const kn = S.lLeg.knee;
    keys.push({ t, side: 'r', world: kn.clone().add(V(0.04, -0.04, -0.17)).toArray(), wpole: [-0.3, 1, 0.3] });
    keys.push({ t, side: 'l', target: [0.20, -0.20, -0.12], pole: [-0.3, -1, -1] });
  }
  for (const t of [2.5, 3.5, 7.1, 8.4]) for (const k of HANDS_SET) keys.push({ ...k, t });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'hip', ground: FLAT, headRel: true }, events: { UP: 2.5 } });
}

// ───────── 4、5 單腳飛機 ─────────
// mode: 'head'（右手放頭後、左手往前下方伸）或 'band'（雙手伸直拉住彈力帶）
export function makeAirplane(o = {}) {
  const band = o.mode === 'band';
  const c = {};
  const tiltT = band ? 62 : 78;
  const stand = { x: -0.02, y: 0.95, z: -0.02, tilt: 4 }, tee = { x: -0.05, y: band ? 0.935 : 0.925, z: -0.05, tilt: tiltT };
  const S1 = 0.6, T1 = 2.0, T2 = 2.6, REP = 3.3, N = 3;
  const OPEN = { spin: -30, twist: -26 }, CLOSE = { spin: 10, twist: 14 };
  const spin = [[0, 0], [T2, 0]], twist = [[0, 0], [T2, 0]];
  for (let i = 0; i < N; i++) {
    const s = T2 + i * REP, last = i === N - 1;
    spin.push([s + 1.3, OPEN.spin], [s + 1.7, OPEN.spin], [s + 2.9, last ? 0 : CLOSE.spin], [s + REP, last ? 0 : CLOSE.spin]);
    twist.push([s + 1.3, OPEN.twist], [s + 1.7, OPEN.twist], [s + 2.9, last ? 0 : CLOSE.twist], [s + REP, last ? 0 : CLOSE.twist]);
  }
  const R1 = T2 + N * REP, E1 = R1 + 1.4, E2 = E1 + 0.6;
  spin.push([E2, 0]); twist.push([E2, 0]);
  const seq = [[0, stand], [S1, stand], [T1, tee], [R1, tee], [E1, stand], [E2, stand]];
  for (const k of ['x', 'y', 'z', 'tilt']) c['pel.' + k] = seq.map(([t, p]) => [t, p[k]]);
  c['pel.yaw'] = K([0, 0], [E2, 0]);
  c['pel.spin'] = spin; c['tr.twist'] = twist;
  c['tr.flex'] = seq.map(([t, p]) => [t, p === tee ? 6 : 2]);
  c['head.pitch'] = seq.map(([t, p]) => [t, p === tee ? (band ? 14 : 22) : -4]);
  constFoot(c, 'l', V(0.02, 0.07, -0.12), 0, 0, E2);
  c['lk.up'] = K([0, 0], [E2, 0]);
  const SL = [0.02, -0.88, 0.12], TL = [-0.06, -0.885, 0.09];
  legChannels(c, 'r', localAnkle([[0, SL], [S1, SL], [T1, TL], [R1, TL], [E1, SL], [E2, SL]]), [[0, 0], [E2, 0]],
    [[0, 0], [S1, 0], [T1, 95], [R1, 95], [E1, 0], [E2, 0]], 0, E2, 0.05);
  c['rf.y'] = c['rf.y'].map(([t, v]) => [t, (t <= S1 || t >= E1) ? 0 : v]);
  c['rk.up'] = K([0, 0], [S1, 0], [T1, -80], [R1, -80], [E1, 0], [E2, 0]);
  const keys = [];
  const arms = band
    ? [{ side: 'r', target: [0.40, 0.24, 0.21], pole: [-0.3, -0.2, 1] }, { side: 'l', target: [0.40, 0.24, -0.21], pole: [-0.3, -0.2, -1] }]
    : [{ side: 'r', target: [-0.07, 0.20, 0.07], pole: [0, 0.3, 1] }, { side: 'l', target: [0.25, 0.40, -0.22], pole: [-0.5, 0, -1] }];
  for (const k of HANDS_SET) keys.push({ ...k, t: 0 }, { ...k, t: S1 }, { ...k, t: E1 + 0.3 }, { ...k, t: E2 });
  for (const k of arms) keys.push({ ...k, t: T1 - 0.2 }, { ...k, t: R1 + 0.1 });
  addIkArmKeys(c, keys);
  return new Motion(c, { props: { kind: 'hip', ground: FLAT, headRel: true, band }, events: { T: T1, REP, N, T2, R1 } });
}
