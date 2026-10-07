// Q 版（大頭、短手短腳）卡通球員：卡通著色（toon）＋黑色描邊
// 骨架仍用一般比例求解（所有既有動作都能直接用），再以「錨點等比縮放」轉成小朋友的身形，
// 頭、手、鞋、四肢粗細另外放大，做出可愛的比例。
import * as THREE from '../vendor/three.module.js';
import { solveSkeleton } from './rig.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y_UP = V(0, 1, 0);

export const CHIBI_K = 0.62;   // 上半身（含手臂、球棒）縮放比例
export const CHIBI_KL = 0.5;   // 腿的縮放比例（比上半身更短，做出 Q 版短腿）
export const CHIBI_COLORS = {
  jersey: '#F7F4EC', trim: '#FE7F2D', pants: '#E4E0D6', belt: '#233D4D', sock: '#FE7F2D',
  shoe: '#233D4D', sole: '#F4F1EA', skin: '#F4C7A1', blush: '#F59A8B', hair: '#3B2A22', eye: '#1A1C24',
  helmet: '#233D4D', cap: '#233D4D', brim: '#1A2D3A', glove: '#B5722F', gloveDark: '#8A5225', number: '#233D4D',
};

// 主題（要在建立任何角色之前設定）：明暗階數、描邊顏色與粗細
const THEME = { gradient: [90, 175, 255], outline: '#141c22', width: 0.009 };
export function setChibiTheme(o) { Object.assign(THEME, o); if (o.colors) Object.assign(CHIBI_COLORS, o.colors); }

// 多階明暗的漸層貼圖（卡通著色）
let GRADIENT = null;
function gradientMap() {
  if (GRADIENT) return GRADIENT;
  const data = new Uint8Array(THEME.gradient.flatMap(v => [v, v, v, 255]));
  GRADIENT = new THREE.DataTexture(data, THEME.gradient.length, 1, THREE.RGBAFormat);
  GRADIENT.minFilter = GRADIENT.magFilter = THREE.NearestFilter;
  GRADIENT.generateMipmaps = false; GRADIENT.needsUpdate = true;
  return GRADIENT;
}

// 描邊：沿法線（在視角空間）往外推的背面黑色殼
let OUTLINE = null;
function outlineMaterial() {
  if (OUTLINE) return OUTLINE;
  OUTLINE = new THREE.ShaderMaterial({
    uniforms: { width: { value: THEME.width }, color: { value: new THREE.Color(THEME.outline) } },
    vertexShader: `uniform float width;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * width; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; void main(){ gl_FragColor = vec4(color,1.0); }`,
    side: THREE.BackSide,
  });
  return OUTLINE;
}

// Q 版轉換：腿與骨盆位置以錨點縮放 kL；骨盆以上（軀幹、頭、手臂、球棒）以骨盆為中心縮放 k
//   腿：p' = A + kL (p − A) + off
//   上半身：p' = P0' + k (p − P0)，P0 為一般比例的骨盆位置
export function xformLeg(p, T) {
  return V(T.A.x + T.kL * (p.x - T.A.x) + T.off.x, T.A.y + T.kL * (p.y - T.A.y) + T.off.y, T.A.z + T.kL * (p.z - T.A.z) + T.off.z);
}
export function xformUpper(p, P0, T) {
  const P0n = xformLeg(P0, T);
  return P0n.add(p.clone().sub(P0).multiplyScalar(T.k));
}
export function invXformUpper(p, P0, T) {
  const P0n = xformLeg(P0, T);
  return P0.clone().add(p.clone().sub(P0n).multiplyScalar(1 / T.k));
}
// 相容舊名稱
export const xformPoint = (p, T, P0) => P0 ? xformUpper(p, P0, T) : xformLeg(p, T);
export function xformSkeleton(S, T) {
  const P0 = S.P0;
  const U = p => xformUpper(p, P0, T), Lg = p => xformLeg(p, T);
  const arm = a => ({ ...a, sh: U(a.sh), elbow: U(a.elbow), wrist: U(a.wrist), hand: U(a.hand), ball: U(a.ball) });
  // 腿：髖關節跟著上半身（接在骨盆上），膝、踝、腳掌以腿的比例
  const leg = l => {
    const hip = U(l.hip), ankle = Lg(l.ankle), ball = Lg(l.ball), toe = Lg(l.toe), heel = Lg(l.heel);
    // 膝蓋：依原本的屈膝方向，重新以兩段等長求位置
    const kneeA = Lg(l.knee);
    const d = ankle.distanceTo(hip), seg = (l.hip.distanceTo(l.knee) + l.knee.distanceTo(l.ankle)) * 0.5 * T.kL;
    const mid = hip.clone().lerp(ankle, 0.5), axis = ankle.clone().sub(hip).normalize();
    let pole = kneeA.clone().sub(mid); pole.sub(axis.clone().multiplyScalar(pole.dot(axis)));
    if (pole.lengthSq() < 1e-8) pole = V(0, 0, 0.001);
    pole.normalize();
    const hh = Math.sqrt(Math.max(0, seg * seg - (d / 2) * (d / 2)));
    const knee = mid.add(pole.multiplyScalar(hh));
    return { ...l, hip, knee, ankle, ball, toe, heel };
  };
  return { ...S, P0: Lg(P0), P1: U(S.P1), P2: U(S.P2), P3: U(S.P3), N0: U(S.N0), N1: U(S.N1), head: U(S.head),
    rArm: arm(S.rArm), lArm: arm(S.lArm), rLeg: leg(S.rLeg), lLeg: leg(S.lLeg), k: T.k, P0a: P0.clone() };
}

