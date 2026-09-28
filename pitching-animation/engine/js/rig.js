// 3D 投手骨架與外型
// 座標：Y 向上、+X 朝本壘、+Z 為三壘側（右投手的手臂側 / 攝影機側）
// yaw：0 = 面向本壘，-90 = 面向三壘（右投固定式準備姿勢）
import * as THREE from '../vendor/three.module.js';

const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y_UP = V(0, 1, 0);

// 1.83 m 選手的人體比例（Drillis & Contini 標準比例）
export const DIM = {
  hipHalf: 0.09, thigh: 0.45, shank: 0.445, ankleH: 0.07,
  ballFwd: 0.145, heelBack: 0.075, toeLen: 0.075,
  sp1: 0.10, sp2: 0.20, sp3: 0.23,
  shHalf: 0.19, shDrop: 0.04,
  neck: 0.09, headR: 0.108,
  upperArm: 0.30, foreArm: 0.265,
};

export const DEFAULT_COLORS = {
  jersey: '#F3EFE7', trim: '#FE7F2D', pants: '#D9D4CA', belt: '#233D4D',
  sock: '#FE7F2D', shoe: '#1D2A34', sole: '#EDEDED', skin: '#D8A27C',
  cap: '#233D4D', brim: '#1A2D3A', glove: '#8A5630', gloveLace: '#5E3A1F',
};

// ───────────────────────── 向量小工具 ─────────────────────────
const tmpQ = new THREE.Quaternion();
function quatYZX(x, y, z) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YZX')); }
function rotAround(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }

// 由姿勢參數求出所有關節位置與軀幹座標系
export function solveSkeleton(p) {
  const S = {};
  // 骨盆：yaw 繞世界 Y；tilt 前傾；roll 向手套側（左）側傾為正
  const qP = quatYZX(-(p.pel.roll || 0) * DEG, p.pel.yaw * DEG, -(p.pel.tilt || 0) * DEG);
  const P0 = V(p.pel.x, p.pel.y, p.pel.z);
  // 腰椎、胸椎分配軀幹相對骨盆的扭轉/前屈/側彎
  const tw = (p.tr.twist || 0) * DEG, fl = (p.tr.flex || 0) * DEG, bd = (p.tr.bend || 0) * DEG;
  const qL = qP.clone().multiply(quatYZX(-bd * 0.40, tw * 0.30, -fl * 0.40));
  const qC = qL.clone().multiply(quatYZX(-bd * 0.60, tw * 0.70, -fl * 0.60));
  const P1 = P0.clone().add(V(-0.015, DIM.sp1, 0).applyQuaternion(qP));
  const P2 = P1.clone().add(V(0, DIM.sp2, 0).applyQuaternion(qL));
  const P3 = P2.clone().add(V(0.01, DIM.sp3, 0).applyQuaternion(qC));
  S.qP = qP; S.qL = qL; S.qC = qC; S.P0 = P0; S.P1 = P1; S.P2 = P2; S.P3 = P3;
  const F = V(1, 0, 0).applyQuaternion(qC), U = V(0, 1, 0).applyQuaternion(qC), R = V(0, 0, 1).applyQuaternion(qC);
  S.F = F; S.U = U; S.R = R;
  S.pF = V(1, 0, 0).applyQuaternion(qP); S.pR = V(0, 0, 1).applyQuaternion(qP); S.pU = V(0, 1, 0).applyQuaternion(qP);

  // ── 手臂（胸廓座標系內的角度）──
  S.rArm = solveArm(p.ra, +1, S);
  S.lArm = solveArm(p.la, -1, S);

  // ── 雙腳 ──
  const hipR = P0.clone().add(V(0, 0, DIM.hipHalf).applyQuaternion(qP));
  const hipL = P0.clone().add(V(0, 0, -DIM.hipHalf).applyQuaternion(qP));
  const ground = p.ground || (() => 0);
  S.rLeg = solveLeg(hipR, p.rf, p.rk || {}, ground);
  S.lLeg = solveLeg(hipL, p.lf, p.lk || {}, ground);

  // ── 頭：看向目標（本壘好球帶），轉動角度有生理限制 ──
  const N0 = P3.clone().add(U.clone().multiplyScalar(0.015));
  const N1 = N0.clone().add(V(0.025, DIM.neck, 0).applyQuaternion(qC));
  let look = p.head && p.head.look ? V(...p.head.look) : V(18.4, 0.9, 0);
  if (p.head && p.head.lookChest) look = P3.clone().add(V(F.x, 0, F.z).normalize().multiplyScalar(5)).setY(P3.y + 0.05);
  let d = look.clone().sub(N1).normalize();
  // 限制相對胸口的左右轉動
  const chestYaw = Math.atan2(-F.z, F.x);
  let yaw = Math.atan2(-d.z, d.x);
  let rel = wrapPi(yaw - chestYaw);
  const lim = 85 * DEG;
  rel = Math.max(-lim, Math.min(lim, rel));
  yaw = chestYaw + rel + ((p.head && p.head.yawOff) || 0) * DEG;
  const pitch = Math.max(-35 * DEG, Math.min(30 * DEG, Math.asin(d.y) + ((p.head && p.head.pitchOff) || 0) * DEG));
  const tilt = (U.z * Math.cos(yaw) + U.x * Math.sin(yaw)) * 0.45; // 跟著軀幹側傾一部分
  const qH = quatYZX(tilt, yaw, pitch);
  S.qH = qH; S.N0 = N0; S.N1 = N1;
  S.head = N1.clone().add(V(0.012, 0.10, 0).applyQuaternion(qH));
  return S;
}

