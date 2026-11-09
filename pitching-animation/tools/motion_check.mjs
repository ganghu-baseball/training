// 檢查動作是否有「跳格」：關節位置突然跳動、膝蓋／手肘彎曲平面突然翻轉
// node tools/motion_check.mjs
import * as THREE from '../engine/vendor/three.module.js';
import { makePitch, poseAt } from '../engine/js/motions.js';
import * as DR from '../engine/js/drills.js';
import * as HD from '../engine/js/hipdrills.js';
import { solveSkeleton } from '../engine/js/rig.js';
const FPS = 60;
const list = [
  ...[{}, { trunkNoBrake: true }, { squat: true }, { noDrift: true }, { lateArm: true }, { land: 'open' }, { land: 'closed' }, { kneeCave: true },
    { gloveYank: true }, { frontKnee: 'locked' }, { frontKnee: 'collapse' }, { elbow: 'low' }, { elbow: 'high' }, { earlyTrunk: true }, { earlyPush: true }]
    .map(o => ['pitch ' + JSON.stringify(o), makePitch(o), -1.6, 1.8]),
  ['medball', DR.makeMedballThrow(), 0, 4], ['chestRot', DR.makeChestRotation(), 0, 6], ['waterbag', DR.makeWaterbag({ jerky: false }), 0, 12],
  ['jump', DR.makeJump({ counter: true, start: 0.8 }), 0, 4],
  ['hipSupine', HD.makeHipSupine(), 0, 16], ['kneeToT', HD.makeKneeToT(), 0, 14], ['finishReturn', HD.makeFinishReturn(), 0, 14],
  ['airplaneHead', HD.makeAirplane({ mode: 'head' }), 0, 16], ['airplaneBand', HD.makeAirplane({ mode: 'band' }), 0, 16],
];
const J = S => ({ kneeR: S.rLeg.knee, kneeL: S.lLeg.knee, ankR: S.rLeg.ankle, ankL: S.lLeg.ankle, toeR: S.rLeg.toe, toeL: S.lLeg.toe,
  elbR: S.rArm.elbow, elbL: S.lArm.elbow, wrR: S.rArm.wrist, wrL: S.lArm.wrist, head: S.head, P3: S.P3 });
const plane = (a, b, c) => b.clone().sub(a).cross(c.clone().sub(b));
let total = 0;
for (const [name, m, t0, t1] of list) {
  const frames = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / FPS) {
    const S = solveSkeleton(poseAt(m, t));
    frames.push({ t, j: J(S), kn: [plane(S.rLeg.hip, S.rLeg.knee, S.rLeg.ankle), plane(S.lLeg.hip, S.lLeg.knee, S.lLeg.ankle)],
      el: [plane(S.rArm.sh, S.rArm.elbow, S.rArm.wrist), plane(S.lArm.sh, S.lArm.elbow, S.lArm.wrist)], reach: S.rLeg.reach && S.lLeg.reach });
  }
  const issues = [];
  for (let i = 2; i < frames.length - 2; i++) {
    for (const k of Object.keys(frames[i].j)) {
      const d = frames[i].j[k].distanceTo(frames[i - 1].j[k]);
      const nb = (frames[i - 1].j[k].distanceTo(frames[i - 2].j[k]) + frames[i + 1].j[k].distanceTo(frames[i].j[k])) / 2;
      if (d > 0.012 && d > 3 * nb) issues.push(`t=${frames[i].t.toFixed(3)} ${k} jump ${(d * 100).toFixed(1)}cm (nb ${(nb * 100).toFixed(1)})`);
    }
    for (const [lab, arr] of [['knee', 'kn'], ['elbow', 'el']]) for (let s = 0; s < 2; s++) {
      const a = frames[i - 1][arr][s], b = frames[i][arr][s];
      if (a.length() < 1e-3 || b.length() < 1e-3) continue;
      const ang = a.angleTo(b) * 180 / Math.PI;
      // 彎曲平面在一格內轉超過 25°，而且這個關節是彎著的（直的時候平面沒有意義）
      if (ang > 25 && Math.min(a.length(), b.length()) > 0.02) issues.push(`t=${frames[i].t.toFixed(3)} ${lab}${s ? 'L' : 'R'} plane flip ${ang.toFixed(0)}°`);
    }
    if (!frames[i].reach && frames[i - 1].reach) issues.push(`t=${frames[i].t.toFixed(3)} leg over-reach starts`);
  }
  total += issues.length;
  console.log(`${name}: ${issues.length ? issues.length + ' issue(s)' : 'ok'}`);
  for (const s of issues.slice(0, 12)) console.log('   ' + s);
}
console.log('total', total);
