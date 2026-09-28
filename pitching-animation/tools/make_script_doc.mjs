// 輸出旁白腳本（含章節時間）給使用者：dist/投球原理動畫_旁白腳本.md（教學內容，不進公開 repo）
import fs from 'fs';
import { SCRIPT } from '../content/script.js';
const tl = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const chapterNames = { 1: '投球是一場接力賽', 2: '力量大，不等於會用力量', 3: '看懂投球的四個關鍵時刻', 4: '第一棒：後腳和髖部的蓄力', 5: '第二棒：跨步和前腳煞車',
  6: '第三棒：骨盆帶動胸口', 7: '最後一棒：手臂和出手', 8: '收尾與減速', 9: '節奏', 10: '用「限制」教會身體：藥球和水袋', 11: '好的提示與學習方法', 12: '怎麼知道自己真的進步了', 13: '保護手臂的好習慣' };
let md = `# 投球原理：從腳到手的力量接力｜旁白腳本\n\n影片長度 ${mmss(tl.duration)}（1080p／30fps）。字幕檔：投球原理動畫_字幕.srt\n\n## 章節時間表\n\n| 時間 | 章節 |\n|---|---|\n| 00:00 | 開場 |\n`;
for (const s of tl.scenes) if (s.chapter) md += `| ${mmss(s.t0)} | 第 ${s.chapter} 章　${chapterNames[s.chapter]} |\n`;
const sum = tl.scenes.find(s => s.id === 'summary'); md += `| ${mmss(sum.t0)} | 總結 |\n\n## 旁白全文\n`;
for (const sc of SCRIPT) {
  const s = tl.scenes.find(x => x.id === sc.id);
  if (sc.chapter) md += `\n### 第 ${sc.chapter} 章　${chapterNames[sc.chapter]}\n\n`;
  else if (sc.id === 'intro') md += `\n### 開場\n\n`;
  else if (sc.id === 'summary') md += `\n### 總結\n\n`;
  sc.lines.forEach((l, i) => { if (sc.chapter) return; md += `- \`${mmss(s.lines[i].t0)}\` ${l.t}\n`; });
}
fs.writeFileSync('dist/投球原理動畫_旁白腳本.md', md);
console.log('written', md.length, 'chars');
