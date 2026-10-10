// 場景：夜間球場風格（深藍 + 橘色點綴），投手丘、投手板、本壘板、好球帶目標
import * as THREE from '../vendor/three.module.js';
import { moundHeight, RUBBER_HEIGHT } from './terrain.js';


export const PALETTE = {
  navy: '#233D4D', ink: '#152632', deep: '#0E1B24', orange: '#FE7F2D', orangeD: '#C2560D',
  yellow: '#FCCA46', sage: '#A1C181', teal: '#619B8A', paper: '#F7F6F0', red: '#F25C54',
};

export function createWorld(canvasW = 1920, canvasH = 1080) {
  const Q = new URLSearchParams(location.search);
  const aaMode = Q.get('aa') || 'msaa';            // msaa | 0（軟體算圖下 MSAA 比後製 FXAA 快）
  const rs = +(Q.get('rs') || 1);                  // 3D 算圖解析度倍率（文字仍為全解析度）
  const renderer = new THREE.WebGLRenderer({ antialias: aaMode === 'msaa', preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(canvasW * rs), Math.round(canvasH * rs), false);
  renderer.domElement.style.width = canvasW + 'px';
  renderer.domElement.style.height = canvasH + 'px';
  const sh = Q.get('shadow') ?? '1';
  renderer.shadowMap.enabled = sh !== '0';
  renderer.shadowMap.type = sh === '2' ? THREE.PCFSoftShadowMap : sh === '3' ? THREE.BasicShadowMap : THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color('#1d3140');
  // 不用全域霧（軟體算圖很貴）；改在地面頂點色做遠方淡出

  // 背景：垂直漸層天空（頂點色，軟體算圖也很快）；地平線帶一點暖橘色球場燈光暈
  const skyGeo = new THREE.SphereGeometry(150, 32, 48);
  {
    const pos = skyGeo.attributes.position, col = new Float32Array(pos.count * 3);
    const top = new THREE.Color('#08131b'), mid = new THREE.Color('#15293a'), hor = new THREE.Color('#1f3240'), glow = new THREE.Color('#ff8a3d');
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 150;
      c.copy(hor).lerp(mid, ss(0.0, 0.2, h)).lerp(top, ss(0.2, 0.8, h));
      const g = Math.exp(-Math.pow(Math.max(h - 0.01, 0) / 0.035, 2)) * 0.06;
      c.r += glow.r * g; c.g += glow.g * g; c.b += glow.b * g;
      col.set([c.r, c.g, c.b], i * 3);
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(sky);

  // 燈光：天空半球光 + 主光（陰影）+ 橘色輪廓光
  const hemi = new THREE.HemisphereLight('#dfe9f2', '#3b3026', 1.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff4e6', 2.6);
  key.position.set(3.5, 9, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(+(Q.get('smap') || 1024), +(Q.get('smap') || 1024));
  const sc = key.shadow.camera; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 2; sc.far = 22;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  key.target.position.set(0.8, 0, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ff8a3d', 1.9);
  rim.position.set(-5, 4.5, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight('#9fc3dd', 0.55);
  fill.position.set(6, 3, -2);
  if (Q.get('fill') !== '0') scene.add(fill);

  // 地面：草地（深墨綠藍）+ 細格線
  const gTex = makeGroundTexture();
  const gg = new THREE.PlaneGeometry(400, 400, 60, 60);
  {
    const pos = gg.attributes.position, col = new Float32Array(pos.count * 3);
    const near = new THREE.Color('#34504a'), mid = new THREE.Color('#2a433f'), far = new THREE.Color('#2e3b44');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - 6, pos.getY(i));
      const f = Math.min(1, Math.max(0, (d - 6) / 90));
      c.copy(near).lerp(mid, Math.min(1, f * 2.5)).lerp(far, Math.pow(f, 0.8));
      col.set([c.r, c.g, c.b], i * 3);
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const ground = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = false;
  ground.renderOrder = 2;
  if (Q.get('noground') === null) scene.add(ground);

  // 投手丘（紅土圓）與投手板
  const moundTex = makeMoundTexture();
  // 有高度的投手丘（依規格的平台與斜坡）：極座標網格讓丘緣是乾淨的圓
  const mg = new THREE.BufferGeometry();
  {
    const RINGS = 26, SEGS = 96, CX = 0.457, R = 2.74;
    const pos = [], uv = [], idx = [];
    pos.push(CX, moundHeight(CX, 0) + 0.004, 0); uv.push(0.5, 0.5);
    for (let i = 1; i <= RINGS; i++) {
      const r = R * Math.pow(i / RINGS, 0.9);
      for (let j = 0; j < SEGS; j++) {
        const th = (j / SEGS) * Math.PI * 2;
        const x = CX + r * Math.cos(th), z = r * Math.sin(th);
        const y = i === RINGS ? 0.0015 : moundHeight(x, z) + 0.004;
        pos.push(x, y, z); uv.push(0.5 + 0.5 * (r / R) * Math.cos(th), 0.5 + 0.5 * (r / R) * Math.sin(th));
      }
    }
    for (let j = 0; j < SEGS; j++) idx.push(0, 1 + (j + 1) % SEGS, 1 + j);
    for (let i = 1; i < RINGS; i++) for (let j = 0; j < SEGS; j++) {
      const a0 = 1 + (i - 1) * SEGS + j, a1 = 1 + (i - 1) * SEGS + (j + 1) % SEGS, b0 = 1 + i * SEGS + j, b1 = 1 + i * SEGS + (j + 1) % SEGS;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    mg.setIndex(idx);
    mg.computeVertexNormals();
  }
  const mound = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ map: moundTex }));
  mound.receiveShadow = true;
  mound.renderOrder = 1;
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.152, 0.03, 0.61), new THREE.MeshLambertMaterial({ color: '#f4f4f0' }));
  rubber.position.set(-0.076, RUBBER_HEIGHT - 0.005, 0); rubber.receiveShadow = true;
  scene.add(rubber);

  // 本壘板 + 本壘周圍紅土 + 好球帶目標
  const plateArea = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshLambertMaterial({ map: moundTex }));
  plateArea.rotation.x = -Math.PI / 2; plateArea.position.set(18.44 + 0.3, 0.002, 0); plateArea.receiveShadow = true;
  scene.add(plateArea);
  const plateShape = new THREE.Shape();
  const w = 0.216;
  plateShape.moveTo(0, -w); plateShape.lineTo(0.216, -w); plateShape.lineTo(0.432, 0); plateShape.lineTo(0.216, w); plateShape.lineTo(0, w); plateShape.lineTo(0, -w);
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(plateShape), new THREE.MeshLambertMaterial({ color: '#f4f4f0' }));
  plate.rotation.x = -Math.PI / 2; plate.position.set(18.44 + 0.432, 0.004, 0); plate.rotation.z = Math.PI;
  scene.add(plate);
  const target = makeTarget();
  target.position.set(18.3, 0.82, 0.05);
  scene.add(target);

  const camera = new THREE.PerspectiveCamera(30, canvasW / canvasH, 0.05, 400);
  camera.position.set(0.8, 1.2, 7.5);
  camera.lookAt(0.8, 0.95, 0);

  // three.js r170 在陰影貼圖階段也會標記「這一格已更新幾何」，下一次 render() 就會跳過上傳，
  // 導致每格更新頂點的軀幹落後一格。每次 render 前先把計數加一，確保幾何一定是最新的。
  const render = () => { renderer.info.render.frame++; renderer.render(scene, camera); };
  return { renderer, scene, camera, key, rim, hemi, ground, mound, rubber, plate, target, sky, render };
}

function makeGroundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#243b39'; g.fillRect(0, 0, 1024, 1024);
  // 寬而柔和的割草條紋（沿本壘方向）
  for (let i = 0; i < 8; i++) {
    const grd = g.createLinearGradient(i * 128, 0, i * 128 + 128, 0);
    const a = i % 2 ? 0.035 : -0.035;
    const col = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(i * 128, 0, 128, 1024);
  }
  const img = g.getImageData(0, 0, 1024, 1024);
  let s = 4242; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 7; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(17, 17);
  t.anisotropy = +(new URLSearchParams(location.search).get('aniso') || 1);
  return t;
}

function makeMoundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  grd.addColorStop(0, '#a4724c'); grd.addColorStop(0.9, '#96663f'); grd.addColorStop(1, '#8a5c38');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  // 細微顆粒
  const img = g.getImageData(0, 0, 512, 512);
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeTarget() {
  const grp = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: '#FE7F2D', transparent: true, opacity: 0.95, side: THREE.DoubleSide, fog: false });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 48), ringMat);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.125, 48), ringMat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), ringMat);
  const zoneMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, fog: false });
  const zone = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.3, -0.216), new THREE.Vector3(0, -0.3, 0.216), new THREE.Vector3(0, 0.32, 0.216), new THREE.Vector3(0, 0.32, -0.216)]), zoneMat);
  for (const m of [r1, r2, dot]) m.rotation.y = Math.PI / 2;
  grp.add(r1, r2, dot, zone);
  return grp;
}

