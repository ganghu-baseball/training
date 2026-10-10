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
  sock: '#FE7F2D', shoe: '#1D2A34', sole: '#4B545B', skin: '#D8A27C',
  cap: '#233D4D', brim: '#1A2D3A', glove: '#8A5630', gloveDark: '#6A4023', gloveLace: '#4A2C16',
};

// ───────────────────────── 向量小工具 ─────────────────────────
const tmpQ = new THREE.Quaternion();
export function quatYZX(x, y, z) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YZX')); }
function rotAround(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }

// 由姿勢參數求出所有關節位置與軀幹座標系
export function solveSkeleton(p) {
  const S = {};
  // 骨盆：yaw 繞世界 Y；tilt 前傾；roll 向手套側（左）側傾為正
  const qP = quatYZX(-(p.pel.roll || 0) * DEG, p.pel.yaw * DEG, -(p.pel.tilt || 0) * DEG);
  // spin：繞骨盆自己的脊椎軸轉（身體前傾成 T 字時，骨盆「打開／關起來」用）
  if (p.pel.spin) qP.multiply(new THREE.Quaternion().setFromAxisAngle(Y_UP, p.pel.spin * DEG));
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
  // 頭跟著胸口（躺下、身體前傾時用）：只在胸口座標系內加上偏轉
  if (p.head && p.head.rel) {
    const qH = qC.clone().multiply(quatYZX(0, (p.head.yawOff || 0) * DEG, (p.head.pitchOff || 0) * DEG));
    S.qH = qH; S.N0 = N0; S.N1 = N1;
    S.head = N1.clone().add(V(0.012, 0.10, 0).applyQuaternion(qH));
    return S;
  }
  let look = p.head && p.head.look ? V(...p.head.look) : V(18.4, 0.9, 0);
  if (p.head && p.head.lookChest) look = P3.clone().add(V(F.x, 0, F.z).normalize().multiplyScalar(5)).setY(P3.y + 0.05);
  let d = look.clone().sub(N1).normalize();
  // 限制相對胸口的左右轉動
  const chestYaw = Math.atan2(-F.z, F.x);
  let yaw = Math.atan2(-d.z, d.x);
  let rel = wrapPi(yaw - chestYaw);
  const lim = ((p.head && p.head.lim) || 85) * DEG;
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
  // 手臂橫過身體超過 135° 時 atan2 會繞到負值，先接回來，避免肩胛骨位置突然跳到另一邊
  const hzw = a.hz < -135 ? a.hz + 360 : a.hz;
  const retr = Math.max(-1, Math.min(1, -hzw / 45));
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
  const yaw = (f.yaw || 0) * DEG;
  let pitch = (f.pitch || 0) * DEG;
  const fw0 = V(Math.cos(yaw), 0, -Math.sin(yaw));
  const gy = ground(f.x, f.z);
  const ball = V(f.x, (f.y || 0) + gy, f.z);
  const ankleAt = pc => ball.clone().add(fw0.clone().multiplyScalar(-DIM.ballFwd * Math.cos(pc) + DIM.ankleH * Math.sin(pc))).add(V(0, DIM.ballFwd * Math.sin(pc) + DIM.ankleH * Math.cos(pc), 0));
  // 腿打直還搆不到腳踝時，先把腳跟墊起來（繞前腳掌轉），讓小腿和鞋子不會分開
  // 差 2.5 cm 以內交給下面的微幅拉長（看不出來），超過才墊腳跟，兩者銜接連續、不會跳動
  const Lmax = DIM.thigh + DIM.shank + 0.025;
  if (ankleAt(pitch).distanceTo(hip) > Lmax) {
    // 找腳跟墊多高時腳踝最靠近髖部；搆得到就二分法找剛好搆到的角度，搆不到就停在最近的角度
    let best = pitch, bestD = 1e9;
    for (let i = 0; i <= 40; i++) { const pc = pitch + i * 2 * DEG, dd = ankleAt(pc).distanceTo(hip); if (dd < bestD) { bestD = dd; best = pc; } }
    if (bestD <= Lmax) {
      let lo = pitch, hi = best;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ankleAt(mid).distanceTo(hip) > Lmax) lo = mid; else hi = mid; }
      pitch = hi;
    } else pitch = best;
  }
  const fw = fw0.clone().multiplyScalar(Math.cos(pitch)).add(V(0, -Math.sin(pitch), 0));
  const up = V(0, Math.cos(pitch), 0).add(fw0.clone().multiplyScalar(Math.sin(pitch)));
  let ankle = ball.clone().sub(fw.clone().multiplyScalar(DIM.ballFwd)).add(up.clone().multiplyScalar(DIM.ankleH));
  // 膝蓋方向：腳尖方向 + 內外角度（kneeYaw>0 表示膝蓋往身體內側倒）
  const kyaw = (k.yaw || 0) * DEG, kup = (k.up || 0) * DEG;
  let horiz = rotAround(fw0, Y_UP, kyaw);
  let pole = horiz.clone().multiplyScalar(Math.cos(kup)).add(V(0, Math.sin(kup), 0)).normalize();
  if (k.pole) pole = V(...k.pole).normalize();
  let L1 = DIM.thigh, L2 = DIM.shank;
  const toA = ankle.clone().sub(hip);
  let d = toA.length();
  const dn = toA.clone().normalize();
  let reach = true;
  // 只差一點點（< 3.5 cm）時把腿微微拉長，腳踝仍接在鞋子上；差太多才真的搆不到
  const over = d - (L1 + L2 - 1e-4);
  if (over > 0 && over < 0.035) { const sc = (d + 1e-4) / (L1 + L2); L1 *= sc; L2 *= sc; }
  else if (over > 0) { d = L1 + L2 - 1e-4; reach = false; }
  d = Math.max(d, 0.12);
  const aa = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
  const pp = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();
  const knee = hip.clone().add(dn.clone().multiplyScalar(aa)).add(pp.multiplyScalar(hh));
  if (!reach) ankle = hip.clone().add(dn.clone().multiplyScalar(d));
  // 腳趾：著地時平貼地面
  const grounded = Math.max(0, Math.min(1, 1 - ((f.y || 0) - 0.004) / 0.03));
  const gToe = ground(f.x + fw0.x * DIM.toeLen, f.z + fw0.z * DIM.toeLen);
  const twG = fw0.clone().multiplyScalar(DIM.toeLen).add(V(0, gToe - gy, 0)).normalize();
  const tw = fw.clone().lerp(twG, grounded).normalize();
  const toe = ball.clone().add(tw.clone().multiplyScalar(DIM.toeLen));
  const heel = ball.clone().sub(fw.clone().multiplyScalar(DIM.ballFwd + DIM.heelBack)).add(up.clone().multiplyScalar(0.012));
  const kneeAng = Math.acos(Math.max(-1, Math.min(1, knee.clone().sub(hip).normalize().dot(ankle.clone().sub(knee).normalize())))) / DEG;
  return { hip, knee, ankle, ball, toe, heel, fw, up, fw0, tw, reach, kneeAng };
}

