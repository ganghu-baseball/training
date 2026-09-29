"""把渲染好的影片與混音合成最終成品：主課程（入門＋進階）與額外課程是兩支獨立影片。
先分別渲染：
  node tools/render.mjs --out build/master_main.mp4  --to   <額外課程開始秒數>
  node tools/render.mjs --out build/master_bonus.mp4 --from <額外課程開始秒數>
再執行：python3 tools/finalize.py"""
import subprocess, imageio_ffmpeg, os, json, math
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs('dist', exist_ok=True)
tl = json.load(open('build/timeline.json', encoding='utf-8'))
D = tl['duration']
scene = {s['id']: s for s in tl['scenes']}
T = next(s['t0'] for s in tl['scenes'] if s.get('part') == 3)      # 額外課程開始
NAMES = {1: '投球是一場接力賽', 2: '力量大，不等於會用力量', 3: '看懂四個關鍵時刻', 4: '節奏', 5: '好的提示與學習方法', 6: '保護手臂的好習慣',
         7: '第一棒：後腳和髖部的蓄力', 8: '第二棒：跨步和前腳煞車', 9: '第三棒：骨盆帶動胸口', 10: '最後一棒：手臂和出手', 11: '收尾與減速',
         12: '第 1 課｜髖關節訓練', 13: '第 2 課｜藥球和水袋', 14: '第 3 課｜怎麼判斷進步'}

# 章節標記（各影片從 0 開始）
main_marks = [(0.0, '開場'), (scene['part1']['t0'], 'PART 1｜入門篇')]
bonus_marks = [(0.0, '額外課程：把動作練進身體')]
for s in tl['scenes']:
    if s.get('part') == 2: main_marks.append((s['t0'], 'PART 2｜進階篇'))
    if s.get('chapter'):
        if s['chapter'] <= 11: main_marks.append((s['t0'], f"{s['chapter']:02d} {NAMES[s['chapter']]}"))
        else: bonus_marks.append((s['t0'] - T, NAMES[s['chapter']]))
main_marks.append((scene['summary']['t0'], '總結'))
bonus_marks.append((scene['bonuswrap']['t0'] - T, '額外課程總結'))
main_marks.sort(); bonus_marks.sort()

def ffmeta(path, title, marks, t0, t1):
    """寫出 [t0, t1) 範圍內的章節（時間平移到從 0 開始）"""
    inside = [m for m in marks if t0 - 1e-6 <= m[0] < t1 - 0.5]
    if not inside or inside[0][0] > t0 + 1e-3:
        prev = [m for m in marks if m[0] <= t0]
        inside = ([(t0, prev[-1][1])] if prev else []) + inside
    ms = [(a - t0, n) for a, n in inside]
    meta = [';FFMETADATA1', f'title={title}']
    for i, (a, n) in enumerate(ms):
        b = ms[i + 1][0] if i + 1 < len(ms) else t1 - t0
        meta += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={int(a * 1000)}', f'END={int(b * 1000)}', f'title={n}']
    open(path, 'w', encoding='utf-8').write('\n'.join(meta) + '\n')

def run(args):
    print(' '.join(a for a in args[:8] if not a.startswith('/')), '...', flush=True)
    subprocess.run([FF, '-y', '-loglevel', 'error'] + args, check=True)

for f in os.listdir('dist'):
    if f.endswith('.mp4'): os.remove('dist/' + f)

COURSES = [
    ('主課程', 'build/master_main.mp4', 0.0, T, main_marks, '投球原理：從腳到手的力量接力（主課程）', 'afade=t=out:st={:.3f}:d=1.8'.format(T - 1.8)),
    ('額外課程', 'build/master_bonus.mp4', T, D, bonus_marks, '投球原理：額外課程｜把動作練進身體', 'afade=t=in:st=0:d=0.8'),
]
for name, video, t0, t1, marks, title, fade in COURSES:
    meta = f'build/chapters_{name}.ffmeta'
    ffmeta(meta, title, marks, 0.0, t1 - t0)
    for audio, suffix, br in [('build/mix.wav', '', '192k'), ('build/voice.wav', '_無配樂', '160k')]:
        run(['-i', video, '-ss', f'{t0:.3f}', '-to', f'{t1:.3f}', '-i', audio, '-i', meta, '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2',
             '-c:v', 'copy', '-af', fade, '-c:a', 'aac', '-b:a', br, '-shortest', '-movflags', '+faststart', f'dist/投球原理_{name}_1080p{suffix}.mp4'])

# 720p 傳送版：每個檔案 < 30 MB（方便用通訊軟體傳送）
LIMIT = 29.5 * 1024 * 1024
def enc720(src, a, b, marks_rel, title, out):
    meta = out.replace('dist/', 'build/').replace('.mp4', '.ffmeta')
    ffmeta(meta, title, marks_rel, a, b)
    kf = ','.join(f'{m - a:.3f}' for m, _ in marks_rel if a < m < b)
    inp = ['-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', src, '-i', meta, '-map_metadata', '1', '-map_chapters', '1']
    vid = ['-map', '0:v', '-vf', 'scale=1280:720:flags=lanczos', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'slow'] + (['-force_key_frames', kf] if kf else [])
    aud = ['-map', '0:a', '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart']
    run(inp + vid + ['-crf', '24'] + aud + [out])
    if os.path.getsize(out) > LIMIT:
        # 超過上限：改用兩段式編碼，把平均位元率壓在上限內
        vbr = int((LIMIT * 8 * 0.96) / (b - a) - 112000)
        log = '/tmp/claude-0/x264pass'
        run(inp + vid + ['-b:v', str(vbr), '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null'])
        run(inp + vid + ['-b:v', str(vbr), '-pass', '2', '-passlogfile', log] + aud + [out])

p2 = scene['part2']['t0']
enc720('dist/投球原理_主課程_1080p.mp4', 0.0, p2, main_marks, '投球原理（主課程）入門篇', 'dist/投球原理_主課程_720p_1_入門篇.mp4')
enc720('dist/投球原理_主課程_1080p.mp4', p2, T, main_marks, '投球原理（主課程）進階篇', 'dist/投球原理_主課程_720p_2_進階篇.mp4')
enc720('dist/投球原理_額外課程_1080p.mp4', 0.0, D - T, bonus_marks, '投球原理：額外課程', 'dist/投球原理_額外課程_720p.mp4')
for f in sorted(os.listdir('dist')): print(f, round(os.path.getsize('dist/' + f) / 1e6, 1), 'MB')