// 棒球（白底紅線）
export function makeBaseball() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#d2382f'; g.lineWidth = 3;
  for (const off of [0, 128]) {
    g.beginPath();
    for (let x = 0; x <= 128; x += 2) {
      const y = 64 + Math.sin((x / 128) * Math.PI * 2) * 34;
      if (x === 0) g.moveTo(x + off, y); else g.lineTo(x + off, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.0366, 24, 16), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
  m.castShadow = true;
  return m;
}

// 藥球（深灰 + 橘色條紋）
export function makeMedball(r = 0.115) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#39434a'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#FE7F2D';
  g.fillRect(0, 118, 512, 20);
  for (const x of [0, 128, 256, 384]) g.fillRect(x, 0, 10, 256);
  const img = g.getImageData(0, 0, 512, 256);
  let s = 777; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  m.castShadow = true;
  return m;
}

// 牆（藥球側拋用）與牆上目標
export function makeWall() {
  const grp = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 4.5), new THREE.MeshStandardMaterial({ color: '#2b4556', roughness: 0.9 }));
  wall.position.set(0.1, 1.6, 0); wall.receiveShadow = true;
  const tMat = new THREE.MeshBasicMaterial({ color: '#FE7F2D', side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.3, 48), tMat);
  ring.rotation.y = Math.PI / 2; ring.position.set(-0.005, 1.3, 0);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 48), tMat);
  ring2.rotation.y = Math.PI / 2; ring2.position.set(-0.005, 1.3, 0);
  grp.add(wall, ring, ring2);
  return grp;
}

// 水袋：透明管 + 會晃動的水
export function makeWaterBag() {
  const grp = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.72, 8, 24), new THREE.MeshPhysicalMaterial({
    color: '#bfe3ff', transparent: true, opacity: 0.28, roughness: 0.15, metalness: 0, clearcoat: 1, depthWrite: false }));
  tube.rotation.z = Math.PI / 2;
  const water = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), new THREE.MeshStandardMaterial({ color: '#3d8fd1', transparent: true, opacity: 0.85, roughness: 0.2 }));
  water.scale.set(0.3, 0.06, 0.07);
  const handleMat = new THREE.MeshStandardMaterial({ color: '#233D4D', roughness: 0.6 });
  const h1 = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), handleMat); h1.position.set(0.44, 0, 0); h1.rotation.y = Math.PI / 2;
  const h2 = h1.clone(); h2.position.set(-0.44, 0, 0);
  grp.add(tube, water, h1, h2);
  grp.userData = { tube, water };
  return grp;
}
