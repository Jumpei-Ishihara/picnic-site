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
