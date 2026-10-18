// 長い構造物を数値から組み立てる：トラス橋・桁橋・橋脚、送電鉄塔と送電線、家並み（まとめ描き）
// 部材は箱の組み合わせ。素材ごとに 1 つのメッシュにまとめて描く回数を減らす。
import * as THREE from 'three';
import { makeCanvas, pixelTex } from './pixel-kit.js';

// ---------------------------------------------------------------------------
// 箱を並べて 1 つの形にまとめる
// ---------------------------------------------------------------------------
export class GeoBuilder {
  constructor() { this.parts = []; }
  // 中心 c、大きさ (sx, sy, sz)、Y 軸まわりの回転 yaw の箱
  box(c, sx, sy, sz, yaw = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(c));
    this.parts.push(g);
    return this;
  }
  // a から b へ伸びる角材（太さ t）
  beam(a, b, t = 0.4, t2 = t) {
    const len = a.distanceTo(b);
    if (len < 1e-4) return this;
    const g = new THREE.BoxGeometry(t, len, t2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    this.parts.push(g);
    return this;
  }
  get empty() { return this.parts.length === 0; }
  build() {
    let nv = 0, ni = 0;
    for (const g of this.parts) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of this.parts) {
      pos.set(g.attributes.position.array, ov * 3);
      nor.set(g.attributes.normal.array, ov * 3);
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[oi + k] = gi[k] + ov;
      ov += g.attributes.position.count; oi += gi.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 折れ線を、長さに沿った位置で引けるようにする
function polyline(path) {
  const pts = path.map(([x, z]) => new THREE.Vector2(x, z));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = cum[cum.length - 1];
  function at(s) {
    s = Math.min(Math.max(s, 0), L);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const p = pts[i - 1].clone().lerp(pts[i], t);
    const d = pts[i].clone().sub(pts[i - 1]).normalize();
    return { x: p.x, z: p.y, dx: d.x, dz: d.y };
  }
  return { L, at };
}

/**
 * 橋。水の上はトラス（kind が 'truss' のとき）または桁、陸の上は桁を橋脚で支える。
 * @param {object} o
 * @param {number[][]} o.path       [x, z] の折れ線（橋の中心線）
 * @param {'truss'|'girder'} o.kind
 * @param {number} o.deckY          床の高さ
 * @param {number} o.width          幅
 * @param {(x:number, z:number) => number} o.heightAt   地面（川底）の高さ
 * @param {(x:number, z:number) => boolean} o.isWater
 * @param {{ steel: THREE.Material, concrete: THREE.Material, deck: THREE.Material }} o.materials
 */
export function createBridge({ path, kind, deckY, width, heightAt, isWater, materials, trussSpan = 70, landSpan = 26, trussHeight = 8.5, panel = 8 }) {
  const P = polyline(path);
  const steel = new GeoBuilder(), concrete = new GeoBuilder(), deck = new GeoBuilder();
  // 水の上の範囲（長さに沿って）
  let w0 = Infinity, w1 = -Infinity;
  for (let s = 0; s <= P.L; s += 2) { const p = P.at(s); if (isWater(p.x, p.z)) { w0 = Math.min(w0, s); w1 = Math.max(w1, s); } }
  // 橋脚の位置：水の上は trussSpan 前後で等分、陸は landSpan ごと
  const piers = [0];
  if (w0 < w1) {
    const a = Math.max(0, w0 - 12), b = Math.min(P.L, w1 + 12);
    for (let s = landSpan; s < a - landSpan * 0.4; s += landSpan) piers.push(s);
    piers.push(a);
    const n = Math.max(1, Math.round((b - a) / trussSpan));
    for (let k = 1; k <= n; k++) piers.push(a + (b - a) * k / n);
    for (let s = b + landSpan; s < P.L - landSpan * 0.4; s += landSpan) piers.push(s);
  } else {
    for (let s = landSpan; s < P.L - landSpan * 0.4; s += landSpan) piers.push(s);
  }
  if (P.L - piers[piers.length - 1] > 1) piers.push(P.L);
  const overWater = (s0, s1) => w0 < w1 && s0 >= Math.max(0, w0 - 13) && s1 <= Math.min(P.L, w1 + 13);

  const deckT = kind === 'girder' ? 1.0 : 0.9;
  for (let i = 0; i < piers.length - 1; i++) {
    const s0 = piers[i], s1 = piers[i + 1];
    // 床（折れ線に沿うよう 1 区間を数枚に分ける）
    const nseg = Math.max(1, Math.ceil((s1 - s0) / 12));
    for (let k = 0; k < nseg; k++) {
      const a = P.at(s0 + (s1 - s0) * k / nseg), b = P.at(s0 + (s1 - s0) * (k + 1) / nseg);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      const c = V((a.x + b.x) / 2, deckY - deckT / 2, (a.z + b.z) / 2);
      deck.box(c, len + 0.05, deckT, width, yaw);
      // 桁（床の下）
      const truss = kind === 'truss' && overWater(s0, s1);
      if (!truss) concrete.box(V(c.x, deckY - deckT - 0.9, c.z), len + 0.05, 1.8, width * 0.7, yaw);
      // 手すり・壁高欄
      for (const side of [-1, 1]) {
        const nx = a.dz, nz = -a.dx; // 進行方向に直角
        const off = (width / 2 - 0.15) * side;
        deck.box(V(c.x + nx * off, deckY + 0.5, c.z + nz * off), len + 0.05, 1.0, 0.3, yaw);
      }
    }
    // トラス（ワーレン形、垂直材つき）
    if (kind === 'truss' && overWater(s0, s1)) {
      const n = Math.max(3, Math.round((s1 - s0) / panel));
      for (const side of [-1, 1]) {
        const node = (k, top) => {
          const p = P.at(s0 + (s1 - s0) * k / n);
          const off = (width / 2 + 0.2) * side;
          return V(p.x + p.dz * off, deckY + (top ? trussHeight : 0), p.z - p.dx * off);
        };
        for (let k = 0; k < n; k++) {
          steel.beam(node(k, false), node(k + 1, false), 0.7, 0.7);                         // 下弦材
          if (k > 0 && k < n - 1) steel.beam(node(k, true), node(k + 1, true), 0.8, 0.8);   // 上弦材
          if (k === 0) steel.beam(node(0, false), node(1, true), 0.8, 0.8);                 // 端の斜材
          else if (k === n - 1) steel.beam(node(n - 1, true), node(n, false), 0.8, 0.8);
          else {
            steel.beam(k % 2 ? node(k, false) : node(k, true), k % 2 ? node(k + 1, true) : node(k + 1, false), 0.5, 0.5); // 斜材
            steel.beam(node(k, false), node(k, true), 0.4, 0.4);                             // 垂直材
          }
        }
      }
      // 上の横つなぎ
      for (let k = 1; k < n; k++) {
        const p = P.at(s0 + (s1 - s0) * k / n);
        const off = width / 2 + 0.2;
        steel.beam(V(p.x + p.dz * off, deckY + trussHeight, p.z - p.dx * off), V(p.x - p.dz * off, deckY + trussHeight, p.z + p.dx * off), 0.35, 0.35);
      }
    }
  }
  // 橋脚（両端は堤防の上に載るので立てない）
  for (let i = 1; i < piers.length - 1; i++) {
    const p = P.at(piers[i]);
    const ground = heightAt(p.x, p.z);
    const top = deckY - deckT - (kind === 'truss' && overWater(piers[i - 1], piers[i + 1]) ? 0 : 1.8);
    if (top - ground < 0.5) continue;
    const yaw = Math.atan2(-p.dz, p.dx);
    const h = top - ground + 1.5;
    concrete.box(V(p.x, ground - 1.5 + h / 2, p.z), 2.2, h, width + 1.5, yaw);
  }
  const group = new THREE.Group();
  for (const [b, m] of [[steel, materials.steel], [concrete, materials.concrete], [deck, materials.deck]]) {
    if (b.empty) continue;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData = { length: P.L, piers, water: [w0, w1], path: P };
  return group;
}

// ---------------------------------------------------------------------------
// 送電鉄塔と送電線
// ---------------------------------------------------------------------------
/**
 * 鉄塔の形（原点が足元、腕は x 方向に出る）と、電線を掛ける点。
 * @returns {{ geo: THREE.BufferGeometry, hooks: THREE.Vector3[] }}  hooks：腕の先（左右 3 段）と頂部
 */
export function pylonGeometry(H = 38) {
  const b = new GeoBuilder();
  const base = H * 0.11, topW = 0.9;
  const halfAt = y => base + (topW - base) * (y / H);
  const leg = 0.55, brace = 0.28;
  const levels = 9;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.beam(V(sx * base, 0, sz * base), V(sx * topW, H, sz * topW), leg, leg);
  }
  // 各面のたすき掛け
  for (let i = 0; i < levels; i++) {
    const y0 = H * i / levels, y1 = H * (i + 1) / levels, h0 = halfAt(y0), h1 = halfAt(y1);
    for (const f of [0, 1, 2, 3]) {
      const ang = f * Math.PI / 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const pA = (h, t, y) => V(c * h - s * h * t, y, s * h + c * h * t);
      b.beam(pA(h0, -1, y0), pA(h1, 1, y1), brace, brace);
      b.beam(pA(h0, 1, y0), pA(h1, -1, y1), brace, brace);
    }
  }
  // 腕（3 段）と頂部の架空地線
  const hooks = [];
  const arms = [[0.66, 5.2], [0.78, 5.8], [0.9, 5.2]];
  for (const [fy, len] of arms) {
    const y = H * fy, w = halfAt(y);
    for (const sx of [-1, 1]) {
      b.beam(V(sx * w, y, 0), V(sx * (w + len), y, 0), 0.5, 0.9);
      b.beam(V(sx * w, y - 1.6, 0), V(sx * (w + len), y, 0), 0.25, 0.25);
      hooks.push(V(sx * (w + len), y - 0.4, 0));
    }
  }
  b.beam(V(0, H - 0.5, 0), V(0, H + 3, 0), 0.4, 0.4);
  hooks.push(V(0, H + 3, 0));
  return { geo: b.build(), hooks };
}

/**
 * 送電線：鉄塔（位置）と、鉄塔をつなぐ線（path の各点が鉄塔）から、鉄塔と電線を作る。
 * @param {object} o
 * @param {{ path: number[][], towerHeight: number }[]} o.lines
 * @param {number[][]} o.towers          鉄塔の位置 [x, z]
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {THREE.Material} o.material    鉄塔の素材
 * @param {THREE.LineBasicMaterial} o.wireMaterial
 */
export function createPowerLines({ lines, towers, heightAt, material, wireMaterial, sag = 0.035, maxDist = 1600 }) {
  const group = new THREE.Group();
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2;
  // 鉄塔ごとに：高さ（通る線のうち最大）と向き（線の向きの平均）
  const info = towers.map(t => ({ t, H: 0, dir: new THREE.Vector2(), hooks: null, yaw: 0, y: heightAt(t[0], t[1]) }));
  const find = p => info.find(i => near(i.t, p));
  for (const l of lines) {
    for (let k = 0; k < l.path.length; k++) {
      const ti = find(l.path[k]);
      if (!ti) continue;
      ti.H = Math.max(ti.H, l.towerHeight);
      const a = l.path[Math.max(0, k - 1)], b = l.path[Math.min(l.path.length - 1, k + 1)];
      ti.dir.add(new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize());
    }
  }
  const geos = new Map();
  for (const ti of info) {
    if (!ti.H) continue;
    if (!geos.has(ti.H)) geos.set(ti.H, pylonGeometry(ti.H));
    const { geo, hooks } = geos.get(ti.H);
    // 腕（x 方向）を線の向きと直角に
    ti.yaw = Math.atan2(-ti.dir.y, ti.dir.x) + Math.PI / 2;
    const m = new THREE.Mesh(geo, material);
    m.position.set(ti.t[0], ti.y - 0.3, ti.t[1]);
    m.rotation.y = ti.yaw;
    m.castShadow = true;
    m.updateMatrix();
    group.add(m);
    ti.hooks = hooks.map(h => h.clone().applyMatrix4(m.matrix));
  }
  // 電線（たるみ = 径間 × sag）
  const pts = [];
  for (const l of lines) {
    for (let k = 0; k < l.path.length - 1; k++) {
      const A = find(l.path[k]), B = find(l.path[k + 1]);
      if (!A || !B || !A.hooks || !B.hooks) continue;
      if (Math.hypot(A.t[0], A.t[1]) > maxDist && Math.hypot(B.t[0], B.t[1]) > maxDist) continue;
      const span = Math.hypot(B.t[0] - A.t[0], B.t[1] - A.t[1]);
      // 腕の左右が入れ替わらないよう、近い方どうしをつなぐ
      const bh = B.hooks.slice();
      const flip = A.hooks[0].distanceTo(bh[0]) > A.hooks[0].distanceTo(bh[1]);
      for (let h = 0; h < A.hooks.length; h++) {
        const a = A.hooks[h], b = bh[h === A.hooks.length - 1 ? h : (flip ? h ^ 1 : h)];
        const N = 14;
        for (let i = 0; i < N; i++) {
          for (const t of [i / N, (i + 1) / N]) {
            const p = a.clone().lerp(b, t);
            p.y -= span * sag * 4 * t * (1 - t);
            pts.push(p.x, p.y, p.z);
          }
        }
      }
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const wires = new THREE.LineSegments(wg, wireMaterial);
  wires.frustumCulled = false;
  group.add(wires);
  return { group, wires, towers: info.filter(i => i.H) };
}

/**
 * 窓の模様（壁の色に掛ける白地の模様）と、夜の窓明かりの模様（emissiveMap）。
 * cols × rows の窓を 1 枚に描く。lit はその割合の窓だけ夜に灯る
 */
export function windowTextures({ cols = 2, rows = 2, cell = 8, lit = 0.6, rnd = Math.random, frame = '#d8d8d4', glass = '#5a6a7e' } = {}) {
  const W = cols * cell, H = rows * cell;
  const [cv, g] = makeCanvas(W, H), [ce, ge] = makeCanvas(W, H);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cell + 2, y = r * cell + 2, w = cell - 4, h = cell - 3;
    g.fillStyle = frame; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = glass; g.fillRect(x, y, w, h);
    if (rnd() < lit) { ge.fillStyle = rnd() < 0.8 ? '#ffffff' : '#9fb8ff'; ge.fillRect(x, y, w, h); }
  }
  const map = pixelTex(cv, true), emissiveMap = pixelTex(ce, true);
  return { map, emissiveMap };
}

// 切妻屋根：底面 1×1（y = 0）、棟の高さ 1、棟は x 方向
function gableGeometry() {
  const P = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [0.5, 1, 0]];
  const tri = [[0, 4, 5], [0, 5, 1], [3, 2, 5], [3, 5, 4], [0, 3, 4], [1, 5, 2], [0, 1, 2], [0, 2, 3]];
  const pos = [];
  for (const t of tri) for (const i of t) pos.push(...P[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// 家並み（まとめ描き）：地面の種類が「町」の所に、小さな家を散らす
// ---------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {(x:number, z:number) => boolean} o.isTown   家を置いてよい場所
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {{x0:number, z0:number, x1:number, z1:number}} o.bounds
 * @param {THREE.Material} o.wallMaterial  vertexColors なしの素材（色はインスタンスごと）
 * @param {THREE.Material} o.roofMaterial
 * @param {() => number} o.rnd
 * @param {number} [o.cell]        置く間隔（m）
 * @param {number} [o.minDist]     原点からこれより近い所には置かない
 * @param {number} [o.clearance]   周り（4 方向）がこの距離まで町のときだけ置く（堤防のきわを空ける）
 */
export function createHouses({ isTown, heightAt, bounds, wallMaterial, roofMaterial, rnd, cell = 14, minDist = 60, maxDist = 1500, clearance = 8, wallColors, roofColors }) {
  const spots = [];
  for (let z = bounds.z0; z < bounds.z1; z += cell) {
    for (let x = bounds.x0; x < bounds.x1; x += cell) {
      const px = x + (rnd() - 0.5) * cell * 0.5, pz = z + (rnd() - 0.5) * cell * 0.5;
      const d = Math.hypot(px, pz);
      if (d < minDist || d > maxDist || !isTown(px, pz)) continue;
      // 周りの 4 方向も町なら置く（堤防のきわは空ける）
      const c = clearance;
      if (!isTown(px + c, pz) || !isTown(px - c, pz) || !isTown(px, pz + c) || !isTown(px, pz - c)) continue;
      spots.push([px, pz]);
    }
  }
  const n = spots.length;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), wallMaterial, n);
  const roofs = new THREE.InstancedMesh(gableGeometry(), roofMaterial, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, z], i) => {
    const tall = rnd() < 0.12;
    const w = 7 + rnd() * 5, d = 8 + rnd() * 6, h = tall ? 9 + rnd() * 9 : 5.5 + rnd() * 2;
    q.setFromAxisAngle(up, rnd() * Math.PI);
    const y = heightAt(x, z);
    walls.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(w, h, d)));
    walls.setColorAt(i, c.set(wallColors[(rnd() * wallColors.length) | 0]));
    // 屋根：低い家は切妻、高い建物は平らな屋根（小さく沈めて見せない）
    roofs.setMatrixAt(i, m.compose(p.set(x, y + h - (tall ? 0.5 : 0), z), q, s.set(w * 1.06, tall ? 0.01 : 2.4, d * 1.06)));
    roofs.setColorAt(i, c.set(roofColors[(rnd() * roofColors.length) | 0]));
  });
  for (const im of [walls, roofs]) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.castShadow = false; im.receiveShadow = true; }
  const group = new THREE.Group();
  group.add(walls, roofs);
  return { group, count: n };
}

