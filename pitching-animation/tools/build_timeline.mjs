// 依旁白實際長度排出整支影片的時間軸，並輸出字幕檔（SRT）
import fs from 'fs';
const script = JSON.parse(fs.readFileSync('build/script.json', 'utf8'));
const tts = JSON.parse(fs.readFileSync('build/audio/tts.json', 'utf8'));
let meta = {};
try { const m = await import('../content/scenes.js'); meta = m.SCENES || {}; } catch (e) { console.warn('scenes.js not loaded:', e.message); }
const LINE_GAP = 0.42;
let t = 0;
const scenes = [], subtitles = [];
for (const sc of script) {
  const lines = tts[sc.id] || [];
  const m = meta[sc.id] || {};
  const t0 = t;
  t += sc.pre ?? 0.4;
  const L = [];
  lines.forEach((ln, i) => {
    const lt0 = t;
    L.push({ t0: lt0, t1: lt0 + ln.dur, file: ln.file, text: sc.lines[i].t });
    for (const ch of ln.chunks) subtitles.push({ t0: +(lt0 + ch.t0).toFixed(3), t1: +(lt0 + ch.t1).toFixed(3), text: ch.text });
    t += ln.dur;
    if (i < lines.length - 1) t += LINE_GAP;
  });
  t += sc.post ?? 0.6;
  if (m.minDur && t - t0 < m.minDur) t = t0 + m.minDur;
  scenes.push({ id: sc.id, chapter: sc.chapter || null, part: sc.part || null, t0: +t0.toFixed(3), t1: +t.toFixed(3), lines: L, transition: m.transition || 'dip' });
}
// 讓相鄰字幕之間不重疊，並把很短的空檔補起來（字幕不閃爍）
subtitles.sort((a, b) => a.t0 - b.t0);
for (let i = 0; i < subtitles.length - 1; i++) {
  const a = subtitles[i], b = subtitles[i + 1];
  if (b.t0 - a.t1 < 0.25 && b.t0 > a.t1) a.t1 = b.t0;
  if (a.t1 > b.t0) a.t1 = b.t0;
}
const out = { fps: 30, duration: +t.toFixed(3), scenes, subtitles };
fs.writeFileSync('build/timeline.json', JSON.stringify(out, null, 1));
fs.mkdirSync('dist', { recursive: true });
const fmt = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), mi = Math.floor(ms / 60000) % 60, se = Math.floor(ms / 1000) % 60, mm = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')},${String(mm).padStart(3, '0')}`; };
// 主課程與額外課程是兩支影片：字幕各自從 0 開始
const bonus = scenes.find(s => s.part === 3);
const T = bonus ? bonus.t0 : out.duration;
const srt = (list, off) => list.map((s, i) => `${i + 1}\n${fmt(s.t0 - off)} --> ${fmt(s.t1 - off)}\n${s.text}\n`).join('\n');
for (const f of fs.readdirSync('dist')) if (f.endsWith('.srt')) fs.unlinkSync('dist/' + f);
fs.writeFileSync('dist/投球原理_主課程_字幕.srt', srt(subtitles.filter(s => s.t0 < T), 0));
if (bonus) fs.writeFileSync('dist/投球原理_額外課程_字幕.srt', srt(subtitles.filter(s => s.t0 >= T), T));
const mins = Math.floor(t / 60), secs = Math.round(t % 60);
console.log(`scenes ${scenes.length}, subtitles ${subtitles.length}, duration ${t.toFixed(1)}s (${mins}m${secs}s)`);
// 章節時間表
const ch = scenes.filter(s => s.chapter).map(s => `${fmt(s.t0).slice(3, 8)} 第${s.chapter}章`);
fs.writeFileSync('build/chapters.txt', ch.join('\n'));
