// 手繪風格的世界：藍天積雲、遠山樹林、筆觸草地、暖陽與偏藍的陰影、紙張質感
// （致敬日本手繪動畫的氛圍；山、雲、樹都是程式即時畫出來的原創圖樣）
import * as THREE from '../vendor/three.module.js';

const rng = seed => { let s = (seed >>> 0) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const mkTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CENTER = new THREE.Vector3(9.2, 0, 0);
export const SUN_DIR = new THREE.Vector3(0.42, 0.78, 0.46).normalize();

export const PAINT = {
  zenith: '#3b80cc', sky: '#79b3e2', horizon: '#d8ecf0', haze: '#c6dccf',
  grass: '#78b054', dirt: '#d6a66d', ink: '#4a3528',
};

// ───────── 天空 ─────────
function paintSky(world) {
  const geo = world.sky.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const zen = new THREE.Color(PAINT.zenith), mid = new THREE.Color(PAINT.sky), hor = new THREE.Color(PAINT.horizon), warm = new THREE.Color('#f7ead2');
  const c = new THREE.Color(), sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), h = y / 150;
    c.copy(hor).lerp(mid, ss(0.0, 0.22, h)).lerp(zen, ss(0.18, 0.85, h));
    const az = Math.atan2(z, x), da = Math.abs(Math.atan2(Math.sin(az - sunAz), Math.cos(az - sunAz)));
    c.lerp(warm, (1 - ss(0, 1.4, da)) * (1 - ss(0.0, 0.3, Math.max(h, 0))) * 0.45);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// ───────── 積雲（一顆顆的雲團：亮面在左上、底部平且偏藍紫）─────────
function cloudTexture(seed) {
  const W = 1024, H = 640, [c, g] = mkCanvas(W, H), r = rng(seed);
  const base = H * 0.88, puffs = [];
  const n = 14 + Math.floor(r() * 8), tall = 0.55 + r() * 0.4;
  for (let i = 0; i < n; i++) {
    const u = 0.1 + 0.8 * (i + r() * 0.7) / n, env = Math.pow(Math.sin(Math.PI * u), 0.9);
    const rad = (38 + 80 * env) * (0.75 + r() * 0.45);
    puffs.push({ x: u * W, y: base - rad * 0.45 - env * H * 0.12 * r(), r: rad });
  }
  const crown = 3 + Math.floor(r() * 5);
  for (let i = 0; i < crown; i++) {
    const u = 0.3 + 0.4 * r(), rad = 60 + 70 * r();
    puffs.push({ x: u * W, y: base - H * (0.3 + 0.35 * tall * r()) - rad * 0.2, r: rad });
  }
  puffs.sort((a, b) => a.y - b.y);   // 先畫上面（後面）的雲團，下面的疊在前面
  g.save(); g.beginPath(); g.rect(0, 0, W, base); g.clip();
  for (const p of puffs) {
    g.save(); g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#a7b6d6'; g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    const m = g.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.28, p.r * 0.2, p.x - p.r * 0.12, p.y - p.r * 0.18, p.r * 0.98);
    m.addColorStop(0, '#ffffff'); m.addColorStop(0.55, '#f6f8fc'); m.addColorStop(0.8, '#d9e1ef'); m.addColorStop(1, 'rgba(217,225,239,0)');
    g.fillStyle = m; g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    g.restore();
  }
  // 底部的陰影（平底、偏藍紫）
  const lg = g.createLinearGradient(0, base - H * 0.32, 0, base);
  lg.addColorStop(0, 'rgba(140,155,196,0)'); lg.addColorStop(1, 'rgba(140,155,196,0.6)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.restore();
  return mkTex(c);
}

// ───────── 遠山（可左右無縫重複的帶狀貼圖）─────────
function ridge(u, terms, r0) { let y = 0; for (const [k, a, ph] of terms) y += a * Math.sin(2 * Math.PI * (k * u + ph)); return r0 + y; }
function treeBlob(g, x, y, s, dark, mid, light, r) {
  const n = 4 + Math.floor(r() * 4);
  const pts = Array.from({ length: n }, () => [x + (r() - 0.5) * s * 1.6, y - r() * s * 1.1, s * (0.45 + r() * 0.45)]);
  g.fillStyle = dark; for (const [px, py, pr] of pts) { g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = mid; for (const [px, py, pr] of pts) { g.beginPath(); g.arc(px - pr * 0.18, py - pr * 0.22, pr * 0.72, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = light; for (const [px, py, pr] of pts) if (r() < 0.6) { g.beginPath(); g.arc(px - pr * 0.32, py - pr * 0.4, pr * 0.32, 0, Math.PI * 2); g.fill(); }
}
function hillTexture(kind) {
  const W = kind === 'far' ? 4096 : 8192, H = 512, [c, g] = mkCanvas(W, H), r = rng(kind === 'far' ? 91 : 57);
  const terms = Array.from({ length: 5 }, (_, i) => [[1, 2, 3, 5, 8][i], [0.09, 0.06, 0.04, 0.025, 0.015][i] * (0.6 + r() * 0.8), r()]);
  const y0 = kind === 'far' ? 0.42 : 0.5;
  const path = () => { g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, H * ridge(x / W, terms, y0)); g.lineTo(W, H); g.closePath(); };
  if (kind === 'far') {
    const lg = g.createLinearGradient(0, H * 0.2, 0, H);
    lg.addColorStop(0, '#93b8c8'); lg.addColorStop(0.6, '#a9c8cb'); lg.addColorStop(1, '#bcd5cd');
    path(); g.fillStyle = lg; g.fill();
    // 山脊上淡淡的亮面
    g.save(); path(); g.clip(); g.globalAlpha = 0.35; g.fillStyle = '#d4e6ea';
    for (let i = 0; i < 70; i++) { const x = r() * W, y = H * ridge(x / W, terms, y0); g.beginPath(); g.ellipse(x - 30, y + 30, 120 + r() * 160, 26, -0.25, 0, Math.PI * 2); g.fill(); }
    g.restore();
  } else {
    const lg = g.createLinearGradient(0, H * 0.3, 0, H);
    lg.addColorStop(0, '#5f9450'); lg.addColorStop(0.5, '#73a65b'); lg.addColorStop(1, PAINT.haze);
    path(); g.fillStyle = lg; g.fill();
    // 沿山稜一排樹（左右重複畫，讓接縫無痕）
    for (let i = 0; i < 520; i++) {
      const x = r() * W, y = H * ridge(x / W, terms, y0) + 10 + r() * 30, s = 14 + r() * 26;
      for (const dx of [0, -W, W]) treeBlob(g, x + dx, y, s, '#3f6e3f', '#5b8f4b', '#86b764', r);
    }
    // 山坡上的田野色塊
    g.save(); path(); g.clip(); g.globalAlpha = 0.18;
    for (let i = 0; i < 180; i++) { g.fillStyle = r() < 0.5 ? '#a8cf73' : '#4f8443'; const x = r() * W, y = H * (0.72 + r() * 0.25); g.beginPath(); g.ellipse(x, y, 80 + r() * 200, 12 + r() * 20, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  const t = mkTex(c); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2;
  return t;
}

// ───────── 中景的樹（看板）：圓樹、高瘦的楊樹、矮樹叢；遠一點的加上空氣感 ─────────
function treeTexture(seed, kind, haze) {
  const W = 512, H = 640, [c, g] = mkCanvas(W, H), r = rng(seed);
  const dark = '#365f38', mid = '#4f8446', light = '#76ad59', tip = '#a9d27b';
  let cx = W / 2, cy, rx, ry, n;
  if (kind === 'poplar') { cy = H * 0.46; rx = W * 0.17; ry = H * 0.42; n = 22; }
  else if (kind === 'bush') { cy = H * 0.78; rx = W * 0.44; ry = H * 0.18; n = 20; }
  else { cy = H * 0.42; rx = W * (0.3 + r() * 0.08); ry = H * (0.28 + r() * 0.06); n = 26; }
  if (kind !== 'bush') {
    g.fillStyle = '#6b4b33'; g.beginPath(); g.moveTo(W / 2 - 14, H); g.lineTo(W / 2 - 7, cy + ry * 0.4); g.lineTo(W / 2 + 7, cy + ry * 0.4); g.lineTo(W / 2 + 14, H); g.fill();
  }
  const s0 = kind === 'poplar' ? 30 : kind === 'bush' ? 34 : 40;
  const blobs = Array.from({ length: n }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()); return [cx + Math.cos(a) * rx * d * 0.82, cy + Math.sin(a) * ry * d * 0.85, s0 + r() * s0 * 1.1]; });
  blobs.sort((a, b) => a[1] - b[1]);
  g.fillStyle = dark; for (const [x, y, s] of blobs) { g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = mid; for (const [x, y, s] of blobs) { g.beginPath(); g.arc(x - s * 0.2, y - s * 0.24, s * 0.78, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = light; for (const [x, y, s] of blobs) if (y < cy + ry * 0.2) { g.beginPath(); g.arc(x - s * 0.34, y - s * 0.4, s * 0.42, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = tip; for (const [x, y, s] of blobs) if (y < cy && r() < 0.5) { g.beginPath(); g.arc(x - s * 0.42, y - s * 0.5, s * 0.16, 0, Math.PI * 2); g.fill(); }
  // 空氣感：整棵樹往天空色靠
  g.globalCompositeOperation = 'source-atop'; g.globalAlpha = haze; g.fillStyle = '#b9d3d4'; g.fillRect(0, 0, W, H);
  return mkTex(c);
}

// ───────── 草地與紅土 ─────────
function grassTexture() {
  const S = 1024, [c, g] = mkCanvas(S, S), r = rng(7);
  g.fillStyle = PAINT.grass; g.fillRect(0, 0, S, S);
  const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); };
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = 70 + r() * 200, light = r() < 0.5;
    wrap((dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, light ? 'rgba(160,205,110,0.32)' : 'rgba(80,135,60,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); });
  }
  const pal = ['#5d9844', '#6aa54c', '#82b95b', '#93c669', '#a8d07a', '#4f8a3d', '#77b052'];
  g.lineCap = 'round';
  for (let i = 0; i < 16000; i++) {
    const x = r() * S, y = r() * S, len = 5 + r() * 12, a = -Math.PI / 2 + (r() - 0.5) * 0.9, bend = (r() - 0.5) * 5;
    g.strokeStyle = pal[Math.floor(r() * pal.length)]; g.globalAlpha = 0.45 + r() * 0.45; g.lineWidth = 1.4 + r() * 1.8;
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x1) / 2 + bend, (y + y1) / 2, x1, y1); g.stroke();
  }
  g.globalAlpha = 1;
  const t = mkTex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60);
  return t;
}
function dirtTexture() {
  const S = 1024, [c, g] = mkCanvas(S, S), r = rng(21), C = S / 2;
  const gr = g.createRadialGradient(C, C, 0, C, C, C);
  gr.addColorStop(0, '#dcae76'); gr.addColorStop(0.8, '#d4a46b'); gr.addColorStop(1, '#c8975f');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, rad = 30 + r() * 120;
    const b = g.createRadialGradient(x, y, 0, x, y, rad);
    b.addColorStop(0, r() < 0.5 ? 'rgba(236,196,146,0.35)' : 'rgba(176,128,82,0.25)'); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 1200; i++) {
    const x = r() * S, y = r() * S;
    g.fillStyle = r() < 0.5 ? 'rgba(180,135,88,0.35)' : 'rgba(240,210,165,0.35)';
    g.beginPath(); g.ellipse(x, y, 1.5 + r() * 3, 1 + r() * 2, r() * 3, 0, Math.PI * 2); g.fill();
  }
  // 不規則的邊緣：外面透明，交界畫一條深一點的線
  const edge = th => C * (0.955 + 0.012 * Math.sin(th * 7 + 1) + 0.008 * Math.sin(th * 13 + 2) + 0.006 * Math.sin(th * 23));
  g.globalCompositeOperation = 'destination-in';
  g.beginPath(); for (let i = 0; i <= 360; i++) { const th = i / 360 * Math.PI * 2, R = edge(th); g.lineTo(C + Math.cos(th) * R, C + Math.sin(th) * R); } g.closePath();
  g.fillStyle = '#000'; g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(150,104,62,0.7)'; g.lineWidth = 7; g.stroke();
  return mkTex(c);
}

// 雲影＋大片草色變化用的貼圖：R＝雲影（會飄動），G＝固定的大色塊
function shadeTexture() {
  const S = 512, [c, g] = mkCanvas(S, S), r = rng(99);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const blobs = (chan, n, r0, r1, a) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const x = r() * S, y = r() * S, rad = r0 + r() * (r1 - r0);
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, `rgba(${chan === 0 ? 255 : 0},${chan === 1 ? 255 : 0},0,${a})`); gr.addColorStop(0.6, `rgba(${chan === 0 ? 255 : 0},${chan === 1 ? 255 : 0},0,${a * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    }
  };
  blobs(0, 9, 40, 90, 0.75); blobs(1, 40, 30, 110, 0.35);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export const SHADE = { tex: null, offset: new THREE.Vector2() };
// 把「雲影＋大色塊」加進材質：worldXZ 決定取樣位置
function addShade(m, { haze = false, patches = false } = {}) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.shadeTex = { value: SHADE.tex }; sh.uniforms.shadeOff = { value: SHADE.offset };
    if (haze) sh.uniforms.hazeColor = { value: new THREE.Color(PAINT.haze) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;' + (haze ? '\nattribute float haze;\nvarying float vHaze;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;' + (haze ? '\nvHaze = haze;' : ''));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D shadeTex;\nuniform vec2 shadeOff;\nvarying vec2 vWXZ;' + (haze ? '\nuniform vec3 hazeColor;\nvarying float vHaze;' : ''))
      .replace('#include <opaque_fragment>', `
        float cs = texture2D(shadeTex, vWXZ * 0.011 + shadeOff).r;
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.74, 0.8, 0.93), smoothstep(0.25, 0.6, cs) * 0.8);
        ${haze ? 'outgoingLight = mix(outgoingLight, hazeColor, vHaze);' : ''}
        #include <opaque_fragment>`);
  };
  return m;
}

export function paintWorld(world) {
  const { scene, renderer } = world;
  renderer.toneMapping = THREE.NoToneMapping;
  paintSky(world);
  world.clearColor = PAINT.horizon;

  // 光：暖色太陽 + 偏藍的天光（陰影面自然偏冷）
  world.hemi.color.set('#cfe1f2'); world.hemi.groundColor.set('#a4b98a'); world.hemi.intensity = 1.55;
  world.key.color.set('#fff1da'); world.key.intensity = 2.2;
  world.rim.color.set('#ffe9c7'); world.rim.intensity = 0.9;
  const sc = world.key.shadow.camera; sc.near = 1; sc.far = 40;
  world.key.shadow.mapSize.set(1024, 1024);

  // 地面：筆觸草地 + 遠方空氣感
  const gg = world.ground.geometry, pos = gg.attributes.position;
  const col = gg.attributes.color, hz = new Float32Array(pos.count);
  const pr = rng(43), blobs = Array.from({ length: 60 }, () => [CENTER.x + (pr() - 0.5) * 220, (pr() - 0.5) * 220, 12 + pr() * 30, (pr() - 0.5) * 0.2]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getY(i), d = Math.hypot(x - CENTER.x, z);
    let v = 1; for (const [bx, bz, br, a] of blobs) v += a * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (br * br));   // 大片的深淺草色
    col.setXYZ(i, v, v * 1.01, v * 0.98);
    hz[i] = ss(25, 115, d) * 0.85;
  }
  col.needsUpdate = true; gg.setAttribute('haze', new THREE.BufferAttribute(hz, 1));
  SHADE.tex = shadeTexture();
  world.ground.material = addShade(new THREE.MeshBasicMaterial({ map: grassTexture(), vertexColors: true }), { haze: true, patches: true });

  // 紅土
  const dt = dirtTexture();
  for (const m of [world.mound, ...scene.children.filter(o => o.isMesh && o.geometry.type === 'CircleGeometry' && o.material.map)]) {
    m.material = addShade(new THREE.MeshLambertMaterial({ map: dt, transparent: true }));
  }

  // 遠山兩層、雲：直接畫在天空圓頂上（一個著色器合成三層貼圖，比一堆透明面片快很多）
  const props = new THREE.Group(); scene.add(props);
  const cloudBand = (() => {
    const W = 8192, H = 512, [c, g] = mkCanvas(W, H), cr = rng(3);
    const px = deg => deg / 360 * W, py = el => H - el / 25 * H;
    for (let i = 0; i < 14; i++) {
      const w = 60 + cr() * 60, h = w * (0.5 + cr() * 0.2), yb = 6 + cr() * 18, az = (i / 14) * 360 + cr() * 17;
      const wd = 2 * Math.atan(w / 2 / 138) * 180 / Math.PI, e0 = Math.atan(yb / 138) * 180 / Math.PI, e1 = Math.atan((yb + h) / 138) * 180 / Math.PI;
      const img = cloudTexture(100 + i * 7).image;
      for (const dx of [-W, 0, W]) g.drawImage(img, px(az - wd / 2) + dx, py(e1), px(wd), py(e0) - py(e1));
    }
    return c;
  })();
  const bandTex = (cv, rep) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.repeat.x = rep; return t; };
  const farT = hillTexture('far'), nearT = hillTexture('near');
  const skyU = { cloudTex: { value: bandTex(cloudBand, 1) }, farTex: { value: bandTex(farT.image, 2) }, nearTex: { value: bandTex(nearT.image, 2) }, cloudOff: { value: 0 } };
  world.sky.material = new THREE.ShaderMaterial({
    uniforms: skyU, vertexColors: true, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; varying vec3 vCol;
      void main() { vDir = position; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D cloudTex, farTex, nearTex; uniform float cloudOff; varying vec3 vDir; varying vec3 vCol;
      void main() {
        vec3 d = normalize(vDir);
        float az = atan(d.z, d.x) / 6.2831853 + 0.5;
        float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
        vec3 c = vCol;
        if (el > -0.5 && el < 25.0) { vec4 k = texture2D(cloudTex, vec2(az + cloudOff, el / 25.0)); c = mix(c, k.rgb, k.a); }
        if (el > -2.5 && el < 10.0) { vec4 h = texture2D(farTex, vec2(az * 2.0, (el + 2.5) / 12.5)); c = mix(c, h.rgb, h.a); }
        if (el > -2.5 && el < 6.0) { vec4 h = texture2D(nearTex, vec2(az * 2.0 + 0.37, (el + 2.5) / 8.5)); c = mix(c, h.rgb, h.a); }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // 樹叢：幾個樹林，每個樹林混合不同的樹
  const trees = [], r = rng(5);
  const kinds = ['round', 'round', 'poplar', 'bush'];
  const tTex = {};
  const getTex = (k, v, hz) => { const key = k + v + hz; return tTex[key] || (tTex[key] = treeTexture(11 + v * 13 + k.length, k, hz)); };
  for (let grove = 0; grove < 11; grove++) {
    const a0 = (grove / 11) * Math.PI * 2 + r() * 0.35, d0 = 60 + r() * 22, n = 3 + Math.floor(r() * 5);
    if (Math.abs(Math.atan2(Math.sin(a0), Math.cos(a0))) < 0.3) continue;   // 本壘後方留空（中外野轉播鏡頭會拍到）
    for (let i = 0; i < n; i++) {
      const k = kinds[Math.floor(r() * kinds.length)], a = a0 + (r() - 0.5) * 0.16, d = d0 + (r() - 0.5) * 10;
      const h = k === 'poplar' ? 9 + r() * 5 : k === 'bush' ? 3 + r() * 2 : 6 + r() * 5;
      const hz = d > 72 ? 0.42 : 0.3;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.8, h), new THREE.MeshBasicMaterial({ map: getTex(k, Math.floor(r() * 3), hz), transparent: true, alphaTest: 0.5, fog: false }));
      m.position.set(CENTER.x + Math.cos(a) * d, h / 2 - 0.2, CENTER.z + Math.sin(a) * d);
      m.lookAt(CENTER.x, h / 2, CENTER.z); if (r() < 0.5) m.scale.x = -1;
      props.add(m); trees.push(m);
    }
  }
  // 小鳥：幾群 V 字形的鳥，拍著翅膀飛過天空
  const birdMat = new THREE.MeshBasicMaterial({ color: '#3f4a5a', side: THREE.DoubleSide, fog: false });
  const flocks = [], br = rng(17);
  for (let f = 0; f < 4; f++) {
    const n = 3 + Math.floor(br() * 4), birds = [];
    for (let i = 0; i < n; i++) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
      const m = new THREE.Mesh(geo, birdMat); m.frustumCulled = false; props.add(m);
      birds.push({ m, off: new THREE.Vector3((br() - 0.5) * 6, (br() - 0.5) * 2.5, (br() - 0.5) * 6), ph: br() * 6 });
    }
    flocks.push({ birds, a: br() * Math.PI * 2, R: 55 + br() * 30, y: 16 + br() * 14, speed: (br() < 0.5 ? -1 : 1) * (0.03 + br() * 0.02), period: 70 + br() * 50, t0: br() * 60 });
  }
  // 蒲公英的種子：在打擊區附近慢慢飄
  const seedTex = (() => { const [c, g] = mkCanvas(64, 64); const gr = g.createRadialGradient(32, 26, 0, 32, 26, 22);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,250,0.75)'); gr.addColorStop(1, 'rgba(255,255,250,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(255,255,245,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(32, 30); g.lineTo(33, 60); g.stroke();
    return mkTex(c); })();
  const seedMat = new THREE.SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false, fog: false });
  const seeds = [], sr = rng(29);
  for (let i = 0; i < 36; i++) {
    const sp = new THREE.Sprite(seedMat.clone()); const s = 0.035 + sr() * 0.025; sp.scale.set(s, s, 1); props.add(sp);
    seeds.push({ sp, b: new THREE.Vector3(sr(), sr(), sr()), ph: sr() * 6.28, sp2: 0.6 + sr() * 0.8 });
  }
  const wing = new THREE.Vector3(), tmp = new THREE.Vector3();
  const look = new THREE.Vector3(), fwd = new THREE.Vector3();
  function update(t, cam) {
    SHADE.offset.set(t * 0.0042, t * 0.0016);
    for (const fl of flocks) {
      const u = ((t + fl.t0) % fl.period) / fl.period, on = u < 0.6;
      const a = fl.a + fl.speed * ((t + fl.t0) % fl.period) - fl.speed * fl.period * 0.3;
      const c = new THREE.Vector3(CENTER.x + Math.cos(a) * fl.R, fl.y + Math.sin(t * 0.3 + fl.a) * 1.2, CENTER.z + Math.sin(a) * fl.R);
      const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.sign(fl.speed));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      for (const b of fl.birds) {
        b.m.visible = on;
        if (!on) continue;
        const p = c.clone().add(b.off), fl2 = Math.sin(t * 9 + b.ph) * 0.55, S2 = 0.55;
        const tipL = p.clone().addScaledVector(side, S2).addScaledVector(dir, -0.15); tipL.y += fl2 * S2;
        const tipR = p.clone().addScaledVector(side, -S2).addScaledVector(dir, -0.15); tipR.y += fl2 * S2;
        const nose = p.clone().addScaledVector(dir, 0.18), tail = p.clone().addScaledVector(dir, -0.12);
        const arr = b.m.geometry.attributes.position.array;
        [nose, tail, tipL, nose, tail, tipR].forEach((v, k) => { arr[k * 3] = v.x; arr[k * 3 + 1] = v.y; arr[k * 3 + 2] = v.z; });
        b.m.geometry.attributes.position.needsUpdate = true;
      }
    }
    cam.getWorldDirection(fwd);
    const seedsOn = fwd.y > -0.55;   // 俯視鏡頭不顯示種子（從上面看會像一堆白點）
    for (const s of seeds) {
      const W = 9, Hh = 2.2, D = 7;
      const x = ((s.b.x * W + t * 0.32 * s.sp2) % W + W) % W, z = ((s.b.z * D + t * 0.12 * s.sp2) % D + D) % D;
      s.sp.position.set(14.2 + x, 0.25 + s.b.y * Hh + Math.sin(t * 0.9 + s.ph) * 0.12, -3.5 + z + Math.sin(t * 0.6 + s.ph) * 0.15);
      s.sp.material.opacity = seedsOn ? ss(1.0, 2.0, s.sp.position.distanceTo(cam.position)) : 0;   // 太靠近鏡頭的種子會變成一大團白，淡掉
    }
    skyU.cloudOff.value = t * 0.0009 / (Math.PI * 2);
    // 陰影跟著鏡頭看的地方走（打者、投手都有影子）
    cam.getWorldDirection(fwd);
    let s = fwd.y < -0.03 ? (cam.position.y - 0.4) / -fwd.y : 7;
    s = Math.min(Math.max(s, 1.5), 14);
    look.copy(cam.position).addScaledVector(fwd, s); look.y = 0;
    const half = Math.min(8, Math.max(2.6, s * 0.42));
    const k = world.key, c = k.shadow.camera;
    k.target.position.copy(look); k.position.copy(look).addScaledVector(SUN_DIR, 16);
    k.target.updateMatrixWorld();
    if (c.right !== half) { c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.updateProjectionMatrix(); }
  }
  return { update, trees, props };
}

// 紙張質感（疊在畫面最上層，multiply）
export function paperOverlay(stage) {
  const S = 512, [c, g] = mkCanvas(S, S), r = rng(77);
  const img = g.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) { const v = 238 + r() * 17; img.data[i] = v; img.data[i + 1] = v - 2; img.data[i + 2] = v - 6; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.07; g.strokeStyle = '#8a7350'; g.lineWidth = 1;
  for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S, a = r() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (8 + r() * 24), y + Math.sin(a) * (8 + r() * 24)); g.stroke(); }
  const el = document.createElement('div');
  el.id = 'paper';
  el.style.cssText = `position:absolute;inset:0;pointer-events:none;background-image:url(${c.toDataURL()});background-size:512px 512px;mix-blend-mode:multiply;opacity:0.55`;
  stage.insertBefore(el, document.getElementById('curtain'));
  return el;
}
