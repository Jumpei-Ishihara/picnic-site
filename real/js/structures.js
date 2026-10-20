// 写実版の遠景と構造物：鉄橋・送電線と鉄塔・家並み・高い建物・両岸の水際（護岸・船着場・ヨシの帯）・遠景の影絵
//   形の作り方はドット絵版のもの（engine/structures.js・engine/backdrop.js・realsite/edogawa-banks.js）を使い、素材だけ PBR にする
import * as THREE from 'three';
import { createBridge, createPowerLines, createHouses, railCorridor, windowTextures } from '../../engine/structures.js';
import { createBackdrop } from '../../engine/backdrop.js';
import { createBanks } from '../../realsite/edogawa-banks.js';
import { mulberry32 } from '../../engine/pixel-kit.js';

// 鉄橋の塗装（ドット絵版と同じ色。実際の橋の写真から）
const BRIDGE_COLORS = {
  'jr-sobu-local': '#c9c3a0',   // 各駅停車の線（明るい灰色がかった黄）
  'jr-sobu-rapid': '#8f9ba8',   // 快速の線（青みの灰色）
  'keisei': '#7e9488',
  'ichikawa-bridge': '#a9a9a2'
};

// toon({ color, vertexColors, flatShading, map, ... }) の代わりに PBR の素材を返す（engine・realsite の部品に渡す）
export function pbr(p = {}) {
  const { color = '#ffffff', flatShading, ...rest } = p;
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, metalness: 0, ...rest });
}

