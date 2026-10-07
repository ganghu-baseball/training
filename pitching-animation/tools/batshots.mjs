// 用法：node tools/batshots.mjs out.png '[[{swing opts}, t, "front", {pitch:true}], ...]' [cols] [w]
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
const [out, specJson, cols = '3', w = '640'] = process.argv.slice(2);
const CAMS = {
  front: { pos: [18.15, 1.15, -3.0], look: [18.15, 1.0, 0.6], fov: 38 },
  catcher: { pos: [21.6, 1.5, 0.2], look: [18.2, 1.0, 0.5], fov: 34 },
  pitcher: { pos: [12.0, 1.6, -0.4], look: [18.2, 1.0, 0.55], fov: 20 },
  back: { pos: [18.2, 1.3, 4.2], look: [18.2, 1.0, 0.6], fov: 36 },
  top: { pos: [18.2, 6.5, 0.5], look: [18.2, 0, 0.5], up: [-1, 0, 0], fov: 34 },
  hands: { pos: [17.6, 1.3, -1.0], look: [18.1, 1.05, 0.5], fov: 24 },
};
const specs = JSON.parse(specJson);
const srv = await serve(process.cwd(), 8796);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: Math.round(+w * 9 / 16) } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(`http://localhost:8796/engine/batter-preview.html?w=${w}`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const dir = '/tmp/claude-0/bshots'; fs.mkdirSync(dir, { recursive: true });
const files = [];
for (let i = 0; i < specs.length; i++) {
  const [opts, t, cam, extra] = specs[i];
  const info = await page.evaluate(([o, tt, c, e]) => window.show(o, tt, c, e || {}), [opts, t, typeof cam === 'string' ? CAMS[cam] : cam, extra]);
  const f = `${dir}/b${i}.png`;
  await page.screenshot({ path: f });
  files.push({ f, label: `${JSON.stringify(opts)} t=${t} ${typeof cam === 'string' ? cam : ''}` });
  console.log(i, t, JSON.stringify(info));
}
await browser.close(); srv.close();
fs.writeFileSync(`${dir}/list.json`, JSON.stringify(files));
execFileSync('python3', ['tools/tile.py', `${dir}/list.json`, out, cols], { stdio: 'inherit' });
