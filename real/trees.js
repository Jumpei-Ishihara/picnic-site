// 写実版の木：ez-tree（MIT、https://github.com/dgreenheck/ez-tree）で樹種ごとに数本の形を作り、実際の位置にインスタンスで並べる
//   樹種は engine/season.js の treeKind（桜・落葉樹・常緑樹）。秋の桜は葉を赤茶・橙に塗り替える（foliageColors）
//   ez-tree の素材（Phong）は環境光を受けないので、同じテクスチャで PBR の素材に作り直す。葉は風で揺れ、葉のすき間を通った光が木漏れ日の影になる
//   葉は影を受けず、樹冠の内側ほど暗くする陰で代える
import * as THREE from 'three';
import { Tree } from 'https://cdn.jsdelivr.net/npm/@dgreenheck/ez-tree@1.1.0/build/ez-tree.es.js';
import { treeKind, treeHash, foliageColors } from '../engine/season.js';

// 樹種ごとの形。ez-tree の見本「Oak Medium」をもとに枝と葉を変える（ほかの見本は葉がまばらな若木で、
// 河川敷の公園の木らしくなかった）。seeds の数だけ形を作る。葉の色の補正（sRGB を掛ける）
const KINDS = {
  // ケヤキのような広い樹冠
  deciduous: { seeds: [35729, 4511], leafTint: '#c8d8a8', barkTint: '#a09888',
    shape: o => { o.leaves.count = 26; o.leaves.size = 2.8; o.branch.children[0] = 7; } },
  // 桜：幹が短く、枝が横に広がる
  cherry: { seeds: [811, 9203], leafTint: '#d8e0c0', barkTint: '#8a7a70',
    shape: o => { o.branch.length[0] = 28; o.branch.angle[1] = 72; o.branch.start[1] = 0.32; o.branch.length[1] = 17; o.branch.length[2] = 12; o.leaves.count = 20; o.leaves.size = 2.3; o.branch.force.strength = -0.02; } },
  // 常緑樹（クスノキ・シイのような、葉の細かく詰んだ丸い樹冠）
  evergreen: { seeds: [2207, 6131], leafTint: '#7a9868', barkTint: '#8a8070',
    shape: o => { o.leaves.count = 42; o.leaves.size = 2.0; o.branch.children[1] = 5; o.branch.angle[1] = 45; } }
};

