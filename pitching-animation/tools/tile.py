import json, sys
from PIL import Image, ImageDraw, ImageFont
lst = json.load(open(sys.argv[1])); out = sys.argv[2]; cols = int(sys.argv[3])
ims = [Image.open(x['f']) for x in lst]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
LH = 22  # 標籤列放在畫面上方，不遮住畫面內容
sheet = Image.new('RGB', (cols * w, rows * (h + LH)), (20, 20, 20))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 16)
except Exception:
    font = ImageFont.load_default()
for i, (im, x) in enumerate(zip(ims, lst)):
    X, Y = (i % cols) * w, (i // cols) * (h + LH)
    sheet.paste(im, (X, Y + LH))
    d = ImageDraw.Draw(sheet)
    d.rectangle([X, Y, X + w, Y + LH - 1], fill=(0, 0, 0))
    d.text((X + 6, Y + 3), x['label'], fill=(255, 220, 120), font=font)
sheet.save(out)
print('saved', out, sheet.size)
