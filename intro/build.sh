#!/usr/bin/env bash
# 產生 5 秒開場動畫。結尾白閃會淡出到原影片的第一格，所以後面直接接原影片就是無縫轉場。
#   ./build.sh [原影片.mp4] [輸出資料夾]
# 需要: python3 (numpy, scipy)、node + playwright、ffmpeg
set -euo pipefail
cd "$(dirname "$0")"

ORIG="${1:-}"
OUT="${2:-output}"
mkdir -p "$OUT" work

# 0) 原影片第一格 (結尾轉場用；沒給原影片就沿用現有的 orig_first_frame.png)
if [ -n "$ORIG" ]; then
  ffmpeg -y -v error -i "$ORIG" -frames:v 1 -vf "scale=1080:1920:flags=lanczos" orig_first_frame.png
fi

# 1) 音效 (Python 合成)
python3 make_music.py work/intro_music.wav

# 2) 動畫 (逐格渲染 intro.html)
node render.js video work/intro_silent.mp4

# 3) 成品 (1080x1920, 30fps, 5 秒)
ffmpeg -y -v error -i work/intro_silent.mp4 -i work/intro_music.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 20 -tune film -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$OUT/港湖開場動畫_5秒.mp4"

echo "完成：$OUT/港湖開場動畫_5秒.mp4"
