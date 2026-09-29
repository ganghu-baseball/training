# 投球原理動畫｜製作引擎

用程式產生「投球原理」教學影片的工具：3D 投手動作、畫面圖解、旁白語音、字幕、配樂，最後輸出成 1080p MP4。

> **教學內容不在這個 repo 裡。** 這個 repo 是公開的，旁白腳本、畫面文字（`content/`）與成品影片（`build/`、`dist/`）
> 都被 `.gitignore` 排除，只保留可重複使用的引擎程式。需要重新產生影片時，把 `content/` 放回這個資料夾即可。

## 架構

| 位置 | 內容 |
|---|---|
| `engine/js/rig.js` | 3D 投手骨架與外型（1.83 m 人體比例；腳用 IK 固定、不會滑步；軀幹是會扭轉的連續曲面） |
| `engine/js/motions.js` | 投球動作關鍵影格（前腳落地 = 0 秒）與錯誤示範的變化版本 |
| `engine/js/drills.js` | 藥球側拋、胸前旋轉、水袋、反向跳／蹲踞跳 |
| `engine/js/terrain.js` | 依正式規格建立的投手丘（投手板高 10 吋、每呎下降 1 吋） |
| `engine/js/world.js` | 場景、燈光、道具（棒球、藥球、牆、水袋） |
| `engine/js/main.js` | `renderAt(t)`：任一時間點都能決定性地畫出完整畫面（可平行渲染） |
| `tools/` | 旁白語音、時間軸與字幕、混音、平行渲染、合成成品 |
| `content/`（不在 repo） | `script.js` 旁白腳本、`scenes/` 各場景畫面 |

動作插值使用單調三次曲線（PCHIP），關鍵影格之間平滑、不會多晃一下；
骨盆 → 軀幹 → 手臂的轉速峰值依序出現，出手前軀幹會先減速，符合投球的動力鏈順序。

## 需要的環境

- Node.js 22、Python 3.11、Playwright 的 Chromium（`/opt/pw-browsers`）
- `npm install`
- `pip install sherpa-onnx soundfile numpy pillow opencc-python-reimplemented pypinyin imageio-ffmpeg`
- 離線語音模型（Kokoro v1.1-zh，Apache-2.0）放在 `models/kokoro-multi-lang-v1_1`：
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2`
- （選用）發音檢查用的語音辨識模型放在 `models/sense-voice`：
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`

## 產生影片

```bash
node tools/dump_script.mjs > build/script.json          # 讀取旁白腳本
python3 tools/tts.py build/script.json build/audio        # 產生旁白（預設第 60 號男聲）
python3 tools/asr_check.py                                # （選用）用語音辨識逐句檢查發音
node tools/build_timeline.mjs                             # 依旁白長度排時間軸、輸出字幕 SRT
python3 tools/mix_audio.py                                # 旁白 + 程式生成的配樂 + 音效
node tools/render.mjs --out build/master_video.mp4        # 平行渲染（分段、可中斷後續跑）
python3 tools/finalize.py                                 # 合成 1080p、無配樂版、720p（另切成三段 <30 MB）
node tools/make_script_doc.mjs                            # 輸出含章節時間的旁白腳本
```

檢查畫面用：

```bash
node tools/stills.mjs out.png "intro@5,medball@L2+4" 3 640   # 指定場景與時間的靜態畫面對照圖
node tools/diag.mjs '{"variant":{}}'                          # 檢查投球動作的膝角與腳是否搆得到地
```

`medball@L2+4` 代表「medball 場景第 3 句旁白開始後 4 秒」。

## 授權

- Three.js（MIT）、Lucide 圖示（ISC）、Noto Sans TC / Barlow Condensed 字型（SIL OFL）
- Kokoro 語音模型（Apache-2.0）；配樂與音效由 `tools/mix_audio.py` 即時合成
