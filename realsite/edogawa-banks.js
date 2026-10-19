// 江戸川の両岸の水際（scene.json の banks）
//   東京側（対岸）：水際に沿ってヨシ・低木・柳の帯（空中写真の芝より暗い緑の帯から幅を読む）。200 m 以上先なので、
//                   葉の 1 本 1 本ではなく、株のかたまり・低木・木の形で描く（1 つのメッシュにまとめる。揺れは見えない距離なので付けない）
//   市川側（シートの岸）：船着場より上流はまっすぐなコンクリートの護岸、市川緊急用船着場はコンクリートの床と水側の鋼の手すり、
//                   下流は水際にまばらな低木とヨシ（近景の中のヨシは life.js が揺らして描く。ここは近景の外の株）
import * as THREE from 'three';
import { mulberry32 } from '../engine/pixel-kit.js';

// 位置・法線・色だけの形をまとめる
function merge(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
// 形に 1 色を塗る（上ほど明るくしたいときは top に色）
function paint(geo, color, top = null, h = 1) {
  const c0 = new THREE.Color(color), c1 = new THREE.Color(top ?? color);
  const p = geo.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(c0).lerp(c1, Math.min(1, Math.max(0, p.getY(i) / h)));
    a.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/**
 * @param {object} o
 * @param {(p:object) => THREE.Material} o.toon
 * @param {object} o.data      scene.json
 * @param {object} o.terrain   createHeightTerrain の戻り値
 * @param {number} o.level     水面の高さ（場面の y）
 * @param {object} [o.collider]
 */
export function createBanks({ toon, data, terrain, level, collider = null, seed = 23, season = null }) {
  const B = data.banks;
  const group = new THREE.Group();
  group.name = 'banks';
  if (!B) return { group, counts: {} };
  const rnd = mulberry32(seed);
  const NB = terrain.bounds.near;
  const inNear = (x, z) => x > NB.x0 && x < NB.x1 && z > NB.z0 && z < NB.z1;
  const baseY = (x, z) => Math.max(terrain.heightAt(x, z), level - 0.15);
  const parts = [];
  const counts = { reedMass: 0, shrub: 0, tree: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const place = (geo, x, y, z, sx, sy, sz, yaw = rnd() * 6.28) => {
    m4.compose(p.set(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), sc.set(sx, sy, sz));
    parts.push(geo.clone().applyMatrix4(m4));
  };
  // 部品（1 m の大きさで作って、置くときに伸ばす）
  // 季節の色：春は新しい緑、夏は濃い緑、秋（もと）は黄ばみ始め、冬は枯れたヨシと葉を落とした柳
  const SK = season?.key ?? 'autumn';
  const REED = { spring: ['#6a8a44', '#76944a', '#5f7e3c', '#80a050'], summer: ['#4a7430', '#557e36', '#426a2c', '#5e8a3a'],
    autumn: ['#76844a', '#7f8a4c', '#8a8f52', '#6f7e46'], winter: ['#a8986c', '#b2a276', '#9c8c62', '#bcac80'] }[SK];
  const REED_TOP = { spring: '#8aa458', summer: '#6a9442', autumn: '#ada27a', winter: '#d0c4a2' }[SK];
  const SHRUB = { spring: ['#5a8238', '#669044', '#6c9442', '#527a34'], summer: ['#3a6428', '#446e2e', '#4a722e', '#365e26'],
    autumn: ['#4f6a36', '#5a7440', '#61783e', '#4a6232'], winter: ['#6a6a48', '#74704e', '#5e6244', '#7a7452'] }[SK];
  const WILLOW = { spring: ['#8ab450', '#9ac25c', '#84ac4c'], summer: ['#4a7a34', '#56863a', '#4e7e36'], autumn: ['#6c8a4a', '#7d9650', '#718c46'], winter: null }[SK];
  // ヨシ原のかたまり：上が少しすぼまった筒（上の面が穂の色）
  const reedGeo = () => paint(new THREE.CylinderGeometry(0.36, 0.5, 1, 6, 2).translate(0, 0.5, 0), REED[(rnd() * REED.length) | 0], REED_TOP, 1.25);
  const shrubGeo = () => paint(new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.4, 0), SHRUB[(rnd() * SHRUB.length) | 0]);
  const crownGeo = () => paint(new THREE.IcosahedronGeometry(0.5, 1), WILLOW[(rnd() * WILLOW.length) | 0]);
  const trunkGeo = paint(new THREE.CylinderGeometry(0.06, 0.1, 1, 5).translate(0, 0.5, 0), '#5b4632');

  // ---- 水際の植え込みの帯。pts は 4 m おきの点 [x, z, nx, nz, 始まり, 幅, 濃さ, 縁]
  function band(pts, { minWidth = 3, treeBase = 0.22, fringe = null } = {}) {
    for (let i = 0; i < pts.length; i++) {
      const [x, z, nx, nz, s0, w0, dark] = pts[i];
      let s = s0, w = w0, cover = 1;
      if (fringe && z >= fringe.z0 && z <= fringe.z1 && w < fringe.width) { s = -1; w = fringe.width; cover = fringe.cover; }
      if (w < minWidth && !(fringe && w >= fringe.width)) continue;
      const tx = -nz, tz = nx;                         // 水際に沿う向き
      const area = 4 * w;
      // 株のかたまり（ヨシ・オギ）：水際寄りに多い
      const nReed = Math.round(area / 5 * cover);
      for (let k = 0; k < nReed; k++) {
        const u = (rnd() - 0.5) * 4, t = s + Math.pow(rnd(), 1.6) * w;
        const px = x + tx * u + nx * t, pz = z + tz * u + nz * t;
        if (inNear(px, pz)) continue;                  // 近景の中は life.js のヨシ
        const h = 1.5 + rnd() * 1.2, r = 0.9 + rnd() * 1.2;
        place(reedGeo(), px, baseY(px, pz) - 0.1, pz, r * 2, h, r * 2);
        counts.reedMass++;
      }
      // 低木：陸寄りに
      const nShrub = Math.round(area / 16 * cover);
      for (let k = 0; k < nShrub; k++) {
        const u = (rnd() - 0.5) * 4, t = s + (0.4 + rnd() * 0.6) * w;
        const px = x + tx * u + nx * t, pz = z + tz * u + nz * t;
        if (inNear(px, pz)) continue;
        const r = 1.6 + rnd() * 1.8;
        place(shrubGeo(), px, baseY(px, pz) - 0.2, pz, r * 1.3, r, r * 1.3);
        counts.shrub++;
      }
      // 木（柳・エノキなど水際の木）：帯の濃い所ほど多い
      if (w >= 6 && rnd() < treeBase + dark * 1.5) {
        const u = (rnd() - 0.5) * 4, t = s + (0.3 + rnd() * 0.6) * w;
        const px = x + tx * u + nx * t, pz = z + tz * u + nz * t;
        if (!inNear(px, pz)) {
          const h = 4.5 + rnd() * 4, cr = 2.2 + rnd() * 1.8, y0 = baseY(px, pz) - 0.1;
          place(trunkGeo, px, y0, pz, 1.4, h * 0.75, 1.4);
          if (WILLOW) {
            place(crownGeo(), px, y0 + h * 0.62, pz, cr * 2, cr * 1.5, cr * 2);
            place(crownGeo(), px + (rnd() - 0.5) * cr, y0 + h * 0.5, pz + (rnd() - 0.5) * cr, cr * 1.4, cr * 1.1, cr * 1.4);
          } else {
            // 冬の柳：葉を落とした枝（幹の先から斜めに 3 本）
            for (let k = 0; k < 3; k++) { const a = k * 2.1 + rnd(); place(trunkGeo, px + Math.cos(a) * cr * 0.4, y0 + h * 0.55, pz + Math.sin(a) * cr * 0.4, 0.8, h * 0.45, 0.8); }
          }
          counts.tree++;
        }
      }
    }
  }
  band(B.west);
  band(B.east, { treeBase: 0.05, fringe: B.eastRules?.fringe });
  if (parts.length) {
    const veg = new THREE.Mesh(merge(parts), toon({ vertexColors: true, flatShading: true }));
    veg.name = 'bank-vegetation';
    veg.receiveShadow = true;
    group.add(veg);
  }

  // ---- 市川側：船着場より上流のコンクリートの護岸（水面から岸の上までの垂直の面と、上の縁）
  const concrete = toon({ color: '#a9a69c' }), coping = toon({ color: '#c4c0b4' });
  const W = B.eastRules?.wall;
  if (W) {
    const line = B.east.filter(q => q[1] >= W[0] && q[1] <= W[1]);
    const pos = [], capPos = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, z0, nx0, nz0] = line[i], [x1, z1, nx1, nz1] = line[i + 1];
      // 岸の上の高さ：水際から 1.5 m 陸側の地面
      const t0 = terrain.heightAt(x0 + nx0 * 1.5, z0 + nz0 * 1.5), t1 = terrain.heightAt(x1 + nx1 * 1.5, z1 + nz1 * 1.5);
      const b = level - 0.5;
      pos.push(x0, b, z0, x1, b, z1, x1, t1, z1, x0, b, z0, x1, t1, z1, x0, t0, z0);
      // 上の縁：幅 0.4 m
      const ax = x0 + nx0 * 0.4, az = z0 + nz0 * 0.4, bx = x1 + nx1 * 0.4, bz = z1 + nz1 * 0.4;
      capPos.push(x0, t0 + 0.05, z0, ax, t0 + 0.05, az, bx, t1 + 0.05, bz, x0, t0 + 0.05, z0, bx, t1 + 0.05, bz, x1, t1 + 0.05, z1);
    }
    for (const [arr, mat] of [[pos, concrete], [capPos, coping]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.material.side = THREE.DoubleSide;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---- 市川緊急用船着場：コンクリートの床（砂をかぶる）と水側の垂直の面、鋼の手すり（陸側の柵・門は位置が確かめられないので作らない）
  const L = B.landing;
  if (L) {
    const ux = Math.cos(L.angle), uz = Math.sin(L.angle);         // 長い向き
    let vx = -uz, vz = ux;                                         // 短い向き（水の方へ向ける）
    if (terrain.heightAt(L.x + vx * L.width * 0.5, L.z + vz * L.width * 0.5) > terrain.heightAt(L.x - vx * L.width * 0.5, L.z - vz * L.width * 0.5)) { vx = -vx; vz = -vz; }
    const at = (a, b) => [L.x + ux * a + vx * b, L.z + uz * a + vz * b];
    // 床の高さ：塊の中ほどの地面
    let top = -Infinity;
    for (let a = -L.length / 2; a <= L.length / 2; a += 4) top = Math.max(top, terrain.heightAt(...at(a, -L.width * 0.25)));
    top += 0.05;
    const bottom = level - 0.6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L.length, top - bottom, L.width * 0.62), [
      concrete, concrete, toon({ color: '#c9bd9e' }), concrete, concrete, concrete     // 上の面は砂の色
    ]);
    // 水側に寄せる（陸側の 4 割は地面の舗装のまま）
    const [cx, cz] = at(0, L.width * 0.19);
    deck.position.set(cx, (top + bottom) / 2, cz);
    deck.rotation.y = -L.angle;
    deck.receiveShadow = deck.castShadow = true;
    group.add(deck);
    // 鋼の手すり：水側の長い辺と、上流・下流の短い辺。支柱 2 m おき、上と中ほどに横の棒
    const steel = toon({ color: '#4a3f38' });
    const rails = [];
    const edge = L.width * 0.5 - 0.15;
    const runs = [
      [at(-L.length / 2, edge), at(L.length / 2, edge)],
      [at(-L.length / 2, edge), at(-L.length / 2, edge - 2)],
      [at(L.length / 2, edge), at(L.length / 2, edge - 2)]
    ];
    const postGeo = new THREE.BoxGeometry(0.08, 1.1, 0.08).translate(0, 0.55, 0);
    for (const [[x0, z0], [x1, z1]] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0);
      for (let s = 0; s <= len + 0.01; s += 2) {
        const x = x0 + (x1 - x0) * s / len, z = z0 + (z1 - z0) * s / len;
        rails.push(postGeo.clone().translate(x, top, z));
        collider?.addCircle(x, z, 0.35, 'rail');
        if (s + 1 <= len) collider?.addCircle(x + (x1 - x0) / len, z + (z1 - z0) / len, 0.35, 'rail');
      }
      for (const hh of [1.08, 0.55]) {
        const bar = new THREE.BoxGeometry(len, 0.06, 0.06).rotateY(yaw).translate((x0 + x1) / 2, top + hh, (z0 + z1) / 2);
        rails.push(bar);
      }
    }
    const mergeBoxes = (list, mat) => {
      const g = merge(list.map(b => paint(b, '#ffffff')));
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      group.add(m);
    };
    mergeBoxes(rails, steel);
  }
  return { group, counts };
}
