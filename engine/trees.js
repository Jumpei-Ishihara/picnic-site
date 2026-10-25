// 木と木漏れ日（picnic.html の作り方を共通の部品にしたもの）
//   近くの木：葉の塊を組み合わせ、影を描くパスで葉を間引いて影にすき間をあける（地面に光の粒が落ちる）。風で揺れる
//   遠くの木：同じ作りを 1 つのメッシュにまとめて描く（数百本でも軽い）。影のすき間は同じ
//   すき間は「光の向きから見た平面」の上で決めるので、葉の塊の表と裏で同じ場所が抜ける。ループ周期で少しずつずれる
import * as THREE from 'three';
import { mulberry32 } from './pixel-kit.js';

export function createLeafKit({ loop = 6, softDapple = false } = {}) {
  if (!Number.isFinite(loop) || loop <= 0) throw new RangeError('Leaf loop must be positive');
  const W0 = Math.PI * 2 / loop;
  const LEAF = { time: { value: 0 }, light: { value: new THREE.Vector3(0, 1, 0) }, soft: { value: softDapple ? 1 : 0 } };
  // A shared, tiny repeatable noise tile replaces eight sine hashes per shadow fragment.
  let noiseTex = null;
  if (softDapple) {
    const random = mulberry32(731), pixels = new Uint8Array(32 * 32);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(random() * 256);
    noiseTex = new THREE.DataTexture(pixels, 32, 32, THREE.RedFormat);
    noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
    noiseTex.generateMipmaps = false; noiseTex.needsUpdate = true;
  }
  const GAP = `
    uniform sampler2D uLeafNoise; uniform float uLeafTime, uLeafSoft; uniform vec3 uLeafLight; varying vec3 vLeafW;
    float leafHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    bool leafGap(vec3 w) {
      vec3 L = normalize(uLeafLight);
      vec3 T = normalize(cross(L, abs(L.z) > 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0)));
      vec2 p = vec2(dot(w, T), dot(w, cross(L, T)));
      float t = uLeafTime * ${W0.toFixed(6)};
      p += vec2(sin(t + p.y * 0.9), cos(t + p.x * 0.8)) * 0.05;
      if (uLeafSoft > 0.5) {
        // Smooth clustered openings: stable under small wind/camera movement.
        return texture2D(uLeafNoise, p / (0.62 * 32.0)).r * 0.72 + texture2D(uLeafNoise, p / (0.24 * 32.0) + 0.37).r * 0.28 > 0.56;
      }
      return leafHash(floor(p / 0.26)) < 0.36 || leafHash(floor(p / 0.85 + 0.37) + 17.0) < 0.18;
    }
`;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = sh => {
    sh.uniforms.uLeafTime = LEAF.time;
    sh.uniforms.uLeafSoft = LEAF.soft;
    sh.uniforms.uLeafNoise = { value: noiseTex };
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
    dispose() { depthMat.dispose(); noiseTex?.dispose(); },
    // 毎フレーム：時間と光の向き（影を落とす光の位置）
    update(t, light) {
      LEAF.time.value = ((t % loop) + loop) % loop;
      LEAF.light.value.copy(light.position).sub(light.target.position);
      if (LEAF.light.value.lengthSq() < 1e-10) LEAF.light.value.set(0, 1, 0);
      else LEAF.light.value.normalize();
    }
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
// foliage(t)：季節の葉の色 [暗, 明]。undefined はもとの色（palettes）、null は葉を落とした木（枝だけ）
export function createForest({ scene, toon, trees, heightAt, detail, kit, seed = 5, palettes = [['#3f6a2e', '#5f8a3c'], ['#4a7232', '#6f9442'], ['#36602c', '#557f38'], ['#56743a', '#7f9a4a']], loop = 6, foliage = null, crown = 'round' }) {
  const rnd = mulberry32(seed);
  const W0 = Math.PI * 2 / loop;
  const trunkMat = toon({ color: '#5b4632' });
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const farLeafGeo = new THREE.IcosahedronGeometry(1, 0); // 遠くは面を少なく
  const mats = palettes.map(([d, l]) => [kit.leafify(toon({ color: d, flatShading: true })), kit.leafify(toon({ color: l, flatShading: true }))]);
  // 季節の色の材質（色の組ごとに 1 つ）
  const matIndex = new Map();
  const matFor = pair => {
    const key = pair.join();
    if (!matIndex.has(key)) { mats.push([kit.leafify(toon({ color: pair[0], flatShading: true })), kit.leafify(toon({ color: pair[1], flatShading: true }))]); matIndex.set(key, mats.length - 1); }
    return matIndex.get(key);
  };
  const sway = [], colliders = [];
  // 樹冠の半径 r から、葉の塊の配置（幹の先端の真上に重心）
  // crown：'round' は丸い樹冠、'spread' は低い所から枝を広げる傘形（ケヤキ・桜。なぎさ公園の写真）
  const spread = crown === 'spread';
  function clustersFor(r, h) {
    const n = 4 + Math.min(4, Math.round(r)) + (spread ? 2 : 0);
    const list = [[0, h + r * (spread ? 0.45 : 0.35), 0, r * (spread ? 0.55 : 0.62)]];
    for (let i = 1; i < n; i++) {
      const a = i / (n - 1) * Math.PI * 2 + rnd() * 0.6;
      const d = r * (spread ? 0.62 + rnd() * 0.22 : 0.42 + rnd() * 0.18);
      list.push([Math.cos(a) * d, h + r * (spread ? 0.1 + rnd() * 0.3 : 0.05 + rnd() * 0.45), Math.sin(a) * d, r * (spread ? 0.4 + rnd() * 0.12 : 0.42 + rnd() * 0.14)]);
    }
    let w = 0, mx = 0, mz = 0;
    for (const [x, , z, rr] of list) { const k = rr ** 3; w += k; mx += x * k; mz += z * k; }
    return list.map(([x, y, z, rr]) => [x - mx / w, y, z - mz / w, rr]);
  }
  const far = { geo: [] };
  // 形の頂点を行列で動かした配列（BufferGeometry.applyMatrix4 と同じ計算。形の複製は作らない）
  const tv = new THREE.Vector3(), nm = new THREE.Matrix3();
  function transformed(geo, m) {
    const P = geo.attributes.position.array, Nn = geo.attributes.normal.array;
    const pos = new Float32Array(P.length), nor = new Float32Array(Nn.length);
    nm.getNormalMatrix(m);
    for (let i = 0; i < P.length; i += 3) {
      tv.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m); pos[i] = tv.x; pos[i + 1] = tv.y; pos[i + 2] = tv.z;
      tv.set(Nn[i], Nn[i + 1], Nn[i + 2]).applyMatrix3(nm).normalize(); nor[i] = tv.x; nor[i + 1] = tv.y; nor[i + 2] = tv.z;
    }
    return { pos, nor };
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  // 遠くの木は色ごとに 1 つにまとめる（マスに分けて画面外を省く方法も試したが、描く回数が増えて速くならなかった）
  const farParts = new Map(), trunkParts = new Map();
  const tile = () => 'all';
  const bucket = (map, key) => { let l = map.get(key); if (!l) map.set(key, l = []); return l; };
  let nNear = 0;
  for (const t of trees) {
    const r = Math.max(1.6, t.r);
    const h = spread ? 1.4 + r * 0.45 : 1.6 + r * 0.9;   // 幹の高さ（樹冠の下まで）
    const trunkR = 0.12 + r * 0.05;
    const y0 = heightAt(t.x, t.z) - 0.1;
    let pal = (rnd() * palettes.length) | 0;
    const cl = clustersFor(r, h);
    const fc = foliage ? foliage(t) : undefined;
    const bare = fc === null;
    if (fc) pal = matFor(fc);
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
        if (bare) {
          // 葉を落とした木：塊の中心へ伸びる細い枝だけ
          const from = new THREE.Vector3(0, h * 0.85, 0), to = new THREE.Vector3(cx, cy, cz);
          const dir = to.clone().sub(from);
          const b = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.18, trunkR * 0.4, dir.length(), 4), trunkMat);
          b.position.copy(from).addScaledVector(dir, 0.5);
          b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          b.castShadow = true;
          g.add(b);
          continue;
        }
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
      // 遠くの木：まとめ描き用に、変換済みの頂点をためる（形の複製は作らず、まとめ先の配列に直接書く）
      for (const [cx, cy, cz, cr] of cl) {
        if (bare) {
          // 遠くの葉の無い木：幹の先から塊の中心へ細い枝
          const dx = cx, dy = cy - h * 0.85, dz = cz, len = Math.hypot(dx, dy, dz);
          const bg = new THREE.CylinderGeometry(trunkR * 0.2, trunkR * 0.45, len, 4);
          m4.compose(p.set(t.x + dx / 2, y0 + h * 0.85 + dy / 2, t.z + dz / 2), q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()), sc.set(1, 1, 1));
          bg.applyMatrix4(m4);
          bucket(trunkParts, tile(t.x, t.z)).push(bg);
          continue;
        }
        m4.compose(p.set(t.x + cx, y0 + cy, t.z + cz), q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3)), sc.set(cr, cr * 0.82, cr));
        bucket(farParts, `${pal}|${cy > h + r * 0.4 ? 1 : 0}|${tile(t.x, t.z)}`).push(transformed(farLeafGeo, m4));
      }
      const tg = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, h + r * 0.2, 5).translate(t.x, y0 + (h + r * 0.2) / 2, t.z);
      bucket(trunkParts, tile(t.x, t.z)).push(tg);
    }
  }
  const merge = list => {
    let nv = 0, ni = 0;
    // list の要素は BufferGeometry か、頂点の配列だけ { pos, nor }（番号なし）
    const verts = g => (g.isBufferGeometry ? g.attributes.position.count : g.pos.length / 3);
    const count = g => (g.isBufferGeometry && g.index ? g.index.count : verts(g));
    for (const g of list) { nv += verts(g); ni += count(g); }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      pos.set(g.isBufferGeometry ? g.attributes.position.array : g.pos, ov * 3); nor.set(g.isBufferGeometry ? g.attributes.normal.array : g.nor, ov * 3);
      const n = count(g), ix = g.isBufferGeometry && g.index ? g.index.array : null;
      for (let k = 0; k < n; k++) idx[oi + k] = (ix ? ix[k] : k) + ov;
      ov += verts(g); oi += n; if (g.isBufferGeometry) g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  };
  const farMeshes = [];
  for (const [key, parts] of farParts) {
    const [pal, light] = key.split('|').map(Number);
    const m = new THREE.Mesh(merge(parts), mats[pal][light]);
    m.castShadow = m.receiveShadow = true;
    m.customDepthMaterial = kit.depthMat;
    scene.add(m);
    farMeshes.push(m);
  }
  for (const parts of trunkParts.values()) {
    const m = new THREE.Mesh(merge(parts), trunkMat);
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