function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

function solveArm(a, side, S) {
  const { F, U, R, P3, qC } = S;
  const abd = a.abd * DEG, hz = a.hz * DEG, er = a.er * DEG, ef = a.ef * DEG;
  const Rs = R.clone().multiplyScalar(side);
  // 肩胛骨：水平外展時後收、內收時前伸，舉高時略上提
  const retr = Math.max(-1, Math.min(1, -a.hz / 45));
  const sh = P3.clone()
    .add(V(0, -DIM.shDrop, side * DIM.shHalf).applyQuaternion(qC))
    .add(F.clone().multiplyScalar(-0.022 * retr))
    .add(U.clone().multiplyScalar(0.018 * Math.max(0, (a.abd - 95) / 60)));
  const lat = Rs.clone().multiplyScalar(Math.cos(hz)).add(F.clone().multiplyScalar(Math.sin(hz)));
  const h = U.clone().multiplyScalar(-Math.cos(abd)).add(lat.clone().multiplyScalar(Math.sin(abd))).normalize();
  const p0 = F.clone().multiplyScalar(Math.cos(hz)).sub(Rs.clone().multiplyScalar(Math.sin(hz))).normalize();
  const hx = h.clone().cross(p0);
  const p = p0.clone().multiplyScalar(Math.cos(er)).add(hx.multiplyScalar(side * Math.sin(er))).normalize();
  const elbow = sh.clone().add(h.clone().multiplyScalar(DIM.upperArm));
  const f = h.clone().multiplyScalar(Math.cos(ef)).add(p.clone().multiplyScalar(Math.sin(ef))).normalize();
  const wrist = elbow.clone().add(f.clone().multiplyScalar(DIM.foreArm));
  // 掌心方向：p×h（右手）/ h×p（左手），再依前臂旋前角度繞前臂轉
  let n = side > 0 ? p.clone().cross(h) : h.clone().cross(p);
  n.sub(f.clone().multiplyScalar(n.dot(f))).normalize();
  n = rotAround(n, f, side * (a.pro || 0) * DEG);
  // 手腕屈伸
  const wf = (a.wf || 0) * DEG;
  const hd = f.clone().multiplyScalar(Math.cos(wf)).add(n.clone().multiplyScalar(-Math.sin(wf))).normalize();
  const n2 = n.clone().multiplyScalar(Math.cos(wf)).add(f.clone().multiplyScalar(Math.sin(wf))).normalize();
  const hand = wrist.clone().add(hd.clone().multiplyScalar(0.075)).add(n2.clone().multiplyScalar(0.012));
  const ball = wrist.clone().add(hd.clone().multiplyScalar(0.085)).add(n2.clone().multiplyScalar(0.038));
  return { sh, elbow, wrist, hand, ball, h, f, hd, n: n2, p };
}

