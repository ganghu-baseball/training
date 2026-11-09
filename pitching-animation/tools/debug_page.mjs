import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import path from 'path';
const srv = await serve(path.resolve('.'), 8799);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('PAGEERR', e.message, e.stack?.slice(0, 500)));
page.on('requestfailed', r => console.log('REQFAIL', r.url()));
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await page.goto('http://localhost:8799/engine/index.html');
try { await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 }); console.log('READY'); }
catch (e) { console.log('NOT READY'); }
const t = +(process.argv[2] || 8);
const r = await page.evaluate(tt => { window.renderAt(tt); return 'ok'; }, t).catch(e => 'ERR ' + e.message);
console.log('render', r);
await page.screenshot({ path: process.argv[3] || 'build/debug.png' });
await browser.close(); srv.close();
