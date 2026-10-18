// 高さの画像から作る地形（近景＋中景）。tools/geo/build_scene.py の出力（scene.json の files）を読む
//   近景：1 m 間隔の高さ＋地面の種類（ground.png）からドット絵のテクスチャを焼く。影を受け、落とす
//   中景：4 m 間隔の高さを間引いて粗いメッシュに。地面の種類ごとの頂点色。近景の下は沈めて隠す
//   heightAt(x, z)：近景の中は近景、外は中景。近景の縁 blend m で中景になめらかにつなぐ
import * as THREE from 'three';
import { makeCanvas, pixelTex } from './pixel-kit.js';

/**
 * 高さの PNG を読む。R*256+G = (TP+10)*100、B = 地面の種類の番号。
 * @returns {Promise<{w:number, h:number, x0:number, z0:number, step:number, y:Float32Array, cls:Uint8Array}>}
 */
export async function loadHeightField(url, { x0, z0, step, originTP }) {
  const blob = await (await fetch(url, { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const [cv, g] = makeCanvas(bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const n = bmp.width * bmp.height;
  const y = new Float32Array(n), cls = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    y[k] = (px[k * 4] * 256 + px[k * 4 + 1]) / 100 - 10 - originTP;
    cls[k] = px[k * 4 + 2];
  }
  cv.width = cv.height = 0;
  return { w: bmp.width, h: bmp.height, x0, z0, step, y, cls };
}

// 格子の値を双一次補間（範囲外は端の値）
function sampleField(f, x, z) {
  const fx = Math.min(Math.max((x - f.x0) / f.step, 0), f.w - 1.0001);
  const fz = Math.min(Math.max((z - f.z0) / f.step, 0), f.h - 1.0001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, w = f.w;
  const a = f.y[j * w + i], b = f.y[j * w + i + 1], c = f.y[(j + 1) * w + i], d = f.y[(j + 1) * w + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
const inField = (f, x, z) => x >= f.x0 && z >= f.z0 && x <= f.x0 + (f.w - 1) * f.step && z <= f.z0 + (f.h - 1) * f.step;

// 位置から決まる乱数（0〜1）
function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
// なめらかなノイズ（まだら模様）
function valueNoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), tx = x - i, tz = z - j;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

// 地面の種類ごとの 3 色（暗・中・明, sRGB）と模様。名前は scene.json の ground[].name
export const GROUND_LOOKS = {
  water:      { c: ['#4a4a32', '#5a573a', '#6b6744'], pattern: 'mud' },       // 水の下の川底（濁った泥）
  lawn:       { c: ['#4f7a34', '#679142', '#86ad55'], pattern: 'grass' },
  lawnWorn:   { c: ['#7a8a4a', '#94a35c', '#b2b878'], pattern: 'grass' },
  dirt:       { c: ['#a8875c', '#c2a274', '#d8bc8e'], pattern: 'speckle' },
  paved:      { c: ['#9a9a92', '#b4b4ac', '#cacac2'], pattern: 'slab' },
  revetment:  { c: ['#7d7c74', '#93928a', '#a9a89e'], pattern: 'block' },
  leveeGrass: { c: ['#4a7432', '#5f8a3e', '#7ba24f'], pattern: 'grass' },
  road:       { c: ['#55565c', '#64656b', '#75767c'], pattern: 'asphalt' },
  tree:       { c: ['#3c6a2c', '#4f7a34', '#679142'], pattern: 'grass' },     // 木の下（木そのものは場面側で立てる）
  reeds:      { c: ['#8a8445', '#a39c56', '#bdb46a'], pattern: 'grass' },
  other:      { c: ['#6f7f48', '#86955a', '#9fae6c'], pattern: 'grass' }
};
// 中景の地面の種類（mid_height.png の B）
export const MID_LOOKS = {
  town:  '#8a8378',
  grass: '#6a9446',
  pitch: '#b39a70',
  water: '#4a4a32'
};

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data        scene.json の中身
 * @param {string} o.baseUrl     scene.json のあるフォルダ（末尾 /）
 * @param {(p:object) => THREE.Material} o.material  トゥーンのマテリアルを作る関数（createToon の戻り値）
 * @param {number} [o.ppm]       近景のテクスチャ密度（1 m あたりのドット数）
 * @param {number} [o.midStep]   中景の間引き（2 なら 8 m 間隔）
 * @param {number} [o.blend]     近景の縁で中景につなぐ幅（m）
 * @param {string[]} [o.midPhotoClasses]  files.mid.color（中景の空中写真の色、2 m ごと）がある場面で、写真の色を混ぜる中景の種類
 * @param {number} [o.photoMix]  files.near.groundColor（空中写真の色）がある場面で、looks の photo: true の種類に写真の色をどれだけ混ぜるか
 */
export async function createHeightTerrain({ scene, data, baseUrl, material, ppm = 8, midStep = 2, blend = 6, looks = GROUND_LOOKS, midLooks = MID_LOOKS, photoMix = 0.6, midPhotoClasses = ['grass', 'pitch'] }) {
  const originTP = data.frame.origin.tp;
  const N = data.files.near, M = data.files.mid;
  const [near, mid] = await Promise.all([
    loadHeightField(baseUrl + N.height, { ...N, originTP }),
    loadHeightField(baseUrl + M.height, { ...M, originTP })
  ]);
  // 地面の種類（ground.png の色 → 番号）
  const groundNames = data.ground.map(g => g.name);
  const groundCls = await loadGroundClasses(baseUrl + N.ground, data.ground);
  const groundColor = N.groundColor ? await loadRGB(baseUrl + N.groundColor, N.w, N.h) : null;
  const nx1 = N.x0 + (N.w - 1) * N.step, nz1 = N.z0 + (N.h - 1) * N.step;

  const midAt = (x, z) => sampleField(mid, x, z);
  // 近景の縁からの距離で、近景と中景を混ぜる割合
  const nearWeight = (x, z) => {
    const d = Math.min(x - N.x0, nx1 - x, z - N.z0, nz1 - z);
    if (d <= 0) return 0;
    const t = Math.min(1, d / blend);
    return t * t * (3 - 2 * t);
  };
  function heightAt(x, z) {
    const w = nearWeight(x, z);
    if (w <= 0) return midAt(x, z);
    const yn = sampleField(near, x, z);
    return w >= 1 ? yn : midAt(x, z) + (yn - midAt(x, z)) * w;
  }
  // 近景の地面の種類の名前（範囲外は中景の種類）
  function groundAt(x, z) {
    if (inField(near, x, z)) {
      const i = Math.round(x - N.x0), j = Math.round(z - N.z0);
      return groundNames[groundCls[j * N.w + i]] ?? 'other';
    }
    return midClassAt(x, z);
  }
  function midClassAt(x, z) {
    const i = Math.min(Math.max(Math.round((x - M.x0) / M.step), 0), M.w - 1);
    const j = Math.min(Math.max(Math.round((z - M.z0) / M.step), 0), M.h - 1);
    return M.classes[mid.cls[j * M.w + i]] ?? 'town';
  }

  // ---- 近景のメッシュ（1 m 間隔）とテクスチャ
  const nearMesh = new THREE.Mesh(
    gridGeometry(N.w, N.h, N.x0, N.z0, N.step, heightAt),
    material({ map: bakeGroundTexture({ N, groundCls, groundNames, looks, ppm, groundColor, photoMix }) })
  );
  nearMesh.receiveShadow = true;
  nearMesh.castShadow = true;
  nearMesh.name = 'terrain-near';
  scene.add(nearMesh);

  // ---- 中景のメッシュ（間引き）。近景の下は沈める
  const ms = M.step * midStep;
  const mw = Math.floor((M.w - 1) / midStep) + 1, mh = Math.floor((M.h - 1) / midStep) + 1;
  const sink = ms + 1;
  const midHeight = (x, z) => {
    const inside = x > N.x0 + sink && x < nx1 - sink && z > N.z0 + sink && z < nz1 - sink;
    return inside ? midAt(x, z) - 3 : heightAt(x, z);
  };
  const midGeo = gridGeometry(mw, mh, M.x0, M.z0, ms, midHeight);
  let midMat;
  if (M.color) {
    // 中景の色を 2 m ごとのテクスチャに：種類の色に、写真の色を混ぜる（河川敷の内野・道・水際の植え込みが見える）
    const C = M.color;
    const photo = await loadRGBA(baseUrl + C.file);
    const [cv, g] = makeCanvas(C.w, C.h);
    const img = g.createImageData(C.w, C.h);
    const col = new THREE.Color();
    const cache = {};
    for (let j = 0; j < C.h; j++) for (let i = 0; i < C.w; i++) {
      const x = C.x0 + i * C.step, z = C.z0 + j * C.step, o = (j * C.w + i) * 4;
      const cls = midClassAt(x, z);
      const base = cache[cls] ??= (col.set(midLooks[cls] ?? midLooks.town), [col.r * 255, col.g * 255, col.b * 255]);
      // 写真の水（灰色）は混ぜない：水際の斜面が明るい帯に見えてしまうので
      const pr = photo.data[o], pg = photo.data[o + 1], pb = photo.data[o + 2];
      const usePhoto = photo.data[o + 3] > 0 && midPhotoClasses.includes(cls) && (pg - Math.max(pr, pb) >= 2 || pr + pg + pb > 480);
      const v = 0.92 + hash2(i, j) * 0.14;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, (usePhoto ? base[c] + (photo.data[o + c] - base[c]) * photoMix : base[c]) * v);
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    midMat = material({ map: pixelTex(cv) });
  }
  const colors = new Float32Array(mw * mh * 3);
  const c = new THREE.Color();
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const x = M.x0 + i * ms, z = M.z0 + j * ms;
    c.set(midLooks[midClassAt(x, z)] ?? midLooks.town);
    const v = 0.9 + hash2(i, j) * 0.18; // 少しまだらに
    colors.set([c.r * v, c.g * v, c.b * v], (j * mw + i) * 3);
  }
  midGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const midMesh = new THREE.Mesh(midGeo, midMat ?? material({ vertexColors: true }));
  midMesh.receiveShadow = true;
  midMesh.name = 'terrain-mid';
  scene.add(midMesh);

  return {
    near: nearMesh, mid: midMesh, nearField: near, midField: mid,
    bounds: { near: { x0: N.x0, z0: N.z0, x1: nx1, z1: nz1 }, mid: { x0: M.x0, z0: M.z0, x1: M.x0 + (M.w - 1) * M.step, z1: M.z0 + (M.h - 1) * M.step } },
    heightAt, groundAt, midClassAt,
    // 傾き（勾配の大きさ、1:4 なら 0.25）
    slopeAt(x, z, d = 0.5) {
      const gx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d), gz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
      return Math.hypot(gx, gz);
    }
  };
}

// 1 m ごとの色の画像を読み、3×3 でならす（車や影の点を消す）
async function loadRGB(url, w, h) {
  const blob = await (await fetch(url, { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const [cv, g] = makeCanvas(bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  cv.width = cv.height = 0;
  const out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
      const o = (jj * w + ii) * 4;
      r += px[o]; gg += px[o + 1]; b += px[o + 2]; n++;
    }
    out.set([r / n, gg / n, b / n], (j * w + i) * 3);
  }
  return out;
}

// 透明度つきの画像をそのまま読む（中景の写真の色）
async function loadRGBA(url) {
  const blob = await (await fetch(url, { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const [cv, g] = makeCanvas(bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  cv.width = cv.height = 0;
  return d;
}

// 地面の種類を ground.png の色から読む
async function loadGroundClasses(url, ground) {
  const blob = await (await fetch(url, { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const [cv, g] = makeCanvas(bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const lut = new Map(ground.map(gr => [parseInt(gr.color.slice(1), 16), gr.id]));
  const other = ground.find(gr => gr.name === 'other')?.id ?? 0;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let k = 0; k < out.length; k++) out[k] = lut.get((px[k * 4] << 16) | (px[k * 4 + 1] << 8) | px[k * 4 + 2]) ?? other;
  cv.width = cv.height = 0;
  return out;
}

// w×h 頂点の格子。テクスチャの上端（v = 1）が z0 の側になるようにする
function gridGeometry(w, h, x0, z0, step, heightAt) {
  const pos = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * w + i;
    pos[k * 3] = x; pos[k * 3 + 1] = heightAt(x, z); pos[k * 3 + 2] = z;
    uv[k * 2] = i / (w - 1); uv[k * 2 + 1] = 1 - j / (h - 1);
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    // 対角線の向きを交互に（斜面の筋が一方向にそろわないように）
    if ((i + j) & 1) idx.set([a, c, b, b, c, d], n); else idx.set([a, c, d, a, d, b], n);
    n += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 近景の地面のテクスチャ：種類ごとの 3 色と模様。種類の境目は少しずらして混ぜる（1 m の階段が見えないように）
function bakeGroundTexture({ N, groundCls, groundNames, looks, ppm, groundColor = null, photoMix = 0.6 }) {
  const W = (N.w - 1) * ppm, H = (N.h - 1) * ppm;
  const [cv, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  const cols = groundNames.map(n => (looks[n] ?? looks.other).c.map(rgb));
  const pats = groundNames.map(n => (looks[n] ?? looks.other).pattern);
  const usePhoto = groundNames.map(n => !!(groundColor && (looks[n] ?? looks.other).photo));
  const tmpC = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let py = 0; py < H; py++) {
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
      const o = (py * W + px) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return pixelTex(cv);
}
