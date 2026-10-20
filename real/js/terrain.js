// 写実版の地形（近景＋中景）。tools/geo/build_scene.py の出力（scene.json の files）を読む
//   近景：1 m 間隔の高さを双三次補間して細かい格子（高 25 cm）に。色の平均は地面の種類の色と空中写真の色（頂点色）、
//         細部は地面の種類ごとの PBR の素材（real/js/ground.js）
//   中景：4 m 間隔の高さ。空中写真の色（2 m ごと）を貼る。写真の外は地面の種類の色。近景の下は沈めて隠す
//   heightAt(x, z)：近景の中は近景、外は中景。近景の縁 blend m で中景になめらかにつなぐ（engine/terrain.js と同じ）
//   形（近景・中景の格子）は Web Worker で作る（real/js/terrain-worker.js）。高さ・地面の種類・色はすぐ返すので、
//   そのあいだに木や遠景を組み立てられる。形と地面の素材がそろうと ready が解決する
import * as THREE from 'three';
import { createGroundMaterial, GROUND_LAYERS, CLASS_LAYER } from './ground.js';
import { makeHeightAt, hash2, buildTerrainMeshes } from './terrain-core.js';

// 地面の種類ごとの色の平均（sRGB）。素材（real/js/ground.js）の模様はこの色のまわりで明暗をつける
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
// 初夏（6 月上旬）：芝・堤防の草・ヨシが青々とした緑に
export const REAL_GROUND_EARLY_SUMMER = {
  lawn: '#547a32', lawnWorn: '#74844a', leveeGrass: '#4e7430', tree: '#46682e', reeds: '#62803c', other: '#5e7a40'
};
export const REAL_MID = { town: '#8a857c', grass: '#62783f', pitch: '#9c8866', water: '#4e4a38' };

// 高さの PNG を読む。R*256+G = (TP+10)*100、B = 地面の種類の番号（engine/terrain.js の loadHeightField と同じ形式）。
// engine の方はキャッシュを使わずに読むので、ページの頭の予告（preload）が無駄になる。写実版はこちらを使う
async function loadHeightField(url, { x0, z0, step, originTP }) {
  const { w, h, px } = await loadPixels(url);
  const n = w * h, y = new Float32Array(n), cls = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    y[k] = (px[k * 4] * 256 + px[k * 4 + 1]) / 100 - 10 - originTP;
    cls[k] = px[k * 4 + 2];
  }
  return { w, h, x0, z0, step, y, cls };
}

async function loadPixels(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data };
}

// 形を三角形の格子にする（Worker またはメインで作った配列から）
function toGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nrm, 3));
  if (g.col) geo.setAttribute('color', new THREE.BufferAttribute(g.col, 3));
  if (g.uv) geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// 形を作る：Web Worker が使えればそこで（メインのスレッドはほかの組み立てを進められる）、だめならここで
