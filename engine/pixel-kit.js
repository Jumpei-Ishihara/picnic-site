// ドット絵テクスチャ・マテリアルの小道具と、共通パレット
import * as THREE from 'three';

// 減色パレット（sRGB）。街・ピクニックで共有する基本の色。
export const MASTER_PALETTE = [
  '#0d0b1a', '#1b1a33', '#26304f', '#2f2a3d',
  '#2c4a7a', '#3c6aa8', '#5a8fd1', '#84b6ea', '#b6dcf6', '#e2f3fb',
  '#1f3b2d', '#2e5a3a', '#3f7d3c', '#5fa04a', '#8ac35b', '#bfe08a',
  '#3a2a22', '#5b3d2b', '#7f5639', '#a8774c', '#cf9f6b', '#e8c99a',
  '#5a1f2b', '#8c2f39', '#b8463f', '#e06a4f', '#f29a6b',
  '#f6c95b', '#ffe79a', '#fff6d6', '#ecdcb0', // ecdcb0: 夕方へ移る空の中間色
  '#4b2d5c', '#7a3f6e', '#b35a7a', '#e88a8e',
  '#4a4a55', '#6d6d78', '#9497a0', '#c3c4c8', '#f4f4f2',
  '#1e5a66', '#2f8a8f', '#5cc0b5'
];

// シェーダーの // コメントを取り除く（日本語のコメントを GPU に渡さないため。端末によっては ASCII 以外を受け付けない）
export const glsl = src => src.replace(/\/\/[^\n]*/g, '');

export const PPM = 8; // テクスチャ密度（1mあたりのドット数）

// 再現性のある乱数（同じ seed なら同じ街並みになる）
export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const makePicker = rnd => arr => arr[(rnd() * arr.length) | 0];

export function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [cv, g];
}

// amt < 0 で暗く、amt > 0 で明るく
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ニアレスト補間・ミップマップなしのドット絵テクスチャ
export function pixelTex(cv, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 3段階トゥーンのマテリアルを作る関数を返す。levels は影→光の明るさ（0〜255）。
export function createToon(levels = [115, 185, 255]) {
  const gradientMap = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.RedFormat);
  gradientMap.magFilter = gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return (p = {}) => new THREE.MeshToonMaterial({ gradientMap, ...p });
}

// ---------------------------------------------------------------------------
// 素材ごとの3色（影・中間・光）で塗るトゥーン。
// 光の当たり方を3段階に分け、素材の色に「段階ごとの色のずらし（RAMP）」を掛ける。
// 影は青紫へ、光は黄みへずらすので、明るさを掛けるだけの陰影より色が澄む（旧版の塗り方）。
// 時間帯の光の色と明るさは保つ（夕方は橙、夜は暗く青い）。
// ---------------------------------------------------------------------------
export const RAMP = {
  shadow: { value: new THREE.Vector3(0.24, 0.28, 0.38) },   // 影：素材色に掛ける（線形）
  mid: { value: new THREE.Vector3(0.74, 0.76, 0.8) },       // 中間
  high: { value: new THREE.Vector3(1.2, 1.14, 0.96) },      // 光
  bands: { value: new THREE.Vector2(0.42, 0.7) },           // 影/中間、中間/光 の境目（真昼の日なた = 1）
  dayRef: { value: 1.0 },                                   // 真昼の明るさ（夜や夕方の暗さの基準）
  amount: { value: 1.0 }                                    // 0 で通常のトゥーンに戻る
};
const RAMP_GLSL = `
#if NUM_DIR_LIGHTS > 0 && NUM_HEMI_LIGHTS > 0
{
  const vec3 LUMA = vec3(0.299, 0.587, 0.114);
  vec3 eFull = (directionalLights[0].color + hemisphereLights[0].skyColor) * RECIPROCAL_PI;
  float fullL = max(dot(eFull, LUMA), 1e-4);
  float baseL = max(dot(diffuseColor.rgb, LUMA), 1e-3);
  vec3 reflected = outgoingLight - totalEmissiveRadiance;      // glow is kept as-is and added back below
  float tRel = dot(reflected, LUMA) / (baseL * fullL);
  vec3 tone = tRel < uRampBands.x ? uRampShadow : (tRel < uRampBands.y ? uRampMid : uRampHigh);
  vec3 E = reflected / max(diffuseColor.rgb, vec3(0.03));
  vec3 chroma = E / max(dot(E, LUMA), 1e-4);
  float expo = clamp(fullL / uRampDayRef, 0.12, 1.0);
  // light beyond what full sun + sky can give = lamps (lantern, street lights): add it on top as-is
  vec3 lamp = max(reflected - diffuseColor.rgb * eFull, vec3(0.0));
  vec3 ramped = diffuseColor.rgb * tone * mix(vec3(1.0), chroma, 0.6) * expo + lamp * 1.2;
  outgoingLight = mix(outgoingLight, ramped + totalEmissiveRadiance, uRampAmount);
}
#endif
`;
// MeshToonMaterial を3色塗りにする（すでにある onBeforeCompile は残して後ろに足す）
export function rampify(mat) {
  if (mat.userData.ramped || !mat.isMeshToonMaterial) return mat;
  mat.userData.ramped = true;
  const prev = mat.onBeforeCompile;
  const hasKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
  const prevKey = hasKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, renderer) => {
    if (prev) prev.call(mat, sh, renderer);
    Object.assign(sh.uniforms, {
      uRampShadow: RAMP.shadow, uRampMid: RAMP.mid, uRampHigh: RAMP.high,
      uRampBands: RAMP.bands, uRampDayRef: RAMP.dayRef, uRampAmount: RAMP.amount
    });
    sh.fragmentShader = 'uniform vec3 uRampShadow, uRampMid, uRampHigh; uniform vec2 uRampBands; uniform float uRampDayRef, uRampAmount;\n'
      + sh.fragmentShader.replace('#include <opaque_fragment>', RAMP_GLSL + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => prevKey() + '|ramp';
  mat.needsUpdate = true;
  return mat;
}
