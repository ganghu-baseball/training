// 動畫主程式：renderAt(t) 決定性地畫出任一時間點的畫面（可平行、跳著渲染）
import * as THREE from '../vendor/three.module.js';
import { createWorld, makeWall, PALETTE } from './world.js';
import { Actor } from './actors.js';
import * as MO from './motions.js';
import { pchip, smooth, clamp, easeInOut, easeOut, easeIn, lerp } from './interp.js';
import { MOUND, FLAT } from './terrain.js';
import { solveSkeleton } from './rig.js';
import * as DR from './drills.js';
import * as HD from './hipdrills.js';

const W = 1920, H = 1080;
const qs = new URLSearchParams(location.search);
const world = createWorld(W, H);
document.getElementById('gl').appendChild(world.renderer.domElement);
const ovRoot = document.getElementById('ov');
const subsEl = document.getElementById('subs');
const curtain = document.getElementById('curtain');

const timeline = await (await fetch('../build/timeline.json', { cache: 'no-store' })).json();
// 線條圖示（lucide-static，ISC 授權）：先全部預載
const ICON_NAMES = ['anchor', 'bow-arrow', 'footprints', 'hand', 'activity', 'zap', 'gauge', 'timer', 'car', 'car-front', 'bus', 'bike', 'target', 'eye', 'brain', 'moon',
  'utensils', 'heart-pulse', 'thermometer', 'shield-check', 'triangle-alert', 'check', 'x', 'repeat', 'shuffle', 'rewind', 'undo-2', 'dumbbell',
  'battery-low', 'battery-full', 'battery-medium', 'wind', 'waves', 'droplets', 'trophy', 'smile', 'users', 'person-standing', 'circle-help',
  'message-circle-question', 'megaphone', 'ear', 'music', 'clock', 'hourglass', 'flame', 'sprout', 'cog', 'wrench', 'fuel', 'octagon-x', 'siren', 'bed',
  'rotate-cw', 'rotate-ccw', 'move-right', 'trending-up', 'trending-down', 'chart-line', 'chart-bar', 'lightbulb', 'sparkles', 'play', 'pause', 'sun',
  'crosshair', 'scan-eye', 'hand-heart', 'layers', 'refresh-cw', 'camera', 'video', 'ruler', 'weight', 'biceps-flexed', 'stethoscope', 'hospital',
  'glass-water', 'shirt', 'circle-dot', 'mountain', 'workflow', 'dices', 'signal', 'anvil', 'bone', 'coffee', 'apple', 'volume-2', 'traffic-cone', 'construction',
  'door-open', 'plane', 'graduation-cap', 'book-open', 'flag', 'list-checks', 'bed-single', 'undo', 'redo', 'scale', 'brick-wall', 'hand-grab', 'stretch-horizontal', 'accessibility'];
const ICONS = {};
await Promise.all(ICON_NAMES.map(async n => { try { ICONS[n] = await (await fetch(`../node_modules/lucide-static/icons/${n}.svg`)).text(); } catch (e) { ICONS[n] = ''; } }));
function icon(name, size = 48, color = 'currentColor', sw = 2) {
  const raw = ICONS[name] || '';
  return raw.replace(/<!--[\s\S]*?-->/g, '').replace(/width="24"/, `width="${size}"`).replace(/height="24"/, `height="${size}"`)
    .replace(/stroke="currentColor"/, `stroke="${color}"`).replace(/stroke-width="2"/, `stroke-width="${sw}"`).replace('<svg', '<svg style="display:block"');
}
const { SCENES } = await import('../../content/scenes.js?v=' + Date.now());

// ─────────────── 相機路徑 ───────────────
class CamPath {
  constructor(keys) {
    this.keys = keys;
    const comp = (f) => pchip(keys.map(k => [k.t, f(k)]));
    this.px = comp(k => k.pos[0]); this.py = comp(k => k.pos[1]); this.pz = comp(k => k.pos[2]);
    this.lx = comp(k => k.look[0]); this.ly = comp(k => k.look[1]); this.lz = comp(k => k.look[2]);
    this.f = comp(k => k.fov ?? 30);
  }
  at(t) { return { pos: [this.px(t), this.py(t), this.pz(t)], look: [this.lx(t), this.ly(t), this.lz(t)], fov: this.f(t) }; }
}

