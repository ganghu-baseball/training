// 揮棒檢查：手臂是否搆得到握點、甜蜜點速度與攻擊角、球棒是否穿過身體
// node tools/swing_diag.mjs '{"style":"good","loc":"middle"}' [t0 t1 step]
import * as THREE from '../engine/vendor/three.module.js';
import { makeSwing, Batter, BAT } from '../engine/js/batting.js';
import { poseAt } from '../engine/js/motions.js';
import { solveSkeleton, DIM } from '../engine/js/rig.js';
const opt = JSON.parse(process.argv[2] || '{}');
const t0 = +(process.argv[3] ?? -1.0), t1 = +(process.argv[4] ?? 0.8), st = +(process.argv[5] ?? 0.02);
const m = makeSwing(opt);
const fake = { motion: m, offset: new THREE.Vector3() };
const batAt = (t) => Batter.prototype.batAt.call(fake, t);
const solveAt = (t) => {
  const pose = poseAt(m, t); pose.head.look = [1.5, 1.7, 0.4];
  const bat = batAt(t);
  Batter.prototype.armIK.call(fake, pose, bat);
  return { S: solveSkeleton(pose), bat };
};
const segDist = (p, a, b) => { const ab = b.clone().sub(a); const s = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().add(ab.multiplyScalar(s))); };
const f = (v, n = 2) => v.toFixed(n);
let worst = 0;
for (let t = t0; t <= t1 + 1e-9; t += st) {
  const { S, bat } = solveAt(t);
  const eR = Math.abs(S.rArm.wrist.distanceTo(bat.gR) - 0.088), eL = Math.abs(S.lArm.wrist.distanceTo(bat.gL) - 0.088);
  const b2 = batAt(t + 0.002), b1 = batAt(t - 0.002);
  const v = b2.sweet.clone().sub(b1.sweet).multiplyScalar(1 / 0.004);
  const vk = b2.knob.clone().sub(b1.knob).multiplyScalar(1 / 0.004);
  const att = Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180 / Math.PI;
  // 球棒（握點以上）與身體的最近距離：頭、胸口、骨盆
  let clr = 9;
  const body = [[S.head, 0.13], [S.P3, 0.17], [S.P2, 0.16], [S.P0, 0.17], [S.rLeg.knee, 0.07], [S.lLeg.knee, 0.07]];
  for (let s = 0.2; s <= 1.0; s += 0.1) {
    const p = bat.knob.clone().add(bat.D.clone().multiplyScalar(BAT.len * s));
    for (const [c, r] of body) clr = Math.min(clr, p.distanceTo(c) - r - 0.03);
  }
  const chestYaw = Math.atan2(-S.F.z, S.F.x) * 180 / Math.PI;
  const flag = (eR > 0.02 ? ' !R' : '') + (eL > 0.02 ? ' !L' : '') + (clr < 0 ? ' CLIP' : '') + (S.rLeg.reach ? '' : ' !legR') + (S.lLeg.reach ? '' : ' !legL');
  if (flag) worst++;
  console.log(`t=${f(t, 3).padStart(6)} ss=(${f(bat.sweet.x)},${f(bat.sweet.y)},${f(bat.sweet.z)}) v=${f(v.length(), 1).padStart(5)} kv=${f(vk.length(), 1).padStart(4)} att=${f(att, 0).padStart(4)} chest=${f(chestYaw, 0).padStart(5)} errR=${f(eR, 3)} errL=${f(eL, 3)} clr=${f(clr, 2)} head=(${f(S.head.x)},${f(S.head.y)},${f(S.head.z)})${flag}`);
}
console.log('flagged', worst, 'contact', JSON.stringify(m.props.contact));
