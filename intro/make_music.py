"""港湖社區棒球隊 開場音樂 (10 秒)

輕鬆、漸進式的開場配樂，速度與調性對齊原影片音樂 (122 BPM, C 調)：
  0.0 - 2.3s  柔和 pad 淡入、球場燈「喀」亮起、棒球飛入的 whoosh
  2.3 - 4.2s  球到位的鐘聲 + 馬林巴琶音進場
  4.2 - 6.2s  隊名出現，加入貝斯、輕柔大鼓
  6.2 - 8.2s  沙鈴、拍手，整首最完整的段落
  8.2 - 10.0s 漸強 riser + 小鼓滾奏，停在 G 掛留和弦，接進原影片第一拍

Usage: python3 make_music.py [out.wav]
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 10.0
N = int(SR * DUR)
BEAT = 60 / 122
B0 = 0.294          # first beat; beat 20 lands on the original video's first beat (10.13s)


def B(k):
    return B0 + k * BEAT


rng = np.random.default_rng(2026)

dry = np.zeros((2, N))
send = np.zeros((2, N))   # reverb send bus
duck_times = []           # kick hits, for a gentle sidechain on the pad


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def pan_gains(pan):
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def place(sig, start, gain=1.0, pan=0.0, rev=0.0, bus=None):
    """Mix a mono (or per-sample-panned) signal into the dry bus at time `start` seconds."""
    i0 = int(round(start * SR))
    if i0 >= N:
        return
    if i0 < 0:
        sig = sig[-i0:]
        if np.ndim(pan):
            pan = pan[-i0:]
        i0 = 0
    sig = sig[: N - i0]
    if np.ndim(pan):
        pan = pan[: len(sig)]
    gl, gr = pan_gains(pan)
    target = dry if bus is None else bus
    target[0, i0:i0 + len(sig)] += sig * gl * gain
    target[1, i0:i0 + len(sig)] += sig * gr * gain
    if rev:
        send[0, i0:i0 + len(sig)] += sig * gl * gain * rev
        send[1, i0:i0 + len(sig)] += sig * gr * gain * rev


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def sos_filter(x, kind, f, order=2):
    sos = signal.butter(order, f, btype=kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def swept_noise(n, fc_of_t, bw_oct=0.7, seed=0):
    """White noise through a band-pass whose center frequency follows fc_of_t(t)."""
    x = np.random.default_rng(seed).standard_normal(n)
    f, tt, Z = signal.stft(x, fs=SR, nperseg=1024, noverlap=768)
    fc = np.maximum(fc_of_t(tt), 20)
    G = np.exp(-0.5 * ((np.log2(np.maximum(f, 1))[:, None] - np.log2(fc)[None, :]) / bw_oct) ** 2)
    _, y = signal.istft(Z * G, fs=SR, nperseg=1024, noverlap=768)
    y = y[:n]
    return y / (np.max(np.abs(y)) + 1e-9)


# ------------------------------------------------------------------ instruments
def marimba(m, vel=1.0, dur=1.0):
    t = tvec(dur)
    f = mtof(m)
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.34)
         + 0.22 * np.sin(2 * np.pi * 3.93 * f * t) * np.exp(-t / 0.06)
         + 0.05 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.018))
    return vel * s * np.minimum(1, t / 0.002)


def bell(m, vel=1.0, dur=2.6):
    t = tvec(dur)
    f = mtof(m)
    s = np.zeros_like(t)
    for ratio, amp, tau in [(1, 1, 1.5), (2.76, 0.38, 0.6), (5.40, 0.2, 0.3), (8.93, 0.07, 0.14)]:
        if ratio * f < 16000:
            s += amp * np.sin(2 * np.pi * ratio * f * t) * np.exp(-t / tau)
    return vel * s * np.minimum(1, t / 0.0015)


def kick(vel=1.0):
    t = tvec(0.5)
    freq = 46 + 95 * np.exp(-t / 0.04)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.17)
    click = sos_filter(rng.standard_normal(len(t)), 'lowpass', 3000) * np.exp(-t / 0.003) * 0.25
    return vel * (body + click)


def clap(vel=1.0):
    t = tvec(0.35)
    noise = sos_filter(rng.standard_normal(len(t)), 'bandpass', [900, 4200])
    env = np.zeros_like(t)
    for off in (0, 0.010, 0.021):
        env += np.where(t >= off, np.exp(-np.maximum(t - off, 0) / 0.005), 0)
    env += np.where(t >= 0.03, 0.55 * np.exp(-np.maximum(t - 0.03, 0) / 0.07), 0)
    return vel * noise * env / 1.5


def snare(vel=1.0):
    t = tvec(0.3)
    noise = sos_filter(rng.standard_normal(len(t)), 'bandpass', [1400, 7000]) * np.exp(-t / 0.075)
    tone = 0.35 * np.sin(2 * np.pi * 195 * t) * np.exp(-t / 0.04)
    return vel * (noise + tone)


def shaker(vel=1.0):
    t = tvec(0.12)
    noise = sos_filter(rng.standard_normal(len(t)), 'highpass', 6500)
    return vel * noise * np.minimum(1, t / 0.006) * np.exp(-t / 0.03)


def bass(m, dur, vel=1.0):
    t = tvec(dur)
    f = mtof(m)
    s = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    env = np.minimum(1, t / 0.006) * (0.55 + 0.45 * np.exp(-t / 0.18)) * np.clip((dur - t) / 0.05, 0, 1)
    return vel * s * env


def switch_clunk(vel=1.0):
    """Stadium light switching on: a dull clunk plus a faint electric buzz."""
    t = tvec(0.9)
    thud = np.sin(2 * np.pi * 75 * t) * np.exp(-t / 0.05)
    click = sos_filter(rng.standard_normal(len(t)), 'bandpass', [1500, 5000]) * np.exp(-t / 0.004)
    buzz = (np.sin(2 * np.pi * 120 * t) + 0.5 * np.sin(2 * np.pi * 240 * t)) * 0.06 * np.exp(-t / 0.35) * np.minimum(1, t / 0.03)
    return vel * (thud + 0.5 * click + buzz)


def brightness(time):
    # pad filter slowly opens across the whole intro, fully open during the build
    return 0.28 + 0.32 * np.clip(time / 8.0, 0, 1) + 0.18 * np.clip((time - 8.16) / 1.7, 0, 1)


def pad(notes, t0, t1, gain, att=0.35, rel=0.6):
    i0 = int(t0 * SR)
    n = min(N, int((t1 + rel) * SR)) - i0
    t = np.arange(n) / SR
    env = np.minimum(1, t / att) * np.clip(((t1 - t0) + rel - t) / rel, 0, 1)
    env *= 1 + 0.06 * np.sin(2 * np.pi * 0.7 * t)
    bright = brightness(t0 + t)
    out = np.zeros((2, n))
    for m in notes:
        for ch, det in ((0, -7), (1, 7)):
            f = mtof(m) * 2 ** (det / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, 12):
                if k * f > 11000:
                    break
                out[ch] += (bright ** (k - 1)) / k * np.sin(2 * np.pi * k * f * t + ph * k)
    out *= env * gain / len(notes)
    dry[:, i0:i0 + n] += out
    send[:, i0:i0 + n] += out * 0.5


# ------------------------------------------------------------------ arrangement
BAR = [0.0, B(4), B(8), B(12), B(16), DUR]

# Pad: Cadd9 -> Am9 -> Fmaj9 -> Gadd9 -> G7sus4 (resolves into the original, which sits on C)
pad([48, 55, 64, 67, 74], 0.0, BAR[1], 0.22, att=1.6)
pad([57, 60, 64, 67, 71], BAR[1], BAR[2], 0.22)
pad([53, 57, 60, 64, 67], BAR[2], BAR[3], 0.24)
pad([55, 59, 62, 67, 69], BAR[3], BAR[4], 0.25)
pad([55, 60, 62, 65, 67], BAR[4], 9.93, 0.30, rel=0.07)

# Stadium lights switching on (matches the two lights in the animation)
place(switch_clunk(0.33), B(1), pan=-0.5, rev=0.25)
place(bell(79, 0.10), B(1) + 0.02, pan=-0.4, rev=0.6)
place(switch_clunk(0.30), B(2), pan=0.5, rev=0.25)
place(bell(86, 0.09), B(2) + 0.02, pan=0.4, rev=0.6)

# Ball flight whoosh, panned with the ball's x position
PATH = np.array([[-140, 1560], [860, 1700], [1230, 520], [540, 680]], float)
fl_t = np.arange(int((BAR[1] - B0 + 0.25) * SR)) / SR
p = np.clip(fl_t / (BAR[1] - B0), 0, 1)
u = 1 - (1 - p) ** 2.4
coef = np.stack([(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3], 1)
pos = coef @ PATH
speed = np.hypot(*np.gradient(pos, axis=0).T)
speed = speed / speed.max()
ball_pan = np.clip((pos[:, 0] - 540) / 600, -0.9, 0.9)
wh = swept_noise(len(fl_t), lambda tt: 500 + 2600 * np.interp(tt, fl_t, speed), bw_oct=0.9, seed=1)
wh *= speed ** 0.9 * np.minimum(1, fl_t / 0.15)
place(wh, B0, gain=0.62, pan=ball_pan, rev=0.25)

# Ball arrives: soft thump + bell chord
t_ = tvec(0.6)
place(np.sin(2 * np.pi * 58 * t_) * np.exp(-t_ / 0.16), BAR[1], gain=0.2)
for m, v in ((84, 0.13), (91, 0.07), (88, 0.06)):
    place(bell(m, v), BAR[1], pan=0.0, rev=0.7)

# Marimba arpeggios (8ths), entering at bar 2 and building
ARP = {
    1: [69, 72, 76, 81, 79, 76, 72, 76],   # Am
    2: [65, 69, 72, 77, 76, 72, 69, 72],   # F
    3: [67, 71, 74, 79, 81, 79, 74, 71],   # G
}
for bar, notes in ARP.items():
    for i, m in enumerate(notes):
        vel = (0.10 + 0.05 * bar) * (1.0 if i % 2 == 0 else 0.78)
        place(marimba(m, vel), B(4 * bar) + i * BEAT / 2, pan=(-0.3 if i % 2 else 0.3), rev=0.35)
# bar 4: 8ths then 16ths on G7sus4, stops before the drop
build = [67, 72, 74, 77, 79, 77, 74, 72]
for i, m in enumerate(build[:4]):
    place(marimba(m, 0.26), B(16) + i * BEAT / 2, pan=(-0.3 if i % 2 else 0.3), rev=0.35)
for i in range(10):
    m = [79, 74, 77, 72, 79, 74, 77, 72, 84, 79][i]
    place(marimba(m, 0.22 + 0.015 * i), B(18) + i * BEAT / 4, pan=(-0.35 if i % 2 else 0.35), rev=0.3)

# Caption reveal sparkle (random high pentatonic blips, like the random letter reveal)
for k in range(18):
    m = rng.choice([84, 86, 88, 91, 93, 96, 98])
    place(bell(int(m), 0.035 + 0.02 * rng.random(), dur=0.6), B(6) + k * 0.034 + rng.random() * 0.01,
          pan=rng.uniform(-0.7, 0.7), rev=0.6)


def short_whoosh(t_end, dur, gain, pan, f0=400, f1=3200, seed=0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    w = swept_noise(n, lambda x: f0 * (f1 / f0) ** np.clip(x / dur, 0, 1), bw_oct=0.8, seed=seed)
    w *= np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 1.5
    place(w, t_end - dur, gain=gain, pan=pan, rev=0.3)


# Title slides in and lands
short_whoosh(B(8), 0.5, 0.34, -0.4, seed=3)
place(np.sin(2 * np.pi * 62 * t_) * np.exp(-t_ / 0.14), B(8), gain=0.2)
place(bell(88, 0.08), B(8), rev=0.6)

# PLAY BALL stab
for m in (77, 81, 84):
    place(marimba(m, 0.16), B(9), rev=0.4)
place(bell(84, 0.08), B(9), rev=0.6)
place(clap(0.22), B(9), rev=0.3)

# Shine sweep: quick rising bell run
for i, m in enumerate((79, 83, 86, 91)):
    place(bell(m, 0.07, dur=1.2), B(12) + 0.1 + i * 0.09, pan=-0.6 + 0.4 * i, rev=0.6)

# Bass
for bar, root in ((2, 41), (3, 43)):
    for beat, length in ((0, 1.5), (1.5, 0.5), (2, 1.5), (3.5, 0.5)):
        place(bass(root + (12 if beat in (1.5, 3.5) else 0), length * BEAT * 0.95, 0.22), B(4 * bar + beat))
for beat in range(0, 3):
    place(bass(43, BEAT * 0.9, 0.24), B(16 + beat))

# Drums (gentle)
kicks = [B(8), B(10)] + [B(k) for k in range(12, 18)] + [B(18), B(18.5), B(19), B(19.25)]
for k in kicks:
    place(kick(0.36), k)
    duck_times.append(k)
for k in (B(13), B(15), B(17)):
    place(clap(0.26), k, pan=0.05, rev=0.3)
roll = [B(18) + i * BEAT / 4 for i in range(7)]
for i, k in enumerate(roll):
    place(snare(0.06 + 0.035 * i), k, pan=0.1, rev=0.25)
for i in range(int((B(19.5) - B(10)) / (BEAT / 4))):
    tk = B(10) + i * BEAT / 4
    fade = min(1, (tk - B(10)) / (B(12) - B(10)))
    place(shaker((0.08 if i % 2 else 0.04) * fade), tk, pan=0.35, rev=0.15)

# Exit whooshes as the text leaves, then the big riser into the original video
short_whoosh(B(16) + 0.25, 0.4, 0.13, -0.5, f0=600, f1=4000, seed=5)
short_whoosh(B(17) + 0.35, 0.45, 0.16, 0.6, f0=500, f1=4500, seed=6)
short_whoosh(B(18) + 0.3, 0.4, 0.14, 0.0, f0=700, f1=5000, seed=7)

r_start, r_end = B(16), 9.93
n = int((r_end - r_start) * SR)
tt = np.arange(n) / SR
dur_r = r_end - r_start
riser = swept_noise(n, lambda x: 250 * (9000 / 250) ** np.clip(x / dur_r, 0, 1) ** 1.6, bw_oct=1.0, seed=9)
riser *= (np.clip(tt / dur_r, 0, 1) ** 2.2)
place(riser, r_start, gain=0.6, pan=0.0, rev=0.3)
# reverse cymbal into the flash
n2 = int(0.7 * SR)
t2 = np.arange(n2) / SR
rc = sos_filter(np.random.default_rng(11).standard_normal(n2), 'highpass', 5000) * (t2 / 0.7) ** 3.5
place(rc, 9.93 - 0.7, gain=0.3, rev=0.2)

# ------------------------------------------------------------------ mix
# sidechain duck on everything melodic when the kick hits
duck = np.ones(N)
tN = np.arange(N) / SR
for k in duck_times:
    m = tN >= k
    duck[m] -= 0.22 * np.exp(-(tN[m] - k) / 0.11)
duck = np.clip(duck, 0.6, 1)

# reverb: decaying stereo noise impulse response (~1.8s), lowpassed
ir_t = np.arange(int(1.8 * SR)) / SR
ir = np.random.default_rng(5).standard_normal((2, len(ir_t))) * np.exp(-ir_t / 0.38)
ir = sos_filter(ir, 'lowpass', 6000)
ir[:, : int(0.018 * SR)] = 0
ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
wet = np.stack([signal.fftconvolve(send[c], ir[c])[:N] for c in range(2)]) * 0.55

mix = dry * duck + wet
mix = sos_filter(mix, 'highpass', 28)

# fades: in from silence, quick cut at the end so the original's first beat lands clean
fade = np.ones(N)
fade *= np.clip(tN / 0.25, 0, 1)
fade *= np.clip((DUR - tN) / 0.07, 0, 1)
mix *= fade



def lufs(x):
    """Integrated loudness (ITU-R BS.1770-4) of a stereo 48 kHz signal."""
    # K-weighting: high shelf + high pass (coefficients for 48 kHz from the spec)
    shelf = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
    hp = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
    y = signal.lfilter(*hp, signal.lfilter(*shelf, x, axis=1), axis=1)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.mean(y[:, i:i + blk] ** 2, axis=1).sum() for i in range(0, x.shape[1] - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(z + 1e-12)
    z = z[lk > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z.mean())


# level: about 6 LU under the original video's -9 LUFS so the original lands with impact
TARGET_LUFS = -15.0
mix *= 10 ** ((TARGET_LUFS - lufs(mix)) / 20)
# gentle soft-clip on any peaks above -1 dBFS
ceiling = 10 ** (-1.0 / 20)
over = np.abs(mix) > ceiling * 0.8
knee = ceiling * 0.8
mix[over] = np.sign(mix[over]) * (knee + (ceiling - knee) * np.tanh((np.abs(mix[over]) - knee) / (ceiling - knee)))
print(f'loudness {lufs(mix):.1f} LUFS, peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS')

out = sys.argv[1] if len(sys.argv) > 1 else 'intro_music.wav'
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print('wrote', out)
