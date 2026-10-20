// 写実版の遠景と構造物：鉄橋・送電線と鉄塔・家並み・高い建物・両岸の水際（護岸・船着場・ヨシの帯）・遠景の影絵
//   形の作り方はドット絵版のもの（engine/structures.js・engine/backdrop.js・realsite/edogawa-banks.js）を使い、素材だけ PBR にする
import * as THREE from 'three';
import { createBridge, createPowerLines, createHouses, railCorridor, windowTextures } from '../engine/structures.js';
import { createBackdrop } from '../engine/backdrop.js';
import { createBanks } from '../realsite/edogawa-banks.js';
import { mulberry32 } from '../engine/pixel-kit.js';

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

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object} o.data      scene.json
 * @param {object} o.terrain   real/terrain.js
 * @param {number} o.level
 * @param {object} o.collider
 * @param {object} o.season
 */
export function createRealStructures({ scene, data, terrain, level, collider, season }) {
  const rnd = mulberry32(31);
  const NB = terrain.bounds.near, MB = terrain.bounds.mid;
  const group = new THREE.Group();
  group.name = 'structures';
  scene.add(group);

  // ---- 鉄橋・道路橋
  const concrete = pbr({ color: '#b4b0a6', roughness: 0.9 });
  const deck = pbr({ color: '#7e7d79', roughness: 0.9 });
  for (const b of data.landmarks.bridges) {
    const steel = pbr({ color: BRIDGE_COLORS[b.id] ?? '#9a9a9a', roughness: 0.55, metalness: 0.35 });
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
    lines: data.landmarks.powerLines, towers: data.landmarks.towers, heightAt: terrain.heightAt,
    material: pbr({ color: '#9a9ea4', roughness: 0.5, metalness: 0.5 }), wireMaterial: new THREE.LineBasicMaterial({ color: 0x55585e })
  });
  group.add(power.group);

  // ---- 家並み（堤防の外の町。歩ける近景の中には置かない）
  const houseWin = windowTextures({ cols: 2, rows: 2, lit: 0, rnd });
  smoothTex(houseWin.map);
  const houses = createHouses({
    avoid: railCorridor(data.landmarks.railways, 16),
    isTown: (x, z) => terrain.midClassAt(x, z) === 'town' && !(x > NB.x0 - 10 && x < NB.x1 + 10 && z > NB.z0 - 10 && z < NB.z1 + 10),
    heightAt: terrain.heightAt, bounds: MB, rnd, clearance: 24,
    wallMaterial: pbr({ map: houseWin.map, roughness: 0.9 }), roofMaterial: pbr({ roughness: 0.8 }), minDist: 90, maxDist: 1450,
    wallColors: ['#d8d2c4', '#c9c2b2', '#e4e0d6', '#b8b2a8', '#cfc6b0', '#a9a49c'],
    roofColors: ['#5a5f6a', '#6d4a3e', '#4a5a6a', '#7a7a7a', '#8a5a4a']
  });
  group.add(houses.group);

  // ---- 8 階以上の建物（OSM の形を押し出す。壁の模様は 2 階分 × 2 窓 = 7 m × 6.2 m）
  {
    const win = windowTextures({ cols: 2, rows: 2, lit: 0, rnd, glass: '#4f6074' });
    smoothTex(win.map);
    win.map.repeat.set(1 / 7, 1 / 6.2);
    const wall = pbr({ color: '#d6d2c8', map: win.map, roughness: 0.6, metalness: 0.05 });
    const roof = pbr({ color: '#9a978f' });
    for (const b of data.landmarks.buildings) {
      const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, [roof, wall]);
      m.position.y = terrain.heightAt(b.x, b.z) - 0.5;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---- 両岸の水際：対岸のヨシ・低木・柳の帯、市川側の護岸と船着場（手すりは当たり判定にも）
  const banks = createBanks({ toon: pbr, data, terrain, level, collider, season });
  banks.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(banks.group);

  // ---- 遠景の影絵（スカイツリー・富士山など。方位と見かけの大きさを合わせる）
  const backdrop = createBackdrop({ scene, items: data.landmarks.backdrop, upstreamBearing: data.frame.upstreamBearing, radius: 3600 });

  return {
    group, power, houses, banks, backdrop,
    /** 毎フレーム：影絵の色（空の地平・天頂の色、太陽の向き、夜） */
    update({ horizon, top, sunDir, night }, cameraPos) { backdrop.update({ horizon, top, sunDir, night }, cameraPos); }
  };
}
