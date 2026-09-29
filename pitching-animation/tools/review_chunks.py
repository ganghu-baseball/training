"""從已完成的分段影片抽格，拼成檢查用對照圖。python3 tools/review_chunks.py out.png c000:1.0 c002:10 ..."""
import sys, subprocess, imageio_ffmpeg, os, tempfile
from PIL import Image, ImageDraw, ImageFont
FF = imageio_ffmpeg.get_ffmpeg_exe()
out, specs = sys.argv[1], sys.argv[2:]
tmp = tempfile.mkdtemp(dir='/tmp/claude-0')
ims, labs = [], []
for sp in specs:
    c, t = sp.split(':'); f = os.path.join(tmp, f'{c}_{t}.png')
    subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', t, '-i', f'build/chunks_master_video/{c}.mp4', '-frames:v', '1', '-vf', 'scale=640:-1', f], check=True)
    ims.append(Image.open(f)); labs.append(f'{c} +{t}s (T={int(c[1:]) * 45 + float(t):.0f}s)')
w, h = ims[0].size; cols = 3; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h)); font = ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 16)
for i, (im, lab) in enumerate(zip(ims, labs)):
    x, y = (i % cols) * w, (i // cols) * h; sheet.paste(im, (x, y)); d = ImageDraw.Draw(sheet)
    d.rectangle([x, y, x + 170, y + 20], fill=(0, 0, 0)); d.text((x + 4, y + 2), lab, fill=(255, 220, 120), font=font)
sheet.save(out); print('saved', out, sheet.size)
