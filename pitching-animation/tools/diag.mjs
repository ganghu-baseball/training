// 檢查動作：膝角、腳是否搆得到、骨盆高度（node tools/diag.mjs '{"variant":{}}' [t0 t1 step]）
import { makePitch, poseAt } from '../engine/js/motions.js';
import { solveSkeleton } from '../engine/js/rig.js';
const opt = JSON.parse(process.argv[2] || '{}');
const t0 = +(process.argv[3] ?? -1.4), t1 = +(process.argv[4] ?? 1.15), st = +(process.argv[5] ?? 0.05);
const m = makePitch(opt.variant || {});
let bad = 0;
for (let t = t0; t <= t1 + 1e-9; t += st) {
  const S = solveSkeleton(poseAt(m, t));
  const r = S.rLeg, l = S.lLeg;
  const flag = (r.reach ? '' : ' !R') + (l.reach ? '' : ' !L');
  if (flag) bad++;
  console.log(`t=${t.toFixed(3).padStart(6)} kneeR=${r.kneeAng.toFixed(0).padStart(4)} kneeL=${l.kneeAng.toFixed(0).padStart(4)} pelY=${S.P0.y.toFixed(3)} headY=${S.head.y.toFixed(2)} ball=(${S.rArm.ball.x.toFixed(2)},${S.rArm.ball.y.toFixed(2)},${S.rArm.ball.z.toFixed(2)})${flag}`);
}
console.log('unreachable samples:', bad);
