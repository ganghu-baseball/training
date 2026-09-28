// 用法：node tools/shots.mjs out.png '[{"v":{},"t":-0.62,"cam":"side"},...]' [cols] [width]
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const [out, specJson, cols = '4', width = '640'] = process.argv.slice(2);
const specs = JSON.parse(specJson);
const root = path.resolve('.');
const srv = await serve(root, 8801);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = +width, H = Math.round(W * 9 / 16);
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('PAGE', m.type(), m.text()); });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(`http://localhost:8801/engine/preview.html?w=${W}`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const tmp = fs.mkdtempSync('/tmp/claude-0/shots-');
const files = [];
for (let i = 0; i < specs.length; i++) {
  const s = specs[i];
  const info = await page.evaluate(([v, t, cam]) => window.show(v, t, cam), [s.v || {}, s.t, s.cam || 'side']);
  const f = path.join(tmp, `s${String(i).padStart(3, '0')}.png`);
  await page.screenshot({ path: f });
  files.push({ f, label: `${s.label || ''} t=${s.t} ${s.cam || 'side'} kR=${info.rKnee.toFixed(0)} kL=${info.lKnee.toFixed(0)}${info.rReach ? '' : ' !R'}${info.lReach ? '' : ' !L'}` });
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(tmp, 'list.json'), JSON.stringify(files));
execFileSync('python3', ['tools/tile.py', path.join(tmp, 'list.json'), out, cols], { stdio: 'inherit' });
