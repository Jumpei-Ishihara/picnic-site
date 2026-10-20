// 写実版の地形（近景＋中景）。tools/geo/build_scene.py の出力（scene.json の files）を読む
//   近景：1 m 間隔の高さを双三次補間して細かい格子（高 25 cm）に。色の平均は地面の種類の色と空中写真の色（頂点色）、
//         細部は地面の種類ごとの PBR の素材（real/ground.js）
//   中景：4 m 間隔の高さ。空中写真の色（2 m ごと）を貼る。写真の外は地面の種類の色。近景の下は沈めて隠す
//   heightAt(x, z)：近景の中は近景、外は中景。近景の縁 blend m で中景になめらかにつなぐ（engine/terrain.js と同じ）
import * as THREE from 'three';
import { loadHeightField } from '../engine/terrain.js';
import { createGroundMaterial, GROUND_LAYERS, CLASS_LAYER } from './ground.js';

// 地面の種類ごとの色の平均（sRGB）。素材（real/ground.js）の模様はこの色のまわりで明暗をつける
export const REAL_GROUND = {
  water:      '#4e4a38', // 川底の泥
  lawn:       '#5f7a3c',
  lawnWorn:   '#7f8350',
  dirt:       '#a09078', // 砂っぽい土・砂利道
  paved:      '#77766f', // 河川敷の道（アスファルトの明るめの灰色）
  revetment:  '#8a877f', // 水際の護岸（コンクリート）
  leveeGrass: '#5a7638',
  road:       '#4b4c4f',
  tree:       '#4f6a34',
  reeds:      '#8a8350',
  other:      '#6a7a48'
};
export const REAL_MID = { town: '#8a857c', grass: '#62783f', pitch: '#9c8866', water: '#4e4a38' };