// 見本から作った木を、高さ 1 に正規化した形と素材にする
function buildPrototype(shape, seed) {
  const t = new Tree();
  t.loadPreset('Oak Medium');
  shape(t.options);
  t.options.seed = seed;
  t.generate();
  t.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(t);
  const s = 1 / (box.max.y - box.min.y);
  const fix = g => { const c = g.clone(); c.translate(0, -box.min.y, 0); c.scale(s, s, s); c.computeBoundingSphere(); return c; };
  const out = { bark: fix(t.branchesMesh.geometry), leaves: fix(t.leavesMesh.geometry), barkMat: t.branchesMesh.material, leafMat: t.leavesMesh.material, spread: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s };
  return out;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {{x:number, z:number, r:number, kind?:string}[]} o.trees  木の位置と樹冠の半径（m）
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {object} o.season       engine/season.js の季節
 */
export function createRealTrees({ scene, trees, heightAt, season }) {
  const uniforms = { uTime: { value: 0 } };
  const group = new THREE.Group();
  group.name = 'trees';
  scene.add(group);

  // 樹種ごと・形ごとに木を分ける
  const buckets = new Map();
  for (const tr of trees) {
    const kind = tr.kind ?? treeKind(tr.x, tr.z, { cherry: 0.2, evergreen: 0.3 });
    const variant = (treeHash(tr.z, tr.x) * KINDS[kind].seeds.length) | 0;
    const key = kind + ':' + variant;
    if (!buckets.has(key)) buckets.set(key, { kind, variant, list: [] });
    buckets.get(key).list.push(tr);
  }

  const leafMats = [];
  for (const { kind, variant, list } of buckets.values()) {
    const K = KINDS[kind];
    const proto = buildPrototype(K.shape, K.seeds[variant]);
    // 幹と枝（PBR）
    const pb = proto.barkMat;
    const barkMat = new THREE.MeshStandardMaterial({
      map: pb.map ?? null, normalMap: pb.normalMap ?? null, aoMap: pb.aoMap ?? null,
      roughness: 0.9, metalness: 0, color: new THREE.Color(K.barkTint).multiplyScalar(1.4)
    });
    // 葉（PBR・両面・アルファで切り抜く）。秋の桜は葉の色を塗り替える
    const pl = proto.leafMat;
    const fc = foliageColors(season, kind, 0);
    // 葉は日に透けて明るく見えるので、葉の色を少し自分で光らせる（強さは昼の明るさに合わせて update で変える）
    const leafMat = new THREE.MeshStandardMaterial({
      map: pl.map ?? null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0,
      // ez-tree の葉のテクスチャは暗いので 1.7 倍に（太陽の高い初夏の昼に、横から見た樹冠が黒くつぶれていた）
      color: new THREE.Color(K.leafTint).multiplyScalar(1.7), emissive: new THREE.Color(K.leafTint), emissiveMap: pl.map ?? null, emissiveIntensity: 0
    });
    const recolor = fc ? new THREE.Color(fc[1]) : null;
    leafMat.onBeforeCompile = shader => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uRecolor = { value: recolor ?? new THREE.Color(1, 1, 1) };
      shader.uniforms.uRecolorAmt = { value: recolor ? 1 : 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vLeafP;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLeafP = transformed;
          {
            // 風：木ごと・枝先ごとにずれた揺れ（上の葉ほど大きく）
            vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float ph = base.x * 0.37 + base.z * 0.21 + transformed.x * 3.1 + transformed.z * 2.3;
            float a = 0.012 * transformed.y;
            transformed.x += a * (sin(uTime * 1.7 + ph) + 0.4 * sin(uTime * 4.3 + ph * 1.7));
            transformed.z += a * cos(uTime * 1.3 + ph * 0.8);
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRecolor;\nuniform float uRecolorAmt;\nvarying vec3 vLeafP;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // 秋の葉：明るさは残して色だけ替える
            float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            // 1 枚ごとに色づきをずらし、緑の残る葉もまぜる（10 月中旬の桜）
            float turn = smoothstep(0.25, 0.75, fract(sin(dot(floor(vLeafP * 14.0), vec3(12.9, 78.2, 37.7))) * 43758.5));
            diffuseColor.rgb = mix(diffuseColor.rgb, uRecolor * l * 3.4, uRecolorAmt * mix(0.55, 1.0, turn));
            // 樹冠の内側・下側ほど暗く（葉は影を受けないので、そのかわりの陰）
            float rr = length((vLeafP - vec3(0.0, 0.62, 0.0)) * vec3(1.7, 2.3, 1.7));
            diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.2, 0.8, rr)) * mix(0.9, 1.05, clamp((vLeafP.y - 0.3) / 0.7, 0.0, 1.0));
          }`);
    };
    leafMat.customProgramCacheKey = () => 'real-leaf-' + (recolor ? 'r' : 'n');
    leafMats.push(leafMat);

    const bark = new THREE.InstancedMesh(proto.bark, barkMat, list.length);
    const leaves = new THREE.InstancedMesh(proto.leaves, leafMat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((tr, i) => {
      // 高さは樹冠の半径から（桜は低く横に広い）
      const h = kind === 'cherry' ? 4.5 + tr.r * 1.0 : 5 + tr.r * 1.5;
      // 横は樹冠の直径に合わせる（形がゆがみすぎない 0.7〜1.4 倍の範囲で）
      const sxz = Math.min(h * 1.4, Math.max(h * 0.7, (tr.r * 2) / Math.max(0.2, proto.spread)));
      q.setFromAxisAngle(up, treeHash(tr.x * 7, tr.z) * Math.PI * 2);
      m4.compose(new THREE.Vector3(tr.x, heightAt(tr.x, tr.z) - 0.1, tr.z), q, new THREE.Vector3(sxz, h, sxz));
      bark.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
    });
    for (const m of [bark, leaves]) {
      // 葉は影を受けない（葉が小さく影の解像度が粗いので、1 枚ずつ自分の影で黒くなっていた）。影は落とす
      m.castShadow = true;
      m.receiveShadow = m === bark;
      m.computeBoundingSphere();
      group.add(m);
    }
  }

  return {
    group,
    /** 毎フレーム：風の時間と、葉の透ける明るさ（day：昼 1・夜 0） */
    update(t, day = 1) {
      uniforms.uTime.value = t;
      for (const m of leafMats) m.emissiveIntensity = 0.22 * day;
    },
    get triangles() { let n = 0; group.traverse(o => { if (o.isInstancedMesh) n += (o.geometry.index.count / 3) * o.count; }); return n; }
  };
}
