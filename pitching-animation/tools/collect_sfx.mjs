// 收集擊球音效時間點：逐格跑場景邏輯（不算圖），擬聲字第一次出現的那一格就是擊球（或揮空）的瞬間
// 用法：node tools/collect_sfx.mjs [fps=30] → content/sfx_events.json
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import fs from 'fs';
const fps = +(process.argv[2] || 30);
const srv = await serve(process.cwd(), 8797);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://localhost:8797/engine/index.html');
await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
const events = await page.evaluate((fps) => {
  const D = window.timeline.duration, out = [];
  let prev = new Map();
  window.__collect = [];
  for (let f = 0; f < D * fps; f++) {
    const t = f / fps;
    window.__collect.length = 0;
    window.renderAt(t);
    const cur = new Map();
    for (const e of window.__collect) {
      const k = e.scene + '|' + e.slot + '|' + e.text;
      cur.set(k, e);
      const p = prev.get(k);
      if (!p || e.age < p.age - 1e-6) out.push({ t: t - Math.max(0, Math.min(e.age, 0.5 / fps)), scene: e.scene, slot: e.slot, text: e.text });
    }
    prev = cur;
  }
  window.__collect = null;
  return out;
}, fps);
// 同一時間（分割畫面）好幾個事件 → 每種聲音在 60ms 內只留一個
events.sort((a, b) => a.t - b.t);
const kept = [];
for (const e of events) if (!kept.some(k => k.text === e.text && Math.abs(k.t - e.t) < 0.06)) kept.push(e);
fs.writeFileSync('content/sfx_events.json', JSON.stringify(kept.map(e => ({ ...e, t: +e.t.toFixed(3) })), null, 0));
console.log(events.length, 'raw events →', kept.length, 'sounds');
await browser.close(); srv.close();