function buildMeshes(job) {
  try {
    const worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
    return new Promise((res, rej) => {
      worker.onmessage = e => { res(e.data); worker.terminate(); };
      worker.onerror = e => { worker.terminate(); e.preventDefault(); res(buildTerrainMeshes(job)); };
      worker.postMessage(job);
    });
  } catch {
    return Promise.resolve(buildTerrainMeshes(job));
  }
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data      scene.json の中身
 * @param {string} o.baseUrl   scene.json のあるフォルダ（末尾 /）
 * @param {number} [o.blend]   近景の縁で中景につなぐ幅（m）
 * @param {number} [o.photoMix] 近景で空中写真の色を混ぜる割合
 * @param {number} [o.nearStep] 近景の格子の間隔（m）
 * @param {number} [o.colorSize]  地面の素材（色）の大きさ（px）
 * @param {number} [o.normalSize] 地面の素材（凹凸）の大きさ（px）
 * @param {string} [o.season]   'autumn'（10 月中旬）か 'summer'（初夏）
 */
export async function createRealTerrain({ scene, data, baseUrl, blend = 6, photoMix = 0.3, nearStep = 0.25, colorSize = 1024, normalSize = 1024, season = 'autumn' }) {
  const looks = season === 'summer' ? { ...REAL_GROUND, ...REAL_GROUND_EARLY_SUMMER } : REAL_GROUND;
  const originTP = data.frame.origin.tp;
  const N = data.files.near, M = data.files.mid;
  const t0 = performance.now(), timings = {};
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

  const heightAt = makeHeightAt(near, mid, blend);
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
      c.setStyle(looks[name] ?? looks.other);
      if (photoImg) {
        photo.setRGB(photoImg.px[k * 4] / 255, photoImg.px[k * 4 + 1] / 255, photoImg.px[k * 4 + 2] / 255, THREE.SRGBColorSpace);
        c.lerp(photo, photoMix);
      }
      c.multiplyScalar(0.94 + 0.12 * hash2(i, j)); // 1 m ごとの小さなむら
      cellColor.set([c.r, c.g, c.b], k * 3);
      layerOfCell[k] = layerIndex[CLASS_LAYER[name] ?? 'grass'];
    }
  }
  timings.images = performance.now() - t0;

  // ---- 近景・中景のメッシュ：形はあとで入れる（Worker で作る）。歩く・タップの対象として先に置いておく
  const nearMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  nearMesh.receiveShadow = true;
  nearMesh.castShadow = true;
  nearMesh.name = 'terrain-near';
  const midMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  midMesh.receiveShadow = true;
  midMesh.name = 'terrain-mid';
  scene.add(nearMesh, midMesh);

  // 中景の種類ごとの色と、空中写真を混ぜる割合（写真は明るさが強いので種類の色に寄せる。町は屋根の白さが強いのでさらに）
  const classRGB = M.classes.map(c => { const n = parseInt((REAL_MID[c] ?? REAL_MID.grass).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  const classWeight = M.classes.map(c => c === 'town' ? 0.45 : 0.65);
  const job = {
    near, mid, N, M, blend, nearStep, cellColor,
    midTex: { photo: midPhotoImg?.px ?? null, pw: midPhotoImg?.w, ph: midPhotoImg?.h, pstep: M.color?.step, classRGB, classWeight }
  };
  const tw = performance.now();
  const ready = Promise.all([
    buildMeshes(job).then(r => { timings.meshes = performance.now() - tw; return r; }),
    createGroundMaterial({ layerOfCell, grid: { x0: N.x0, z0: N.z0, w: N.w, h: N.h }, colorSize, normalSize }).then(m => { timings.groundMaterial = performance.now() - tw; return m; })
  ]).then(([r, nearMat]) => {
    nearMesh.geometry = toGeometry(r.nearGeo);
    nearMesh.material = nearMat;
    const midTex = new THREE.DataTexture(r.tex.pixels, r.tex.w, r.tex.h, THREE.RGBAFormat);
    midTex.flipY = false;
    midTex.colorSpace = THREE.SRGBColorSpace;
    midTex.magFilter = THREE.LinearFilter;
    midTex.minFilter = THREE.LinearMipmapLinearFilter;
    midTex.generateMipmaps = true;
    midTex.anisotropy = 8;
    midTex.needsUpdate = true;
    midMesh.geometry = toGeometry(r.midGeo);
    midMesh.material = new THREE.MeshPhysicalMaterial({ map: midTex, roughness: 1, metalness: 0, specularIntensity: 0.25 });
  });
  return {
    timings, ready,
    near: nearMesh, mid: midMesh, heightAt, groundAt, midClassAt,
    // 草（real/js/grass.js）が地面の色にそろえるための、1 m ごとの色の平均（線形 RGB）と格子
    cellColor, grid: { x0: N.x0, z0: N.z0, w: N.w, h: N.h },
    bounds: { near: { x0: N.x0, z0: N.z0, x1: nx1, z1: nz1 }, mid: { x0: M.x0, z0: M.z0, x1: mx1, z1: mz1 } }
  };
}
