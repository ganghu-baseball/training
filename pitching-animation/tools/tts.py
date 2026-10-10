"""產生旁白語音（離線 Kokoro v1.1-zh，Apache-2.0）。

用法：python3 tools/tts.py build/script.json build/audio [--only sceneId,...]
輸出：每行一個 wav（24kHz）與 build/audio/tts.json（每行時長與字幕分段時間）
"""
import json, os, re, sys, time
import numpy as np, soundfile as sf, sherpa_onnx
from opencc import OpenCC

MODEL_DIR = os.environ.get("KOKORO_DIR", "models/kokoro-multi-lang-v1_1")
SPEAKER = int(os.environ.get("TTS_SPEAKER", "60"))
SPEED = float(os.environ.get("TTS_SPEED", "1.0"))
SENT_GAP = 0.30     # 同一行內句子之間的停頓（秒）
t2s = OpenCC("t2s")

def make_tts():
    d = MODEL_DIR
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f"{d}/model.onnx", voices=f"{d}/voices.bin", tokens=f"{d}/tokens.txt",
                data_dir=f"{d}/espeak-ng-data", dict_dir=f"{d}/dict",
                lexicon=f"{d}/lexicon-us-en.txt,{d}/lexicon-zh.txt"),
            num_threads=4),
        rule_fsts=f"{d}/date-zh.fst,{d}/phone-zh.fst,{d}/number-zh.fst",
        max_num_sentences=1)
    return sherpa_onnx.OfflineTts(cfg)

PUNCT = str.maketrans({"，": ",", "。": ".", "？": "?", "！": "!", "：": ",", "；": ",", "、": ","})

def spoken_form(s):
    s = re.sub(r"[「」『』“”]", "", s)
    s = t2s.convert(s)
    return s.translate(PUNCT)

def split_sentences(s):
    parts = re.findall(r"[^。！？]+[。！？]?", s)
    return [p for p in (x.strip() for x in parts) if p]

def trim(x, sr, thr=0.012, pad=0.04):
    a = np.abs(x)
    idx = np.where(a > thr)[0]
    if len(idx) == 0:
        return x
    s = max(0, idx[0] - int(pad * sr)); e = min(len(x), idx[-1] + int(pad * sr))
    return x[s:e]

def chunk_display(sentence, maxlen=24):
    """把一句字幕依逗號切成不超過 maxlen 字的小段。"""
    pieces = re.findall(r"[^，；：、]+[，；：、]?", sentence)
    out, cur = [], ""
    for p in pieces:
        if cur and len(cur) + len(p) > maxlen:
            out.append(cur); cur = p
        else:
            cur += p
    if cur:
        out.append(cur)
    return out

def visible_len(s):
    return len(re.sub(r"[，。？！：；、「」『』\s]", "", s)) + 0.6 * len(re.findall(r"[，；：、]", s))

def main():
    src, outdir = sys.argv[1], sys.argv[2]
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    os.makedirs(outdir, exist_ok=True)
    script = json.load(open(src, encoding="utf-8"))
    meta_path = os.path.join(outdir, "tts.json")
    meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    tts = make_tts()
    t_start = time.time()
    for scene in script:
        sid = scene["id"]
        if only and sid not in only:
            continue
        lines_meta = []
        for i, line in enumerate(scene["lines"]):
            disp = line["t"]
            say = line.get("s", disp)
            disp_sents = split_sentences(disp)
            say_sents = split_sentences(say)
            if len(disp_sents) != len(say_sents):
                disp_sents, say_sents = [disp], [say]
            audio, chunks, t = [], [], 0.0
            sr = 24000
            for k, (ds, ss) in enumerate(zip(disp_sents, say_sents)):
                g = tts.generate(spoken_form(ss), sid=SPEAKER, speed=SPEED)
                sr = g.sample_rate
                x = trim(np.array(g.samples, dtype=np.float32), sr)
                dur = len(x) / sr
                # 句內依字數比例分配字幕時間
                parts = chunk_display(ds)
                w = [visible_len(p) for p in parts]; tot = sum(w) or 1
                acc = t
                for p, wi in zip(parts, w):
                    d = dur * wi / tot
                    chunks.append({"text": p.rstrip("，；：、"), "t0": round(acc, 3), "t1": round(acc + d, 3)})
                    acc += d
                audio.append(x); t += dur
                if k < len(say_sents) - 1:
                    audio.append(np.zeros(int(SENT_GAP * sr), dtype=np.float32)); t += SENT_GAP
            y = np.concatenate(audio) if audio else np.zeros(1, dtype=np.float32)
            peak = float(np.abs(y).max()) or 1.0
            y = (y / peak * 0.89).astype(np.float32)        # 統一響度峰值
            fn = f"{sid}_{i:02d}.wav"
            sf.write(os.path.join(outdir, fn), y, sr)
            lines_meta.append({"file": fn, "dur": round(len(y) / sr, 3), "chunks": chunks, "say": say})
            print(f"{sid:12s} #{i} {len(y)/sr:5.2f}s  {disp[:30]}", flush=True)
        meta[sid] = lines_meta
        json.dump(meta, open(meta_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"done in {time.time()-t_start:.0f}s")

if __name__ == "__main__":
    main()
