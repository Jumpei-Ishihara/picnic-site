// 写実版の地面の素材：地面の種類（1 m ごと）に PBR の素材（色・凹凸・粗さ）を割り当て、境目をゆらがせて混ぜる
//   素材は real/assets/ground/ の WebP（ambientCG、CC0。tools/real/build_textures.py で作る。このファイルからの相対で読む）。
//   色の平均（線形）は means.json に前もって計算してある。テクスチャ配列（sampler2DArray）にまとめて 3 枚で渡す
//   色の平均は頂点色（地面の種類の色＋空中写真の色）にそろえ、素材は細部の模様だけを足す
//   繰り返しが目立たないよう、大きさと向きの違う 2 枚の色を重ねる
import * as THREE from 'three';

// 素材の層（順番がテクスチャ配列の番号）。scale は 1 枚が覆う大きさ（m）、normal は凹凸の強さ、
// contrast は模様の明暗の強さ（1 で素材のまま）、rough は粗さの下限（素材の粗さをこの値〜1 に読み替える。
// 素材のままだと砂利・コンクリートが濡れたように空を映す）
export const GROUND_LAYERS = [
  { name: 'grass',    scale: 2.2, normal: 1.0, contrast: 1.0,  rough: 0.75 },
  { name: 'worn',     scale: 2.8, normal: 0.9, contrast: 0.9,  rough: 0.8 },
  { name: 'gravel',   scale: 1.2, normal: 0.6, contrast: 0.45, rough: 0.8 },
  { name: 'asphalt',  scale: 3.5, normal: 0.6, contrast: 0.8,  rough: 0.7 },
  { name: 'concrete', scale: 3.0, normal: 0.5, contrast: 0.6,  rough: 0.75 }
];
// 地面の種類 → 層
export const CLASS_LAYER = {
  water: 'worn', lawn: 'grass', lawnWorn: 'worn', dirt: 'gravel', paved: 'asphalt', revetment: 'concrete',
  leveeGrass: 'grass', road: 'asphalt', tree: 'grass', reeds: 'worn', other: 'grass'
};

export const GROUND_BASE = new URL('../assets/ground/', import.meta.url).href;

