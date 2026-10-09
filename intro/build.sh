#!/usr/bin/env bash
# 產生開場動畫，並接在原影片前面。
#   ./build.sh 原影片.mp4 [輸出資料夾]
# 需要: python3 (numpy, scipy)、node + playwright、ffmpeg
set -euo pipefail
cd "$(dirname "$0")"

ORIG="${1:?用法: ./build.sh 原影片.mp4 [輸出資料夾]}"
OUT="${2:-output}"
mkdir -p "$OUT" work

# 1) 音樂 (Python 合成)
python3 make_music.py work/intro_music.wav

# 2) 動畫 (逐格渲染 intro.html)
[ -f work/intro_silent.mp4 ] || node render.js video work/intro_silent.mp4

# 3) 開場動畫成品 (1080x1920, 10 秒)
ffmpeg -y -v error -i work/intro_silent.mp4 -i work/intro_music.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 20 -tune film -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
  "$OUT/港湖開場動畫_10秒.mp4"

# 4) 接上原影片：原影片放大到 1080x1920，開頭 0.35 秒從白閃淡出，音訊統一 48kHz
VDUR=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$ORIG")
ffmpeg -y -v error -i work/intro_silent.mp4 -i work/intro_music.wav -i "$ORIG" -filter_complex "
  [0:v]fps=30,format=yuv420p,setsar=1[v0];
  [2:v]fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.35:color=white[v1];
  [1:a]aresample=48000,aformat=channel_layouts=stereo[a0];
  [2:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${VDUR}[a1];
  [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 20 -tune film -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 192k -movflags +faststart \
  "$OUT/港湖社區棒球隊_含開場.mp4"

echo "完成：$OUT/港湖開場動畫_10秒.mp4、$OUT/港湖社區棒球隊_含開場.mp4"
