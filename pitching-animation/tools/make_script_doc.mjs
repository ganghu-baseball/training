// 輸出旁白腳本（含章節時間）給使用者：dist/投球原理_旁白腳本.md（教學內容，不進公開 repo）
import fs from 'fs';
import path from 'path'; import { pathToFileURL } from 'url';
const { SCRIPT } = await import(pathToFileURL(path.resolve('content/script.js')).href);
const tl = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const chapterNames = { 1: '投球是一場接力賽', 2: '力量大，不等於會用力量', 3: '看懂投球的四個關鍵時刻', 4: '節奏', 5: '好的提示與學習方法', 6: '保護手臂的好習慣',
  7: '第一棒：後腳和髖部的蓄力', 8: '第二棒：跨步和前腳煞車', 9: '第三棒：骨盆帶動胸口', 10: '最後一棒：手臂和出手', 11: '收尾與減速',
  12: '髖關節訓練', 13: '用「限制」教會身體：藥球和水袋', 14: '怎麼知道自己真的進步了' };
const partNames = { 1: '入門篇：先把投球看懂', 2: '進階篇：一棒一棒拆開來看', 3: '額外課程：把動作練進身體' };
const chLabel = n => n >= 12 ? `第 ${n - 11} 課` : `第 ${n} 章`;
const at = id => tl.scenes.find(x => x.id === id);
const bonus = tl.scenes.find(s => s.part === 3);
const T = bonus ? bonus.t0 : tl.duration;
const rel = t => mmss(t >= T ? t - T : t);
let md = `# 投球原理：從腳到手的力量接力｜旁白腳本\n\n`;
md += `- 主課程（入門篇＋進階篇）：${mmss(T)}，字幕檔：投球原理_主課程_字幕.srt\n`;
md += `- 額外課程（把動作練進身體）：${mmss(tl.duration - T)}，字幕檔：投球原理_額外課程_字幕.srt\n\n`;
md += `## 主課程章節時間表\n\n| 時間 | 章節 |\n|---|---|\n| 00:00 | 開場 |\n`;
for (const sc of SCRIPT) {
  const s = at(sc.id);
  if (sc.part === 3) md += `\n## 額外課程章節時間表\n\n| 時間 | 課程 |\n|---|---|\n| 00:00 | 額外課程開場 |\n`;
  else if (sc.part) md += `| ${rel(s.t0)} | **第 ${sc.part} 部分　${partNames[sc.part]}** |\n`;
  if (sc.chapter) md += `| ${rel(s.t0)} | ${chLabel(sc.chapter)}　${chapterNames[sc.chapter]} |\n`;
  if (sc.id === 'summary') md += `| ${rel(s.t0)} | 總結 |\n`;
  if (sc.id === 'bonuswrap') md += `| ${rel(s.t0)} | 額外課程總結 |\n`;
}
md += `\n# 旁白全文\n`;
for (const sc of SCRIPT) {
  const s = at(sc.id);
  if (sc.part === 3) md += `\n## 額外課程　把動作練進身體\n\n`;
  else if (sc.part) { md += `\n## 第 ${sc.part} 部分　${partNames[sc.part]}\n`; continue; }
  if (sc.chapter) md += `\n### ${chLabel(sc.chapter)}　${chapterNames[sc.chapter]}\n\n`;
  else if (sc.id === 'intro') md += `\n## 主課程\n\n### 開場\n\n`;
  else if (sc.id === 'terms') md += `\n### 名詞小教室\n\n`;
  else if (sc.id === 'summary') md += `\n### 總結\n\n`;
  else if (sc.id === 'bonuswrap') md += `\n### 額外課程總結\n\n`;
  sc.lines.forEach((l, i) => { if (sc.chapter) return; md += `- \`${rel(s.lines[i].t0)}\` ${l.t}\n`; });
}
for (const f of fs.readdirSync('dist')) if (f.endsWith('.md')) fs.unlinkSync('dist/' + f);
fs.writeFileSync('dist/投球原理_旁白腳本.md', md);
console.log('written', md.length, 'chars');
