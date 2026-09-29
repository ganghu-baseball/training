// 平行渲染影格並編碼成影片（分段、可續跑）
// 用法：node tools/render.mjs --out build/master.mp4 [--from 0 --to 1290 --chunk 60 --workers 4 --crf 20 --preset slow --first 22,23]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path';
import { serve } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const FFMPEG = process.env.FFMPEG || execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const timeline = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const fps = +(args.fps || 30);
const from = +(args.from || 0), to = Math.min(+(args.to || timeline.duration), timeline.duration);
const workers = +(args.workers || 4);
const out = args.out || 'build/render.mp4';
const crf = args.crf || '20';
const preset = args.preset || 'slow';
const chunkSec = +(args.chunk || 60);
const port = 8810 + Math.floor(Math.random() * 100);
const nFrames = Math.round((to - from) * fps);
const chunkDir = path.join('build', 'chunks_' + path.basename(out, '.mp4'));
fs.mkdirSync(chunkDir, { recursive: true });
const perChunk = Math.round(chunkSec * fps);
const chunks = [];
for (let f0 = 0, i = 0; f0 < nFrames; f0 += perChunk, i++) chunks.push({ i, f0, f1: Math.min(nFrames, f0 + perChunk), file: path.join(chunkDir, `c${String(i).padStart(3, '0')}.mp4`) });
const todo = chunks.filter(c => !fs.existsSync(c.file + '.done'));
// --first 22,23,24：先算指定的分段（例如先做出某一章的預覽）
if (args.first) { const pri = args.first.split(',').map(Number); todo.sort((a, b) => (pri.includes(b.i) - pri.includes(a.i)) || a.i - b.i); }
console.log(`${nFrames} frames, ${chunks.length} chunks, ${todo.length} to render`);

const srv = await serve(path.resolve('.'), port);
const chrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const t0 = Date.now();
let doneFrames = chunks.filter(c => fs.existsSync(c.file + '.done')).reduce((s, c) => s + (c.f1 - c.f0), 0);
const done0 = doneFrames;

async function openPage() {
  const browser = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-compositing'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(`http://localhost:${port}/engine/index.html`);
  await waitReady(page);
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp };
}

// 每段開始前重新載入頁面：渲染途中修改的場景程式，會套用到之後才開始的分段
async function waitReady(page) {
  await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
  const miss = await page.evaluate(() => window.__missing || []);
  if (miss.length) throw new Error('missing scenes: ' + miss.join(','));
}
async function reloadPage(ctx) {
  await ctx.page.reload();
  await waitReady(ctx.page);
}

async function renderChunk(ctx, c) {
  const tmp = c.file + '.part.mp4';
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', '60', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise(res => ff.on('close', res));
  for (let f = c.f0; f < c.f1; f++) {
    const t = from + f / fps;
    await ctx.page.evaluate(tt => window.renderAt(tt), t);
    const r = await ctx.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, optimizeForSpeed: true });
    if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise(res => ff.stdin.once('drain', res));
    doneFrames++;
    if (f % 450 === 0) {
      const el = (Date.now() - t0) / 1000, fpsNow = (doneFrames - done0) / el;
      console.log(`[chunk ${c.i}] frame ${f}/${nFrames}  overall ${(doneFrames / nFrames * 100).toFixed(1)}%  ${fpsNow.toFixed(2)} fps  eta ${((nFrames - doneFrames) / Math.max(fpsNow, 0.01) / 60).toFixed(0)} min`);
    }
  }
  ff.stdin.end();
  const code = await closed;
  if (code !== 0) throw new Error('ffmpeg exit ' + code);
  fs.renameSync(tmp, c.file);
  fs.writeFileSync(c.file + '.done', new Date().toISOString());
}

async function worker(k) {
  let ctx = await openPage(), first = true;
  while (todo.length) {
    const c = todo.shift();
    for (let attempt = 0; attempt < 3; attempt++) {
      try { if (!first) await reloadPage(ctx); first = false; await renderChunk(ctx, c); break; }
      catch (e) {
        console.log(`[w${k}] chunk ${c.i} failed (${e.message}); retry`);
        try { await ctx.browser.close(); } catch (_) {}
        ctx = await openPage();
        if (attempt === 2) throw e;
      }
    }
  }
  await ctx.browser.close();
}

await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, (_, k) => worker(k)));
srv.close();
const list = path.join(chunkDir, 'list.txt');
fs.writeFileSync(list, chunks.map(c => `file '${path.resolve(c.file)}'`).join('\n'));
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
console.log(`done: ${nFrames} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${out}`);