// ─────────────── 場景共用工具 ───────────────
const actors = [];
const viewCams = [];
const tracked = [];
const wall = makeWall(); wall.visible = false; world.scene.add(wall);
const motionCache = new Map();
const ctx = {
  THREE, world, scene: world.scene, camera: world.camera, PALETTE, MO, DR, HD, MOUND, FLAT,
  solve(m, t) { return solveSkeleton(MO.poseAt(m, t)); },
  smooth, clamp, easeInOut, easeOut, easeIn, lerp, pchip,
  wall,
  CamPath,
  icon,
  views: null,
  // 場景自己加的 3D 物件：換場景時自動隱藏
  track(obj) { tracked.push(obj); world.scene.add(obj); obj.visible = false; return obj; },
  // 分割畫面：[{rect:[x,y,w,h], cam:{pos,look,fov}, show:[actor index...]}]
  setViews(vs) {
    ctx.views = vs;
    if (!vs) return;
    vs.forEach((v, i) => {
      const c = viewCams[i] || (viewCams[i] = new THREE.PerspectiveCamera(30, 1, 0.05, 400));
      c.aspect = v.rect[2] / v.rect[3]; c.fov = v.cam.fov ?? 30; c.updateProjectionMatrix();
      c.position.set(...v.cam.pos); c.up.set(...(v.cam.up || [0, 1, 0])); c.lookAt(...v.cam.look); c.updateMatrixWorld();
    });
  },
  projectView(i, v) {
    const c = viewCams[i], r = ctx.views[i].rect;
    const p = (v.isVector3 ? v.clone() : new THREE.Vector3(...v)).project(c);
    return { x: r[0] + (p.x * 0.5 + 0.5) * r[2], y: r[1] + (-p.y * 0.5 + 0.5) * r[3], z: p.z };
  },
  actor(i, opts) {
    while (actors.length <= i) actors.push(new Actor(world.scene, opts));
    const a = actors[i];
    a.root.visible = true; a.used = true;
    return a;
  },
  motion(name, factory) {
    if (!motionCache.has(name)) motionCache.set(name, factory());
    return motionCache.get(name);
  },
  pitch(variant = {}) {
    const key = 'pitch:' + JSON.stringify(variant);
    return ctx.motion(key, () => MO.makePitch(variant));
  },
  setCam(c) {
    const cam = world.camera;
    cam.fov = c.fov ?? 30; cam.updateProjectionMatrix();
    cam.position.set(...c.pos);
    cam.up.set(...(c.up || [0, 1, 0]));
    cam.lookAt(...c.look);
    cam.updateMatrixWorld();
  },
  project(v) {
    const p = (v.isVector3 ? v.clone() : new THREE.Vector3(...v)).project(world.camera);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, z: p.z, vis: p.z < 1 };
  },
  // 淡入淡出：a→b 淡入、c→d 淡出
  fade(t, a, b, c = 1e9, d = 1e9) { return Math.min(smooth(a, b, t), 1 - smooth(c, d, t)); },
  pop(el, t, t0, dur = 0.35, t1 = 1e9) {
    if (el.dataset.base === undefined) { const tf = getComputedStyle(el).transform; el.dataset.base = tf && tf !== 'none' ? tf : ''; }
    const s = easeOut(clamp((t - t0) / dur, 0, 1)) * (1 - smooth(t1, t1 + 0.3, t));
    el.style.opacity = s;
    el.style.transform = (el.dataset.base || '') + ` scale(${0.9 + 0.1 * s})`;
    return s;
  },
  show(el, v) { el.style.opacity = v; el.style.visibility = v > 0.001 ? 'visible' : 'hidden'; },
  place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; },
  lineAt(info, i) { return info.lines[i] || { t0: 1e9, t1: 1e9 }; },
  env(opts = {}) {
    world.mound.visible = opts.mound !== false;
    world.rubber.visible = opts.mound !== false;
    world.plate.visible = opts.plate !== false;
    world.target.visible = opts.target !== false;
    wall.visible = !!opts.wall;
    if (opts.wallX !== undefined) wall.position.x = opts.wallX;
  },
  loop(t, period, hold = 0) { const p = period + hold; return ((t % p) + p) % p; },
};

function resetForScene() {
  ctx.views = null;
  for (const o of tracked) o.visible = false;
  for (const a of actors) {
    a.root.visible = false; a.used = false; a.ball.visible = false;
    if (a.medball) a.medball.visible = false;
    if (a.waterbag) a.waterbag.visible = false;
    a.pitcher.highlight({}); a.pitcher.setOpacity(1); a.pitcher.tint('#ffffff', 0);
    a.offset.set(0, 0, 0);
  }
  ctx.env({});
  world.renderer.setClearColor('#0E1B24');
}

// ─────────────── 場景切換 ───────────────
const sceneEls = {};
let current = null;
function sceneInfo(id) { return timeline.scenes.find(s => s.id === id); }

function enter(sc) {
  const def = SCENES[sc.id] || SCENES._default;
  if (!sceneEls[sc.id]) {
    const el = document.createElement('div');
    el.className = 'scene';
    ovRoot.appendChild(el);
    sceneEls[sc.id] = el;
    const info = { ...sc, dur: sc.t1 - sc.t0, lines: sc.lines.map(l => ({ ...l, t0: l.t0 - sc.t0, t1: l.t1 - sc.t0 })) };
    sc._info = info;
    if (def.build) def.build(el, ctx, info);
  }
  sceneEls[sc.id].classList.add('on');
}
function leave(sc) { if (sceneEls[sc.id]) sceneEls[sc.id].classList.remove('on'); }