// 窓の模様のテクスチャをなめらかに（ドット絵版は最近傍）
function smoothTex(t) {
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 茂みの塊の素材：頂点色に、場所で決まる 3 つの大きさのノイズで明暗のむらと凹凸を足す（遠くから見る植え込み・ヨシ原用）
function foliageMassMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFW;
        float fH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float fN(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(fH(i), fH(i + vec3(1,0,0)), f.x), mix(fH(i + vec3(0,1,0)), fH(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(fH(i + vec3(0,0,1)), fH(i + vec3(1,0,1)), f.x), mix(fH(i + vec3(0,1,1)), fH(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fF(vec3 p) { return fN(p * 0.6) * 0.5 + fN(p * 1.9) * 0.3 + fN(p * 5.3) * 0.2; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fv = fF(vFW);
        diffuseColor.rgb *= 0.35 + 0.75 * fv;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float e = 0.15;
          vec3 g = vec3(fF(vFW + vec3(e, 0, 0)), fF(vFW + vec3(0, e, 0)), fF(vFW + vec3(0, 0, e))) - fF(vFW);
          normal = normalize(normal - mat3(viewMatrix) * (g / e) * 0.6);
        }`);
  };
  m.customProgramCacheKey = () => 'real-foliage-mass';
  return m;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data      scene.json
 * @param {object} o.terrain   real/js/terrain.js
 * @param {number} o.level
 * @param {object} o.collider
 * @param {object} o.season
 * 場面ごとの設定（どれも省略できる）：
 * @param {object} [o.bridgeColors]   橋の id → 塗装の色
 * @param {(pbr:Function) => THREE.Material} [o.towerMaterial]  送電鉄塔の素材（紅白の鉄塔など）
 * @param {object} [o.houses]         家並みの createHouses への上書き（maxDist・thinFrom など）と isTownExtra(x, z)
 * @param {object[]|Function} [o.extraHouses]  ほかの家並み（工場・倉庫の地区など）の createHouses の設定（({ terrain }) => [...] でもよい）。wallMaterial・roofMaterial は省略できる
 * @param {(b:object, mats:object) => THREE.Material[]} [o.buildingMaterials]  高い建物ごとの [屋根, 壁]
 * @param {object[]} [o.backdropExtra] 遠景の影絵に足すもの
 * @param {number} [o.houseMax]       家並みを置く最も遠い距離（m）
 */
export function createRealStructures({ scene, data, terrain, level, collider, season, bridgeColors = BRIDGE_COLORS, towerMaterial = null, houses: houseOpts = {}, extraHouses = [], buildingMaterials = null, backdropExtra = [] }) {
  const rnd = mulberry32(31);
  const NB = terrain.bounds.near, MB = terrain.bounds.mid;
  const group = new THREE.Group();
  group.name = 'structures';
  scene.add(group);
  const L = data.landmarks;

  // ---- 鉄橋・道路橋
  const concrete = pbr({ color: '#b4b0a6', roughness: 0.9 });
  const deck = pbr({ color: '#7e7d79', roughness: 0.9 });
  for (const b of L.bridges ?? []) {
    const steel = pbr({ color: bridgeColors[b.id] ?? '#9a9a9a', roughness: 0.55, metalness: 0.35 });
    const g = createBridge({
      path: b.path, kind: b.kind, deckY: b.deckY, width: b.width,
      heightAt: terrain.heightAt, isWater: (x, z) => terrain.midClassAt(x, z) === 'water',
      materials: { steel, concrete, deck }
    });
    g.name = 'bridge-' + b.id;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
  }

  // ---- 送電線と鉄塔
  const power = createPowerLines({
    lines: L.powerLines ?? [], towers: L.towers ?? [], heightAt: terrain.heightAt,
    material: towerMaterial ? towerMaterial(pbr) : pbr({ color: '#9a9ea4', roughness: 0.5, metalness: 0.5 }), wireMaterial: new THREE.LineBasicMaterial({ color: 0x55585e })
  });
  group.add(power.group);

  // ---- 家並み（堤防の外の町。歩ける近景の中には置かない）
  const houseWin = windowTextures({ cols: 2, rows: 2, lit: 0, rnd });
  smoothTex(houseWin.map);
  const houseWall = pbr({ map: houseWin.map, roughness: 0.9 });
  const { isTownExtra = () => true, ...houseRest } = houseOpts;
  const houses = createHouses({
    avoid: railCorridor(L.railways ?? [], 16),
    isTown: (x, z) => terrain.midClassAt(x, z) === 'town' && !(x > NB.x0 - 10 && x < NB.x1 + 10 && z > NB.z0 - 10 && z < NB.z1 + 10) && isTownExtra(x, z),
    heightAt: terrain.heightAt, bounds: MB, rnd, clearance: 24,
    wallMaterial: houseWall, roofMaterial: pbr({ roughness: 0.8 }), minDist: 90, maxDist: 1450,
    wallColors: ['#d8d2c4', '#c9c2b2', '#e4e0d6', '#b8b2a8', '#cfc6b0', '#a9a49c'],
    roofColors: ['#5a5f6a', '#6d4a3e', '#4a5a6a', '#7a7a7a', '#8a5a4a'],
    ...houseRest
  });
  group.add(houses.group);
  for (const h of (typeof extraHouses === 'function' ? extraHouses({ terrain }) : extraHouses)) {
    const more = createHouses({ avoid: railCorridor(L.railways ?? [], 16), heightAt: terrain.heightAt, bounds: MB, rnd, wallMaterial: houseWall, roofMaterial: pbr({ roughness: 0.8 }), ...h });
    group.add(more.group);
  }

  // ---- 8 階以上の建物（OSM の形を押し出す。壁の模様は 2 階分 × 2 窓 = 7 m × 6.2 m）
  {
    const win = windowTextures({ cols: 2, rows: 2, lit: 0, rnd, glass: '#4f6074' });
    smoothTex(win.map);
    win.map.repeat.set(1 / 7, 1 / 6.2);
    const mats = { wall: pbr({ color: '#d6d2c8', map: win.map, roughness: 0.6, metalness: 0.05 }), roof: pbr({ color: '#9a978f' }), plain: pbr({ color: '#e2e2de' }) };
    for (const b of L.buildings ?? []) {
      const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, buildingMaterials?.(b, mats) ?? [mats.roof, mats.wall]);
      m.position.y = terrain.heightAt(b.x, b.z) - 0.5;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }
  // ---- 近景のまわりの建物（倉庫・家・公園の管理棟など。高さ 25 m 未満）。屋根は空中写真の色。中には入れない
  for (const b of L.nearBuildings ?? []) {
    const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const roofColor = b.roof ?? (b.kind === 'warehouse' || b.kind === 'industrial' ? '#8fa6a8' : '#8a8076');
    const m = new THREE.Mesh(geo, [pbr({ color: roofColor }), houseWall]);
    m.position.y = Math.min(...b.footprint.map(([x, z]) => terrain.heightAt(x, z))) - 0.3;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    const xs = b.footprint.map(p => p[0]), zs = b.footprint.map(p => p[1]);
    collider?.addRect(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 'building');
  }
  // ---- 野球場の土の内野（円盤）。広い範囲は内野を何面か並べる
  {
    const dirt = pbr({ color: '#b89a70', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const p of L.pitches ?? []) {
      if (p.sport && p.sport !== 'baseball') continue;
      const n = Math.max(1, Math.round(p.area / 9000));
      const r = Math.min(22, 0.3 * Math.sqrt(p.area / n));
      const xs = p.polygon.map(q => q[0]), zs = p.polygon.map(q => q[1]);
      const alongX = Math.max(...xs) - Math.min(...xs) > Math.max(...zs) - Math.min(...zs);
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0.5 : (k + 0.5) / n;
        const x = alongX ? Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * t : p.x;
        const z = alongX ? p.z : Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * t;
        if (x > NB.x0 && x < NB.x1 && z > NB.z0 && z < NB.z1) continue; // 近景の中は地面の素材（砂利）で描く
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2), dirt);
        m.position.set(x, terrain.heightAt(x, z) + 0.15, z);
        m.receiveShadow = true;
        group.add(m);
      }
    }
  }

  // ---- 両岸の水際：対岸のヨシ・低木・柳の帯、護岸と船着場（手すりは当たり判定にも）。データに水際の帯がある場面だけ
  let banks = null;
  if (data.banks) {
    banks = createBanks({ toon: pbr, data, terrain, level, collider, season });
    banks.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // 対岸のヨシ原・低木・柳の塊（多面体）に、葉の茂みのようなむらと凹凸を付ける
    const veg = banks.group.getObjectByName('bank-vegetation');
    if (veg) veg.material = foliageMassMaterial();
    group.add(banks.group);
  }

  // ---- 遠景の影絵（スカイツリー・富士山など。方位と見かけの大きさを合わせる）
  const backdrop = createBackdrop({ scene, items: [...(L.backdrop ?? []), ...backdropExtra], upstreamBearing: data.frame.upstreamBearing, radius: 3600 });

  return {
    group, power, houses, banks, backdrop, houseWall,
    /** 毎フレーム：影絵の色（空の地平・天頂の色、太陽の向き、夜） */
    update({ horizon, top, sunDir, night }, cameraPos) { backdrop.update({ horizon, top, sunDir, night }, cameraPos); }
  };
}