// 給其他道具（球棒、握拳、頭盔）用的卡通材質與描邊
export function toonMat(color, part, extra = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });
  m.userData.part = part; return m;
}
export function addOutlines(obj, list, width = 1) {
  const meshes = []; obj.traverse(o => { if (o.isMesh && o.material !== OUTLINE) meshes.push(o); });
  for (const m of meshes) { const o = new THREE.Mesh(m.geometry, outlineMaterial()); o.castShadow = false; m.add(o); if (list) list.push(o); }
}

const SPH = new THREE.SphereGeometry(1, 28, 20);
// 四肢：沿 Y 從 0 到 1 的旋轉體，半徑是實際尺寸（只沿長度方向縮放），兩端收圓
function limbGeo(r0, r1, round = 0.35) {
  const pts = [], n = 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(r0 * Math.sin(a) + 1e-4, -r0 * round * Math.cos(a) * 0.0 + 0)); }
  const prof = [[0, r0 * 0.55], [0.05, r0 * 0.92], [0.14, r0], [0.86, r1], [0.95, r1 * 0.92], [1, r1 * 0.55]];
  return new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 22);
}

export class Chibi {
  constructor(opts = {}) {
    this.colors = { ...CHIBI_COLORS, ...(opts.colors || {}) };
    this.group = new THREE.Group();
    this.parts = {}; this.mats = []; this.outlines = [];
    this.opacity = 1;
    this.castShadow = opts.castShadow !== false;
    this.HR = opts.headR || 0.17;
    this.number = opts.number ?? 7;
    const c = this.colors;
    const M = (color, part, extra = {}) => {
      const m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });
      m.userData.part = part; this.mats.push(m); return m;
    };
    this.M = {
      jersey: M(c.jersey, 'trunk'), jerseyArmR: M(c.jersey, 'armR'), jerseyArmL: M(c.jersey, 'armL'), trim: M(c.trim, 'trunk'),
      skinR: M(c.skin, 'armR'), skinL: M(c.skin, 'armL'), skinH: M(c.skin, 'head'),
      pantsR: M(c.pants, 'legR'), pantsL: M(c.pants, 'legL'), sockR: M(c.sock, 'legR'), sockL: M(c.sock, 'legL'),
      shoeR: M(c.shoe, 'footR'), shoeL: M(c.shoe, 'footL'), soleR: M(c.sole, 'footR'), soleL: M(c.sole, 'footL'),
      hair: M(c.hair, 'head'), eye: new THREE.MeshBasicMaterial({ color: c.eye }), white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      blush: new THREE.MeshBasicMaterial({ color: c.blush, transparent: true, opacity: 0.55, depthWrite: false }),
      cap: M(c.cap, 'head'), brim: M(c.brim, 'head'), glove: M(c.glove, 'armL'), gloveDark: M(c.gloveDark, 'armL'),
    };
    for (const k of ['eye', 'white', 'blush']) { this.M[k].userData.part = 'face'; this.mats.push(this.M[k]); }
    const mk = (geo, mat, part, outline = true, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat); m.castShadow = this.castShadow; parent.add(m);
      (this.parts[part] = this.parts[part] || []).push(m);
      if (outline) { const o = new THREE.Mesh(geo, outlineMaterial()); o.castShadow = false; m.add(o); this.outlines.push(o); }
      return m;
    };
    this.mk = mk;
    // 四肢（兩端收圓的旋轉體，關節處再補球）
    const L = {};
    const G = { thigh: limbGeo(0.078, 0.068), shank: limbGeo(0.066, 0.058), sock: limbGeo(0.056, 0.05), uArm: limbGeo(0.05, 0.046),
      sleeve: limbGeo(0.064, 0.06), fArm: limbGeo(0.047, 0.043) };
    L.thighR = mk(G.thigh, this.M.pantsR, 'legR'); L.thighL = mk(G.thigh, this.M.pantsL, 'legL');
    L.shankR = mk(G.shank, this.M.pantsR, 'legR'); L.shankL = mk(G.shank, this.M.pantsL, 'legL');
    L.sockR = mk(G.sock, this.M.sockR, 'legR'); L.sockL = mk(G.sock, this.M.sockL, 'legL');
    L.uArmR = mk(G.uArm, this.M.skinR, 'armR'); L.uArmL = mk(G.uArm, this.M.skinL, 'armL');
    L.sleeveR = mk(G.sleeve, this.M.jerseyArmR, 'armR'); L.sleeveL = mk(G.sleeve, this.M.jerseyArmL, 'armL');
    L.trimR = mk(new THREE.TorusGeometry(1, 0.12, 8, 24), this.M.trim, 'armR', false); L.trimL = mk(new THREE.TorusGeometry(1, 0.12, 8, 24), this.M.trim, 'armL', false);
    L.fArmR = mk(G.fArm, this.M.skinR, 'armR'); L.fArmL = mk(G.fArm, this.M.skinL, 'armL');
    this.limbs = L;
    const J = {};
    for (const s of ['R', 'L']) {
      J['knee' + s] = mk(SPH, this.M['pants' + s], 'leg' + s, false);
      J['elbow' + s] = mk(SPH, this.M['skin' + s], 'arm' + s, false);
      J['sh' + s] = mk(SPH, this.M['jerseyArm' + s], 'arm' + s, true);
      J['hip' + s] = mk(SPH, this.M['pants' + s], 'leg' + s, false);
    }
    this.joints = J;
    // 手（右手握球、左手手套；打者另外用握拳）
    this.handR = mk(SPH, this.M.skinR, 'armR'); this.handL = mk(SPH, this.M.skinL, 'armL'); this.handL.visible = false;
    this.gloveMesh = this.makeGlove();
    // 鞋
    this.shoes = { R: this.makeShoe('R'), L: this.makeShoe('L') };
    // 頭、臉、頭髮、帽子
    this.headGroup = new THREE.Group(); this.group.add(this.headGroup);
    this.makeHead();
    this.capGroup = new THREE.Group(); this.headGroup.add(this.capGroup);
    this.makeCap();
    // 軀幹
    this.torso = this.makeTorso();
  }

  // 握棒的卡通拳頭（局部 z = 沿球棒、x = 由手腕往指節、原點在球棒軸上）
  makeMitt(side) {
    const g = new THREE.Group(); this.group.add(g);
    const part = side > 0 ? 'armR' : 'armL', mat = side > 0 ? this.M.skinR : this.M.skinL;
    const palm = this.mk(SPH, mat, part, true, g); palm.scale.set(0.05, 0.046, 0.048); palm.position.set(-0.012, 0, 0);
    const thumb = this.mk(SPH, mat, part, true, g); thumb.scale.set(0.02, 0.018, 0.026); thumb.position.set(-0.02, side * 0.04, 0.034);
    return g;
  }

  makeGlove() {
    // 大大的卡通手套：局部 x = 手指方向、y = 口袋方向、z = 小指側
    const g = new THREE.Group(); this.group.add(g);
    const add = (geo, mat, pos, scale) => { const m = this.mk(geo, mat, 'armL', true, g); m.position.copy(pos); m.scale.copy(scale); return m; };
    add(SPH, this.M.glove, V(0.02, 0, 0), V(0.085, 0.04, 0.075));
    add(SPH, this.M.gloveDark, V(0.035, 0.026, -0.005), V(0.055, 0.012, 0.05));
    for (let i = 0; i < 4; i++) add(SPH, this.M.glove, V(0.1, 0.0, -0.045 + i * 0.03), V(0.045, 0.026, 0.017));
    add(SPH, this.M.glove, V(0.03, 0.0, -0.075), V(0.05, 0.026, 0.022));
    add(SPH, this.M.gloveDark, V(-0.055, -0.005, 0), V(0.03, 0.035, 0.06));
    return g;
  }

  makeShoe(side) {
    const g = new THREE.Group(); this.group.add(g);
    const body = this.mk(SPH, this.M['shoe' + side], 'foot' + side, true, g); body.scale.set(0.11, 0.06, 0.068); body.position.set(0.02, 0.05, 0);
    const sole = this.mk(SPH, this.M['sole' + side], 'foot' + side, true, g); sole.scale.set(0.118, 0.024, 0.072); sole.position.set(0.02, 0.014, 0);
    const lace = this.mk(SPH, this.M.trim, 'foot' + side, false, g); lace.scale.set(0.045, 0.014, 0.04); lace.position.set(0.06, 0.098, 0);
    return g;
  }

  makeHead() {
    const H = this.HR, g = this.headGroup, mk = (geo, mat, part, ol) => this.mk(geo, mat, part, ol, g);
    const head = mk(SPH, this.M.skinH, 'head', true); head.scale.set(H * 1.0, H * 0.94, H * 1.02);
    this.headMesh = head;
    // 頭髮（後腦與鬢角，帽子蓋住頂部）
    const hair = mk(SPH, this.M.hair, 'head', true); hair.scale.set(H * 0.93, H * 0.88, H * 0.99); hair.position.set(-H * 0.16, H * 0.14, 0);
    // 耳朵
    for (const z of [-1, 1]) { const e = mk(SPH, this.M.skinH, 'head', true); e.scale.set(H * 0.16, H * 0.22, H * 0.1); e.position.set(-H * 0.02, -H * 0.05, z * H * 0.99); }
    // 大眼睛（黑色橢圓 + 白色亮點）
    this.eyes = [];
    const soft = THEME.face === 'soft';   // 手繪風格：圓一點的眼睛、大一點的亮點、細眉毛
    for (const z of [-1, 1]) {
      const e = mk(SPH, this.M.eye, 'face', false);
      if (soft) { e.scale.set(H * 0.08, H * 0.235, H * 0.2); e.position.set(H * 0.92, -H * 0.07, z * H * 0.37); }
      else { e.scale.set(H * 0.07, H * 0.24, H * 0.16); e.position.set(H * 0.93, -H * 0.04, z * H * 0.36); }
      e.rotation.y = -z * 0.36;
      const w = mk(SPH, this.M.white, 'face', false);
      if (soft) { w.scale.set(H * 0.045, H * 0.08, H * 0.075); w.position.set(H * 0.975, H * 0.02, z * H * 0.35 - H * 0.05); }
      else { w.scale.set(H * 0.04, H * 0.075, H * 0.06); w.position.set(H * 0.97, H * 0.06, z * H * 0.33 - H * 0.04); }
      const w2 = mk(SPH, this.M.white, 'face', false); w2.scale.set(H * 0.03, H * 0.035, H * 0.035); w2.position.set(H * 0.98, soft ? -H * 0.15 : -H * 0.12, z * H * 0.41);
      (this.eyeParts = this.eyeParts || []).push(e, w, w2);
      const b = mk(SPH, this.M.blush, 'face', false); b.scale.set(H * 0.04, H * 0.07, H * 0.13); b.position.set(H * 0.86, -H * 0.3, z * H * 0.56); b.rotation.y = -z * 0.6;
      const brow = mk(new THREE.CapsuleGeometry(H * (soft ? 0.02 : 0.035), H * (soft ? 0.17 : 0.2), 4, 8), this.M.hair, 'face', false);
      brow.position.set(H * 0.9, H * (soft ? 0.27 : 0.3), z * H * 0.37); brow.rotation.set(Math.PI / 2 + z * 0.12, 0, 0); brow.rotation.order = 'YXZ'; brow.rotation.y = -z * 0.38;
      this.eyes.push(e);
    }
    // 嘴巴（小小的微笑）
    const mouth = mk(new THREE.TorusGeometry(H * 0.1, H * 0.022, 6, 16, Math.PI), this.M.eye, 'face', false);
    mouth.position.set(H * 0.94, -H * 0.38, 0); mouth.rotation.set(0, Math.PI / 2, Math.PI);
    this.mouth = mouth;
    if (soft) this.makeFaces(H);
  }

  // 表情：開心（^^ 眼、張嘴笑）、糟糕（>< 眼、o 嘴）
  makeFaces(H) {
    const g = this.headGroup, F = this.faces = { happy: [], oops: [] };
    const mouthM = new THREE.MeshBasicMaterial({ color: '#7c3a30', side: THREE.DoubleSide }); mouthM.userData.part = 'face'; this.mats.push(mouthM);
    const arcG = new THREE.TorusGeometry(H * 0.1, H * 0.027, 6, 14, Math.PI);
    const strokeLen = Math.hypot(0.11, 0.075) * H;
    const strokeG = new THREE.CapsuleGeometry(H * 0.024, strokeLen, 4, 8);
    for (const z of [-1, 1]) {
      const a = this.mk(arcG, this.M.eye, 'face', false, g); a.position.set(H * 0.95, -H * 0.13, z * H * 0.37); a.rotation.set(0, Math.PI / 2 - z * 0.36, 0);
      F.happy.push(a);
      const grp = new THREE.Group(); grp.position.set(H * 0.94, -H * 0.06, z * H * 0.37); grp.rotation.y = -z * 0.36; g.add(grp);
      for (const sy of [-1, 1]) {
        const st = this.mk(strokeG, this.M.eye, 'face', false, grp);
        const dz = z * 0.11 * H, dy = sy * 0.075 * H;       // 頂點在內側（靠鼻子），往外上／外下畫：>  <
        st.position.set(0, dy / 2, -z * 0.05 * H + dz / 2);
        st.rotation.x = Math.atan2(dz, dy);
        F.oops.push(st);
      }
    }
    F.mouthHappy = this.mk(new THREE.CircleGeometry(H * 0.1, 18, Math.PI, Math.PI), mouthM, 'face', false, g);
    F.mouthHappy.position.set(H * 0.965, -H * 0.33, 0); F.mouthHappy.rotation.y = Math.PI / 2;
    F.mouthO = this.mk(new THREE.TorusGeometry(H * 0.05, H * 0.02, 6, 16), this.M.eye, 'face', false, g);
    F.mouthO.position.set(H * 0.95, -H * 0.38, 0); F.mouthO.rotation.y = Math.PI / 2;
    this.faceKind = null; this.setFace('smile');
  }
  setFace(kind = 'smile') {
    if (!this.faces || this.faceKind === kind) return;
    this.faceKind = kind;
    const F = this.faces;
    for (const m of this.eyeParts) m.visible = kind === 'smile' || kind === 'surprise';
    for (const m of F.happy) m.visible = kind === 'happy';
    for (const m of F.oops) m.visible = kind === 'oops';
    this.mouth.visible = kind === 'smile';
    F.mouthHappy.visible = kind === 'happy';
    F.mouthO.visible = kind === 'oops' || kind === 'surprise';
  }

  // 打擊頭盔：比頭大一圈、亮面，面向投手那側有護耳
  makeHelmet(color = '#233D4D') {
    const H = this.HR, g = new THREE.Group(); this.headGroup.add(g);
    const shellM = toonMat(color, 'head'); this.mats.push(shellM);
    const darkM = toonMat('#101a22', 'head'); this.mats.push(darkM);
    const mk = (geo, mat, ol = true) => this.mk(geo, mat, 'head', ol, g);
    const dome = mk(new THREE.SphereGeometry(1, 30, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), shellM);
    dome.scale.set(H * 1.1, H * 0.98, H * 1.12); dome.position.set(-H * 0.05, H * 0.22, 0);
    const back = mk(new THREE.SphereGeometry(1, 24, 12, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.5, Math.PI * 0.2), shellM);
    back.scale.set(H * 1.1, H * 0.98, H * 1.12); back.position.set(-H * 0.05, H * 0.22, 0);
    const flap = mk(SPH, shellM); flap.scale.set(H * 0.44, H * 0.5, H * 0.16); flap.position.set(-H * 0.05, -H * 0.05, -H * 1.0);
    const hole = mk(SPH, darkM, false); hole.scale.set(H * 0.09, H * 0.09, H * 0.04); hole.position.set(-H * 0.05, -H * 0.02, -H * 1.15);
    const brim = mk(new THREE.CylinderGeometry(1, 1, 1, 28, 1, false, -Math.PI * 0.3, Math.PI * 0.6), shellM);
    brim.scale.set(H * 1.0, H * 0.06, H * 1.0); brim.position.set(H * 0.24, H * 0.25, 0); brim.rotation.set(0, Math.PI / 2, -0.22);
    const stripe = mk(new THREE.TorusGeometry(1, 0.035, 6, 40, Math.PI * 1.1), this.M.trim, false);
    stripe.scale.set(H * 1.08, H * 1.08, H * 1.08); stripe.position.set(-H * 0.05, H * 0.22, 0); stripe.rotation.set(0, 0, Math.PI * -0.05 + Math.PI * 0.5);
    stripe.rotation.order = 'ZYX';
    const logo = mk(SPH, this.M.trim, false); logo.scale.set(H * 0.2, H * 0.2, H * 0.05); logo.position.set(H * 0.05, H * 0.62, -H * 0.93);
    this.capGroup.visible = false;
    this.helmetGroup = g;
    return g;
  }

  makeCap() {
    // 一般球帽（打者會換成頭盔）
    const H = this.HR, g = this.capGroup, mk = (geo, mat, ol) => this.mk(geo, mat, 'head', ol, g);
    const dome = mk(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), this.M.cap, true);
    dome.scale.set(H * 1.07, H * 0.95, H * 1.08); dome.position.set(-H * 0.02, H * 0.2, 0);
    const brim = mk(new THREE.CylinderGeometry(1, 1, 1, 28, 1, false, -Math.PI * 0.32, Math.PI * 0.64), this.M.brim, true);
    brim.scale.set(H * 0.95, H * 0.06, H * 0.95); brim.position.set(H * 0.28, H * 0.22, 0); brim.rotation.set(0, Math.PI / 2, -0.18);
    const btn = mk(SPH, this.M.trim, false); btn.scale.setScalar(H * 0.09); btn.position.set(-H * 0.02, H * 1.14, 0);
    const logo = mk(SPH, this.M.trim, false); logo.scale.set(H * 0.05, H * 0.2, H * 0.2); logo.position.set(H * 0.93, H * 0.6, 0); logo.rotation.z = -0.6;
  }

  makeTorso() {
    // 圓滾滾的身體：沿脊椎放樣（每格更新），上衣／皮帶／褲子以頂點顏色區分
    this.rings = [
      { u: 0.0, a: 0.06, b: 0.05, col: 'pants' }, { u: 0.05, a: 0.115, b: 0.095, col: 'pants' }, { u: 0.14, a: 0.142, b: 0.112, col: 'pants' },
      { u: 0.26, a: 0.148, b: 0.118, col: 'pants' }, { u: 0.30, a: 0.15, b: 0.12, col: 'belt' }, { u: 0.37, a: 0.148, b: 0.118, col: 'belt' },
      { u: 0.39, a: 0.146, b: 0.117, col: 'jersey' }, { u: 0.52, a: 0.142, b: 0.116, col: 'jersey' }, { u: 0.68, a: 0.147, b: 0.116, col: 'jersey' },
      { u: 0.80, a: 0.146, b: 0.108, col: 'jersey' }, { u: 0.89, a: 0.128, b: 0.095, col: 'jersey' }, { u: 0.95, a: 0.092, b: 0.072, col: 'trim' },
      { u: 1.0, a: 0.05, b: 0.045, col: 'skin' },
    ];
    this.ringN = 40;
    const nR = this.rings.length, nS = this.ringN;
    const pos = new Float32Array((nR * nS + 2) * 3), idx = [], col = new Float32Array((nR * nS + 2) * 3);
    for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nS; j++) {
      const a = i * nS + j, b = i * nS + (j + 1) % nS, c2 = (i + 1) * nS + j, d = (i + 1) * nS + (j + 1) % nS;
      idx.push(a, b, c2, b, d, c2);
    }
    const bot = nR * nS, top = nR * nS + 1;
    for (let j = 0; j < nS; j++) { idx.push(bot, (j + 1) % nS, j); idx.push(top, (nR - 1) * nS + j, (nR - 1) * nS + (j + 1) % nS); }
    const C = k => new THREE.Color(this.colors[k] || this.colors.jersey);
    for (let i = 0; i < nR; i++) { const cc = C(this.rings[i].col); for (let j = 0; j < nS; j++) col.set([cc.r, cc.g, cc.b], (i * nS + j) * 3); }
    const cp = C('pants'), cs = C('skin');
    col.set([cp.r, cp.g, cp.b], bot * 3); col.set([cs.r, cs.g, cs.b], top * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
    mat.userData.part = 'trunk'; this.mats.push(mat);
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = this.castShadow; mesh.frustumCulled = false;
    this.group.add(mesh); (this.parts.trunk = this.parts.trunk || []).push(mesh);
    const o = new THREE.Mesh(g, outlineMaterial()); o.frustumCulled = false; mesh.add(o); this.outlines.push(o);
    // 胸前小圓牌、背號
    this.badge = this.mk(SPH, this.M.trim, 'trunk', false);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g2 = cv.getContext('2d');
    g2.font = '900 104px "Barlow Condensed", "Noto Sans TC", sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.lineWidth = 12; g2.strokeStyle = this.colors.trim; g2.strokeText(String(this.number ?? 7), 64, 70);
    g2.fillStyle = this.colors.number; g2.fillText(String(this.number ?? 7), 64, 70);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    nm.userData.part = 'trunk'; this.mats.push(nm);
    this.backNo = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), nm); this.group.add(this.backNo);
    return mesh;
  }

  setLimb(mesh, a, b) {
    const d = b.clone().sub(a), len = d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(Y_UP, d.divideScalar(len || 1));
    mesh.scale.set(1, Math.max(0.001, len), 1);
  }

  // pose：一般比例的姿勢；T：{A 錨點, k 縮放, off 位移}
  update(pose, T) {
    const S0 = solveSkeleton(pose);
    const S = xformSkeleton(S0, T);
    this.S = S;
    const L = this.limbs, J = this.joints;
    for (const [s, leg] of [['R', S.rLeg], ['L', S.lLeg]]) {
      this.setLimb(L['thigh' + s], leg.hip, leg.knee);
      this.setLimb(L['shank' + s], leg.knee, leg.ankle.clone().lerp(leg.knee, 0.4));
      this.setLimb(L['sock' + s], leg.knee.clone().lerp(leg.ankle, 0.5), leg.ankle);
      J['knee' + s].position.copy(leg.knee); J['knee' + s].scale.setScalar(0.066);
      J['hip' + s].position.copy(leg.hip); J['hip' + s].scale.setScalar(0.076);
      // 鞋：以腳掌方向擺放（含腳跟抬起）
      const sh = this.shoes[s];
      const fw = leg.fw.clone().normalize(), up = leg.up.clone().normalize(), side = fw.clone().cross(up).normalize();
      sh.position.copy(leg.ball).sub(fw.clone().multiplyScalar(0.05)).add(up.clone().multiplyScalar(-0.012));
      sh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fw, up, side));
    }
    for (const [s, arm] of [['R', S.rArm], ['L', S.lArm]]) {
      this.setLimb(L['uArm' + s], arm.sh, arm.elbow);
      const sl = arm.sh.clone().lerp(arm.elbow, 0.55);
      this.setLimb(L['sleeve' + s], arm.sh.clone().sub(arm.h.clone().multiplyScalar(0.01)), sl);
      const tr = L['trim' + s]; tr.position.copy(sl); tr.quaternion.setFromUnitVectors(V(0, 0, 1), arm.h); tr.scale.setScalar(0.062);
      this.setLimb(L['fArm' + s], arm.elbow, arm.wrist);
      J['elbow' + s].position.copy(arm.elbow); J['elbow' + s].scale.setScalar(0.047);
      J['sh' + s].position.copy(arm.sh.clone().add(arm.h.clone().multiplyScalar(0.012))); J['sh' + s].scale.setScalar(0.066);
    }
    const ra = S.rArm, la = S.lArm;
    this.handR.position.copy(ra.wrist.clone().add(ra.hd.clone().multiplyScalar(0.03))); this.handR.scale.set(0.05, 0.042, 0.05);
    this.handL.position.copy(la.wrist.clone().add(la.hd.clone().multiplyScalar(0.03))); this.handL.scale.set(0.05, 0.042, 0.05);
    this.gloveMesh.position.copy(la.wrist.clone().add(la.hd.clone().multiplyScalar(0.05)).add(la.n.clone().multiplyScalar(0.015)));
    this.gloveMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(la.hd, la.n, la.hd.clone().cross(la.n).normalize()));
    // 頭：大頭放在脖子上方
    const hu = V(0, 1, 0).applyQuaternion(S.qH);
    const hp = S.N1.clone().add(hu.clone().multiplyScalar(this.HR * 0.78)).add(V(1, 0, 0).applyQuaternion(S.qH).multiplyScalar(this.HR * 0.04));
    this.headGroup.position.copy(hp); this.headGroup.quaternion.copy(S.qH);
    S.headC = hp; S.headR = this.HR;
    this.updateTorso(S);
    this.badge.position.copy(S.P2.clone().lerp(S.P3, 0.55).add(S.F.clone().multiplyScalar(0.112)).add(S.R.clone().multiplyScalar(0.06)));
    this.badge.quaternion.copy(S.qC); this.badge.scale.set(0.006, 0.022, 0.022);
    this.backNo.position.copy(S.P2.clone().lerp(S.P3, 0.45).sub(S.F.clone().multiplyScalar(0.128)));
    this.backNo.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(S.R, S.U, S.F.clone().negate()));
    return S;
  }

  updateTorso(S) {
    const pts = [S.P0.clone().add(S.pU.clone().multiplyScalar(-0.075)), S.P0, S.P1, S.P2, S.P3, S.P3.clone().add(S.U.clone().multiplyScalar(0.06))];
    const seg = []; for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i].distanceTo(pts[i + 1]));
    const cum = [0]; for (const l of seg) cum.push(cum[cum.length - 1] + l);
    const total = cum[cum.length - 1];
    const at = (u) => {
      const ss = u * total; let i = 0; while (i < seg.length - 1 && cum[i + 1] < ss) i++;
      const w = Math.max(0, Math.min(1, (ss - cum[i]) / (seg[i] || 1)));
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const w2 = w * w, w3 = w2 * w;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * w + (2 * a - 5 * b + 4 * c - d) * w2 + (-a + 3 * b - 3 * c + d) * w3);
      return V(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
    };
    const pos = this.torso.geometry.attributes.position.array, nS = this.ringN;
    const q = new THREE.Quaternion();
    let k = 0, botC = null, topC = null;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.u < 0.3) q.copy(S.qP); else if (r.u < 0.6) q.copy(S.qP).slerp(S.qL, (r.u - 0.3) / 0.3); else q.copy(S.qL).slerp(S.qC, Math.min(1, (r.u - 0.6) / 0.25));
      const c = at(r.u), f = V(1, 0, 0).applyQuaternion(q), rr = V(0, 0, 1).applyQuaternion(q);
      if (i === 0) botC = c.clone(); if (i === this.rings.length - 1) topC = c.clone();
      for (let j = 0; j < nS; j++) {
        const th = (j / nS) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), e = 2.25;
        const x = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / e), y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
        const p = c.clone().add(rr.clone().multiplyScalar(r.a * x)).add(f.clone().multiplyScalar(r.b * y + (r.u > 0.4 && r.u < 0.85 ? 0.008 : 0)));
        pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z;
      }
    }
    pos[k++] = botC.x; pos[k++] = botC.y - 0.01; pos[k++] = botC.z;
    pos[k++] = topC.x; pos[k++] = topC.y; pos[k++] = topC.z;
    const g = this.torso.geometry;
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }

  highlight(map) {
    const col = new THREE.Color('#FE7F2D');
    for (const m of this.mats) {
      if (!m.emissive) continue;
      const part = m.userData.part;
      let a = 0;
      for (const [k, v] of Object.entries(map || {})) {
        if (k === part || (k === 'legs' && /^(leg|foot)[RL]$/.test(part)) || (k === 'arms' && /^arm[RL]$/.test(part))) a = Math.max(a, v);
      }
      m.emissive.copy(col).multiplyScalar(a * 0.7);
    }
  }
  setGlove(on) { this.gloveMesh.visible = on; this.handL.visible = !on; }
  setOpacity(a) {
    this.opacity = a;
    for (const m of this.mats) {
      const tr = a < 0.999 || m === this.M.blush;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = m === this.M.blush ? 0.55 * a : a;
      m.depthWrite = m === this.M.blush ? false : a > 0.6;
    }
    for (const o of this.outlines) o.visible = a > 0.97;
    this.group.visible = a > 0.003;
    this.group.traverse(o => { if (o.isMesh && o.material !== OUTLINE) o.castShadow = this.castShadow && a > 0.6; });
  }
  tint(color, amount) {
    const c = new THREE.Color(color);
    for (const m of this.mats) {
      if (!m.userData.origColor) m.userData.origColor = m.color.clone();
      m.color.copy(m.userData.origColor).lerp(c, amount);
    }
  }
}
