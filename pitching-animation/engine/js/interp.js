// 單調三次 Hermite 插值（PCHIP）：關鍵影格之間平滑、不會超調（overshoot）
// 用在所有動作通道，避免身體在兩個姿勢之間「多晃一下」而顯得不自然。

export function pchip(keys) {
  // keys: [[t, v], ...]（t 遞增）
  const n = keys.length;
  const t = keys.map(k => k[0]);
  const v = keys.map(k => k[1]);
  if (n === 1) return () => v[0];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(t[i + 1] - t[i]);
    d.push((v[i + 1] - v[i]) / (t[i + 1] - t[i]));
  }
  const m = new Array(n).fill(0);
  m[0] = endSlope(h[0], h[1], d[0], d[1]);
  m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return function (x) {
    if (x <= t[0]) return v[0];
    if (x >= t[n - 1]) return v[n - 1];
    let i = 0, j = n - 1;
    while (j - i > 1) { const k = (i + j) >> 1; if (t[k] <= x) i = k; else j = k; }
    const hh = t[i + 1] - t[i], s = (x - t[i]) / hh;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * hh * m[i]
      + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * hh * m[i + 1];
  };
}

function endSlope(h0, h1, d0, d1) {
  if (h1 === undefined || d1 === undefined) return d0;
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) m = 0;
  else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) m = 3 * d0;
  return m;
}

// 一組動作 = 多個通道；每個通道是 [[t,v],...]
export class Motion {
  constructor(channels, opts = {}) {
    this.fns = {};
    this.duration = 0;
    this.start = Infinity;
    for (const [name, keys] of Object.entries(channels)) {
      if (!keys || !keys.length) continue;
      const ks = keys.slice().sort((a, b) => a[0] - b[0]);
      this.fns[name] = pchip(ks);
      this.duration = Math.max(this.duration, ks[ks.length - 1][0]);
      this.start = Math.min(this.start, ks[0][0]);
    }
    this.events = opts.events || {};
    this.props = opts.props || {};
  }
  get(name, t, fallback = 0) {
    const f = this.fns[name];
    return f ? f(t) : fallback;
  }
  has(name) { return !!this.fns[name]; }
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, s) => a + (b - a) * s;
export const smooth = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * (3 - 2 * s); };
export const easeInOut = s => s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
export const easeOut = s => 1 - Math.pow(1 - s, 3);
export const easeIn = s => s * s * s;

// 影片時間 → 動作時間（可做慢動作、定格、加速），以 PCHIP 讓速度轉換平順
export function timeMap(pairs) {
  return pchip(pairs);
}
