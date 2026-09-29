"""把渲染好的影片與混音合成最終成品，並輸出較小的 720p 版本。
python3 tools/finalize.py"""
import subprocess, imageio_ffmpeg, os
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs('dist', exist_ok=True)
V = 'build/master_video.mp4'
# 章節標記（播放器可直接跳章）
import json
tl = json.load(open('build/timeline.json', encoding='utf-8'))
NAMES = {1: '投球是一場接力賽', 2: '力量大，不等於會用力量', 3: '看懂四個關鍵時刻', 4: '節奏', 5: '好的提示與學習方法', 6: '保護手臂的好習慣',
         7: '第一棒：後腳和髖部的蓄力', 8: '第二棒：跨步和前腳煞車', 9: '第三棒：骨盆帶動胸口', 10: '最後一棒：手臂和出手', 11: '收尾與減速',
         12: '髖關節訓練', 13: '藥球和水袋', 14: '怎麼判斷進步'}
PARTS = {1: '入門篇', 2: '進階篇', 3: '訓練篇'}
# 哪些場景是「部分」標題卡（寫在腳本裡）
part_of = {s['id']: s['part'] for s in json.load(open('build/script.json', encoding='utf-8')) if s.get('part')}
marks = [(0.0, '開場')]
for s in tl['scenes']:
    if s['id'] in part_of: marks.append((s['t0'], f"PART {part_of[s['id']]}｜{PARTS[part_of[s['id']]]}"))
    if s.get('chapter'): marks.append((s['t0'], f"{s['chapter']:02d} {NAMES[s['chapter']]}"))
marks.append((next(s['t0'] for s in tl['scenes'] if s['id'] == 'summary'), '總結'))
meta = [';FFMETADATA1', 'title=投球原理：從腳到手的力量接力']
for i, (t0, name) in enumerate(marks):
    t1 = marks[i + 1][0] if i + 1 < len(marks) else tl['duration']
    meta += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={int(t0 * 1000)}', f'END={int(t1 * 1000)}', f'title={name}']
open('build/chapters.ffmeta', 'w', encoding='utf-8').write('\n'.join(meta) + '\n')
def run(args):
    print(' '.join(args[:6]), '...'); subprocess.run([FF, '-y', '-loglevel', 'error'] + args, check=True)
# 1080p（旁白＋配樂）
run(['-i', V, '-i', 'build/mix.wav', '-i', 'build/chapters.ffmeta', '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2',
     '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'dist/投球原理動畫_1080p.mp4'])
# 1080p（只有旁白，方便自行搭配音樂）
run(['-i', V, '-i', 'build/voice.wav', '-i', 'build/chapters.ffmeta', '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2',
     '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', 'dist/投球原理動畫_1080p_無配樂.mp4'])
# 720p（檔案較小，手機觀看）
# 每個章節開頭強制關鍵影格，章節跳轉準確，也能在章節交界無損切段
kf = ','.join(f'{t0:.3f}' for t0, _ in marks[1:])
run(['-i', 'dist/投球原理動畫_1080p.mp4', '-map_chapters', '0', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
     '-force_key_frames', kf, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'dist/投球原理動畫_720p.mp4'])
# 分成三段（入門篇／進階篇／訓練篇，每段 < 30 MB，方便用通訊軟體傳送）
starts = {part_of[s['id']]: s['t0'] for s in tl['scenes'] if s['id'] in part_of}
cuts = [starts[2], starts[3]]
parts = [(0.0, cuts[0], '1_入門篇'), (cuts[0], cuts[1], '2_進階篇'), (cuts[1], tl['duration'], '3_訓練篇')]
import math
kfAt = lambda t: math.ceil(t * 30 - 1e-6) / 30      # 強制關鍵影格落在時間點之後的第一格
for f in os.listdir('dist'):
    if f.startswith('投球原理動畫_720p_') and f.endswith('.mp4'): os.remove('dist/' + f)
for t0, t1, name in parts:
    a, b = (kfAt(t0) + 0.001 if t0 > 0 else 0.0), (kfAt(t1) if t1 < tl['duration'] else tl['duration'])
    run(['-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', 'dist/投球原理動畫_720p.mp4', '-map', '0:v', '-map', '0:a', '-c', 'copy',
         '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', f'dist/投球原理動畫_720p_{name}.mp4'])
for f in sorted(os.listdir('dist')): print(f, round(os.path.getsize('dist/' + f) / 1e6, 1), 'MB')
