// 依「場景 id + 場景內秒數」渲染靜態畫面並拼成對照圖
// node tools/stills.mjs out.png "intro@2,intro@8,title@5" [cols] [width]
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import fs from 'fs'; import path from 'path'; import { execFileSync } from 'child_process';
const [out, spec, cols = '3', width = '640'] = process.argv.slice(2);
const tl = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const items = spec.split(',').map(s => {
  const [id, rel] = s.split('@');
  const sc = tl.scenes.find(x => x.id === id);
  if (!sc) throw new Error('no scene ' + id);
  let t;
  if (rel.startsWith('L')) { const [li, off] = rel.slice(1).split('+'); t = sc.lines[+li].t0 + (+off || 0); }
  else if (rel.endsWith('%')) t = sc.t0 + (sc.t1 - sc.t0) * parseFloat(rel) / 100;
  else t = sc.t0 + parseFloat(rel);
  return { id, rel, t };
});
const srv = await serve(path.resolve('.'), 8790 + Math.floor(Math.random() * 9));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('ERR', m.text()); });
await page.goto(`http://localhost:${srv.address().port}/engine/index.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
const tmp = fs.mkdtempSync('/tmp/claude-0/stills-');
const files = [];
for (let i = 0; i < items.length; i++) {
  await page.evaluate(tt => window.renderAt(tt), items[i].t);
  const f = path.join(tmp, `s${String(i).padStart(3, '0')}.png`);
  await page.screenshot({ path: f });
  if (width !== '1920') execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${f}'); im.resize((${width}, ${Math.round(+width * 9 / 16)}), Image.LANCZOS).save('${f}')`]);
  files.push({ f, label: `${items[i].id}@${items[i].rel} (t=${items[i].t.toFixed(1)})` });
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(tmp, 'list.json'), JSON.stringify(files));
execFileSync('python3', ['tools/tile.py', path.join(tmp, 'list.json'), out, cols], { stdio: 'inherit' });
