"""單一課程的成品輸出（打擊課程用）：1080p 完整版（有配樂／無配樂）＋ 720p 分段傳送版（每段 < 30 MB）。
設定檔 content/finalize.json：
  {"title": "打擊原理", "full_title": "...", "chapters": [["sceneId", "章節名"], ...], "parts": [["名稱", "起始 sceneId"], ...]}
先渲染：node tools/render.mjs --out build/master.mp4，再執行：python3 tools/finalize_single.py"""
import subprocess, imageio_ffmpeg, os, json
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs('dist', exist_ok=True)
cfg = json.load(open('content/finalize.json', encoding='utf-8'))
tl = json.load(open('build/timeline.json', encoding='utf-8'))
D = tl['duration']
scene = {s['id']: s for s in tl['scenes']}
TITLE = cfg['title']
marks = sorted((scene[sid]['t0'] if sid in scene else 0.0, name) for sid, name in cfg['chapters'])

def ffmeta(path, title, t0, t1):
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

meta = 'build/chapters_full.ffmeta'
ffmeta(meta, cfg['full_title'], 0.0, D)
full = f'dist/{TITLE}_1080p.mp4'
for audio, suffix, br in [('build/mix.wav', '', '192k'), ('build/voice.wav', '_無配樂', '160k')]:
    run(['-i', 'build/master.mp4', '-i', audio, '-i', meta, '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', br, '-shortest', '-movflags', '+faststart', f'dist/{TITLE}_1080p{suffix}.mp4'])

LIMIT = 29.5 * 1024 * 1024
def enc720(a, b, title, out):
    m = out.replace('dist/', 'build/').replace('.mp4', '.ffmeta')
    ffmeta(m, title, a, b)
    kf = ','.join(f'{t - a:.3f}' for t, _ in marks if a < t < b)
    inp = ['-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', full, '-i', m, '-map_metadata', '1', '-map_chapters', '1']
    vid = ['-map', '0:v', '-vf', 'scale=1280:720:flags=lanczos', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'slow'] + (['-force_key_frames', kf] if kf else [])
    aud = ['-map', '0:a', '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart']
    run(inp + vid + ['-crf', '24'] + aud + [out])
    if os.path.getsize(out) > LIMIT:
        vbr = int((LIMIT * 8 * 0.96) / (b - a) - 112000)
        log = '/tmp/claude-0/x264pass'
        run(inp + vid + ['-b:v', str(vbr), '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null'])
        run(inp + vid + ['-b:v', str(vbr), '-pass', '2', '-passlogfile', log] + aud + [out])

parts = cfg['parts']
for i, (name, sid) in enumerate(parts):
    a = scene[sid]['t0'] if i else 0.0
    b = scene[parts[i + 1][1]]['t0'] if i + 1 < len(parts) else D
    enc720(a, b, f'{TITLE}｜{name}', f'dist/{TITLE}_720p_{i + 1}_{name}.mp4')
for f in sorted(os.listdir('dist')): print(f, round(os.path.getsize('dist/' + f) / 1e6, 1), 'MB')
