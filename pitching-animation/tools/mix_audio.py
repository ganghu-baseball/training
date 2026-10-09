"""混音：旁白（依時間軸放置）+ 程式生成的柔和配樂（自動閃避旁白）+ 少量音效。
輸出 build/mix.wav（有配樂）與 build/voice.wav（只有旁白）。配樂為程式即時合成，無版權問題。"""
import json, math, os, re, numpy as np, soundfile as sf

SR = 48000
tl = json.load(open('build/timeline.json', encoding='utf-8'))
dur = tl['duration'] + 0.5
N = int(dur * SR)

# ── 旁白 ──
voice = np.zeros(N, dtype=np.float32)
active = np.zeros(N, dtype=np.float32)
for sc in tl['scenes']:
    for ln in sc['lines']:
        x, sr = sf.read('build/audio/' + ln['file'], dtype='float32')
        if x.ndim > 1: x = x.mean(axis=1)
        # 24k → 48k 線性插值
        n2 = int(len(x) * SR / sr)
        x2 = np.interp(np.linspace(0, len(x) - 1, n2), np.arange(len(x)), x).astype(np.float32)
        s = int(ln['t0'] * SR); e = min(N, s + n2)
        voice[s:e] += x2[:e - s]
        active[s:e] = 1.0
# 旁白響度：讓說話時 RMS 約 -19 dBFS
rms = np.sqrt(np.mean(voice[active > 0] ** 2))
voice *= (10 ** (-19 / 20)) / max(rms, 1e-6)
voice = np.clip(voice, -0.98, 0.98)