// ─────────────── 字幕 ───────────────
let lastSub = null;
function updateSubs(t) {
  const s = timeline.subtitles.find(x => t >= x.t0 && t < x.t1);
  const text = s ? s.text : '';
  if (text !== lastSub) {
    subsEl.innerHTML = text ? `<div class="sub">${text.replace(/「([^」]+)」/g, '<em>「$1」</em>')}</div>` : '';
    lastSub = text;
  }
  if (s) {
    const a = clamp((t - s.t0) / 0.12, 0, 1) * clamp((s.t1 - t) / 0.08, 0, 1);
    subsEl.style.opacity = Math.max(0.0, a);
  }
}

// ─────────────── 分割畫面算圖 ───────────────
const RS = +(qs.get('rs') || 1);
function renderViews() {
  const r = world.renderer;
  const vis = actors.map(a => a.root.visible);
  const ballVis = actors.map(a => a.ball.visible);
  const medVis = actors.map(a => a.medball ? a.medball.visible : false);
  const wbVis = actors.map(a => a.waterbag ? a.waterbag.visible : false);
  r.setScissorTest(true);
  r.setClearColor('#0E1B24');
  r.clear();
  ctx.views.forEach((v, i) => {
    const [x, y, w, h] = v.rect;
    actors.forEach((a, k) => {
      const on = v.show.includes(k);
      a.root.visible = vis[k] && on; a.ball.visible = ballVis[k] && on;
      if (a.medball) a.medball.visible = medVis[k] && on;
      if (a.waterbag) a.waterbag.visible = wbVis[k] && on;
    });
    r.setViewport(x * RS, (1080 - y - h) * RS, w * RS, h * RS);
    r.setScissor(x * RS, (1080 - y - h) * RS, w * RS, h * RS);
    r.info.render.frame++;    // 同 world.render：避免軀幹幾何沿用上一格
    r.render(world.scene, viewCams[i]);
  });
  r.setScissorTest(false);
  r.setViewport(0, 0, 1920 * RS, 1080 * RS);
  actors.forEach((a, k) => { a.root.visible = vis[k]; a.ball.visible = ballVis[k]; if (a.medball) a.medball.visible = medVis[k]; if (a.waterbag) a.waterbag.visible = wbVis[k]; });
}

// ─────────────── 主渲染 ───────────────
window.renderAt = (t) => {
  const sc = timeline.scenes.find(s => t >= s.t0 && t < s.t1) || timeline.scenes[timeline.scenes.length - 1];
  if (current !== sc) {
    if (current) leave(current);
    resetForScene();
    enter(sc);
    current = sc;
  } else {
    for (const a of actors) { a.root.visible = false; a.used = false; a.ball.visible = false; if (a.medball) a.medball.visible = false; if (a.waterbag) a.waterbag.visible = false; }
  }
  const def = SCENES[sc.id] || SCENES._default;
  const lt = t - sc.t0;
  ctx.views = null;           // 分割畫面每一格都要由場景重新設定
  const pq0 = performance.now();
  def.update && def.update(lt, ctx, sc._info);
  window.__tUpdate = performance.now() - pq0;
  for (const a of actors) if (!a.used) { a.root.visible = false; a.ball.visible = false; if (a.medball) a.medball.visible = false; if (a.waterbag) a.waterbag.visible = false; }
  // 轉場：場景交界短暫變暗
  let cv = 0;
  const idx = timeline.scenes.indexOf(sc);
  const prev = timeline.scenes[idx - 1];
  if (sc.transition !== 'cut' && prev) cv = Math.max(cv, 1 - clamp((t - sc.t0) / 0.2, 0, 1));
  const next = timeline.scenes[idx + 1];
  if (next && next.transition !== 'cut') cv = Math.max(cv, 1 - clamp((sc.t1 - t) / 0.2, 0, 1));
  if (idx === 0) cv = Math.max(cv, 1 - clamp(t / 0.8, 0, 1));
  if (idx === timeline.scenes.length - 1) cv = Math.max(cv, clamp((t - (sc.t1 - 1.2)) / 1.2, 0, 1));
  curtain.style.opacity = cv * 0.92;
  updateSubs(t);
  const pq1 = performance.now();
  if (ctx.views && ctx.views.length) renderViews(); else world.render();
  window.__tRender = performance.now() - pq1;
  return true;
};
window.timeline = timeline;
window.__missing = timeline.scenes.map(s => s.id).filter(id => !SCENES[id]);
window.__world = world; window.__actors = actors;
await document.fonts.ready;
// 預熱：讓字型、貼圖、shader 都先載入
window.renderAt(0.5);
window.renderAt(0);
window.ready = true;

// 預覽模式：即時播放（含旁白音訊）
if (qs.get('play') !== null) {
  const audio = new Audio('../build/mix.mp3');
  let t0 = performance.now() - (+qs.get('play') || 0) * 1000;
  audio.currentTime = +qs.get('play') || 0;
  audio.play().catch(() => {});
  const loop = () => { const t = audio.paused ? (performance.now() - t0) / 1000 : audio.currentTime; window.renderAt(t); requestAnimationFrame(loop); };
  loop();
}