async function loadLayerArray(urls, size, srgb) {
  const data = new Uint8Array(size * size * 4 * urls.length);
  const cv = new OffscreenCanvas(size, size), g = cv.getContext('2d', { willReadFrequently: true });
  const bitmaps = await Promise.all(urls.map(async u => createImageBitmap(await (await fetch(u)).blob(), { colorSpaceConversion: 'none' })));
  bitmaps.forEach((bmp, i) => {
    g.drawImage(bmp, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
    bmp.close();
  });
  const tex = new THREE.DataArrayTexture(data, size, size, urls.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** 画質ごとに読む素材の大きさ（px）。素材の画像は 1024 と 512 を用意してある（粗さは 512 だけ） */
export const groundTextureFiles = (baseUrl, colorSize, normalSize) => GROUND_LAYERS.flatMap(l => [
  `${baseUrl}${l.name}_color_${colorSize}.webp`, `${baseUrl}${l.name}_normal_${normalSize}.webp`, `${baseUrl}${l.name}_rough_512.webp`
]);

/**
 * @param {object} o
 * @param {Uint8Array} o.layerOfCell  近景の 1 m ごとの層の番号（w × h、行は z）
 * @param {{x0:number, z0:number, w:number, h:number}} o.grid
 * @param {number} [o.colorSize]   色の素材の大きさ（1024 か 512）
 * @param {number} [o.normalSize]  凹凸の素材の大きさ（1024 か 512）
 * @param {string} [o.baseUrl]
 */
export async function createGroundMaterial({ layerOfCell, grid, colorSize = 1024, normalSize = 1024, baseUrl = GROUND_BASE }) {
  const names = GROUND_LAYERS.map(l => l.name);
  const [color, normal, rough, meansJson] = await Promise.all([
    loadLayerArray(names.map(n => `${baseUrl}${n}_color_${colorSize}.webp`), colorSize, true),
    loadLayerArray(names.map(n => `${baseUrl}${n}_normal_${normalSize}.webp`), normalSize, false),
    loadLayerArray(names.map(n => `${baseUrl}${n}_rough_512.webp`), 512, false),
    fetch(`${baseUrl}means.json`).then(r => r.json())
  ]);
  const means = names.map(n => new THREE.Vector3(...meansJson[n]));
  const classTex = new THREE.DataTexture(layerOfCell, grid.w, grid.h, THREE.RedFormat, THREE.UnsignedByteType);
  classTex.magFilter = classTex.minFilter = THREE.NearestFilter;
  classTex.needsUpdate = true;

  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, specularIntensity: 0.25 });
  const uniforms = {
    tGColor: { value: color }, tGNormal: { value: normal }, tGRough: { value: rough }, tClass: { value: classTex },
    uGrid: { value: new THREE.Vector4(grid.x0, grid.z0, grid.w, grid.h) },
    uLayerScale: { value: GROUND_LAYERS.map(l => l.scale) },
    uLayerNormal: { value: GROUND_LAYERS.map(l => l.normal) },
    uLayerContrast: { value: GROUND_LAYERS.map(l => l.contrast) },
    uLayerRough: { value: GROUND_LAYERS.map(l => l.rough) },
    uLayerMean: { value: means }
  };
  const N = GROUND_LAYERS.length;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nvarying vec3 vGN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW;
        varying vec3 vGN;
        uniform highp sampler2DArray tGColor, tGNormal, tGRough;
        uniform sampler2D tClass;
        uniform vec4 uGrid;
        uniform float uLayerScale[${N}], uLayerNormal[${N}], uLayerContrast[${N}], uLayerRough[${N}];
        uniform vec3 uLayerMean[${N}];
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
        }
        int gLayer(ivec2 c) {
          c = clamp(c, ivec2(0), ivec2(uGrid.zw) - 1);
          return int(texelFetch(tClass, c, 0).r * 255.0 + 0.5);
        }
        vec3 gCol; vec3 gNrm; float gRgh;
        void gSample(int L, float w) {
          if (w <= 0.001) return;
          float s = uLayerScale[L];
          vec2 uvA = vGW.xz / s;
          vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vGW.xz / (s * 3.7) + 0.37;
          vec3 c = mix(texture(tGColor, vec3(uvA, float(L))).rgb, texture(tGColor, vec3(uvB, float(L))).rgb, 0.4) / uLayerMean[L];
          vec3 n = texture(tGNormal, vec3(uvA, float(L))).xyz * 2.0 - 1.0;
          c = mix(vec3(1.0), c, uLayerContrast[L]);
          n.xy *= uLayerNormal[L];
          float r = mix(uLayerRough[L], 1.0, texture(tGRough, vec3(uvA, float(L))).r);
          gCol += c * w; gNrm += n * w; gRgh += r * w;
        }
        void gEval() {
          gCol = vec3(0); gNrm = vec3(0); gRgh = 0.0;
          // 1 m の格子の 4 隅の層を、ゆらがせた重みで混ぜる（境目が格子の線にならないように）
          vec2 g = vGW.xz - uGrid.xy;
          g += (vec2(gNoise(vGW.xz * 0.6), gNoise(vGW.xz * 0.6 + 17.0)) - 0.5) * 1.1 + (vec2(gNoise(vGW.xz * 2.3 + 5.0), gNoise(vGW.xz * 2.3 + 41.0)) - 0.5) * 0.35;
          vec2 i0 = floor(g), t = smoothstep(0.15, 0.85, g - i0);
          ivec2 c = ivec2(i0);
          int a = gLayer(c), b = gLayer(c + ivec2(1, 0)), d = gLayer(c + ivec2(0, 1)), e = gLayer(c + ivec2(1, 1));
          float wa = (1.0 - t.x) * (1.0 - t.y), wb = t.x * (1.0 - t.y), wd = (1.0 - t.x) * t.y, we = t.x * t.y;
          if (a == b && a == d && a == e) { gSample(a, 1.0); return; }
          // 同じ層の重みはまとめる
          if (b == a) { wa += wb; wb = 0.0; }
          if (d == a) { wa += wd; wd = 0.0; } else if (d == b) { wb += wd; wd = 0.0; }
          if (e == a) { wa += we; we = 0.0; } else if (e == b) { wb += we; we = 0.0; } else if (e == d) { wd += we; we = 0.0; }
          gSample(a, wa); gSample(b, wb); gSample(d, wd); gSample(e, we);
        }`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ngEval();\ndiffuseColor.rgb *= gCol;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRgh;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 Nw = normalize(vGN);
          vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
          vec3 Bw = cross(Nw, Tw); // 画像の上（法線の緑）＝ -z
          vec3 tn = normalize(gNrm);
          float fade = 1.0 - smoothstep(25.0, 90.0, length(vGW - cameraPosition));
          tn.xy *= fade;
          normal = normalize(mat3(viewMatrix) * normalize(Tw * tn.x + Bw * tn.y + Nw * tn.z));
        }`);
  };
  mat.customProgramCacheKey = () => 'real-ground-v2';
  return mat;
}
