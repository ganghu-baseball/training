"""把渲染好的影片與混音合成最終成品，並輸出較小的 720p 版本。
python3 tools/finalize.py"""
import subprocess, imageio_ffmpeg, os
FF = imageio_ffmpeg.get_ffmpeg_exe()
os.makedirs('dist', exist_ok=True)
V = 'build/master_video.mp4'
def run(args):
    print(' '.join(args[:6]), '...'); subprocess.run([FF, '-y', '-loglevel', 'error'] + args, check=True)
# 1080p（旁白＋配樂）
run(['-i', V, '-i', 'build/mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
     '-metadata', 'title=投球原理：從腳到手的力量接力', '-movflags', '+faststart', 'dist/投球原理動畫_1080p.mp4'])
# 1080p（只有旁白，方便自行搭配音樂）
run(['-i', V, '-i', 'build/voice.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest',
     '-movflags', '+faststart', 'dist/投球原理動畫_1080p_無配樂.mp4'])
# 720p（檔案較小，手機觀看）
run(['-i', 'dist/投球原理動畫_1080p.mp4', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'dist/投球原理動畫_720p.mp4'])
for f in sorted(os.listdir('dist')): print(f, round(os.path.getsize('dist/' + f) / 1e6, 1), 'MB')