// ---------------------------------------------------------------------------
// 大観覧車：車輪・スポーク・脚・ゴンドラ。ループ周期でちょうどゴンドラ 2 つ分まわるので、ループ動画でもつながる
// ---------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {{x:number, z:number, y:number}} o.at        足元の位置
 * @param {{x:number, z:number}} o.face                車輪の面を向ける先（見る人の位置）
 * @param {number} [o.height]   てっぺんの高さ（m）
 * @param {number} [o.diameter]
 * @param {number} [o.gondolas]
 * @param {{ frame: THREE.Material, gondola: THREE.Material, rim: THREE.Material }} o.materials  rim は夜に光らせる（emissive）
 */
export function createFerrisWheel({ at, face, height = 117, diameter = 111, gondolas = 68, materials, loop = 6 }) {
  const R = diameter / 2, hubY = height - R;
  const group = new THREE.Group();
  group.position.set(at.x, at.y, at.z);
  group.rotation.y = Math.atan2(face.x - at.x, face.z - at.z); // 組の +z（車輪の軸）を見る人に向ける
  // 脚：車輪の前後に A 字の脚
  const legs = new GeoBuilder();
  for (const zz of [-5, 5]) {
    for (const sx of [-1, 1]) legs.beam(V(sx * R * 0.42, 0, zz * 1.6), V(0, hubY, zz * 0.5), 1.6, 1.6);
    legs.beam(V(-R * 0.3, hubY * 0.28, zz * 1.4), V(R * 0.3, hubY * 0.28, zz * 1.4), 0.8, 0.8);
  }
  legs.box(V(0, hubY, 0), 4, 4, 12);
  const legMesh = new THREE.Mesh(legs.build(), materials.frame);
  legMesh.castShadow = true;
  group.add(legMesh);
  // 回る部分：前後 2 本の輪、スポーク
  const wheel = new THREE.Group();
  wheel.position.y = hubY;
  const frame = new GeoBuilder(), rim = new GeoBuilder();
  const n = gondolas;
  const P = (a, r, z) => V(Math.cos(a) * r, Math.sin(a) * r, z);
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
    for (const z of [-2.2, 2.2]) {
      rim.beam(P(a0, R, z), P(a1, R, z), 1.0, 1.0);
      frame.beam(P(a0, R * 0.93, z), P(a1, R * 0.93, z), 0.6, 0.6);
    }
    frame.beam(P(a0, R, -2.2), P(a0, R, 2.2), 0.5, 0.5);
    if (i % 2 === 0) for (const z of [-2.2, 2.2]) frame.beam(V(0, 0, z * 2.4), P(a0, R * 0.93, z), 0.35, 0.35);
  }
  const frameMesh = new THREE.Mesh(frame.build(), materials.frame);
  const rimMesh = new THREE.Mesh(rim.build(), materials.rim);
  wheel.add(frameMesh, rimMesh);
  group.add(wheel);
  // ゴンドラ：輪の外側に吊るす。向きはいつも上下そのまま
  const gGeo = new THREE.BoxGeometry(2.6, 2.6, 2.6).translate(0, -1.6, 0);
  const gond = new THREE.InstancedMesh(gGeo, materials.gondola, n);
  group.add(gond);
  // 遠くから見る大きな構造物は、部材が 1 ドットより細くなって消える（2 km 先では 1 ドット 約 15 m）。
  // そこで輪・スポーク・脚を 1 ドットの線、ゴンドラを点でも描く（どの距離でも 1 ドットは残る）
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe8e8e4 });
  const ring = [], legsL = [];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
    ring.push(Math.cos(a0) * R, Math.sin(a0) * R, 0, Math.cos(a1) * R, Math.sin(a1) * R, 0);
  }
  for (let i = 0; i < n; i += 2) { const a = i / n * Math.PI * 2; ring.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0); }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
  const ringLines = new THREE.LineSegments(ringGeo, lineMaterial);
  wheel.add(ringLines);
  for (const sx of [-1, 1]) legsL.push(sx * R * 0.42, 0, 0, 0, hubY, 0);
  const legGeo = new THREE.BufferGeometry();
  legGeo.setAttribute('position', new THREE.Float32BufferAttribute(legsL, 3));
  const legLines = new THREE.LineSegments(legGeo, lineMaterial);
  group.add(legLines);
  const gpGeo = new THREE.BufferGeometry();
  gpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pointMaterial = new THREE.PointsMaterial({ color: 0x9cc4e4, size: 1.5, sizeAttenuation: false });
  const gondPoints = new THREE.Points(gpGeo, pointMaterial);
  gondPoints.frustumCulled = false;
  group.add(gondPoints);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  // ループ周期でゴンドラ 2 つ分まわる：スポークは 2 つおきなので、6 秒後に輪・スポーク・ゴンドラがぴったり重なる（約 3.4 分で 1 周）
  const W = 2 * Math.PI * 2 / n / loop;
  const gp = gpGeo.attributes.position;
  function update(t) {
    const a = t * W;
    wheel.rotation.z = a;
    for (let i = 0; i < n; i++) {
      const ang = i / n * Math.PI * 2 + a;
      p.set(Math.cos(ang) * (R + 0.6), hubY + Math.sin(ang) * (R + 0.6), 0);
      gond.setMatrixAt(i, m.compose(p, q, s));
      gp.setXYZ(i, p.x, p.y - 1.6, p.z);
    }
    gond.instanceMatrix.needsUpdate = true;
    gp.needsUpdate = true;
  }
  update(0);
  // 法線パスで描かないもの（線・点に輪郭線が付かないように）
  return { group, update, wheel, lineMaterial, pointMaterial, thin: [ringLines, legLines, gondPoints] };
}