async function loadPixels(url) {
  const blob = await (await fetch(url, { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data };
}

// 格子の値を双一次補間（範囲外は端の値）
function sampleField(f, x, z) {
  const fx = Math.min(Math.max((x - f.x0) / f.step, 0), f.w - 1.0001);
  const fz = Math.min(Math.max((z - f.z0) / f.step, 0), f.h - 1.0001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, w = f.w;
  const a = f.y[j * w + i], b = f.y[j * w + i + 1], c = f.y[(j + 1) * w + i], d = f.y[(j + 1) * w + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// 格子の値を双三次（Catmull-Rom）補間。堤防の肩などの折れ目を、1 m の格子の角を見せずになめらかに
function sampleBicubic(f, x, z) {
  const fx = Math.min(Math.max((x - f.x0) / f.step, 0), f.w - 1.0001);
  const fz = Math.min(Math.max((z - f.z0) / f.step, 0), f.h - 1.0001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, w = f.w;
  const at = (a, b) => f.y[Math.min(f.h - 1, Math.max(0, b)) * w + Math.min(w - 1, Math.max(0, a))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = b => cr(at(i - 1, b), at(i, b), at(i + 1, b), at(i + 2, b), tx);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
}

// 位置から決まる乱数（0〜1）
function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

// 格子のメッシュ（x0..x1, z0..z1 を step 間隔）。高さと色は関数で
function gridGeometry(x0, z0, x1, z1, step, height, color, uv = null) {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uvs = uv ? new Float32Array(nx * nz * 2) : null;
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    pos.set([x, height(x, z), z], k * 3);
    color(x, z, c);
    col.set([c.r, c.g, c.b], k * 3);
    if (uvs) uvs.set(uv(x, z), k * 2);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    idx.set([a, d, b, b, d, e], n); n += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data      scene.json の中身
 * @param {string} o.baseUrl   scene.json のあるフォルダ（末尾 /）
 * @param {number} [o.blend]   近景の縁で中景につなぐ幅（m）
 * @param {number} [o.photoMix] 近景で空中写真の色を混ぜる割合
 * @param {number} [o.nearStep] 近景の格子の間隔（m）
 * @param {number} [o.texSize]  地面の素材のテクスチャの大きさ（px）
 */
export async function createRealTerrain({ scene, data, baseUrl, blend = 6, photoMix = 0.3, nearStep = 0.25, texSize = 1024 }) {
  const originTP = data.frame.origin.tp;
  const N = data.files.near, M = data.files.mid;
  const [near, mid, groundImg, photoImg, midPhotoImg] = await Promise.all([
    loadHeightField(baseUrl + N.height, { ...N, originTP }),
    loadHeightField(baseUrl + M.height, { ...M, originTP }),
    loadPixels(baseUrl + N.ground),
    N.groundColor ? loadPixels(baseUrl + N.groundColor) : null,
    M.color ? loadPixels(baseUrl + M.color.file) : null
  ]);
  const nx1 = N.x0 + (N.w - 1) * N.step, nz1 = N.z0 + (N.h - 1) * N.step;
  const mx1 = M.x0 + (M.w - 1) * M.step, mz1 = M.z0 + (M.h - 1) * M.step;

  // 地面の種類（ground.png の色 → いちばん近い data.ground の色の種類）
  const groundNames = data.ground.map(g => g.name);
  const refs = data.ground.map(g => { const n = parseInt(g.color.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  const groundCls = new Uint8Array(N.w * N.h);
  for (let k = 0; k < N.w * N.h; k++) {
    const r = groundImg.px[k * 4], g = groundImg.px[k * 4 + 1], b = groundImg.px[k * 4 + 2];
    let best = 0, bd = Infinity;
    refs.forEach(([R, G, B], i) => { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = i; } });
    groundCls[k] = best;
  }

  const midAt = (x, z) => sampleField(mid, x, z);
  const nearWeight = (x, z) => {
    const d = Math.min(x - N.x0, nx1 - x, z - N.z0, nz1 - z);
    if (d <= 0) return 0;
    const t = Math.min(1, d / blend);
    return t * t * (3 - 2 * t);
  };
  function heightAt(x, z) {
    const w = nearWeight(x, z);
    if (w <= 0) return midAt(x, z);
    const yn = sampleBicubic(near, x, z);
    return w >= 1 ? yn : midAt(x, z) + (yn - midAt(x, z)) * w;
  }
  const inNear = (x, z) => x >= N.x0 && z >= N.z0 && x <= nx1 && z <= nz1;
  function groundAt(x, z) {
    if (inNear(x, z)) {
      const i = Math.round(x - N.x0), j = Math.round(z - N.z0);
      return groundNames[groundCls[j * N.w + i]] ?? 'other';
    }
    return midClassAt(x, z);
  }
  function midClassAt(x, z) {
    const i = Math.min(M.w - 1, Math.max(0, Math.round((x - M.x0) / M.step)));
    const j = Math.min(M.h - 1, Math.max(0, Math.round((z - M.z0) / M.step)));
    return M.classes[mid.cls[j * M.w + i]] ?? 'grass';
  }

  // ---- 近景：1 m ごとの色の平均（地面の種類の色と空中写真の色）を頂点で補間し、素材の模様を重ねる
  const cellColor = new Float32Array(N.w * N.h * 3);
  const layerOfCell = new Uint8Array(N.w * N.h);
  const layerIndex = Object.fromEntries(GROUND_LAYERS.map((l, i) => [l.name, i]));
  {
    const c = new THREE.Color(), photo = new THREE.Color();
    for (let j = 0; j < N.h; j++) for (let i = 0; i < N.w; i++) {
      const k = j * N.w + i, name = groundNames[groundCls[k]];
      c.setStyle(REAL_GROUND[name] ?? REAL_GROUND.other);
      if (photoImg) {
        photo.setRGB(photoImg.px[k * 4] / 255, photoImg.px[k * 4 + 1] / 255, photoImg.px[k * 4 + 2] / 255, THREE.SRGBColorSpace);
        c.lerp(photo, photoMix);
      }
      c.multiplyScalar(0.94 + 0.12 * hash2(i, j)); // 1 m ごとの小さなむら
      cellColor.set([c.r, c.g, c.b], k * 3);
      layerOfCell[k] = layerIndex[CLASS_LAYER[name] ?? 'grass'];
    }
  }
  const cellAt = (x, z, out) => {
    const fx = Math.min(Math.max(x - N.x0, 0), N.w - 1.0001), fz = Math.min(Math.max(z - N.z0, 0), N.h - 1.0001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k00 = (j * N.w + i) * 3, k10 = k00 + 3, k01 = k00 + N.w * 3, k11 = k01 + 3;
    for (let n = 0; n < 3; n++) {
      const a = cellColor[k00 + n], b = cellColor[k10 + n], cc = cellColor[k01 + n], d = cellColor[k11 + n];
      out[n] = (a + (b - a) * tx) * (1 - tz) + (cc + (d - cc) * tx) * tz;
    }
  };
  const rgbTmp = [0, 0, 0];
  const nearGeo = gridGeometry(N.x0, N.z0, nx1, nz1, nearStep, heightAt, (x, z, c) => { cellAt(x, z, rgbTmp); c.setRGB(rgbTmp[0], rgbTmp[1], rgbTmp[2]); });
  const nearMat = await createGroundMaterial({ layerOfCell, grid: { x0: N.x0, z0: N.z0, w: N.w, h: N.h }, size: texSize });
  const nearMesh = new THREE.Mesh(nearGeo, nearMat);
  nearMesh.receiveShadow = true;
  nearMesh.castShadow = true;
  nearMesh.name = 'terrain-near';
  scene.add(nearMesh);

  // ---- 中景：空中写真の色のテクスチャ（写真の外は地面の種類の色）。近景の下は 1.5 m 沈める
  const cw = midPhotoImg ? midPhotoImg.w : M.w, ch = midPhotoImg ? midPhotoImg.h : M.h;
  const cstep = midPhotoImg ? M.color.step : M.step;
  const cv = new OffscreenCanvas(cw, ch), g = cv.getContext('2d');
  const img = g.createImageData(cw, ch);
  const midRGB = Object.fromEntries(Object.entries(REAL_MID).map(([k, v]) => { const n = parseInt(v.slice(1), 16); return [k, [n >> 16, (n >> 8) & 255, n & 255]]; }));
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const k = j * cw + i, x = M.x0 + i * cstep, z = M.z0 + j * cstep;
    const base = midRGB[midClassAt(x, z)] ?? midRGB.grass;
    let rgb = base;
    if (midPhotoImg && midPhotoImg.px[k * 4 + 3] > 0) {
      const p = [midPhotoImg.px[k * 4], midPhotoImg.px[k * 4 + 1], midPhotoImg.px[k * 4 + 2]];
      rgb = base.map((v, n) => Math.round(v * 0.35 + p[n] * 0.65)); // 写真は明るさが強いので、少し種類の色に寄せる
    }
    img.data.set([rgb[0], rgb[1], rgb[2], 255], k * 4);
  }
  g.putImageData(img, 0, 0);
  const midTex = new THREE.CanvasTexture(cv);
  midTex.colorSpace = THREE.SRGBColorSpace;
  midTex.anisotropy = 8;
  const cx1 = M.x0 + (cw - 1) * cstep, cz1 = M.z0 + (ch - 1) * cstep;
  const midGeo = gridGeometry(M.x0, M.z0, mx1, mz1, M.step,
    (x, z) => (x > N.x0 + 2 && x < nx1 - 2 && z > N.z0 + 2 && z < nz1 - 2) ? heightAt(x, z) - 1.5 : heightAt(x, z),
    (x, z, c) => c.setRGB(1, 1, 1),
    (x, z) => [(x - M.x0) / (cx1 - M.x0), 1 - (z - M.z0) / (cz1 - M.z0)]);
  const midMat = new THREE.MeshPhysicalMaterial({ map: midTex, roughness: 1, metalness: 0, specularIntensity: 0.25 });
  const midMesh = new THREE.Mesh(midGeo, midMat);
  midMesh.receiveShadow = true;
  midMesh.name = 'terrain-mid';
  scene.add(midMesh);

  return {
    near: nearMesh, mid: midMesh, heightAt, groundAt, midClassAt,
    bounds: { near: { x0: N.x0, z0: N.z0, x1: nx1, z1: nz1 }, mid: { x0: M.x0, z0: M.z0, x1: mx1, z1: mz1 } }
  };
}
