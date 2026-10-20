// 写実版の草：草の葉を 1 本ずつ大量に描く（タイルごとのインスタンス）。人からの距離で何段かに分け、
//   足もとはとても密に、離れるほど粗く太く、いちばん外の先は地面の素材だけ。段の境目は本数を少しずつ入れ替える
//   葉の高さ・密度は地面の種類から（芝生は短く、堤防の草は長め、ヨシは高く）。色は地面の色の平均（terrain.cellColor）にそろえる
//   根もとの高さは地形の高さのテクスチャから読む。風で揺れる。影は受けるが落とさない（重いので）
import * as THREE from 'three';

// 地面の種類ごとの草：高さ（m）・密度（0〜1）・葉の幅の倍率
export const GRASS_KINDS = {
  lawn:       { h: 0.10, d: 1.0,  w: 1.0 },
  tree:       { h: 0.09, d: 0.8,  w: 1.0 },
  leveeGrass: { h: 0.26, d: 1.0,  w: 1.1 },
  other:      { h: 0.18, d: 0.8,  w: 1.0 },
  lawnWorn:   { h: 0.05, d: 0.35, w: 0.9 },
  reeds:      { h: 1.30, d: 0.55, w: 1.8 }
};
const MAX_H = 1.5; // マスクの高さの上限（m）

// 1 本の葉：3 段の帯＋先（7 頂点・5 三角形）。position.x = 幅の位置（-0.5〜0.5）、position.y = 根もとから先（0〜1）
function tileGeometry(tile, perM2, rnd) {
  const n = Math.round(tile * tile * perM2);
  const pos = new Float32Array(n * 7 * 3), blade = new Float32Array(n * 7 * 4), rand = new Float32Array(n * 7 * 2);
  const idx = new Uint32Array(n * 15);
  const T = [0, 0.33, 0.66];
  for (let b = 0; b < n; b++) {
    const x = rnd() * tile, z = rnd() * tile, yaw = rnd() * Math.PI * 2, r0 = rnd(), r1 = rnd(), keep = rnd();
    for (let v = 0; v < 7; v++) {
      const k = b * 7 + v;
      const t = v < 6 ? T[v >> 1] : 1, side = v < 6 ? ((v & 1) ? 0.5 : -0.5) : 0;
      pos.set([side, t, 0], k * 3);
      blade.set([x, z, yaw, keep], k * 4);
      rand.set([r0, r1], k * 2);
    }
    const o = b * 7;
    idx.set([o, o + 1, o + 2, o + 2, o + 1, o + 3, o + 2, o + 3, o + 4, o + 4, o + 3, o + 5, o + 4, o + 5, o + 6], b * 15);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.BufferAttribute(blade, 4));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile / 2, 0, tile / 2), 1e5);
  return g;
}

