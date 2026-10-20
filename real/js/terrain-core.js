// 写実版の地形の計算（three を使わない純粋な計算）。real/js/terrain.js（メインのスレッド）と
// real/js/terrain-worker.js（Web Worker）の両方から使う。同じ関数なので、どちらで作っても同じ形になる

// 格子の値を双一次補間（範囲外は端の値）
export function sampleField(f, x, z) {
  const fx = Math.min(Math.max((x - f.x0) / f.step, 0), f.w - 1.0001);
  const fz = Math.min(Math.max((z - f.z0) / f.step, 0), f.h - 1.0001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, w = f.w;
  const a = f.y[j * w + i], b = f.y[j * w + i + 1], c = f.y[(j + 1) * w + i], d = f.y[(j + 1) * w + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// 格子の値を双三次（Catmull-Rom）補間。堤防の肩などの折れ目を、1 m の格子の角を見せずになめらかに
export function sampleBicubic(f, x, z) {
  const fx = Math.min(Math.max((x - f.x0) / f.step, 0), f.w - 1.0001);
  const fz = Math.min(Math.max((z - f.z0) / f.step, 0), f.h - 1.0001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, w = f.w;
  const at = (a, b) => f.y[Math.min(f.h - 1, Math.max(0, b)) * w + Math.min(w - 1, Math.max(0, a))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = b => cr(at(i - 1, b), at(i, b), at(i + 1, b), at(i + 2, b), tx);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
}

// 位置から決まる乱数（0〜1）
export function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

/**
 * 高さ：近景の中は近景（双三次）、外は中景。近景の縁 blend m で中景になめらかにつなぐ
 * @param {object} near  { w, h, x0, z0, step, y }
 * @param {object} mid
 */
export function makeHeightAt(near, mid, blend) {
  const nx1 = near.x0 + (near.w - 1) * near.step, nz1 = near.z0 + (near.h - 1) * near.step;
  return (x, z) => {
    const d = Math.min(x - near.x0, nx1 - x, z - near.z0, nz1 - z);
    if (d <= 0) return sampleField(mid, x, z);
    const t = Math.min(1, d / blend), w = t * t * (3 - 2 * t);
    const yn = sampleBicubic(near, x, z);
    if (w >= 1) return yn;
    const ym = sampleField(mid, x, z);
    return ym + (yn - ym) * w;
  };
}

/**
 * 格子の形（x0..x1, z0..z1 を step 間隔）。法線は隣の高さの差から
 * @param {(x:number, z:number) => number} height
 * @param {Float32Array|null} cellColor  近景の 1 m ごとの色（線形 RGB）。あれば頂点で双一次補間して頂点色に
 * @param {object|null} cellGrid  { x0, z0, w, h }
 * @param {object|null} uvBox     { x0, z0, x1, z1 }。あれば UV を作る（v は z の向き。テクスチャの 1 行目が z0）
 */
export function buildGrid(x0, z0, x1, z1, step, height, cellColor = null, cellGrid = null, uvBox = null) {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1, n = nx * nz;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const col = cellColor ? new Float32Array(n * 3) : null, uv = uvBox ? new Float32Array(n * 2) : null;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z;
    if (col) {
      const G = cellGrid;
      const fx = Math.min(Math.max(x - G.x0, 0), G.w - 1.0001), fz = Math.min(Math.max(z - G.z0, 0), G.h - 1.0001);
      const ci = fx | 0, cj = fz | 0, tx = fx - ci, tz = fz - cj;
      const k00 = (cj * G.w + ci) * 3, k10 = k00 + 3, k01 = k00 + G.w * 3, k11 = k01 + 3;
      for (let c = 0; c < 3; c++) {
        const a = cellColor[k00 + c], b = cellColor[k10 + c], cc = cellColor[k01 + c], d = cellColor[k11 + c];
        col[k * 3 + c] = (a + (b - a) * tx) * (1 - tz) + (cc + (d - cc) * tx) * tz;
      }
    }
    if (uv) { uv[k * 2] = (x - uvBox.x0) / (uvBox.x1 - uvBox.x0); uv[k * 2 + 1] = (z - uvBox.z0) / (uvBox.z1 - uvBox.z0); }
  }
  // 法線：となりの頂点の高さの差（端は片側）
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
    const dx = (pos[(j * nx + ir) * 3 + 1] - pos[(j * nx + il) * 3 + 1]) / ((ir - il) * step);
    const dz = (pos[(ju * nx + i) * 3 + 1] - pos[(jd * nx + i) * 3 + 1]) / ((ju - jd) * step);
    const l = Math.hypot(dx, 1, dz);
    nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dz / l;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let m = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    idx[m++] = a; idx[m++] = d; idx[m++] = b; idx[m++] = b; idx[m++] = d; idx[m++] = e;
  }
  return { pos, nrm, col, uv, idx };
}

/**
 * 中景の色のテクスチャ：空中写真の色（2 m ごと）を、地面の種類の色に寄せて混ぜる。写真の外は種類の色
 * @param {object} p
 * @param {Uint8ClampedArray|null} p.photo  中景の空中写真（RGBA）。無ければ中景の格子の大きさで種類の色だけ
 * @param {number[][]} p.classRGB   中景の種類の番号 → sRGB の色（0〜255）
 * @param {number[]} p.classWeight  中景の種類の番号 → 写真を混ぜる割合
 */
export function buildMidTexture({ M, mid, photo, pw, ph, pstep, classRGB, classWeight }) {
  const cw = photo ? pw : M.w, ch = photo ? ph : M.h, cstep = photo ? pstep : M.step;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i, x = M.x0 + i * cstep, z = M.z0 + j * cstep;
    const mi = Math.min(M.w - 1, Math.max(0, Math.round((x - M.x0) / M.step))), mj = Math.min(M.h - 1, Math.max(0, Math.round((z - M.z0) / M.step)));
    const cls = mid.cls[mj * M.w + mi];
    const base = classRGB[cls] ?? classRGB[0];
    if (photo && photo[k * 4 + 3] > 0) {
      const w = classWeight[cls] ?? 0.65;
      for (let c = 0; c < 3; c++) out[k * 4 + c] = Math.round(base[c] * (1 - w) + photo[k * 4 + c] * w);
    } else {
      out[k * 4] = base[0]; out[k * 4 + 1] = base[1]; out[k * 4 + 2] = base[2];
    }
    out[k * 4 + 3] = 255;
  }
  return { pixels: out, w: cw, h: ch, step: cstep };
}

/** 近景と中景の形と中景のテクスチャを作る（Worker でもメインでも同じ） */
export function buildTerrainMeshes({ near, mid, N, M, blend, nearStep, cellColor, midTex }) {
  const heightAt = makeHeightAt(near, mid, blend);
  const nx1 = N.x0 + (N.w - 1) * N.step, nz1 = N.z0 + (N.h - 1) * N.step;
  const mx1 = M.x0 + (M.w - 1) * M.step, mz1 = M.z0 + (M.h - 1) * M.step;
  const nearGeo = buildGrid(N.x0, N.z0, nx1, nz1, nearStep, heightAt, cellColor, { x0: N.x0, z0: N.z0, w: N.w, h: N.h });
  const tex = buildMidTexture({ M, mid, ...midTex });
  const cx1 = M.x0 + (tex.w - 1) * tex.step, cz1 = M.z0 + (tex.h - 1) * tex.step;
  // 中景は近景の下を 1.5 m 沈めて隠す
  const midH = (x, z) => (x > N.x0 + 2 && x < nx1 - 2 && z > N.z0 + 2 && z < nz1 - 2) ? heightAt(x, z) - 1.5 : heightAt(x, z);
  const midGeo = buildGrid(M.x0, M.z0, mx1, mz1, M.step, midH, null, null, { x0: M.x0, z0: M.z0, x1: cx1, z1: cz1 });
  return { nearGeo, midGeo, tex };
}

/** 結果の配列（Worker から渡すときに、コピーせずに渡す一覧） */
export const transferables = r => [r.nearGeo.pos, r.nearGeo.nrm, r.nearGeo.col, r.nearGeo.idx, r.midGeo.pos, r.midGeo.nrm, r.midGeo.uv, r.midGeo.idx, r.tex.pixels].filter(Boolean).map(a => a.buffer);
