// 遠景の影絵：方位・距離・高さから、見かけの大きさが正しくなるように遠くの板（輪）に立てる
//   tower   … 塔（スカイツリーのような細い塔。展望台 2 つとアンテナ）
//   hill    … 木の多い台地の稜線（span の方位の範囲）
//   skyline … 家並み・ビルの並び（span の方位の範囲）
// 色は時間帯で変える：遠いものほど空（地平線）の色に近く、太陽の側にあるものは逆光で暗い影絵に。
import * as THREE from 'three';
import { mulberry32 } from './pixel-kit.js';
import { bearingToDir } from './sun.js';

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {object[]} o.items          scene.json の landmarks.backdrop
 * @param {number} [o.upstreamBearing] 場面の -z の方位
 * @param {number} [o.radius]         影絵を立てる距離（場面の中景より外、空の球より内）
 * @param {number} [o.eyeY]           見る目の高さ（見かけの高さの基準）
 * @param {number} [o.baseY]          影絵の下端（地平線より少し下）
 * @param {number} [o.seed]
 */
export function createBackdrop({ scene, items, upstreamBearing = 0, radius = 1800, eyeY = 1.6, baseY = -4, seed = 7 }) {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const layers = [];
  const rnd = mulberry32(seed);
  const tmp = new THREE.Vector3();

  // 物ごとの輪の半径：実際に遠いものほど外側に（重なったとき近いものが手前に来るように）
  const radiusOf = dist => radius * (0.9 + 0.1 * Math.min(1, dist / 8000));
  // 実際の距離 dist にある高さ h の物の、半径 R での高さ（見かけの角度が同じになる）
  const scaleH = (h, dist, R) => (h - eyeY) * R / dist + eyeY;
  const at = (b, R, out = new THREE.Vector3()) => bearingToDir(b, 0, upstreamBearing, out).multiplyScalar(R);

  for (const it of items) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x888888, fog: false });
    let mesh;
    if (it.kind === 'tower') mesh = towerMesh(it, mat);
    else if (it.kind === 'hill') mesh = ridgeMesh(it, mat, 'hill');
    else mesh = ridgeMesh(it, mat, 'skyline');
    mesh.name = 'backdrop-' + it.id;
    group.add(mesh);
    // 遠いほど空に溶ける（8 km でかなり淡く、400 m ではほぼ地の色）
    const haze = Math.min(0.85, Math.max(0.15, Math.log10(Math.max(it.dist, 100) / 100) * 0.45));
    const span = it.span ?? [it.bearing - 1, it.bearing + 1];
    const mid = (span[0] + span[1] + (span[1] < span[0] ? 360 : 0)) / 2;
    layers.push({ it, mat, haze, dir: bearingToDir(mid, 0, upstreamBearing) });
  }
  scene.add(group);

  function towerMesh(it, mat) {
    const R = radiusOf(it.dist);
    const H = scaleH(it.height, it.dist, R) - baseY;
    const k = R / it.dist; // 実際の 1 m がここで何 m か
    const parts = [];
    const add = (geo, y) => { geo.translate(0, y, 0); parts.push(geo); };
    // 足元は三角、上へ行くほど細い円筒（スカイツリーの形を簡略化）
    add(new THREE.CylinderGeometry(9 * k, 34 * k, H * 0.55, 6, 1, true), H * 0.275);
    add(new THREE.CylinderGeometry(6 * k, 9 * k, H * 0.25, 6, 1, true), H * 0.55 + H * 0.125);
    add(new THREE.CylinderGeometry(19 * k, 17 * k, 18 * k, 8), H * 0.55);   // 第1展望台（350 m）
    add(new THREE.CylinderGeometry(12 * k, 11 * k, 12 * k, 8), H * 0.72);   // 第2展望台（450 m）
    add(new THREE.CylinderGeometry(2.5 * k, 4 * k, H * 0.2, 4, 1, true), H * 0.8 + H * 0.1);
    const geo = mergeGeos(parts);
    const m = new THREE.Mesh(geo, mat);
    at(it.bearing, R, m.position);
    m.position.y = baseY;
    return m;
  }

  // 方位の範囲に沿った帯。上の縁を、台地なら木のこぶ、家並みなら四角い建物の段々に
  function ridgeMesh(it, mat, style) {
    const [b0, b1raw] = it.span;
    const b1 = b1raw < b0 ? b1raw + 360 : b1raw;
    const R = radiusOf(it.dist);
    const H = scaleH(it.height + (style === 'hill' ? 2 : 0), it.dist, R) - baseY;
    const stepDeg = 0.25;
    const pts = [];
    let roof = H, left = 0;
    for (let b = b0; b <= b1 + 1e-6; b += stepDeg) {
      let h;
      const edge = Math.min(1, (b - b0) / 3, (b1 - b) / 3); // 端はなだらかに下げる
      if (style === 'hill') {
        h = H * (0.75 + 0.18 * Math.sin(b * 0.9) + rnd() * 0.12) * (0.4 + 0.6 * edge);
      } else {
        if (left <= 0) { roof = H * (0.35 + rnd() * rnd() * 1.4); left = 1 + (rnd() * 4 | 0); }
        left--;
        h = roof * (0.5 + 0.5 * edge);
      }
      pts.push([b, h]);
    }
    // 下端と上端の点の組を方位の順に並べ、隣どうしを四角でつなぐ。
    // 家並みは高さが変わる所に同じ高さの組をもう 1 つ足して、段差を垂直にする
    const pos = [];
    const pair = (b, h) => { const p = at(b, R, tmp); pos.push(p.x, baseY, p.z, p.x, baseY + h, p.z); };
    pts.forEach(([b, h], i) => {
      pair(b, h);
      if (style === 'skyline' && i < pts.length - 1 && pts[i + 1][1] !== h) pair(b + stepDeg * 0.999, h);
    });
    const idx = [];
    for (let a = 0; a + 3 < pos.length / 3; a += 2) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat);
    m.material.side = THREE.DoubleSide;
    return m;
  }

  const cHor = new THREE.Color(), cDark = new THREE.Color(), cLand = new THREE.Color();
  return {
    group,
    /**
     * 毎フレーム（または時刻が変わったとき）：空の色と太陽の向きから影絵の色を決める
     * @param {{ horizon: THREE.Color, top: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, night: number }} env
     * @param {THREE.Vector3} [cameraPos]  影絵の輪をカメラについて動かす（広い場面で歩いても遠景がずれない）
     */
    update({ horizon, top, sunDir, night }, cameraPos) {
      if (cameraPos) group.position.set(cameraPos.x, 0, cameraPos.z);
      for (const l of layers) {
        // 太陽の側（逆光）ほど暗く、空の色とのコントラストが強い
        const back = Math.max(0, l.dir.dot(tmp.set(sunDir.x, 0, sunDir.z).normalize())) * Math.max(0, 1 - sunDir.y * 2.5);
        cHor.copy(horizon).lerp(top, 0.25);
        cLand.set(l.it.kind === 'hill' ? 0x3c5a3a : 0x6a6e7c).multiplyScalar(1 - night * 0.75);
        cDark.copy(cHor).multiplyScalar(0.35 + 0.15 * (1 - night));
        const base = cLand.lerp(cDark, back * 0.8);
        l.mat.color.copy(base).lerp(cHor, l.haze * (1 - back * 0.5));
      }
    }
  };
}

// 位置だけの BufferGeometry をまとめる
function mergeGeos(geos) {
  const pos = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const ng = g.index ? g : g.toNonIndexed();
    const p = ng.attributes.position.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    if (ng.index) for (const i of ng.index.array) idx.push(i + off);
    else for (let i = 0; i < p.length / 3; i++) idx.push(i + off);
    off += p.length / 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
