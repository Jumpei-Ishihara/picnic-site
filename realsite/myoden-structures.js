// 妙典の岸の場面だけで使う形
//   createArchPipeBridge：妙典給水場の水管橋。手前（妙典の岸）は白い上路でないトラス、川の上は 3 つのアーチ（タイドアーチ。吊り材が縦に並ぶ）。
//     床の両側に太い白い水道管が 2 本。橋脚は白い円柱。写真（妙典の堤防から上流を見たもの）にもとづく。大きさは推定
//   stripeMaterial：高さで紅白に塗り分ける（送電線の鉄塔・煙突。航空障害の塗装）
import * as THREE from 'three';

/**
 * @param {object} o
 * @param {(p:object) => THREE.Material} o.toon
 * @param {{path:number[][], deckY:number, truss:number[], arches:number[][], girder:number[], rise:number, pipeR:number, width:number}} o.spec
 *   truss・arches・girder は、線の始まり（妙典の岸）からの距離 [始め, 終わり]（m）
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {number} o.level   水面の高さ
 */
export function createArchPipeBridge({ toon, spec, heightAt, level }) {
  const group = new THREE.Group();
  group.name = 'pipe-bridge';
  const [[x0, z0], [x1, z1]] = [spec.path[0], spec.path[spec.path.length - 1]];
  const L = Math.hypot(x1 - x0, z1 - z0);
  const ux = (x1 - x0) / L, uz = (z1 - z0) / L, vx = -uz, vz = ux;
  const P = (s, off = 0, y = spec.deckY) => new THREE.Vector3(x0 + ux * s + vx * off, y, z0 + uz * s + vz * off);
  const yaw = Math.atan2(-uz, ux);
  // 水道管は淡い水色（360° 写真で、陸側のトラスの下に見える）
  const white = toon({ color: '#eceeee' }), pale = toon({ color: '#b8d2e6' }), pier = toon({ color: '#e4e2dc' }), pipeMat = toon({ color: '#a8c8de' });
  const W = spec.width / 2;
  const parts = new Map();
  const push = (mat, geo) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo); };
  // 2 点を結ぶ細い角材
  const beam = (a, b, t, mat) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.BoxGeometry(t, t, len).translate(0, 0, len / 2);
    // lookAt(目, 先) の z 軸は「先から目」の向きなので、目を d・先を原点にして z を d の向きに
    const up = Math.abs(d.clone().normalize().y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), up);
    g.applyMatrix4(m).translate(a.x, a.y, a.z);
    push(mat, g);
  };
  // 水道管 2 本（陸側のトラスの始まりから全長）と床の桁
  const s0 = Math.min(0, spec.truss[0]);
  for (const off of [-W + spec.pipeR, W - spec.pipeR]) {
    const g = new THREE.CylinderGeometry(spec.pipeR, spec.pipeR, L - s0, 10).rotateZ(Math.PI / 2).rotateY(yaw)
      .translate(...P((L + s0) / 2, off, spec.deckY + spec.pipeR).toArray());
    push(pipeMat, g);
  }
  for (const off of [-W, W]) beam(P(s0, off), P(L, off), 0.5, white);
  // 手前のトラス（ワーレン。高さ 5 m）
  const [ta, tb] = spec.truss, TH = 6.5, panel = 9;
  for (const off of [-W, W]) {
    beam(P(ta, off, spec.deckY + TH), P(tb, off, spec.deckY + TH), 0.45, white);
    for (let s = ta, k = 0; s < tb - 0.1; s += panel, k++) {
      const s2 = Math.min(tb, s + panel);
      const [lo, hi] = k % 2 ? [s2, s] : [s, s2];
      beam(P(lo, off), P(hi, off, spec.deckY + TH), 0.35, white);
    }
  }
  for (let s = ta; s <= tb + 0.1; s += panel * 2) beam(P(s, -W, spec.deckY + TH), P(s, W, spec.deckY + TH), 0.3, white);
  // アーチ：2 本の弓（放物線）、縦の吊り材、弓どうしのつなぎ。最初のアーチは白、ほかは淡い水色
  spec.arches.forEach(([a, b], i) => {
    const mat = i === 0 ? white : pale;
    const span = b - a, rise = span * spec.rise, n = 16;
    const yAt = t => spec.deckY + rise * 4 * t * (1 - t);
    for (const off of [-W, W]) {
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        beam(P(a + span * t0, off, yAt(t0)), P(a + span * t1, off, yAt(t1)), 1.2, mat);
      }
      for (let s = 7; s < span - 6; s += 7) beam(P(a + s, off), P(a + s, off, yAt(s / span)), 0.25, mat);
    }
    for (let k = 3; k <= n - 3; k += 2) {
      const t = k / n;
      beam(P(a + span * t, -W, yAt(t)), P(a + span * t, W, yAt(t)), 0.35, mat);
    }
  });
  // 橋脚：白い円柱（トラスの両端・アーチの継ぎ目・陸の桁の下）
  const pierAt = [...(spec.trussPiers ?? [spec.truss[0]]), ...spec.arches.map(r => r[0]), spec.arches[spec.arches.length - 1][1], ...(spec.girder ?? [])];
  for (const s of [...new Set(pierAt.map(v => Math.round(v)))]) {
    const p = P(s, 0);
    const g0 = Math.max(level - 1.5, heightAt(p.x, p.z) - 0.5);
    const h = spec.deckY - 0.3 - g0;
    if (h < 0.5) continue;
    push(pier, new THREE.CylinderGeometry(1.4, 1.6, h, 12).translate(p.x, g0 + h / 2, p.z));
    push(pier, new THREE.BoxGeometry(2.4, 0.8, spec.width + 1.2).rotateY(yaw).translate(p.x, spec.deckY - 0.4, p.z));
  }
  for (const [mat, list] of parts) {
    const g = mergeGeos(list);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return { group };
}

