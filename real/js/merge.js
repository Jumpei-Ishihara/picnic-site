// 動かない物をまとめて描く：同じ素材・同じ影の設定・同じレイヤーの形を、1 km 四方の区画ごとに 1 つの形にまとめる
//   描画命令（ドローコール）を減らす。区画に分けるのは、画面の外の区画を描かない仕組み（視錐台カリング）を残すため。
//   200 m では見えている区画の数だけ描画命令が増え（なぎさ公園で 108 回）、1 km で 71 回になった
//   まとめないもの：インスタンス（家並み・木・草）、線と点（送電線）、動く物（exclude に渡す組の中）、userData.noMerge の付いた物
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 素材の中身が同じなら同じ素材として扱う（部品は色ごとに別の素材を作るので、uuid では分けすぎる）。
// シェーダーを書き換える素材（縞の鉄塔・茂みのむら）はその素材だけで
// テクスチャを使わない素材は、色を頂点の色に焼き込んで、色が違っても 1 つの素材にまとめる（bakeColor）
const hex = c => c ? c.getHexString() : '';
const custom = m => m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
const hasMaps = m => !!(m.map || m.normalMap || m.roughnessMap || m.aoMap || m.emissiveMap || m.alphaMap);
const bakeable = m => m.isMeshStandardMaterial && !custom(m) && !hasMaps(m) && !m.transparent;
function materialKey(m) {
  if (custom(m)) return m.uuid;
  return [m.type, bakeable(m) ? 'bake' : hex(m.color), hex(m.emissive), m.emissiveIntensity, m.map?.uuid, m.normalMap?.uuid, m.roughnessMap?.uuid, m.aoMap?.uuid, m.emissiveMap?.uuid,
    m.roughness, m.metalness, m.transparent, m.opacity, m.side, bakeable(m) || m.vertexColors, m.alphaTest, m.polygonOffset, m.polygonOffsetFactor, m.depthWrite].join('|');
}

// 形を位置・法線・UV（・頂点色）だけの、番号なしの形にそろえる
function normalize(geo, withColor) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (withColor && !g.attributes.color) {
    const c = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (!withColor && g.attributes.color) g.deleteAttribute('color');
  g.clearGroups();
  return g;
}

// 素材が 2 つ以上ある形（押し出した建物の屋根と壁など）を、素材ごとの形に分ける
function splitByGroups(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.groups.length) return [[g, 0]];
  return g.groups.map(gr => {
    const part = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) {
      part.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    return [part, gr.materialIndex];
  });
}

/**
 * @param {THREE.Scene} scene
 * @param {object} o
 * @param {THREE.Object3D[]} o.roots     まとめる候補の組（この中を調べる）
 * @param {THREE.Object3D[]} [o.exclude] まとめない組（動く物）
 * @param {number} [o.cell]              区画の大きさ（m）
 * @returns {{ before:number, after:number }}  まとめる前と後のメッシュの数
 */
export function mergeStatic(scene, { roots, exclude = [], cell = 1000 }) {
  const skip = new Set();
  for (const e of exclude) e?.traverse(o => skip.add(o));
  const buckets = new Map();
  const meshes = [];
  scene.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  for (const root of roots) {
    root?.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || skip.has(o) || o.userData.noMerge || !o.visible) return;
      if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return; // 描く前に何かする物（映り込みなど）
      let p = o.parent, hidden = false;
      while (p) { if (!p.visible) hidden = true; p = p.parent; }
      if (hidden) return;
      meshes.push(o);
    });
  }
  for (const o of meshes) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!o.geometry.attributes.position) continue;
    o.geometry.computeBoundingSphere();
    center.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const cx = Math.floor(center.x / cell), cz = Math.floor(center.z / cell);
    for (const [part, mi] of splitByGroups(o.geometry)) {
      const mat = mats[mi] ?? mats[0];
      const key = `${materialKey(mat)}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}|${cx},${cz}`;
      const bake = bakeable(mat);
      if (!buckets.has(key)) {
        // 色を焼き込む素材は、白で頂点の色を使う複製を代表に
        const rep = bake ? Object.assign(mat.clone(), { vertexColors: true }) : mat;
        if (bake) rep.color.set(0xffffff);
        buckets.set(key, { mat: rep, cast: o.castShadow, receive: o.receiveShadow, layers: o.layers.mask, geos: [] });
      }
      const g = normalize(part, bake || !!mat.vertexColors);
      if (bake) {
        // 素材の色（線形）を頂点の色に掛ける（もとから頂点の色を使う素材なら、その色に掛ける）
        const c = g.attributes.color.array, useVc = !!mat.vertexColors;
        for (let i = 0; i < c.length; i += 3) {
          c[i] = (useVc ? c[i] : 1) * mat.color.r; c[i + 1] = (useVc ? c[i + 1] : 1) * mat.color.g; c[i + 2] = (useVc ? c[i + 2] : 1) * mat.color.b;
        }
      }
      g.applyMatrix4(o.matrixWorld);
      buckets.get(key).geos.push(g);
    }
  }
  // 元のメッシュを外して、まとめたメッシュを置く
  for (const o of meshes) o.parent?.remove(o);
  const group = new THREE.Group();
  group.name = 'merged-static';
  let after = 0;
  for (const b of buckets.values()) {
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, b.mat);
    m.castShadow = b.cast; m.receiveShadow = b.receive; m.layers.mask = b.layers;
    group.add(m);
    after++;
  }
  scene.add(group);
  return { before: meshes.length, after };
}