// ───────────────────────── 外型 ─────────────────────────
function latheLimb(profile, segs = 32) {
  // profile: [[s(0..1), r], ...]
  const pts = profile.map(([s, r]) => new THREE.Vector2(r, s));
  const g = new THREE.LatheGeometry(pts, segs);
  return g;
}

const UNIT_SPHERE = new THREE.SphereGeometry(1, 32, 22);

// ───────────────────────── 鞋子外型 ─────────────────────────
// 以前腳掌著地點為原點：x 往腳尖、y 往上、z 側向。依序為 x、半寬、鞋面高、鞋底離地（腳跟與鞋頭微翹）
const SHOE = [
  [-0.229, 0.012, 0.040, 0.016], [-0.224, 0.024, 0.058, 0.008], [-0.214, 0.032, 0.071, 0.003], [-0.195, 0.037, 0.080, 0.0],
  [-0.160, 0.039, 0.086, 0.0], [-0.120, 0.038, 0.083, 0.0], [-0.080, 0.039, 0.071, 0.0], [-0.040, 0.044, 0.059, 0.0],
  [-0.008, 0.047, 0.051, 0.0], [0.020, 0.046, 0.046, 0.0], [0.043, 0.042, 0.041, 0.001], [0.061, 0.035, 0.036, 0.003],
  [0.074, 0.025, 0.030, 0.006], [0.082, 0.013, 0.024, 0.010], [0.086, 0.004, 0.019, 0.013],
];
const smooth01 = u => { const s = Math.max(0, Math.min(1, u)); return s * s * (3 - 2 * s); };
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
function shoeSample(u) {
  // Catmull-Rom 內插（u: 0..SHOE.length-1）
  const n = SHOE.length, i = Math.min(n - 2, Math.floor(u)), t = u - i;
  const g = k => SHOE[Math.max(0, Math.min(n - 1, k))];
  const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
  return p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t));
}
function shoeGeometry(isSole) {
  const nR = 43, nS = 28, SOLE_T = 0.017;
  const pos = [], idx = [];
  const rings = [];
  for (let i = 0; i < nR; i++) {
    const [x, w, h, b] = shoeSample((i / (nR - 1)) * (SHOE.length - 1));
    const ring = [];
    for (let j = 0; j < nS; j++) {
      const th = (j / nS) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      let y, z;
      if (isSole) {
        // 薄鞋底：略寬於鞋面、邊緣圓角
        z = (w + 0.0035) * spow(c, 2 / 5);
        y = b + SOLE_T * 0.5 + SOLE_T * 0.5 * spow(sn, 2 / 5);
      } else {
        const e = sn < 0 ? 2 / 4 : 2 / 2.3;
        z = w * spow(c, e);
        y = (b + 0.006 + h) / 2 + (h - b - 0.006) / 2 * spow(sn, e);
      }
      ring.push(pos.length / 3); pos.push(x, y, z);
    }
    rings.push({ ring, x, b, h, w });
  }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nS; j++) {
    const a = rings[i].ring[j], bb = rings[i].ring[(j + 1) % nS], c2 = rings[i + 1].ring[j], d = rings[i + 1].ring[(j + 1) % nS];
    idx.push(a, c2, bb, bb, c2, d);
  }
  // 兩端封口
  for (const [ri, dir] of [[0, -1], [nR - 1, 1]]) {
    const r = rings[ri];
    const cy = isSole ? r.b + SOLE_T * 0.5 : (r.b + r.h) / 2;
    const ci = pos.length / 3; pos.push(r.x + dir * 0.002, cy, 0);
    for (let j = 0; j < nS; j++) {
      const a = r.ring[j], bb = r.ring[(j + 1) % nS];
      if (dir < 0) idx.push(ci, a, bb); else idx.push(ci, bb, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

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
      glove: M(c.glove, 'glove', { rough: 0.7 }), gloveDark: M(c.gloveDark, 'glove'), gloveLace: M(c.gloveLace, 'glove'), glovePatch: M(c.trim, 'glove'),
      belt: M(c.belt, 'pelvis'), trim: M(c.trim, 'trunk'),
    };
    const mk = (geo, mat, part) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.castShadow; mesh.receiveShadow = false;
      this.group.add(mesh);
      (this.parts[part] = this.parts[part] || []).push(mesh);
      return mesh;
    };
    // 四肢（lathe 讓肌肉輪廓自然）
    // 兩端略為收窄，讓關節球乾淨地包住接縫（避免鋸齒狀的交界）
    const thighP = [[0, 0.074], [0.07, 0.083], [0.17, 0.086], [0.5, 0.074], [0.85, 0.062], [0.95, 0.058], [1, 0.050]];
    const shankP = [[0, 0.049], [0.06, 0.057], [0.2, 0.06], [0.35, 0.061], [0.7, 0.046], [1, 0.038]];
    const sockP = [[0, 0.047], [0.5, 0.042], [1, 0.037]];
    const uArmP = [[0, 0.052], [0.3, 0.05], [0.7, 0.043], [0.92, 0.040], [1, 0.033]];
    const fArmP = [[0, 0.032], [0.08, 0.040], [0.25, 0.042], [0.6, 0.034], [0.93, 0.027], [1, 0.022]];
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
    J('ankleR', 0.036, this.M.sockR, 'legR'); J('ankleL', 0.036, this.M.sockL, 'legL');
    J('elbowR', 0.041, this.M.skinR, 'armR'); J('elbowL', 0.041, this.M.skinL, 'armL');
    J('wristR', 0.028, this.M.skinR, 'armR'); J('wristL', 0.028, this.M.skinL, 'armL');
    J('shR', 0.058, this.M.jerseyArmR, 'armR'); J('shL', 0.058, this.M.jerseyArmL, 'armL');
    J('hipR', 0.077, this.M.pantsR, 'legR'); J('hipL', 0.077, this.M.pantsL, 'legL');
    // 手（右手握球、左手手套）
    this.handR = this.makeHand(this.M.skinR, 'armR', +1);
    this.handL = this.makeHand(this.M.skinL, 'armL', -1); this.handL.visible = false;
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

  makeHand(mat, part, side) {
    // 手掌 + 微彎的四指 + 大拇指（局部：x 手指方向、y 掌心方向、z = x×y；右手大拇指在 +z）
    const g = new THREE.Group(), meshes = [];
    const add = (geo, pos, scale, quat) => {
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos); if (scale) m.scale.copy(scale); if (quat) m.quaternion.copy(quat);
      m.castShadow = this.castShadow; g.add(m); meshes.push(m); return m;
    };
    add(UNIT_SPHERE, V(-0.006, 0, 0), V(0.04, 0.02, 0.037));
    add(UNIT_SPHERE, V(0.036, 0.009, -side * 0.003), V(0.032, 0.017, 0.035), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.55));
    const a = V(-0.018, 0.008, side * 0.03), b = V(0.018, 0.022, side * 0.043);
    const d = b.clone().sub(a);
    add(new THREE.CapsuleGeometry(0.0115, d.length(), 4, 10), a.clone().add(b).multiplyScalar(0.5), null, new THREE.Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
    this.group.add(g);
    (this.parts[part] = this.parts[part] || []).push(...meshes);
    return g;
  }

  makeGlove(mk) {
    // 棒球手套（左手）：局部座標 x = 手指方向、y = 掌心（手套口袋）方向、z = 小指側；大拇指在 -z 側
    const g = new THREE.Group();
    const M = this.M, meshes = [];
    const add = (geo, mat, pos, quat, scale) => {
      const m = new THREE.Mesh(geo, mat);
      if (pos) m.position.copy(pos); if (quat) m.quaternion.copy(quat); if (scale) m.scale.copy(scale);
      m.castShadow = this.castShadow; g.add(m); meshes.push(m); return m;
    };
    const blob = (mat, pos, scale, rot) => add(UNIT_SPHERE, mat, pos, rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)) : null, scale);
    const capGeo = {};
    const seg = (a, b, r, mat) => {
      const d = b.clone().sub(a), len = d.length();
      const key = r.toFixed(4) + '_' + len.toFixed(4);
      const geo = capGeo[key] || (capGeo[key] = new THREE.CapsuleGeometry(r, len, 6, 14));
      return add(geo, mat, a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
    };
    // 手指：兩節，往口袋方向微彎
    const curl = (dir, deg) => dir.clone().applyAxisAngle(V(0, 0, 1), deg * DEG).normalize();
    const finger = (base, dir, L1, L2, r, c1, c2) => {
      const d1 = curl(dir, c1), j = base.clone().add(d1.multiplyScalar(L1));
      const d2 = curl(dir, c2), tip = j.clone().add(d2.multiplyScalar(L2));
      seg(base, j, r, M.glove); seg(j, tip, r * 0.96, M.glove);
      return tip;
    };
    // 手背主體與掌心
    blob(M.glove, V(-0.006, -0.004, 0.002), V(0.09, 0.036, 0.08));
    // 口袋（較深的皮革）
    blob(M.gloveDark, V(0.022, 0.021, -0.01), V(0.062, 0.013, 0.056));
    // 手套根部的厚墊
    blob(M.glove, V(-0.068, 0.006, 0.004), V(0.032, 0.032, 0.074));
    // 手背的腕帶 + 橘色小標
    blob(M.gloveDark, V(-0.05, -0.024, 0.006), V(0.018, 0.017, 0.062));
    blob(M.glovePatch, V(-0.05, -0.04, 0.012), V(0.01, 0.0035, 0.018));
    // 四根手指（食指靠大拇指）
    const tips = [];
    // 手套的手指很粗、彼此縫在一起，整體像一把張開的扇子
    const FZ = [-0.045, -0.0155, 0.0135, 0.041], L1 = [0.08, 0.086, 0.08, 0.068], L2 = [0.058, 0.064, 0.058, 0.05], FR = [0.0225, 0.023, 0.0225, 0.0215];
    for (let i = 0; i < 4; i++) {
      const dir = V(1, 0, (i - 1.5) * 0.04).normalize();
      tips.push(finger(V(0.035, 0.0, FZ[i]), dir, L1[i], L2[i], FR[i], 4, 16));
    }
    // 大拇指：斜向外張、往口袋彎
    const thumbTip = finger(V(-0.035, 0.004, -0.064), V(0.9, 0, -0.43).normalize(), 0.075, 0.056, 0.0215, 8, 24);
    // 網子：大拇指與食指之間（淺色皮革 + 深色橫條）
    // 網子：填滿大拇指與食指之間，上緣接近指尖高度
    const webC = V(0.105, 0.02, -0.088);
    blob(M.glove, webC, V(0.075, 0.011, 0.036), [0, -0.38, 0.18]);
    for (let k = -1; k <= 1; k++) {
      const c = webC.clone().add(V(k * 0.036, 0.008, k * 0.016));
      blob(M.gloveLace, c, V(0.006, 0.004, 0.03), [0, -0.42, 0.16]);
    }
    // 指尖之間的綁繩
    const lacePts = [thumbTip.clone(), ...tips].map(p => p.clone().add(V(0.004, 0.004, 0)));
    const laceGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lacePts.slice(1)), 24, 0.0035, 6, false);
    add(laceGeo, M.gloveLace);
    for (const t of tips) blob(M.gloveLace, t.clone().add(V(0.012, 0.002, 0)), V(0.006, 0.006, 0.012));
    // 根部綁繩
    for (let k = 0; k < 5; k++) blob(M.gloveLace, V(-0.09, 0.012, -0.04 + k * 0.022), V(0.004, 0.005, 0.008));
    this.group.add(g);
    (this.parts.armL = this.parts.armL || []).push(...meshes);
    return g;
  }

  makeShoe(mk, mat, part) {
    // 一整隻鞋（鞋面 + 薄鞋底）。頂點每格依「後腳掌／腳趾」兩段座標系變形，在前腳掌處自然彎折
    const upper = new THREE.Mesh(shoeGeometry(false), mat);
    const sole = new THREE.Mesh(shoeGeometry(true), this.M.sole);
    for (const m of [upper, sole]) {
      m.castShadow = this.castShadow; m.receiveShadow = false; m.frustumCulled = false;
      m.userData.rest = Float32Array.from(m.geometry.attributes.position.array);
      this.group.add(m);
    }
    (this.parts[part] = this.parts[part] || []).push(upper, sole);
    return { upper, sole };
  }

  skinShoe(sh, leg) {
    const lat = leg.fw.clone().cross(leg.up).normalize();
    let tup = leg.tw.clone().cross(leg.fw0.clone().cross(Y_UP)).normalize().negate();
    if (tup.y < 0) tup.negate();
    const lat2 = leg.tw.clone().cross(tup).normalize();
    const b = leg.ball, fw = leg.fw, up = leg.up, tw = leg.tw;
    for (const m of [sh.upper, sh.sole]) {
      const R = m.userData.rest, P = m.geometry.attributes.position.array;
      for (let i = 0; i < R.length; i += 3) {
        const x = R[i], y = R[i + 1], z = R[i + 2];
        const w = smooth01((x + 0.022) / 0.034);
        const ax = b.x + fw.x * x + up.x * y + lat.x * z, ay = b.y + fw.y * x + up.y * y + lat.y * z, az = b.z + fw.z * x + up.z * y + lat.z * z;
        const bx = b.x + tw.x * x + tup.x * y + lat2.x * z, by = b.y + tw.y * x + tup.y * y + lat2.y * z, bz = b.z + tw.z * x + tup.z * y + lat2.z * z;
        P[i] = ax + (bx - ax) * w; P[i + 1] = ay + (by - ay) * w; P[i + 2] = az + (bz - az) * w;
      }
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
  }

  makeTorso(mk) {
    // 橫切面（半寬 a：左右，半深 b：前後，前後偏移 off），沿脊椎由下而上
    this.rings = [
      { s: -0.118, a: 0.050, b: 0.050, off: -0.02 },
      { s: -0.102, a: 0.088, b: 0.066, off: -0.022 },
      { s: -0.08, a: 0.114, b: 0.082, off: -0.02 },
      { s: -0.055, a: 0.134, b: 0.098, off: -0.016 },
      { s: -0.03, a: 0.150, b: 0.108, off: -0.013 },
      { s: 0.00, a: 0.170, b: 0.118, off: -0.01 },
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
    this.ringN = 56;
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
      // 鞋：整隻鞋依腳掌、腳趾兩段變形
      this.skinShoe(this.shoes[side], leg);
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
      const tr = a < 0.999;
      // 切換透明與否會改變 shader（不透明時 alpha 固定為 1），必須標記重新編譯
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
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