function mergeGeos(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 高さで紅白に塗り分ける材質（場面の y で band m ごとに交互。from より上だけ）
 * @param {(p:object) => THREE.Material} toon
 */
export function stripeMaterial(toon, { red = '#c8463c', white = '#eceae4', band = 7, from = -100 } = {}) {
  const mat = toon({ color: '#ffffff' });
  const cr = new THREE.Color(red), cw = new THREE.Color(white);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRed = { value: cr }; sh.uniforms.uWhite = { value: cw };
    sh.vertexShader = 'varying float vStripeY;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vStripeY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = 'uniform vec3 uRed, uWhite; varying float vStripeY;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= (vStripeY > ${from.toFixed(1)} && mod(floor((vStripeY - ${from.toFixed(1)}) / ${band.toFixed(1)}), 2.0) < 0.5) ? uRed : uWhite;`);
  };
  mat.customProgramCacheKey = () => `stripe-${band}-${from}`;
  return mat;
}

// 位置・法線だけの形をまとめる（1 つの材質で描く）
function addMerged(group, list, mat, { shadow = true } = {}) {
  if (!list.length) return null;
  const m = new THREE.Mesh(mergeGeos(list), mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
// 2 点の間に置く箱（長さの向きを線に合わせる）
function boxAlong(ax, ay, az, bx, by, bz, w, h) {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.BoxGeometry(len, h, w);
  const yaw = Math.atan2(-(bz - az), bx - ax), pitch = Math.atan2(by - ay, Math.hypot(bx - ax, bz - az));
  g.rotateZ(pitch).rotateY(yaw).translate((ax + bx) / 2, (ay + by) / 2 + h / 2, (az + bz) / 2);
  return g;
}

/**
 * 東京メトロ東西線の車両基地（妙典）：砂利の上の線路、架線柱、堤防側の柵、止めてある電車
 * @param {{area:number[][], tracks:number[][][]}} o.yard
 */
export function createRailYard({ toon, yard, heightAt, rnd, near = null }) {
  const group = new THREE.Group();
  group.name = 'rail-yard';
  if (!yard?.tracks?.length) return { group };
  const inside = near ?? (() => true);
  const ballast = [], rails = [], poles = [], fence = [], mesh = [], bodies = [], bands = [];
  const H = (x, z) => heightAt(x, z);
  yard.tracks.forEach((line, ti) => {
    // 線を 4 m ごとに区切って、地面に沿わせる
    const pts = [];
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    }
    pts.push(line[line.length - 1]);
    let run = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      if (!inside(ax, az)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const ya = H(ax, az), yb = H(bx, bz);
      ballast.push(boxAlong(ax, ya - 0.05, az, bx, yb - 0.05, bz, 3.0, 0.12));
      for (const o of [-0.75, 0.75]) rails.push(boxAlong(ax + nx * o, ya + 0.07, az + nz * o, bx + nx * o, yb + 0.07, bz + nz * o, 0.08, 0.12));
      run += len;
      // 架線柱：3 本に 1 本の線に、約 48 m ごと
      if (ti % 3 === 0 && run > 48) {
        run = 0;
        const px = ax + nx * 2.2, pz = az + nz * 2.2, py = H(px, pz);
        poles.push(new THREE.BoxGeometry(0.3, 7.5, 0.3).translate(px, py + 3.75, pz));
        poles.push(boxAlong(px, py + 6.8, pz, ax - nx * 1.0, ya + 6.8, az - nz * 1.0, 0.15, 0.15));
      }
    }
  });
  // 止めてある電車（銀色に水色の帯、20 m の車両を 6 両）：長い線路 4 本に
  const long = yard.tracks.map(l => ({ l, L: l.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0) }))
    .filter(t => t.L > 160).sort((a, b) => b.L - a.L).slice(0, 7).filter((_, i) => i % 2 === 0);
  for (const { l, L } of long) {
    let s0 = 20 + rnd() * Math.max(1, L - 160);
    const at = s => {
      let acc = 0;
      for (let k = 0; k < l.length - 1; k++) {
        const seg = Math.hypot(l[k + 1][0] - l[k][0], l[k + 1][1] - l[k][1]);
        if (acc + seg >= s) { const t = (s - acc) / seg; return [l[k][0] + (l[k + 1][0] - l[k][0]) * t, l[k][1] + (l[k + 1][1] - l[k][1]) * t]; }
        acc += seg;
      }
      return l[l.length - 1];
    };
    for (let c = 0; c < 6; c++) {
      const [ax, az] = at(s0 + c * 20.5), [bx, bz] = at(s0 + c * 20.5 + 20);
      if (!inside(ax, az)) continue;
      const y = (H(ax, az) + H(bx, bz)) / 2 + 0.25;
      bodies.push(boxAlong(ax, y + 0.6, az, bx, y + 0.6, bz, 2.8, 3.1));
      bands.push(boxAlong(ax, y + 2.0, az, bx, y + 2.0, bz, 2.84, 0.35));
    }
  }
  // 柵：車両基地の範囲の縁に沿って、高さ 1.8 m の黒い柵（柱 3 m おきと横の棒）
  const A = yard.area ?? [];
  for (let k = 0; k < A.length - 1; k++) {
    const [ax, az] = A[k], [bx, bz] = A[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < len; s += 3) {
      const x = ax + (bx - ax) * s / len, z = az + (bz - az) * s / len;
      if (!inside(x, z)) continue;
      fence.push(new THREE.BoxGeometry(0.08, 1.8, 0.08).translate(x, H(x, z) + 0.9, z));
      const x2 = ax + (bx - ax) * Math.min(len, s + 3) / len, z2 = az + (bz - az) * Math.min(len, s + 3) / len;
      for (const hh of [0.2, 1.75]) fence.push(boxAlong(x, H(x, z) + hh, z, x2, H(x2, z2) + hh, z2, 0.05, 0.05));
      mesh.push(boxAlong(x, H(x, z) + 0.2, z, x2, H(x2, z2) + 0.2, z2, 0.02, 1.55)); // 網（向こうが透けて見える薄い板）
    }
  }
  addMerged(group, ballast, toon({ color: '#8a8478' }), { shadow: false });
  addMerged(group, rails, toon({ color: '#a8a6a2' }), { shadow: false });
  addMerged(group, poles, toon({ color: '#9aa0a4' }));
  addMerged(group, fence, toon({ color: '#2e3230' }));
  const net = addMerged(group, mesh, toon({ color: '#2e3230', transparent: true, opacity: 0.35, depthWrite: false }), { shadow: false });
  addMerged(group, bodies, toon({ color: '#c8ccd0' }));
  addMerged(group, bands, toon({ color: '#2a9ad8' }));
  return { group };
}

/**
 * 川につないである小舟（白い船体、半分ほどに小さな操舵室）。位置と向きは空中写真から
 * @param {number[][]} o.boats  [x, z, 向き（x 軸から）, 長さ]
 */
export function createBoats({ toon, boats, level, rnd }) {
  const group = new THREE.Group();
  group.name = 'boats';
  const hulls = [], cabins = [];
  for (const [x, z, ang, L] of boats ?? []) {
    const w = L * 0.32, yaw = -ang;
    const hull = new THREE.BoxGeometry(L * 0.8, 0.7, w).translate(-L * 0.1, 0.25, 0);
    const bow = new THREE.ConeGeometry(w * 0.5, L * 0.3, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).scale(1, 0.5, 1).translate(L * 0.45, 0.4, 0);
    for (const g of [hull, bow]) hulls.push(g.rotateY(yaw).translate(x, level, z));
    if (rnd() < 0.5) cabins.push(new THREE.BoxGeometry(L * 0.25, 1.0, w * 0.7).translate(-L * 0.15, 1.05, 0).rotateY(yaw).translate(x, level, z));
  }
  addMerged(group, hulls, toon({ color: '#eeeeea' }));
  addMerged(group, cabins, toon({ color: '#8fa8b8' }));
  return { group };
}
