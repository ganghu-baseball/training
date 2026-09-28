// 「演員」：把動作 + 骨架 + 道具（球、藥球、水袋）綁在一起，給場景使用
import * as THREE from '../vendor/three.module.js';
import { Pitcher, solveSkeleton, armAnglesFromTarget } from './rig.js';
import { poseAt, ballFlight } from './motions.js';
import { makeBaseball, makeMedball, makeWaterBag } from './world.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Actor {
  constructor(scene, opts = {}) {
    this.pitcher = new Pitcher({ colors: opts.colors, castShadow: opts.castShadow });
    this.root = new THREE.Group();
    this.root.add(this.pitcher.group);
    scene.add(this.root);
    this.ball = makeBaseball();
    scene.add(this.ball);
    this.ball.visible = false;
    this.medball = null; this.waterbag = null;
    this.motion = null;
    this.offset = V(0, 0, 0);      // 整個人的位移（例如並排比較時）
    this.flightCache = new Map();
  }
  setMotion(m) { if (m !== this.motion) { this.medState = null; this.slosh = null; } this.motion = m; }
  ensureMedball() { if (!this.medball) { this.medball = makeMedball(); this.root.parent.add(this.medball); } return this.medball; }
  ensureWaterbag() { if (!this.waterbag) { this.waterbag = makeWaterBag(); this.root.parent.add(this.waterbag); } return this.waterbag; }

  // 在動作時間 t 擺出姿勢，並更新道具
  update(t, o = {}) {
    const m = this.motion;
    if (!m) return null;
    const pose = poseAt(m, t);
    const kind = m.props.kind;
    if (kind === 'medball' || kind === 'waterbag' || kind === 'chest') this.applyHoldIK(pose, m, t);
    pose.pel.x += this.offset.x; pose.pel.z += this.offset.z;
    for (const f of [pose.rf, pose.lf]) { f.x += this.offset.x; f.z += this.offset.z; }
    if (pose.head && pose.head.look) pose.head.look = [pose.head.look[0] + (m.props.lookFollow ? this.offset.x : 0), pose.head.look[1], pose.head.look[2] + this.offset.z];
    const ground = pose.ground;
    if (this.offset.x || this.offset.z) pose.ground = (x, z) => ground(x - this.offset.x, z - this.offset.z);
    const S = this.pitcher.update(pose);
    this.pitcher.setGlove(kind === 'pitch');
    this.S = S;
    this.updateProps(t, S, o);
    return S;
  }

  // 雙手抱藥球 / 握水袋：由道具位置反求手臂角度
  applyHoldIK(pose, m, t) {
    const S0 = solveSkeleton(pose);
    const item = this.itemLocal(m, t);
    if (!item) return;
    const w = m.get('hold', t, 1);
    const toW = (l) => S0.P3.clone().add(S0.F.clone().multiplyScalar(l[0])).add(S0.U.clone().multiplyScalar(l[1])).add(S0.R.clone().multiplyScalar(l[2]));
    const dirW = (l) => S0.F.clone().multiplyScalar(l[0]).add(S0.U.clone().multiplyScalar(l[1])).add(S0.R.clone().multiplyScalar(l[2])).normalize();
    const g = m.props.grip;
    const cW = item.world ? item.world.clone().add(V(pose.pel.x - m.get('pel.x', t), 0, pose.pel.z - m.get('pel.z', t))) : null;
    for (const side of ['r', 'l']) {
      const tgt = cW ? cW.clone().add(dirW(g[side]).multiplyScalar(Math.hypot(...g[side]))) : toW(item[side]);
      const pole = dirW(item[side + 'Pole'] || g[side + 'Pole']);
      const ang = armAnglesFromTarget(S0, side === 'r' ? 1 : -1, tgt, pole);
      const a = side === 'r' ? pose.ra : pose.la;
      for (const k of ['abd', 'hz', 'er', 'ef']) a[k] = a[k] * (1 - w) + ang[k] * w;
    }
  }

  itemLocal(m, t) {
    // 道具中心（胸廓座標 f,u,r，或世界座標 item.x/y/z）與雙手抓握點
    if (m.has('item.x')) return { world: V(m.get('item.x', t), m.get('item.y', t), m.get('item.z', t)) };
    if (!m.has('item.f')) return null;
    const c = [m.get('item.f', t), m.get('item.u', t), m.get('item.r', t)];
    const g = m.props.grip;
    return {
      c,
      r: [c[0] + g.r[0], c[1] + g.r[1], c[2] + g.r[2]], rPole: g.rPole,
      l: [c[0] + g.l[0], c[1] + g.l[1], c[2] + g.l[2]], lPole: g.lPole,
    };
  }

  updateProps(t, S, o) {
    const m = this.motion;
    const kind = m.props.kind;
    if (kind === 'pitch') {
      const rel = m.props.release;
      this.ball.visible = o.showBall !== false;
      if (t < rel) this.ball.position.copy(S.rArm.ball);
      else {
        if (!this.relPos) this.relPos = new Map();
        const key = m;
        let rp = this.relPos.get(key);
        if (!rp) {
          const pose = poseAt(m, rel);
          pose.pel.x += this.offset.x; pose.pel.z += this.offset.z;
          for (const f of [pose.rf, pose.lf]) { f.x += this.offset.x; f.z += this.offset.z; }
          rp = solveSkeleton(pose).rArm.ball.clone();
          this.relPos.set(key, rp);
        }
        const tgt = m.props.target ? V(...m.props.target) : V(18.3, 0.82, 0.05);
        tgt.x += this.offset.x; tgt.z += this.offset.z;
        const ft = m.props.flightTime || 0.46;
        const dt = t - rel;
        if (dt <= ft) this.ball.position.copy(ballFlight(rp, dt, ft, tgt));
        else this.ball.position.copy(tgt);  // 進手套
      }
      this.ball.rotation.x = t * 40; this.ball.rotation.z = t * 25;
    } else {
      this.ball.visible = false;
    }
    if (kind === 'medball') this.updateMedball(t, S);
    if (kind === 'waterbag') this.updateWaterbag(t, S);
    if (kind === 'chest') this.updateMedball(t, S, true);
  }

  itemWorld(S, l) {
    if (l && l.isVector3) return l.clone().add(this.offset);
    return S.P3.clone().add(S.F.clone().multiplyScalar(l[0])).add(S.U.clone().multiplyScalar(l[1])).add(S.R.clone().multiplyScalar(l[2]));
  }

  updateMedball(t, S, noThrow = false) {
    const mb = this.ensureMedball();
    mb.visible = true;
    const m = this.motion;
    const rel = m.props.release;
    if (noThrow || t < rel) {
      const it = this.itemLocal(m, t);
      mb.position.copy(this.itemWorld(S, it.world || it.c));
      mb.quaternion.copy(S.qC);
      return;
    }
    // 出手後：以出手瞬間的速度做拋體運動，撞牆反彈後落地
    const st = this.medState || (this.medState = this.computeMedFlight());
    const p = st.at(t - rel);
    mb.position.copy(p.pos);
    mb.rotation.set(0, 0, -(t - rel) * 9);
  }

  computeMedFlight() {
    const m = this.motion, rel = m.props.release;
    const posAt = (tt) => {
      const pose = poseAt(m, tt);
      pose.pel.x += this.offset.x; pose.pel.z += this.offset.z;
      for (const f of [pose.rf, pose.lf]) { f.x += this.offset.x; f.z += this.offset.z; }
      const S = solveSkeleton(pose);
      const it = this.itemLocal(m, tt);
      return this.itemWorld(S, it.world || it.c);
    };
    const p0 = posAt(rel), pm = posAt(rel - 0.02);
    const v0 = p0.clone().sub(pm).multiplyScalar(1 / 0.02);
    const wallX = (m.props.wallX ?? 4.0) + this.offset.x - 0.115;
    const g = -9.8, r = 0.115;
    // 以固定步長預先模擬
    const dt = 1 / 240, samples = [];
    let pos = p0.clone(), vel = v0.clone(), hitWall = false, T = 0;
    for (let i = 0; i < 240 * 3; i++) {
      samples.push({ t: T, pos: pos.clone() });
      vel.y += g * dt;
      pos.add(vel.clone().multiplyScalar(dt));
      if (!hitWall && pos.x > wallX) { pos.x = wallX; vel.x *= -0.35; vel.y *= 0.6; vel.z *= 0.6; hitWall = true; this.wallHit = T; }
      if (pos.y < r) { pos.y = r; vel.y *= -0.3; vel.x *= 0.6; vel.z *= 0.6; }
      T += dt;
    }
    this.medV0 = v0;
    return {
      at: (tt) => {
        const i = Math.max(0, Math.min(samples.length - 2, Math.floor(tt / dt)));
        const a = samples[i], b = samples[i + 1];
        const s = Math.max(0, Math.min(1, (tt - a.t) / dt));
        return { pos: a.pos.clone().lerp(b.pos, s) };
      },
    };
  }

  updateWaterbag(t, S) {
    const wb = this.ensureWaterbag();
    const m = this.motion;
    const it = this.itemLocal(m, t);
    wb.position.copy(this.itemWorld(S, it.c));
    // 水袋方向：沿胸廓左右軸
    const R = S.R.clone(), U = S.U.clone(), F = S.F.clone();
    wb.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, F.negate()));
    // 水的晃動（預先模擬好的表格）
    const sl = this.slosh || (this.slosh = this.computeSlosh());
    const s = sl.at(t);
    const water = wb.userData.water;
    water.position.set(s.x, -0.02 - Math.abs(s.x) * 0.06, 0);
    water.scale.set(0.3 + Math.abs(s.v) * 0.08, 0.055 + Math.abs(s.v) * 0.01, 0.068);
    water.rotation.z = -s.v * 0.35;
  }

  computeSlosh() {
    // 水袋中水的質心沿管子方向的彈簧阻尼模型，受管子沿軸向的加速度驅動
    const m = this.motion;
    const dt = 1 / 240;
    const t0 = m.start, t1 = m.duration;
    const axisPos = (tt) => {
      const pose = poseAt(m, tt);
      this.applyHoldIK(pose, m, tt);
      const S = solveSkeleton(pose);
      const it = this.itemLocal(m, tt);
      const c = this.itemWorld(S, it.c);
      return { c, R: S.R.clone() };
    };
    const samples = [];
    let x = 0, v = 0;
    let prev = axisPos(t0), prevV = V();
    for (let tt = t0; tt <= t1 + dt; tt += dt) {
      const cur = axisPos(tt);
      const vel = cur.c.clone().sub(prev.c).multiplyScalar(1 / dt);
      const acc = vel.clone().sub(prevV).multiplyScalar(1 / dt);
      const aAxis = acc.dot(cur.R) + (-9.8) * cur.R.y;
      const k = 28, c = 3.2;
      const ax = -k * x - c * v - aAxis * 0.03;
      v += ax * dt; x += v * dt;
      x = Math.max(-0.25, Math.min(0.25, x));
      samples.push({ t: tt, x, v });
      prev = cur; prevV = vel;
    }
    return {
      at: (tt) => {
        const i = Math.max(0, Math.min(samples.length - 1, Math.round((tt - t0) / dt)));
        return samples[i];
      },
    };
  }
}
