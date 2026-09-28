"""把渲染好的影片與混音合成最終成品，並輸出較小的 720p 版本。
python3 tools/finalize.py"""
import subprocess, imageio_ffmpeg, os
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs('dist', exist_ok=True)
V = 'build/master_video.mp4'
# 章節標記（播放器可直接跳章）
import json
tl = json.load(open('build/timeline.json', encoding='utf-8'))
NAMES = {1: '投球是一場接力賽', 2: '力量大，不等於會用力量', 3: '看懂四個關鍵時刻', 4: '後腳和髖部的蓄力', 5: '跨步和前腳煞車', 6: '骨盆帶動胸口',
         7: '手臂和出手', 8: '收尾與減速', 9: '節奏', 10: '藥球和水袋', 11: '好的提示與學習方法', 12: '怎麼判斷進步', 13: '保護手臂的好習慣'}
marks = [(0.0, '開場')] + [(s['t0'], f"{s['chapter']:02d} {NAMES[s['chapter']]}") for s in tl['scenes'] if s.get('chapter')]
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
run(['-i', 'dist/投球原理動畫_1080p.mp4', '-map_chapters', '0', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'dist/投球原理動畫_720p.mp4'])
for f in sorted(os.listdir('dist')): print(f, round(os.path.getsize('dist/' + f) / 1e6, 1), 'MB')
