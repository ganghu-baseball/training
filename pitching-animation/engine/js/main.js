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
import * as BT from './batting.js';
import * as CH from './chibi.js';
import * as YO from './youth.js';

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
  'door-open', 'plane', 'graduation-cap', 'book-open', 'flag', 'list-checks', 'bed-single', 'undo', 'redo', 'scale', 'brick-wall', 'hand-grab', 'stretch-horizontal', 'accessibility',
  'arrow-up-right', 'binoculars', 'brain-circuit', 'chevrons-up', 'circle-gauge', 'clipboard-list', 'cpu', 'crown', 'eye-off', 'focus', 'gamepad-2', 'goal', 'grid-3x3',
  'hammer', 'joystick', 'map', 'medal', 'move-up-right', 'notebook-pen', 'puzzle', 'rabbit', 'radar', 'rocket', 'scan', 'search', 'shield', 'snail', 'split', 'star',
  'sword', 'swords', 'telescope', 'timer-reset', 'turtle', 'zap-off'];
const ICONS = {};
await Promise.all(ICON_NAMES.map(async n => { try { ICONS[n] = await (await fetch(`../node_modules/lucide-static/icons/${n}.svg`)).text(); } catch (e) { ICONS[n] = ''; } }));
function icon(name, size = 48, color = 'currentColor', sw = 2) {
  const raw = ICONS[name] || '';
  return raw.replace(/<!--[\s\S]*?-->/g, '').replace(/width="24"/, `width="${size}"`).replace(/height="24"/, `height="${size}"`)
    .replace(/stroke="currentColor"/, `stroke="${color}"`).replace(/stroke-width="2"/, `stroke-width="${sw}"`).replace('<svg', '<svg style="display:block"');
}
const { SCENES, THEME } = await import('../../content/scenes.js?v=' + Date.now());
// 主題：painted＝手繪風格（天空、遠山、草地、紙張質感、圓體字）
let painter = null;
const RETHEME = [];
if (THEME === 'painted') {
  const P = await import('./painted.js');
  painter = P.paintWorld(world);
  if (qs.get('paper') !== null) P.paperOverlay(document.getElementById('stage'));   // 紙張紋理（軟體算圖時很花時間，預設關閉）
  CH.setChibiTheme({ gradient: [150, 255], outline: '#4a3528', width: 0.0075, face: 'soft' });
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'css/painted.css';
  await new Promise(res => { link.onload = res; link.onerror = res; document.head.appendChild(link); });
  // 場景裡寫死的深藍面板 → 苔綠墨色
  RETHEME.push([/rgba\(\s*(?:10|12|8|14)\s*,\s*(?:21|24|17|27)\s*,\s*(?:29|33|24|36)\s*,/g, 'rgba(40, 52, 44,'],
    [/#0E1B24/gi, '#28342C'], [/#152632/gi, '#2E3A31'], [/#10202b/gi, '#2A2A22'], [/#233D4D/gi, '#3A4D3F']);
}
function retheme(root) {
  if (!RETHEME.length) return;
  for (const e of [root, ...root.querySelectorAll('*')]) {
    for (const a of ['style', 'fill', 'stroke', 'stop-color']) {
      const v = e.getAttribute(a); if (!v) continue;
      let w = v; for (const [re, to] of RETHEME) w = w.replace(re, to);
      if (w !== v) e.setAttribute(a, w);
    }
  }
}

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
const slots = {};
const viewCams = [];
const tracked = [];
const wall = makeWall(); wall.visible = false; world.scene.add(wall);
const motionCache = new Map();
const ctx = {
  THREE, world, scene: world.scene, camera: world.camera, PALETTE, MO, DR, HD, BT, CH, YO, MOUND, FLAT,
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
  // 演員以「槽位」管理：投手 a0, a1…（分割畫面 show 可用數字或 'a0'）；打者 b0, b1…（show 用 'b0'）
  actor(i, opts) {
    for (let k = 0; k <= i; k++) if (!slots['a' + k]) { const n = new Actor(world.scene, opts); n.slot = 'a' + k; n.slotNum = k; slots[n.slot] = n; actors.push(n); }
    const a = slots['a' + i];
    a.root.visible = true; a.used = true;
    return a;
  },
  batter(i = 0, opts) {
    const key = 'b' + i;
    if (!slots[key]) { const n = new BT.Batter(world.scene, opts); n.slot = key; slots[key] = n; actors.push(n); }
    const b = slots[key];
    b.root.visible = true; b.used = true;
    return b;
  },
  swing(variant = {}) {
    const key = 'swing:' + JSON.stringify(variant);
    return ctx.motion(key, () => BT.makeSwing(variant));
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
    if (a.pitcher.setFace) a.pitcher.setFace('smile');
    a.offset.set(0, 0, 0);
  }
  ctx.env({});
  world.renderer.setClearColor(world.clearColor || '#0E1B24');
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
    retheme(el);
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

// ─────────────── 效果層（擬聲字、星星、汗滴）：場景在 update 裡登記，相機都設定好之後才投影 ───────────────
const fxRoot = document.createElement('div');
fxRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none';
document.getElementById('stage').insertBefore(fxRoot, subsEl);
const fxPool = [];
let fxReq = [];
ctx.fx = (r) => { fxReq.push(r); };
const OUT = (c, w) => [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]].map(([x, y]) => `${x * w}px ${y * w}px 0 ${c}`).join(',');
const STAR = (x, y, r) => `<path transform="translate(${x},${y})" d="M0,${-r} Q${r * 0.18},${-r * 0.18} ${r},0 Q${r * 0.18},${r * 0.18} 0,${r} Q${-r * 0.18},${r * 0.18} ${-r},0 Q${-r * 0.18},${-r * 0.18} 0,${-r}Z" fill="#FFE27A" stroke="#7a5520" stroke-width="3" stroke-linejoin="round"/>`;
function fxHTML(r) {
  if (r.kind === 'word') return `<div style="font-family:'Chiron GoRound TC','Noto Sans TC',sans-serif;font-weight:900;font-size:96px;line-height:1;white-space:nowrap;letter-spacing:2px;color:${r.color || '#FF8A3D'};text-shadow:${OUT('#3a2c22', 4)},0 8px 12px rgba(0,0,0,0.3)">${r.text}</div>`;
  if (r.kind === 'sparkle') return `<svg width="150" height="150" viewBox="-75 -75 150 150" style="display:block;overflow:visible">${STAR(-8, -12, 30)}${STAR(36, 18, 18)}${STAR(-40, 30, 13)}</svg>`;
  if (r.kind === 'sweat') return `<svg width="70" height="90" viewBox="-35 -45 70 90" style="display:block;overflow:visible"><path d="M0,-34 C12,-12 24,4 24,16 A24,24 0 0 1 -24,16 C-24,4 -12,-12 0,-34Z" fill="#A9DBFF" stroke="#2f5a7a" stroke-width="4"/><ellipse cx="-8" cy="12" rx="5" ry="9" fill="#fff" opacity="0.85"/></svg>`;
  return '';
}
function fxAnim(r) {
  const a = r.age;
  if (r.kind === 'word') return { s: a < 0.08 ? easeOut(a / 0.08) * 1.2 : a < 0.16 ? 1.2 - 0.2 * (a - 0.08) / 0.08 : 1, o: 1 - smooth(0.32, 0.5, a), dy: -30 * easeOut(clamp(a / 0.5, 0, 1)) };
  if (r.kind === 'sparkle') return { s: easeOut(clamp(a / 0.22, 0, 1)) * (0.88 + 0.12 * Math.sin(a * 14)), o: 1 - smooth(0.95, 1.35, a), dy: -12 * a };
  return { s: easeOut(clamp(a / 0.2, 0, 1)), o: 1 - smooth(1.15, 1.55, a), dy: 22 * smooth(0.2, 1.3, a) };
}
function drawFx() {
  let n = 0;
  for (const r of fxReq) {
    const pos = r.pos.isVector3 ? r.pos : new THREE.Vector3(...r.pos);
    let p, sc = 1;
    if (ctx.views && ctx.views.length) {
      const vi = ctx.views.findIndex(v => v.show.includes(r.slot));
      if (vi < 0) continue;
      const rc = ctx.views[vi].rect;
      p = ctx.projectView(vi, pos); sc = Math.min(1, Math.sqrt(rc[2] / 1920) * 1.3);
      if (p.z > 1 || p.x < rc[0] + 20 || p.x > rc[0] + rc[2] - 20 || p.y < rc[1] + 20 || p.y > rc[1] + rc[3] - 20) continue;
      p = { ...p };
    } else { p = ctx.project(pos); if (!p.vis) continue; p = { ...p }; }
    // 擬聲字：從頭往擊球點的方向再推出去一點，避免壓在角色身上；也不要掉到字幕區
    let rc = [0, 0, 1920, 1080];
    if (ctx.views && ctx.views.length) rc = ctx.views[ctx.views.findIndex(v => v.show.includes(r.slot))].rect;
    if (r.from) {
      const f = r.from.isVector3 ? r.from : new THREE.Vector3(...r.from);
      const q = ctx.views && ctx.views.length ? ctx.projectView(ctx.views.findIndex(v => v.show.includes(r.slot)), f) : ctx.project(f);
      const side = Math.sign(p.x - q.x) || 1;      // 往遠離頭（身體）的那一側水平推開，並稍微往上
      p = { ...p, x: p.x + side * 160 * sc, y: Math.min(p.y, q.y + 80 * sc) - 40 * sc };
      p.x = Math.min(Math.max(p.x, rc[0] + 90 * sc), rc[0] + rc[2] - 90 * sc);
      p.y = Math.min(Math.max(p.y, rc[1] + 120 * sc), rc[1] + rc[3] - 200 * sc);
    }
    const el = fxPool[n] || (fxPool[n] = fxRoot.appendChild(document.createElement('div')));
    n++;
    const key = r.kind + (r.text || '') + (r.color || '');
    if (el.dataset.key !== key) { el.dataset.key = key; el.innerHTML = fxHTML(r); }
    const A = fxAnim(r), k = sc * (r.size || 1);
    el.style.cssText = `position:absolute;display:block;left:${p.x + (r.ox || 0) * sc}px;top:${p.y + (r.oy || 0) * sc + A.dy * sc}px;transform:translate(-50%,-50%) scale(${A.s * k}) rotate(${r.rot || 0}deg);opacity:${A.o}`;
  }
  for (let i = n; i < fxPool.length; i++) fxPool[i].style.display = 'none';
  fxReq = [];
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
  r.setClearColor(world.clearColor || '#0E1B24');
  r.clear();
  ctx.views.forEach((v, i) => {
    const [x, y, w, h] = v.rect;
    actors.forEach((a, k) => {
      const on = v.show.includes(a.slot) || (a.slotNum !== undefined && v.show.includes(a.slotNum));
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
    // 染色每格重設：場景只在某一段染紅（錯誤示範）時，不會殘留到後面，分段渲染的結果也一致
    for (const a of actors) { a.pitcher.tint('#ffffff', 0); if (a.pitcher.setFace) a.pitcher.setFace('smile'); }
  }
  fxReq = [];
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
  // 音效收集模式：只跑場景邏輯、記下擬聲字（擊球事件），不算圖
  if (window.__collect) {
    for (const r of fxReq) if (r.kind === 'word') window.__collect.push({ t, scene: sc.id, slot: r.slot, text: r.text, age: r.age });
    fxReq = [];
    return true;
  }
  drawFx();
  if (painter) painter.update(t, ctx.views && ctx.views.length ? viewCams[0] : world.camera);
  if (ctx.views && ctx.views.length) renderViews(); else world.render();
  window.__tRender = performance.now() - pq1;
  return true;
};
window.timeline = timeline;
window.__missing = timeline.scenes.map(s => s.id).filter(id => !SCENES[id]);
window.__world = world; window.__actors = actors;
if (THEME === 'painted') {
  // 中文字型依字元分成很多小檔：先全部載入，避免後面才出現的字閃一下備用字型
  await Promise.all([...document.fonts].filter(f => /Chiron|WenKai/.test(f.family)).map(f => f.load().catch(() => {})));
}
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
