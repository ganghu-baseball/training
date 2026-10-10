"""用語音辨識檢查每句旁白的發音（拼音比對，同音字不算錯）。"""
import json, re, numpy as np, soundfile as sf, sherpa_onnx
from pypinyin import lazy_pinyin
from opencc import OpenCC
t2s = OpenCC('t2s')
d = 'models/sense-voice'
asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt", language="zh", use_itn=False, num_threads=4)
meta = json.load(open('build/audio/tts.json', encoding='utf-8'))
def norm(s): return re.sub(r"[^一-鿿]", "", s)
def ed(a, b):
    dp = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(b) + 1):
            cur = dp[j]; dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1])); prev = cur
    return dp[-1]
bad = []
tot = 0
for sid, lines in meta.items():
    for ln in lines:
        x, sr = sf.read('build/audio/' + ln['file'], dtype='float32')
        x16 = np.interp(np.linspace(0, len(x) - 1, int(len(x) * 16000 / sr)), np.arange(len(x)), x).astype(np.float32)
        st = asr.create_stream(); st.accept_waveform(16000, x16); asr.decode_stream(st)
        ref = norm(t2s.convert(ln['say'])); hyp = norm(st.result.text)
        rp, hp = lazy_pinyin(ref), lazy_pinyin(hyp)
        per = ed(rp, hp) / max(1, len(rp)); tot += 1
        if per > 0.06: bad.append((per, ln['file'], ref, hyp))
bad.sort(reverse=True)
print(f'checked {tot} lines; flagged {len(bad)}')
for per, f, ref, hyp in bad[:40]:
    print(f'{per:.2f} {f}\n   REF {ref}\n   HYP {hyp}')