// 由目標位置反求手臂角度（用在雙手抱球、握水袋等姿勢）
export function armAnglesFromTarget(S, side, target, pole) {
  const { F, U, R, P3, qC } = S;
  const Rs = R.clone().multiplyScalar(side);
  const sh = P3.clone().add(V(0, -DIM.shDrop, side * DIM.shHalf).applyQuaternion(qC));
  const L1 = DIM.upperArm, L2 = DIM.foreArm;
  const toT = target.clone().sub(sh);
  let d = toT.length();
  const dn = toT.clone().normalize();
  d = Math.min(d, L1 + L2 - 1e-4);
  d = Math.max(d, Math.abs(L1 - L2) + 0.02);
  const aa = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
  const pp = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();
  const elbow = sh.clone().add(dn.clone().multiplyScalar(aa)).add(pp.multiplyScalar(hh));
  const wrist = sh.clone().add(dn.clone().multiplyScalar(d));
  const h = elbow.clone().sub(sh).normalize();
  const f = wrist.clone().sub(elbow).normalize();
  const abd = Math.acos(Math.max(-1, Math.min(1, -h.dot(U))));
  const hz = Math.atan2(h.dot(F), h.dot(Rs));
  const ef = Math.acos(Math.max(-1, Math.min(1, h.dot(f))));
  const p0 = F.clone().multiplyScalar(Math.cos(hz)).sub(Rs.clone().multiplyScalar(Math.sin(hz))).normalize();
  let pvec = f.clone().sub(h.clone().multiplyScalar(f.dot(h)));
  let er = 0;
  if (pvec.length() > 1e-4) {
    pvec.normalize();
    const hx = h.clone().cross(p0).multiplyScalar(side);
    er = Math.atan2(pvec.dot(hx), pvec.dot(p0));
  }
  return { abd: abd / DEG, hz: hz / DEG, er: er / DEG, ef: ef / DEG };
}

function solveLeg(hip, f, k, ground) {
  const yaw = (f.yaw || 0) * DEG, pitch = (f.pitch || 0) * DEG;
  const fw0 = V(Math.cos(yaw), 0, -Math.sin(yaw));
  const fw = fw0.clone().multiplyScalar(Math.cos(pitch)).add(V(0, -Math.sin(pitch), 0));
  const up = V(0, Math.cos(pitch), 0).add(fw0.clone().multiplyScalar(Math.sin(pitch)));
  const gy = ground(f.x, f.z);
  const ball = V(f.x, (f.y || 0) + gy, f.z);
  let ankle = ball.clone().sub(fw.clone().multiplyScalar(DIM.ballFwd)).add(up.clone().multiplyScalar(DIM.ankleH));
  // 膝蓋方向：腳尖方向 + 內外角度（kneeYaw>0 表示膝蓋往身體內側倒）
  const kyaw = (k.yaw || 0) * DEG, kup = (k.up || 0) * DEG;
  let horiz = rotAround(fw0, Y_UP, kyaw);
  let pole = horiz.clone().multiplyScalar(Math.cos(kup)).add(V(0, Math.sin(kup), 0)).normalize();
  if (k.pole) pole = V(...k.pole).normalize();
  const L1 = DIM.thigh, L2 = DIM.shank;
  const toA = ankle.clone().sub(hip);
  let d = toA.length();
  const dn = toA.clone().normalize();
  let reach = true;
  if (d > L1 + L2 - 1e-4) { d = L1 + L2 - 1e-4; reach = false; }
  d = Math.max(d, 0.12);
  const aa = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
  const pp = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();
  const knee = hip.clone().add(dn.clone().multiplyScalar(aa)).add(pp.multiplyScalar(hh));
  if (!reach) ankle = hip.clone().add(dn.clone().multiplyScalar(d));
  // 腳趾：著地時平貼地面
  const grounded = Math.max(0, Math.min(1, 1 - ((f.y || 0) - 0.004) / 0.03));
  const tw = fw.clone().lerp(fw0, grounded).normalize();
  const toe = ball.clone().add(tw.clone().multiplyScalar(DIM.toeLen));
  const heel = ball.clone().sub(fw.clone().multiplyScalar(DIM.ballFwd + DIM.heelBack)).add(up.clone().multiplyScalar(0.012));
  const kneeAng = Math.acos(Math.max(-1, Math.min(1, knee.clone().sub(hip).normalize().dot(ankle.clone().sub(knee).normalize())))) / DEG;
  return { hip, knee, ankle, ball, toe, heel, fw, up, fw0, tw, reach, kneeAng };
}