# ── 配樂（D 大調 I–V–vi–IV，84 BPM）──
bpm = 84.0; beat = 60 / bpm; bar = 4 * beat
chords = [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]]   # D  A  Bm  G（MIDI）
f = lambda m: 440.0 * 2 ** ((m - 69) / 12)
t = np.arange(N) / SR
music = np.zeros((N, 2), dtype=np.float32)
def env_adsr(n, a, r):
    e = np.ones(n, dtype=np.float32)
    na, nr = min(int(a * SR), n // 2), min(int(r * SR), n // 2)   # 最後一段很短時避免超出範圍
    if na: e[:na] = np.linspace(0, 1, na) ** 1.5
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e
cyc = 2 * bar  # 每個和弦兩小節
k = 0; start = 0.0
rng = np.random.default_rng(7)
while start < dur:
    ch = chords[k % 4]
    s = int(start * SR); e = min(N, int((start + cyc + 1.2) * SR)); n = e - s
    if n <= 0: break
    tt = np.arange(n) / SR
    pad = np.zeros(n, dtype=np.float32)
    for i, m in enumerate(ch + [ch[0] + 12]):
        for det in (-0.6, 0.6):
            fr = f(m) * (1 + det / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            pad += (np.sin(2 * np.pi * fr * tt + ph) * 0.6 + np.sin(4 * np.pi * fr * tt + ph) * 0.12).astype(np.float32)
    pad *= env_adsr(n, 1.6, 1.4) * 0.018
    bass = (np.sin(2 * np.pi * f(ch[0] - 12) * tt) * env_adsr(n, 0.8, 1.2) * 0.028).astype(np.float32)
    music[s:e, 0] += pad + bass; music[s:e, 1] += pad + bass
    # 撥弦琶音（八分音符）
    arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12]
    for j in range(int(cyc / (beat / 2))):
        ts = start + j * beat / 2
        m = arp[j % 4] + (12 if (j // 8) % 2 else 0)
        s2 = int(ts * SR); n2 = int(0.9 * SR); e2 = min(N, s2 + n2)
        if e2 <= s2: continue
        t2 = np.arange(e2 - s2) / SR
        fr = f(m)
        tone = (np.sin(2 * np.pi * fr * t2) + 0.3 * np.sin(4 * np.pi * fr * t2) * np.exp(-t2 * 8)) * np.exp(-t2 * 4.2) * 0.011
        tone *= np.minimum(1, t2 / 0.004)
        pan = 0.35 if j % 2 else -0.35
        music[s2:e2, 0] += (tone * (1 - pan) * 0.8).astype(np.float32); music[s2:e2, 1] += (tone * (1 + pan) * 0.8).astype(np.float32)
    start += cyc; k += 1
# 柔化高頻（一階低通）
def lowpass(x, fc):
    a = math.exp(-2 * math.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    # 分塊向量化的一階濾波（用 scipy 以外的方法）：遞迴太慢，改用 FFT 頻域衰減
    return x
# 逐聲道做頻域低通（影片變長後整段一起做會用光記憶體）
gain = (1 / np.sqrt(1 + (np.fft.rfftfreq(N, 1 / SR) / 2600) ** 4)).astype(np.float32)
for ch in range(2):
    spec = np.fft.rfft(music[:, ch]); spec *= gain
    music[:, ch] = np.fft.irfft(spec, n=N).astype(np.float32)
    del spec
del gain
# 閃避：旁白時降低配樂音量
from numpy.lib.stride_tricks import sliding_window_view
win = int(0.35 * SR)
# 移動平均（累積和，O(N)；結果等同 np.convolve(..., mode='same')）
cs = np.concatenate([[0.0], np.cumsum(active, dtype=np.float64)])
lo = np.clip(np.arange(N) - win // 2, 0, N); hi = np.clip(np.arange(N) - win // 2 + win, 0, N)
act = ((cs[hi] - cs[lo]) / win).astype(np.float32)
del cs, lo, hi
duck = 1 - 0.55 * np.clip(act, 0, 1)
mrms = np.sqrt(np.mean(music ** 2))
music *= (10 ** (-27 / 20)) / max(mrms, 1e-6)
music *= duck[:, None]
# 片頭淡入、片尾淡出
fi, fo = int(2.0 * SR), int(4.0 * SR)
music[:fi] *= np.linspace(0, 1, fi)[:, None]; music[-fo:] *= np.linspace(1, 0, fo)[:, None]

# ── 音效 ──
sfx = np.zeros(N, dtype=np.float32)
def add(tsec, sig, gain=1.0):
    s = int(tsec * SR); e = min(N, s + len(sig)); sfx[s:e] += sig[:e - s] * gain
def pop():
    n = int(0.12 * SR); tt = np.arange(n) / SR
    noise = rng.standard_normal(n).astype(np.float32)
    body = np.sin(2 * np.pi * 140 * tt * np.exp(-tt * 12)) * np.exp(-tt * 38)
    return ((noise * np.exp(-tt * 70) * 0.5 + body) * 0.5).astype(np.float32)
def thud():
    n = int(0.25 * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 16) * 0.6 + rng.standard_normal(n) * np.exp(-tt * 40) * 0.15).astype(np.float32)
def chime():
    n = int(1.6 * SR); tt = np.arange(n) / SR
    return sum(np.sin(2 * np.pi * fr * tt) * np.exp(-tt * d) * g for fr, d, g in [(1175, 2.2, 0.22), (1760, 3.0, 0.12), (2350, 4.0, 0.06)]).astype(np.float32)
scenes = {s['id']: s for s in tl['scenes']}
def crack():
    # 木棒擊球的清脆聲：短促的寬頻噪音 + 高頻共振
    n = int(0.18 * SR); tt = np.arange(n) / SR
    noise = rng.standard_normal(n).astype(np.float32) * np.exp(-tt * 90)
    ring = sum(np.sin(2 * np.pi * fr * tt) * np.exp(-tt * d) * g for fr, d, g in [(1850, 45, 0.5), (2900, 60, 0.3), (950, 30, 0.35)])
    return ((noise * 0.6 + ring) * 0.8).astype(np.float32)
SFX_CFG = 'content/sfx.json'
if os.path.exists(SFX_CFG):
    # 專案自訂音效：{"events":[{"scene","t","kind","gain"}], "chime":"場景 id 的正規式"}
    cfg = json.load(open(SFX_CFG))
    def whoosh():
        # 揮空的「咻～」：往下掃的帶通噪音
        n = int(0.32 * SR); tt = np.arange(n) / SR
        noise = rng.standard_normal(n).astype(np.float32)
        env = np.sin(np.pi * np.clip(tt / 0.32, 0, 1)) ** 2
        y = np.zeros(n, dtype=np.float32); lp = 0.0; bp = 0.0
        for i in range(n):
            f = 2400 - 1800 * tt[i] / 0.32; a = 2 * np.pi * f / SR
            lp += a * (noise[i] - lp); bp += a * (lp - bp); y[i] = lp - bp
        return (y * env * 1.6).astype(np.float32)
    def thunk():
        # 打得軟弱的「叩…」：悶悶的木頭聲
        n = int(0.16 * SR); tt = np.arange(n) / SR
        return ((np.sin(2 * np.pi * 420 * tt) * 0.6 + np.sin(2 * np.pi * 690 * tt) * 0.3) * np.exp(-tt * 38) + rng.standard_normal(n) * np.exp(-tt * 120) * 0.2).astype(np.float32)
    kinds = {'pop': pop, 'thud': thud, 'crack': crack, 'chime': chime, 'whoosh': whoosh, 'thunk': thunk}
    for ev in cfg.get('events', []):
        add(scenes[ev['scene']]['t0'] + ev['t'], kinds[ev['kind']](), ev.get('gain', 1.0))
    if cfg.get('events_file'):
        # 動畫裡擬聲字出現的瞬間（tools/collect_sfx.mjs 產生）：鏗！＝擊球、咻～＝揮空、叩…＝軟弱擊球
        by_text = {'鏗！': ('crack', 0.45), '咻～': ('whoosh', 0.4), '叩…': ('thunk', 0.45), '碰！': ('thud', 0.8)}
        bank = {k: [kinds[k]() for _ in range(4)] for k in ('crack', 'whoosh', 'thunk', 'thud')}
        for i, ev in enumerate(json.load(open(cfg['events_file']))):
            k, g = by_text.get(ev['text'], (None, 0))
            if k: add(ev['t'], bank[k][i % 4], g)
    if cfg.get('chime'):
        for s in tl['scenes']:
            if re.match(cfg['chime'], s['id']): add(s['t0'] + 0.15, chime(), 0.35)
elif 'medball' in scenes:
    add(scenes['intro']['t0'] + 3.105, pop(), 0.9)        # 開場真實速度那一球進捕手手套
    mb = scenes['medball']['t0']
    add(mb + 0.6 + (2.10 - 0.35) + 0.40, thud(), 0.7)     # 藥球（原速）撞牆
else:
    # 打擊課程開場：第一球揮空進手套、第二球平飛安打
    add(scenes['intro']['t0'] + 1.30, pop(), 0.9)
    add(scenes['intro']['t0'] + 2.3 + 1.25, crack(), 1.0)
for s in tl['scenes']:
    if s.get('chapter'): add(s['t0'] + 0.15, chime(), 0.35)
sfx *= 10 ** (-6 / 20)

mix = music + voice[:, None] + sfx[:, None]
peak = np.abs(mix).max()
if peak > 0.97: mix *= 0.97 / peak
sf.write('build/mix.wav', mix, SR, subtype='PCM_16')
sf.write('build/voice.wav', np.stack([voice, voice], axis=1), SR, subtype='PCM_16')
print('mix written', dur, 's; peak', float(np.abs(mix).max()))
