// ez-tree 1.1.0 の素材の読み込みを、写実版用に作り直したもの（もとは src/lib/textures.js）
//   もとはすべての樹皮・葉の画像をライブラリに埋め込んでいた（約 3 MB）。写実版はオークの樹皮と葉だけを使うので、
//   real/assets/trees/ の WebP（tools/real/build_textures.py で作る）を読む。ほかの樹種はオークで代える
//   ready：素材を読み終えたら解決する Promise（木を写して板の絵を作る前に待つ）
import * as THREE from 'three';

const base = new URL('../../../assets/trees/', import.meta.url).href;
const loader = new THREE.TextureLoader();
const loads = [];
const load = (file, srgb) => {
  let done;
  loads.push(new Promise(res => { done = res; }));
  const t = loader.load(base + file, () => done(), undefined, () => done()); // 読めなくても止めない（素材なしで描く）
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  return t;
};

const oak = {
  ao: load('oak_bark_ao.webp', false),
  color: load('oak_bark_color.webp', true),
  normal: load('oak_bark_normal.webp', false),
  roughness: load('oak_bark_rough.webp', false)
};
const oakLeaves = load('oak_leaves.webp', true);

export const ready = Promise.all(loads);

/**
 * 樹皮の素材（どの樹種もオーク）
 * @param {string} barkType
 * @param {'ao' | 'color' | 'normal' | 'roughness'} fileType
 * @param {{x:number, y:number}} scale
 */
export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const texture = oak[fileType];
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.x = scale.x;
  texture.repeat.y = 1 / scale.y;
  return texture;
}

/** 葉の素材（どの樹種もオーク） */
export function getLeafTexture(leafType) {
  return oakLeaves;
}
