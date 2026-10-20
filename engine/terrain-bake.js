// ドット絵版の近景の地面の模様を焼く計算（three もキャンバスも使わない）。engine/terrain.js（メインのスレッド）と
// engine/terrain-bake-worker.js（Web Worker）の両方から使う。同じコードなので、どちらで焼いても 1 ドットも変わらない

// 位置から決まる乱数（0〜1）
export function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
// なめらかなノイズ（まだら模様）
export function valueNoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), tx = x - i, tz = z - j;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

// rows：焼く行の範囲 [始め, 終わり)。いくつかの Worker で分けて焼くときに使う（結果は rows の行だけの配列）
export function bakeGroundPixels({ N, groundCls, groundNames, looks, ppm, groundColor = null, photoMix = 0.6, rows = null }) {
  const W = (N.w - 1) * ppm, H = (N.h - 1) * ppm;
  const [r0, r1] = rows ?? [0, H];
  const d = new Uint8ClampedArray(W * (r1 - r0) * 4);
  const cols = groundNames.map(n => (looks[n] ?? looks.other).c.map(rgb));
  const pats = groundNames.map(n => (looks[n] ?? looks.other).pattern);
  const usePhoto = groundNames.map(n => !!(groundColor && (looks[n] ?? looks.other).photo));
  const tmpC = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let py = r0; py < r1; py++) {
    const z = N.z0 + (py + 0.5) / ppm;
    for (let px = 0; px < W; px++) {
      const x = N.x0 + (px + 0.5) / ppm;
      // 境目をずらす：2 ドット単位の乱数で ±0.5 m
      const jx = (hash2(px >> 1, py >> 1) - 0.5) * 0.9, jz = (hash2(py >> 1, px >> 1) - 0.5) * 0.9;
      const ci = Math.min(Math.max(Math.round(x + jx - N.x0), 0), N.w - 1);
      const cj = Math.min(Math.max(Math.round(z + jz - N.z0), 0), N.h - 1);
      const k = groundCls[cj * N.w + ci];
      let [dark, midc, light] = cols[k];
      if (usePhoto[k]) {
        // 写真の色を混ぜた中間色から、暗・明を作る（模様は種類のまま）
        const o = (cj * N.w + ci) * 3;
        for (let c = 0; c < 3; c++) {
          const m = midc[c] + (groundColor[o + c] - midc[c]) * photoMix;
          tmpC[0][c] = m * 0.84; tmpC[1][c] = m; tmpC[2][c] = Math.min(255, m * 1.1);
        }
        [dark, midc, light] = tmpC;
      }
      // まだら模様：大きな斑（約 3 m）＋細かな斑（約 0.6 m）。境目はドット単位でディザして、四角い塊に見えないように
      const n = valueNoise(x * 0.35, z * 0.35) * 0.55 + valueNoise(x * 1.7, z * 1.7) * 0.3 + valueNoise(x * 4.3 + 17, z * 4.3) * 0.15
        + (hash2(px * 7 + 3, py * 5 + 1) - 0.5) * 0.14;
      const r = hash2(px, py);
      let tone = n < 0.36 ? 0 : n > 0.66 ? 2 : 1;
      switch (pats[k]) {
        case 'grass': // 草の短い筋：縦に 2 ドット明るく
          if (r > 0.93 || (hash2(px, py - 1) > 0.93)) tone = Math.min(2, tone + 1);
          else if (r < 0.05) tone = 0;
          break;
        case 'speckle':
          if (r > 0.9) tone = 2; else if (r < 0.1) tone = 0;
          break;
        case 'slab': { // 2 m ごとの目地
          const lx = ((x % 2) + 2) % 2, lz = ((z % 2) + 2) % 2;
          if (lx < 1 / ppm || lz < 1 / ppm) tone = 0; else tone = r > 0.95 ? 2 : 1;
          break;
        }
        case 'block': { // 護岸のブロック（0.5 m 角、ずらし積み）
          const bz = Math.floor(z * 2), lx = (((x + (bz & 1) * 0.25) % 0.5) + 0.5) % 0.5, lz = ((z * 2) % 1 + 1) % 1;
          tone = lx < 1 / ppm || lz < 2 / ppm ? 0 : (r > 0.85 ? 2 : 1);
          break;
        }
        case 'asphalt':
          tone = r > 0.94 ? 2 : r < 0.12 ? 0 : 1;
          break;
        case 'mud':
          tone = n < 0.45 ? 0 : 1;
          break;
      }
      const c = tone === 0 ? dark : tone === 2 ? light : midc;
      const o = ((py - r0) * W + px) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  return { data: d, W, H, rows: [r0, r1] };
}
