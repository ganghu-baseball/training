// Render intro.html frame by frame with headless Chromium and pipe the frames to ffmpeg.
//   node render.js video out.mp4          -> silent 1080x1920 @30fps H.264 (length = DUR in intro.html)
//   node render.js stills outdir 1,2.5,9  -> PNG stills at the given times (seconds)
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const W = 1080, H = 1920, FPS = 30;
const [mode, out, times] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => { console.error('[page error]', e); process.exit(1); });
  await page.goto('file://' + path.resolve(__dirname, 'intro.html'));
  const fontsOk = await page.evaluate(() => window.ready);
  if (!fontsOk) throw new Error('fonts failed to load');
  const canvas = page.locator('canvas');

  if (mode === 'stills') {
    fs.mkdirSync(out, { recursive: true });
    for (const t of times.split(',').map(Number)) {
      await page.evaluate(t => window.render(t), t);
      await canvas.screenshot({ path: path.join(out, `t${t.toFixed(2)}.png`) });
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(FPS * await page.evaluate(() => window.DUR));
    for (let i = 0; i < n; i++) {
      await page.evaluate(t => window.render(t), i / FPS);
      const buf = await canvas.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 30 === 0) process.stdout.write(`frame ${i}/${n}\n`);
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