// ───────────────────────── 外型 ─────────────────────────
function latheLimb(profile, segs = 20) {
  // profile: [[s(0..1), r], ...]
  const pts = profile.map(([s, r]) => new THREE.Vector2(r, s));
  const g = new THREE.LatheGeometry(pts, segs);
  return g;
}

const UNIT_SPHERE = new THREE.SphereGeometry(1, 24, 16);

export class Pitcher {
  constructor(opts = {}) {
    this.colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
    this.group = new THREE.Group();
    this.parts = {};        // name -> [mesh...]
    this.mats = [];
    this.opacity = 1;
    this.castShadow = opts.castShadow !== false;
    const c = this.colors;
    const M = (color, part, extra = {}) => {
      const { rough, ...rest } = extra;
      const m = new THREE.MeshLambertMaterial({ color, ...rest });
      m.userData.part = part; m.userData.baseEmissive = new THREE.Color(0, 0, 0);
      this.mats.push(m);
      return m;
    };
    this.M = {
      jersey: M(c.jersey, 'trunk'), jerseyArmR: M(c.jersey, 'armR'), jerseyArmL: M(c.jersey, 'armL'),
      skinR: M(c.skin, 'armR', { rough: 0.55 }), skinL: M(c.skin, 'armL', { rough: 0.55 }), skinH: M(c.skin, 'head', { rough: 0.55 }),
      pantsR: M(c.pants, 'legR'), pantsL: M(c.pants, 'legL'), pelvis: M(c.pants, 'pelvis'),
      sockR: M(c.sock, 'legR'), sockL: M(c.sock, 'legL'),
      shoeR: M(c.shoe, 'footR', { rough: 0.45 }), shoeL: M(c.shoe, 'footL', { rough: 0.45 }),
      sole: M(c.sole, 'feet'), cap: M(c.cap, 'head', { rough: 0.5 }), brim: M(c.brim, 'head', { rough: 0.5 }),
      glove: M(c.glove, 'glove', { rough: 0.7 }), belt: M(c.belt, 'pelvis'), trim: M(c.trim, 'trunk'),
    };
    const mk = (geo, mat, part) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.castShadow; mesh.receiveShadow = false;
      this.group.add(mesh);
      (this.parts[part] = this.parts[part] || []).push(mesh);
      return mesh;
    };
    // 四肢（lathe 讓肌肉輪廓自然）
    const thighP = [[0, 0.083], [0.15, 0.086], [0.5, 0.074], [0.85, 0.062], [1, 0.058]];
    const shankP = [[0, 0.056], [0.2, 0.06], [0.35, 0.061], [0.7, 0.046], [1, 0.038]];
    const sockP = [[0, 0.047], [0.5, 0.042], [1, 0.037]];
    const uArmP = [[0, 0.052], [0.3, 0.05], [0.7, 0.043], [1, 0.04]];
    const fArmP = [[0, 0.039], [0.25, 0.042], [0.6, 0.034], [1, 0.027]];
    const sleeveP = [[0, 0.058], [0.55, 0.054], [1, 0.05]];
    this.limbs = {
      thighR: mk(latheLimb(thighP), this.M.pantsR, 'legR'), thighL: mk(latheLimb(thighP), this.M.pantsL, 'legL'),
      shankR: mk(latheLimb(shankP), this.M.pantsR, 'legR'), shankL: mk(latheLimb(shankP), this.M.pantsL, 'legL'),
      sockR: mk(latheLimb(sockP), this.M.sockR, 'legR'), sockL: mk(latheLimb(sockP), this.M.sockL, 'legL'),
      uArmR: mk(latheLimb(uArmP), this.M.skinR, 'armR'), uArmL: mk(latheLimb(uArmP), this.M.skinL, 'armL'),
      sleeveR: mk(latheLimb(sleeveP), this.M.jerseyArmR, 'armR'), sleeveL: mk(latheLimb(sleeveP), this.M.jerseyArmL, 'armL'),
      fArmR: mk(latheLimb(fArmP), this.M.skinR, 'armR'), fArmL: mk(latheLimb(fArmP), this.M.skinL, 'armL'),
      neck: mk(latheLimb([[0, 0.058], [0.6, 0.052], [1, 0.05]]), this.M.skinH, 'head'),
    };
    this.joints = {};
    const J = (name, r, mat, part) => { const m = mk(UNIT_SPHERE, mat, part); m.scale.setScalar(r); this.joints[name] = m; };
    J('kneeR', 0.059, this.M.pantsR, 'legR'); J('kneeL', 0.059, this.M.pantsL, 'legL');
    J('ankleR', 0.04, this.M.sockR, 'legR'); J('ankleL', 0.04, this.M.sockL, 'legL');
    J('elbowR', 0.041, this.M.skinR, 'armR'); J('elbowL', 0.041, this.M.skinL, 'armL');
    J('wristR', 0.028, this.M.skinR, 'armR'); J('wristL', 0.028, this.M.skinL, 'armL');
    J('shR', 0.058, this.M.jerseyArmR, 'armR'); J('shL', 0.058, this.M.jerseyArmL, 'armL');
    J('hipR', 0.084, this.M.pantsR, 'legR'); J('hipL', 0.084, this.M.pantsL, 'legL');
    // 手（右手握球、左手手套）
    this.handR = mk(UNIT_SPHERE, this.M.skinR, 'armR'); this.handR.scale.set(0.045, 0.028, 0.038);
    this.handL = mk(UNIT_SPHERE, this.M.skinL, 'armL'); this.handL.scale.set(0.045, 0.028, 0.038); this.handL.visible = false;
    this.gloveMesh = this.makeGlove(mk);
    // 鞋子
    this.shoes = { R: this.makeShoe(mk, this.M.shoeR, 'footR'), L: this.makeShoe(mk, this.M.shoeL, 'footL') };
    // 頭與帽子
    this.headMesh = mk(UNIT_SPHERE, this.M.skinH, 'head'); this.headMesh.scale.set(0.1, 0.112, 0.092);
    this.capGroup = new THREE.Group(); this.group.add(this.capGroup);
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.106, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), this.M.cap);
    capDome.scale.set(1.03, 0.92, 0.98); capDome.position.set(0, 0.018, 0); capDome.castShadow = this.castShadow;
    const brimShape = new THREE.CylinderGeometry(0.105, 0.105, 0.008, 28, 1, false, -Math.PI * 0.36, Math.PI * 0.72);
    const brim = new THREE.Mesh(brimShape, this.M.brim);
    brim.scale.set(1.0, 1, 1.0); brim.position.set(0.055, 0.012, 0); brim.rotation.set(0, Math.PI / 2, -0.12);
    brim.castShadow = this.castShadow;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), this.M.trim);
    button.position.set(0, 0.116, 0);
    this.capGroup.add(capDome, brim, button);
    (this.parts.head = this.parts.head || []).push(capDome, brim, button);
    // 軀幹（每格更新的放樣曲面）
    this.torso = this.makeTorso(mk);
    this.pose = null;
  }

  makeGlove(mk) {
    const g = new THREE.Group();
    const palm = new THREE.Mesh(UNIT_SPHERE, this.M.glove); palm.scale.set(0.105, 0.042, 0.082);
    const fingers = new THREE.Mesh(UNIT_SPHERE, this.M.glove); fingers.scale.set(0.085, 0.036, 0.075); fingers.position.set(0.1, 0.004, 0);
    const thumb = new THREE.Mesh(UNIT_SPHERE, this.M.glove); thumb.scale.set(0.055, 0.03, 0.032); thumb.position.set(0.03, 0.01, 0.075); thumb.rotation.y = -0.5;
    for (const m of [palm, fingers, thumb]) { m.castShadow = this.castShadow; g.add(m); }
    this.group.add(g);
    (this.parts.armL = this.parts.armL || []).push(palm, fingers, thumb);
    return g;
  }

  makeShoe(mk, mat, part) {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(UNIT_SPHERE, mat); upper.scale.set(0.125, 0.052, 0.048); upper.position.set(0.02, 0.045, 0);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.018, 0.092), this.M.sole); sole.position.set(0.005, 0.009, 0);
    const toe = new THREE.Mesh(UNIT_SPHERE, mat); toe.scale.set(0.06, 0.036, 0.046);
    const toeSole = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.085), this.M.sole);
    for (const m of [upper, sole, toe, toeSole]) { m.castShadow = this.castShadow; m.receiveShadow = false; }
    g.add(upper, sole); this.group.add(g, toe, toeSole);
    (this.parts[part] = this.parts[part] || []).push(upper, sole, toe, toeSole);
    return { g, toe, toeSole };
  }

  makeTorso(mk) {
    // 橫切面（半寬 a：左右，半深 b：前後，前後偏移 off），沿脊椎由下而上
    this.rings = [
      { s: -0.075, a: 0.150, b: 0.105, off: -0.012 },
      { s: 0.00, a: 0.172, b: 0.118, off: -0.01 },
      { s: 0.068, a: 0.164, b: 0.110, off: -0.006, col: 'pants' },
      { s: 0.074, a: 0.166, b: 0.112, off: -0.006, col: 'belt' },
      { s: 0.106, a: 0.160, b: 0.107, off: -0.004, col: 'belt' },
      { s: 0.112, a: 0.158, b: 0.106, off: -0.003, col: 'jersey' },
      { s: 0.17, a: 0.146, b: 0.100, off: 0.0 },
      { s: 0.27, a: 0.150, b: 0.108, off: 0.005 },
      { s: 0.36, a: 0.164, b: 0.118, off: 0.01 },
      { s: 0.44, a: 0.178, b: 0.118, off: 0.012 },
      { s: 0.49, a: 0.186, b: 0.106, off: 0.004 },
      { s: 0.525, a: 0.15, b: 0.085, off: -0.004 },
      { s: 0.545, a: 0.07, b: 0.058, off: 0.0 },
    ];
    this.ringN = 28;
    const nR = this.rings.length, nS = this.ringN;
    const pos = new Float32Array((nR * nS + 2) * 3);
    const idx = [];
    for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nS; j++) {
      const a = i * nS + j, b = i * nS + (j + 1) % nS, c2 = (i + 1) * nS + j, d = (i + 1) * nS + (j + 1) % nS;
      idx.push(a, b, c2, b, d, c2);      // 外側為正面（法線朝外）
    }
    const bot = nR * nS, top = nR * nS + 1;
    for (let j = 0; j < nS; j++) { idx.push(bot, (j + 1) % nS, j); idx.push(top, (nR - 1) * nS + j, (nR - 1) * nS + (j + 1) % nS); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    // 上半身球衣、下半身褲子：用頂點顏色區分
    const col = new Float32Array((nR * nS + 2) * 3);
    const cj = new THREE.Color(this.colors.jersey), cp = new THREE.Color(this.colors.pants), cb = new THREE.Color(this.colors.belt);
    for (let i = 0; i < nR; i++) for (let j = 0; j < nS; j++) {
      const r = this.rings[i];
      const cc = r.col === 'belt' ? cb : (r.col === 'pants' || r.s <= 0.0) ? cp : cj;
      col.set([cc.r, cc.g, cc.b], (i * nS + j) * 3);
    }
    col.set([cp.r, cp.g, cp.b], bot * 3); col.set([cj.r, cj.g, cj.b], top * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.userData.part = 'trunk'; mat.userData.baseEmissive = new THREE.Color(0, 0, 0);
    this.mats.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = this.castShadow; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    (this.parts.trunk = this.parts.trunk || []).push(mesh);
    return mesh;
  }

  setLimb(mesh, a, b) {
    const d = b.clone().sub(a);
    const len = d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(Y_UP, d.divideScalar(len || 1));
    mesh.scale.set(1, len, 1);
  }

  update(pose) {
    const S = solveSkeleton(pose);
    this.S = S;
    const L = this.limbs, J = this.joints;
    // 腿
    for (const [side, leg] of [['R', S.rLeg], ['L', S.lLeg]]) {
      this.setLimb(L['thigh' + side], leg.hip, leg.knee);
      this.setLimb(L['shank' + side], leg.knee, leg.ankle);
      const sockTop = leg.knee.clone().lerp(leg.ankle, 0.55);
      this.setLimb(L['sock' + side], sockTop, leg.ankle);
      J['knee' + side].position.copy(leg.knee);
      J['ankle' + side].position.copy(leg.ankle);
      J['hip' + side].position.copy(leg.hip);
      // 鞋：後腳掌段 + 腳趾段
      const sh = this.shoes[side];
      const mid = leg.ball.clone().sub(leg.fw.clone().multiplyScalar(0.095));
      const base = mid.clone().sub(leg.up.clone().multiplyScalar(0.0));
      sh.g.position.copy(base);
      const m = new THREE.Matrix4().makeBasis(leg.fw, leg.up, leg.fw.clone().cross(leg.up).normalize());
      sh.g.quaternion.setFromRotationMatrix(m);
      const tup = leg.tw.clone().cross(leg.fw0.clone().cross(Y_UP)).normalize().negate();
      const tupV = tup.y < 0 ? tup.negate() : tup;
      const m2 = new THREE.Matrix4().makeBasis(leg.tw, tupV, leg.tw.clone().cross(tupV).normalize());
      sh.toe.quaternion.setFromRotationMatrix(m2);
      sh.toe.position.copy(leg.ball.clone().add(leg.tw.clone().multiplyScalar(0.035)).add(tupV.clone().multiplyScalar(0.03)));
      sh.toeSole.quaternion.copy(sh.toe.quaternion);
      sh.toeSole.position.copy(leg.ball.clone().add(leg.tw.clone().multiplyScalar(0.035)).add(tupV.clone().multiplyScalar(0.008)));
    }
    // 手臂
    for (const [side, arm] of [['R', S.rArm], ['L', S.lArm]]) {
      const sleeveEnd = arm.sh.clone().lerp(arm.elbow, 0.55);
      this.setLimb(L['sleeve' + side], arm.sh, sleeveEnd);
      this.setLimb(L['uArm' + side], arm.sh, arm.elbow);
      this.setLimb(L['fArm' + side], arm.elbow, arm.wrist);
      J['sh' + side].position.copy(arm.sh.clone().add(arm.h.clone().multiplyScalar(0.02)));
      J['sh' + side].quaternion.setFromUnitVectors(Y_UP, arm.h);
      J['sh' + side].scale.set(0.056, 0.07, 0.056);
      J['elbow' + side].position.copy(arm.elbow);
      J['wrist' + side].position.copy(arm.wrist);
    }
    // 右手（握球的手）
    const ra = S.rArm;
    this.handR.position.copy(ra.hand);
    this.handR.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ra.hd, ra.n, ra.hd.clone().cross(ra.n).normalize()));
    // 手套（訓練動作時改成空手）
    const la = S.lArm;
    this.handL.position.copy(la.hand);
    this.handL.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(la.hd, la.n, la.hd.clone().cross(la.n).normalize()));
    this.gloveMesh.position.copy(la.wrist.clone().add(la.hd.clone().multiplyScalar(0.07)).add(la.n.clone().multiplyScalar(0.02)));
    this.gloveMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(la.hd, la.n, la.hd.clone().cross(la.n).normalize()));
    // 頸、頭
    this.setLimb(L.neck, S.N0, S.N1.clone().add(V(0, 0.02, 0).applyQuaternion(S.qH)));
    this.headMesh.position.copy(S.head);
    this.headMesh.quaternion.copy(S.qH);
    this.capGroup.position.copy(S.head);
    this.capGroup.quaternion.copy(S.qH);
    // 軀幹放樣
    this.updateTorso(S);
    return S;
  }

  updateTorso(S) {
    const pos = this.torso.geometry.attributes.position.array;
    const nS = this.ringN;
    // 脊椎曲線（Catmull-Rom），s 為沿脊椎的距離
    const pts = [S.P0.clone().add(V(0, -0.1, 0).applyQuaternion(S.qP)), S.P0, S.P1, S.P2, S.P3, S.P3.clone().add(S.U.clone().multiplyScalar(0.08))];
    const segLen = [0.1, DIM.sp1, DIM.sp2, DIM.sp3, 0.08];
    const cum = [0]; for (const l of segLen) cum.push(cum[cum.length - 1] + l);
    const spineAt = (s) => {
      const ss = s + 0.1;
      let i = 0; while (i < segLen.length - 1 && cum[i + 1] < ss) i++;
      const u = Math.max(0, Math.min(1, (ss - cum[i]) / segLen[i]));
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const u2 = u * u, u3 = u2 * u;
      return V(
        0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
        0.5 * ((2 * p1.z) + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3));
    };
    const q = new THREE.Quaternion();
    let k = 0;
    let botC = null, topC = null;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      // 方向：骨盆 → 腰椎 → 胸廓 逐步過渡（扭轉會在腰部自然呈現）
      const s = r.s;
      if (s <= 0.03) q.copy(S.qP);
      else if (s <= DIM.sp1 + 0.08) q.copy(S.qP).slerp(S.qL, (s - 0.03) / (DIM.sp1 + 0.05));
      else q.copy(S.qL).slerp(S.qC, Math.min(1, (s - DIM.sp1 - 0.08) / 0.2));
      const c = spineAt(Math.min(s, 0.62));
      const f = V(1, 0, 0).applyQuaternion(q), rr = V(0, 0, 1).applyQuaternion(q);
      c.add(f.clone().multiplyScalar(r.off));
      if (i === 0) botC = c.clone();
      if (i === this.rings.length - 1) topC = c.clone();
      for (let j = 0; j < nS; j++) {
        const th = (j / nS) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        // 超橢圓：胸口較方、腰部較圓
        const e = 2.6;
        const x = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / e), y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
        const p = c.clone().add(rr.clone().multiplyScalar(r.a * x)).add(f.clone().multiplyScalar(r.b * y));
        pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z;
      }
    }
    const bot = botC.add(V(0, -0.03, 0).applyQuaternion(S.qP));
    pos[k++] = bot.x; pos[k++] = bot.y; pos[k++] = bot.z;
    pos[k++] = topC.x; pos[k++] = topC.y; pos[k++] = topC.z;
    this.torso.geometry.attributes.position.needsUpdate = true;
    this.torso.geometry.computeVertexNormals();
    this.torso.geometry.computeBoundingSphere();
  }

  // 高亮某些部位（橘色發光），amount 0..1
  highlight(map) {
    const col = new THREE.Color('#FE7F2D');
    for (const m of this.mats) {
      const part = m.userData.part;
      let a = 0;
      for (const [k, v] of Object.entries(map || {})) {
        if (k === part || (k === 'legs' && (part === 'legR' || part === 'legL' || part === 'footR' || part === 'footL'))
          || (k === 'arms' && (part === 'armR' || part === 'armL'))) a = Math.max(a, v);
      }
      m.emissive.copy(col).multiplyScalar(a * 0.75);
    }
  }

  setGlove(on) { this.gloveMesh.visible = on; this.handL.visible = !on; }

  setOpacity(a) {
    this.opacity = a;
    for (const m of this.mats) {
      m.transparent = a < 0.999;
      m.opacity = a;
      m.depthWrite = a > 0.6;
    }
    this.group.visible = a > 0.003;
    this.group.traverse(o => { if (o.isMesh) o.castShadow = this.castShadow && a > 0.6; });
  }

  tint(color, amount) {
    // 把整個人染成某個顏色（例如錯誤示範用淡紅色）
    const c = new THREE.Color(color);
    for (const m of this.mats) {
      if (!m.userData.origColor) m.userData.origColor = m.color.clone();
      m.color.copy(m.userData.origColor).lerp(c, amount);
    }
  }
}
