// 投手丘高度（依正式規格）：投手板高 10 吋（0.254 m），板前 6 吋開始每呎下降 1 吋，
// 投手丘直徑 18 呎、圓心在投手板前緣前方 18 吋。投手板前緣位於 x = 0。
const RUBBER_H = 0.254;
const CX = 0.457, R = 2.74;

function smoothstep(a, b, x) { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); }

// 平滑的分段線性（在轉折處做圓角）
function softRidge(x) {
  const k = 0.008;
  // 以最小值組合幾段直線，再用 soft-min 圓滑
  const lines = [
    xx => RUBBER_H,                                                   // 平台
    xx => RUBBER_H - 0.0833 * (xx - 0.15),                            // 往本壘的斜坡
    xx => RUBBER_H - 0.1524 - 0.09 * (xx - 1.98),                     // 斜坡末端到丘緣
    xx => RUBBER_H + 0.16 * (xx + 0.71),                              // 投手板後方
  ];
  const vals = lines.map(f => f(x));
  const mn = Math.min(...vals);
  // soft-min（以最小值為基準避免數值溢位）
  const sm = mn - k * Math.log(vals.reduce((s, v) => s + Math.exp(-(v - mn) / k), 0));
  return Math.max(0, Math.min(RUBBER_H, sm));
}

export function moundHeight(x, z) {
  const r = Math.hypot(x - CX, z);
  if (r >= R) return 0;
  const hx = softRidge(x);
  const zmax = Math.sqrt(Math.max(0.0001, R * R - (x - CX) * (x - CX)));
  const lat = 1 - smoothstep(0.76, Math.max(0.8, zmax), Math.abs(z));
  const rad = 1 - smoothstep(R - 0.35, R, r);
  return hx * lat * rad;
}

export const FLAT = () => 0;
export const MOUND = moundHeight;
export const RUBBER_HEIGHT = RUBBER_H;