function halfTexture(w, h, channels, fill) {
  const data = new Uint16Array(w * h * 4);
  const v = [0, 0, 0, 1];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    fill(i, j, v);
    for (let c = 0; c < 4; c++) data[(j * w + i) * 4 + c] = THREE.DataUtils.toHalfFloat(c < channels ? v[c] : 1);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.terrain     real/js/terrain.js の戻り値
 * @param {{rings: {tile:number, perM2:number, to:number, width:number}[]}} o.quality
 *        段ごとのタイルの大きさ（m）・1 m² あたりの本数・外側の半径（m）・葉の幅の倍率（内側から順に）
 */
export function createRealGrass({ scene, terrain, quality, rnd = Math.random }) {
  const G = terrain.grid, NB = terrain.bounds.near;
  // ---- 草のマスク（1 m ごと）：R = 高さ / MAX_H、G = 密度、B = 幅の倍率 / 2
  const mask = halfTexture(G.w, G.h, 3, (i, j, v) => {
    const k = GRASS_KINDS[terrain.groundAt(G.x0 + i, G.z0 + j)];
    v[0] = k ? k.h / MAX_H : 0; v[1] = k ? k.d : 0; v[2] = k ? k.w / 2 : 0.5;
  });
  // ---- 地面の色（1 m ごと、線形）
  const color = halfTexture(G.w, G.h, 3, (i, j, v) => {
    const k = (j * G.w + i) * 3;
    v[0] = terrain.cellColor[k]; v[1] = terrain.cellColor[k + 1]; v[2] = terrain.cellColor[k + 2];
  });
  // ---- 根もとの高さ（50 cm ごと）
  const hs = 0.5, hw = Math.round((NB.x1 - NB.x0) / hs) + 1, hh = Math.round((NB.z1 - NB.z0) / hs) + 1;
  const height = halfTexture(hw, hh, 1, (i, j, v) => { v[0] = terrain.heightAt(NB.x0 + i * hs, NB.z0 + j * hs); });

  const uniforms = {
    tMask: { value: mask }, tColor: { value: color }, tHeight: { value: height },
    uGrid: { value: new THREE.Vector4(G.x0, G.z0, G.w, G.h) },
    uHBox: { value: new THREE.Vector4(NB.x0, NB.z0, NB.x1, NB.z1) },
    uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(0.3, 0.9).normalize() },
    uHide: { value: new THREE.Vector4(0, 0, 0, 0) }, // シートの下（中心 x, z・半幅 w, d）
    uHideYaw: { value: 0 }                            // シートの向き（engine/basecamp.js の yaw）
  };

  // lod：内側の境目 a〜b で増え、外側の境目 c〜d で減る
  function makeMaterial(layer, widthScale, lod) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aBlade;
          attribute vec2 aRand;
          uniform sampler2D tMask, tColor, tHeight;
          uniform vec4 uGrid, uHBox, uHide;
          uniform float uTime, uWind, uHideYaw;
          uniform vec2 uWindDir;
          varying vec3 vGrassCol;
          varying float vGrassT;
          varying float vGrassR;
          vec3 grassP;`)
        .replace('#include <beginnormal_vertex>', `
          vec3 inst = instanceMatrix[3].xyz;
          vec2 bxz = inst.xz + aBlade.xy;
          vec2 cuv = (bxz - uGrid.xy + 0.5) / uGrid.zw;
          vec4 m = texture2D(tMask, cuv);
          float dist = length(bxz - cameraPosition.xz);
          // 密な所と粗い所の受け渡し、遠くで消す
          float lod = ${layer === 0 ? '1.0' : `smoothstep(${lod[0].toFixed(1)}, ${lod[1].toFixed(1)}, dist)`} * (1.0 - smoothstep(${lod[2].toFixed(1)}, ${lod[3].toFixed(1)}, dist));
          vec2 hq = bxz - uHide.xy;
          vec2 hd = abs(vec2(hq.x * cos(uHideYaw) - hq.y * sin(uHideYaw), hq.x * sin(uHideYaw) + hq.y * cos(uHideYaw)));
          float hidden = (hd.x < uHide.z && hd.y < uHide.w) ? 0.0 : 1.0;
          float keep = step(aBlade.w, m.g * lod) * hidden;
          float h = m.r * ${MAX_H.toFixed(2)} * (0.55 + 0.9 * aRand.x) * keep;
          vec2 huv = (bxz - uHBox.xy) / (uHBox.zw - uHBox.xy);
          float y0 = texture2D(tHeight, huv).r;
          float yaw = aBlade.z;
          vec2 dir = vec2(cos(yaw), sin(yaw)), side = vec2(-dir.y, dir.x);
          float t = position.y;
          // 風：大きなうねり＋細かい揺れ
          float gust = 0.5 + 0.5 * sin(uTime * 0.9 + dot(bxz, uWindDir) * 0.15);
          float wv = (sin(uTime * 2.3 + bxz.x * 0.9 + bxz.y * 0.6 + aRand.y * 6.0) * 0.35 + gust * 0.65) * uWind;
          vec2 lean = dir * (0.25 + 0.6 * aRand.y * aRand.y) + uWindDir * wv * 0.5;
          float wdt = 0.009 * ${widthScale.toFixed(2)} * m.b * 2.0 * (0.7 + 0.6 * aRand.y) * (1.0 - t * 0.8) * step(0.001, h);
          grassP = vec3(aBlade.x, y0, aBlade.y);
          grassP.xz += side * position.x * wdt + lean * h * t * t * 0.7;
          grassP.y += h * t * (1.0 - 0.18 * t * dot(lean, lean));
          vec3 objectNormal = normalize(vec3(dir.x, 0.0, dir.y) * 0.35 + vec3(side.x, 0.0, side.y) * position.x * 0.9 + vec3(0.0, 1.0, 0.0));
          vGrassCol = texture2D(tColor, cuv).rgb;
          vGrassT = t;
          vGrassR = aRand.x;
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(1.0, 0.0, 0.0);
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = grassP;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;\nvarying float vGrassT;\nvarying float vGrassR;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // 根もとは暗く、先は明るく黄みに。1 本ごとのむら
          diffuseColor.rgb *= vGrassCol * mix(0.45, 1.25, vGrassT) * (0.8 + 0.4 * vGrassR);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.08, 0.8), vGrassT * vGrassR * 0.6);`)
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
          vec3 normal = normalize(vNormal); // 裏も表と同じ向き（葉の裏が暗くならないように）
          vec3 nonPerturbedNormal = normal;`);
    };
    m.customProgramCacheKey = () => 'real-grass-' + layer;
    return m;
  }

  // ---- 段ごとのタイル。境目は 30 %（最小 3 m）の幅で入れ替える
  const layers = quality.rings.map((R, li, all) => {
    const from = li === 0 ? 0 : all[li - 1].to;
    const band = r => Math.max(3, r * 0.3);
    const lod = [from - band(from), from, R.to - (li === all.length - 1 ? band(R.to) : 0), R.to + (li === all.length - 1 ? 0 : band(R.to))];
    const geo = tileGeometry(R.tile, R.perM2, rnd);
    const maxTiles = Math.ceil((2 * lod[3] / R.tile + 2) ** 2);
    const mesh = new THREE.InstancedMesh(geo, makeMaterial(li, R.width, lod), maxTiles);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.count = 0;
    mesh.name = 'grass-' + li;
    mesh.layers.set(1); // 水面の反射（レイヤー 0 だけを描く）には草を描かない。カメラはレイヤー 1 も描く
    scene.add(mesh);
    return { tile: R.tile, perM2: R.perM2, from: lod[0], to: lod[3], mesh };
  });

  const m4 = new THREE.Matrix4(), frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), box = new THREE.Box3();
  let lastKey = '';
  function update(t, camera) {
    uniforms.uTime.value = t;
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const cx = camera.position.x, cz = camera.position.z;
    for (const L of layers) {
      const s = L.tile;
      const i0 = Math.floor((cx - L.to) / s), i1 = Math.floor((cx + L.to) / s), j0 = Math.floor((cz - L.to) / s), j1 = Math.floor((cz + L.to) / s);
      let n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * s, z = j * s;
        if (x + s < NB.x0 || z + s < NB.z0 || x > NB.x1 || z > NB.z1) continue; // 草は近景の中だけ
        // タイルの中で人にいちばん近い点までの距離
        const dx = Math.max(x - cx, 0, cx - (x + s)), dz = Math.max(z - cz, 0, cz - (z + s));
        const dmin = Math.hypot(dx, dz);
        if (dmin > L.to) continue;
        const dmax = Math.hypot(Math.max(Math.abs(x - cx), Math.abs(x + s - cx)), Math.max(Math.abs(z - cz), Math.abs(z + s - cz)));
        if (dmax < L.from) continue;
        const y = terrain.heightAt(x + s / 2, z + s / 2);
        box.min.set(x, y - 3, z); box.max.set(x + s, y + 3, z + s);
        if (!frustum.intersectsBox(box)) continue;
        m4.makeTranslation(x, 0, z);
        L.mesh.setMatrixAt(n++, m4);
      }
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    layers: layers.map(l => l.mesh), uniforms, update,
    /** シートの下の草を消す（中心・半幅・向き） */
    hideRect(x, z, hw, hd, yaw = 0) { uniforms.uHide.value.set(x, z, hw, hd); uniforms.uHideYaw.value = yaw; },
    get blades() { return layers.reduce((a, L) => a + L.mesh.count * L.tile * L.tile * L.perM2, 0); }
  };
}
