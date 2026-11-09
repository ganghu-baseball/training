import * as THREE from '../engine/vendor/three.module.js';
import { makeMedballThrow } from '../engine/js/drills.js';
import { poseAt } from '../engine/js/motions.js';
import { solveSkeleton, armAnglesFromTarget } from '../engine/js/rig.js';
const m = makeMedballThrow();
const itemAt = (t) => {
  const pose = poseAt(m, t);
  const S0 = solveSkeleton(pose);
  const W = new THREE.Vector3(m.get('item.x', t), m.get('item.y', t), m.get('item.z', t));
  const dirW = l => S0.F.clone().multiplyScalar(l[0]).add(S0.U.clone().multiplyScalar(l[1])).add(S0.R.clone().multiplyScalar(l[2]));
  const g = m.props.grip;
  const reach = {};
  for (const side of ['r', 'l']) {
    const tgt = W.clone().add(dirW(g[side]));
    const sh = S0.P3.clone().add(new THREE.Vector3(0, -0.04, (side === 'r' ? 1 : -1) * 0.19).applyQuaternion(S0.qC));
    reach[side] = tgt.distanceTo(sh).toFixed(2);
  }
  return { p: W, reach, S0 };
};
for (let t = 0; t <= 2.2; t += 0.1) {
  const { p, reach, S0 } = itemAt(t);
  console.log(`t=${t.toFixed(2)} ball=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) reachR=${reach.r} reachL=${reach.l} kneeR=${S0.rLeg.kneeAng.toFixed(0)} kneeL=${S0.lLeg.kneeAng.toFixed(0)}${S0.rLeg.reach && S0.lLeg.reach ? '' : ' !LEG'}`);
}
const R = m.props.release;
const p0 = itemAt(R).p, pm = itemAt(R - 0.02).p;
const v = p0.clone().sub(pm).multiplyScalar(50);
console.log('release pos', p0.toArray().map(x => x.toFixed(2)), 'v0', v.toArray().map(x => x.toFixed(2)), '|v|', v.length().toFixed(2), 'm/s');
