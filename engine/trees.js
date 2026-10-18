// 木と木漏れ日（picnic.html の作り方を共通の部品にしたもの）
//   近くの木：葉の塊を組み合わせ、影を描くパスで葉を間引いて影にすき間をあける（地面に光の粒が落ちる）。風で揺れる
//   遠くの木：同じ作りを 1 つのメッシュにまとめて描く（数百本でも軽い）。影のすき間は同じ
//   すき間は「光の向きから見た平面」の上で決めるので、葉の塊の表と裏で同じ場所が抜ける。ループ周期で少しずつずれる
import * as THREE from 'three';
import { mulberry32 } from './pixel-kit.js';

export function createLeafKit({ loop = 6 } = {}) {
  const W0 = Math.PI * 2 / loop;
  const LEAF = { time: { value: 0 }, light: { value: new THREE.Vector3(0, 1, 0) } };
  const GAP = `
    uniform float uLeafTime; uniform vec3 uLeafLight; varying vec3 vLeafW;
    float leafHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    bool leafGap(vec3 w) {
      vec3 L = normalize(uLeafLight);
      vec3 T = normalize(cross(L, vec3(0.0, 0.0, 1.0)));
      vec2 p = vec2(dot(w, T), dot(w, cross(L, T)));
      float t = uLeafTime * ${W0.toFixed(6)};
      p += vec2(sin(t + p.y * 0.9), cos(t + p.x * 0.8)) * 0.05;
      return leafHash(floor(p / 0.26)) < 0.36 || leafHash(floor(p / 0.85 + 0.37) + 17.0) < 0.18;
    }
`;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = sh => {
    sh.uniforms.uLeafTime = LEAF.time;
    sh.uniforms.uLeafLight = LEAF.light;
    sh.vertexShader = 'varying vec3 vLeafW;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = GAP + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (leafGap(vLeafW)) discard;');
  };
  // 葉の見た目：房ごとの明暗のまだら（メッシュ自身の座標で決めるので、揺れても模様がずれない）
  function leafify(mat) {
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'varying vec3 vLeafL;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vLeafL = transformed * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));');
      sh.fragmentShader = 'varying vec3 vLeafL;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n = fract(sin(dot(floor(vLeafL * 5.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb *= n < 0.22 ? 0.8 : (n > 0.86 ? 1.18 : 1.0);
        }`);
    };
    mat.customProgramCacheKey = () => 'leaf';
    return mat;
  }
  return {
    depthMat, leafify, uniforms: LEAF,
    // 毎フレーム：時間と光の向き（影を落とす光の位置）
    update(t, light) { LEAF.time.value = t; LEAF.light.value.copy(light.position).sub(light.target.position).normalize(); }
  };
}

/**
 * 木々。trees は空中写真から拾った木の位置と樹冠の半径。
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(p:object) => THREE.Material} o.toon
 * @param {{x:number, z:number, r:number}[]} o.trees
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {{x:number, z:number, radius:number}} o.detail   この円の中の木は 1 本ずつ作って揺らす（木漏れ日の主役）
 * @param {ReturnType<typeof createLeafKit>} o.kit
 * @param {string[][]} [o.palettes]   葉の色の組 [濃い, 明るい]
 */
export function createForest({ scene, toon, trees, heightAt, detail, kit, seed = 5, palettes = [['#3f6a2e', '#5f8a3c'], ['#4a7232', '#6f9442'], ['#36602c', '#557f38'], ['#56743a', '#7f9a4a']], loop = 6 }) {
  const rnd = mulberry32(seed);
  const W0 = Math.PI * 2 / loop;
  const trunkMat = toon({ color: '#5b4632' });
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const farLeafGeo = new THREE.IcosahedronGeometry(1, 0); // 遠くは面を少なく
  const mats = palettes.map(([d, l]) => [kit.leafify(toon({ color: d, flatShading: true })), kit.leafify(toon({ color: l, flatShading: true }))]);
  const sway = [], colliders = [];
  // 樹冠の半径 r から、葉の塊の配置（幹の先端の真上に重心）
  function clustersFor(r, h) {
    const n = 4 + Math.min(4, Math.round(r));
    const list = [[0, h + r * 0.35, 0, r * 0.62]];
    for (let i = 1; i < n; i++) {
      const a = i / (n - 1) * Math.PI * 2 + rnd() * 0.6;
      const d = r * (0.42 + rnd() * 0.18);
      list.push([Math.cos(a) * d, h + r * (0.05 + rnd() * 0.45), Math.sin(a) * d, r * (0.42 + rnd() * 0.14)]);
    }
    let w = 0, mx = 0, mz = 0;
    for (const [x, , z, rr] of list) { const k = rr ** 3; w += k; mx += x * k; mz += z * k; }
    return list.map(([x, y, z, rr]) => [x - mx / w, y, z - mz / w, rr]);
  }
  const far = { geo: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const farParts = mats.map(() => ({ dark: [], light: [] })), trunkParts = [];
  let nNear = 0;
  for (const t of trees) {
    const r = Math.max(1.6, t.r);
    const h = 1.6 + r * 0.9;              // 幹の高さ（樹冠の下まで）
    const trunkR = 0.12 + r * 0.05;
    const y0 = heightAt(t.x, t.z) - 0.1;
    const pal = (rnd() * mats.length) | 0;
    const cl = clustersFor(r, h);
    const isNear = Math.hypot(t.x - detail.x, t.z - detail.z) < detail.radius;
    colliders.push([t.x, t.z, trunkR + 0.15]);
    if (isNear) {
      nNear++;
      const g = new THREE.Group();
      g.position.set(t.x, y0, t.z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.7, trunkR, h + r * 0.3, 6).translate(0, (h + r * 0.3) / 2, 0), trunkMat);
      trunk.castShadow = trunk.receiveShadow = true;
      g.add(trunk);
      const foliage = new THREE.Group();
      for (const [cx, cy, cz, cr] of cl) {
        const m = new THREE.Mesh(leafGeo, cy > h + r * 0.4 ? mats[pal][1] : mats[pal][0]);
        m.position.set(cx, cy, cz);
        m.scale.set(cr, cr * 0.82, cr);
        m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        m.castShadow = m.receiveShadow = true;
        m.customDepthMaterial = kit.depthMat;
        foliage.add(m);
        // 塊へ伸びる枝
        if (Math.hypot(cx, cz) > cr * 0.6) {
          const from = new THREE.Vector3(0, h, 0), to = new THREE.Vector3(cx * 0.6, cy - cr * 0.3, cz * 0.6);
          const dir = to.clone().sub(from);
          const b = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.35, trunkR * 0.5, dir.length(), 5), trunkMat);
          b.position.copy(from).addScaledVector(dir, 0.5);
          b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          b.castShadow = true;
          g.add(b);
        }
      }
      g.add(foliage);
      sway.push({ obj: foliage, amp: 0.008 + 0.006 / r, phase: rnd() * 6 });
      scene.add(g);
    } else {
      // 遠くの木：まとめ描き用に、変換済みの形をためる
      for (const [cx, cy, cz, cr] of cl) {
        const geo = farLeafGeo.clone();
        m4.compose(p.set(t.x + cx, y0 + cy, t.z + cz), q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3)), sc.set(cr, cr * 0.82, cr));
        geo.applyMatrix4(m4);
        farParts[pal][cy > h + r * 0.4 ? 'light' : 'dark'].push(geo);
      }
      const tg = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, h + r * 0.2, 5).translate(t.x, y0 + (h + r * 0.2) / 2, t.z);
      trunkParts.push(tg);
    }
  }
  const merge = list => {
    let nv = 0, ni = 0;
    const count = g => (g.index ? g.index.count : g.attributes.position.count);
    for (const g of list) { nv += g.attributes.position.count; ni += count(g); }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
      const n = count(g);
      for (let k = 0; k < n; k++) idx[oi + k] = (g.index ? g.index.array[k] : k) + ov;
      ov += g.attributes.position.count; oi += n; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  };
  const farMeshes = [];
  farParts.forEach((parts, i) => {
    for (const key of ['dark', 'light']) {
      if (!parts[key].length) continue;
      const m = new THREE.Mesh(merge(parts[key]), mats[i][key === 'dark' ? 0 : 1]);
      m.castShadow = m.receiveShadow = true;
      m.customDepthMaterial = kit.depthMat;
      scene.add(m);
      farMeshes.push(m);
    }
  });
  if (trunkParts.length) {
    const m = new THREE.Mesh(merge(trunkParts), trunkMat);
    m.castShadow = true;
    scene.add(m);
    farMeshes.push(m);
  }
  return {
    colliders, nearCount: nNear, farCount: trees.length - nNear, farMeshes,
    // 毎フレーム：近くの木を風で揺らす（ループ周期）
    update(t) {
      const a = t * W0;
      for (const s of sway) {
        s.obj.rotation.x = Math.sin(a + s.phase) * s.amp;
        s.obj.rotation.z = Math.cos(a + s.phase) * s.amp;
      }
    }
  };
}
