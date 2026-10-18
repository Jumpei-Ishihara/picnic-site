// なぎさ公園の施設：魔法の文学館（カフェ・キキ）、なぎさポニーランド（柵の中を周回するポニー）、ヤギのふれあいコーナー
// 形と位置は scene.json の facilities（OSM・空中写真・公式の案内から。docs/NAGISA_DESIGN.md 7 章）
// 動くもの（ポニー・人・ヤギ）はループ周期で元に戻る：ポニーは 5 頭が等間隔で、6 秒でちょうど 1 頭分進む
import * as THREE from 'three';
import { GeoBuilder } from '../engine/structures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// 人（立つ・歩く・馬に乗る）。脚は腰を軸に振る
// ---------------------------------------------------------------------------
export function makePerson(toon, { height = 1.65, shirt = '#3a5a8a', pants = '#3a3a44', skin = '#e8c4a0', hat = null, seated = false } = {}) {
  const k = height / 1.65;
  const g = new THREE.Group();
  const legMat = toon({ color: pants }), body = toon({ color: shirt }), face = toon({ color: skin });
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.09 * k, 0.8 * k, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13 * k, 0.8 * k, 0.15 * k).translate(0, -0.4 * k, 0), legMat);
    if (seated) { pivot.rotation.x = -1.2; pivot.position.x = s * 0.2 * k; }
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36 * k, 0.55 * k, 0.22 * k).translate(0, 1.08 * k, 0), body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22 * k, 0.24 * k, 0.22 * k).translate(0, 1.5 * k, 0), face);
  g.add(torso, head);
  if (hat) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25 * k, 0.1 * k, 0.25 * k).translate(0, 1.66 * k, 0), toon({ color: hat })));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, legs };
}

// 四つ足（ポニー・ヤギ）。体の長さ len、肩の高さ h
function makeQuadruped(toon, { len = 1.4, h = 1.1, color = '#8a5a3a', mane = '#3a2a20', saddle = null }) {
  const g = new THREE.Group();
  const coat = toon({ color }), dark = toon({ color: mane });
  const legH = h * 0.55, bodyH = h * 0.42;
  const body = new THREE.Mesh(new THREE.BoxGeometry(len * 0.32, bodyH, len).translate(0, legH + bodyH / 2, 0), coat);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(len * 0.18, h * 0.42, len * 0.2), coat);
  neck.position.set(0, legH + bodyH + h * 0.12, -len * 0.48);
  neck.rotation.x = -0.5;
  const head = new THREE.Mesh(new THREE.BoxGeometry(len * 0.16, h * 0.2, len * 0.32), coat);
  head.position.set(0, legH + bodyH + h * 0.3, -len * 0.66);
  const maneM = new THREE.Mesh(new THREE.BoxGeometry(len * 0.05, h * 0.36, len * 0.16), dark);
  maneM.position.set(0, legH + bodyH + h * 0.16, -len * 0.44);
  maneM.rotation.x = -0.5;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(len * 0.06, h * 0.4, len * 0.06).translate(0, -h * 0.2, 0), dark);
  tail.position.set(0, legH + bodyH * 0.9, len * 0.5);
  tail.rotation.x = 0.3;
  g.add(body, neck, head, maneM, tail);
  if (saddle) {
    const sd = new THREE.Mesh(new THREE.BoxGeometry(len * 0.36, h * 0.06, len * 0.32), toon({ color: saddle }));
    sd.position.set(0, legH + bodyH + 0.02, -len * 0.05);
    g.add(sd);
  }
  const legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * len * 0.11, legH, sz * len * 0.38);
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(len * 0.08, legH, len * 0.08).translate(0, -legH / 2, 0), coat));
    g.add(pivot);
    legs.push(pivot);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, legs, head, tail, saddleY: legH + bodyH + 0.05 };
}

// ---------------------------------------------------------------------------
// 魔法の文学館：白い建物（OSM の花の形の平面）、3 階のガラスの帯（カフェ・キキ）、花びらのように広がる屋根
// ---------------------------------------------------------------------------
export function createMuseum({ toon, museum, heightAt }) {
  const group = new THREE.Group();
  const fp = museum.footprint;
  const base = museum.baseY - 1.5; // 斜面に建つので、低い側より少し下から立てる
  const H = museum.height;
  const white = toon({ color: '#f2f0ea' });
  const glassMat = toon({ color: '#9aaab4', emissive: 0xff8fa8, emissiveIntensity: 0 }); // 夜は館内の「いちご色」が透ける
  glassMat.userData.lampMax = 1.3;
  const shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
  // 壁（1・2 階）と、3 階のガラスの帯（カフェ）、3 階の上の白い帯
  const cafeY = museum.cafeFloorY;
  const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: cafeY - base, bevelEnabled: false }).rotateX(-Math.PI / 2), white);
  wall.position.y = base;
  const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false }).rotateX(-Math.PI / 2), glassMat);
  glass.position.y = cafeY;
  glass.scale.set(0.985, 1, 0.985);
  // 中心に寄せて縮めるため、平面の重心を原点にしてから戻す
  const cx = museum.x, cz = museum.z;
  glass.geometry.translate(-cx, 0, -cz);
  glass.position.x = cx; glass.position.z = cz;
  const top = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }).rotateX(-Math.PI / 2), white);
  top.position.y = cafeY + 2.6;
  for (const m of [wall, glass, top]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  // フラワールーフ：平面の外側に張り出した角（花びらの先）ごとに、中心から外へ反り上がる白い板
  const roofTop = cafeY + 3.6;
  const outer = fp.map(([x, z]) => ({ x, z, r: Math.hypot(x - cx, z - cz), a: Math.atan2(z - cz, x - cx) }));
  const meanR = outer.reduce((s, p) => s + p.r, 0) / outer.length;
  const tips = outer.filter((p, i) => p.r > meanR * 1.05 && p.r >= outer[(i + 1) % outer.length].r && p.r >= outer[(i - 1 + outer.length) % outer.length].r);
  const roof = new GeoBuilder();
  const petals = [];
  for (const p of tips) {
    const reach = p.r + 4.0; // 軒の出 4 m（花びらが外へ大きく広がる）
    const half = Math.min(0.55, Math.PI / Math.max(4, tips.length));
    const pt = (a, r, y) => V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    // 花びら：中心 → 両わき → 先端。先が少し上に反る
    const c0 = pt(p.a, 1.0, roofTop + 0.6), l = pt(p.a - half, reach * 0.6, roofTop - 0.6), r = pt(p.a + half, reach * 0.6, roofTop - 0.6), tip = pt(p.a, reach, roofTop + 1.0);
    petals.push([c0, l, tip], [c0, tip, r]);
    roof.beam(c0, tip, 0.25, 0.25); // 花びらの芯（厚み）
  }
  const pos = [];
  for (const [a, b, c] of petals) pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  petalGeo.computeVertexNormals();
  const roofMat = toon({ color: '#f6f4ee', side: THREE.DoubleSide });
  const petalMesh = new THREE.Mesh(petalGeo, roofMat);
  const coreMesh = new THREE.Mesh(roof.build(), roofMat);
  for (const m of [petalMesh, coreMesh]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  // カフェのテラス（川側）：床と手すり
  const t = museum.terrace;
  const dir = V(Math.sin(t.bearing * Math.PI / 180), 0, -Math.cos(t.bearing * Math.PI / 180)); // 場面の -z が北
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 3), white);
  deck.position.set(t.x + dir.x * 1.2, cafeY - 0.12, t.z + dir.z * 1.2);
  deck.rotation.y = Math.atan2(-dir.z, dir.x) + Math.PI / 2;
  // 手すり：細い柱と上の横木（ガラスの手すりは、ドット絵では面に見えて景色をふさぐので線で）
  const railB = new GeoBuilder();
  const side = V(-dir.z, 0, dir.x);
  const rc = V(t.x + dir.x * 2.6, cafeY, t.z + dir.z * 2.6);
  for (let k = -3; k <= 3; k++) railB.beam(rc.clone().addScaledVector(side, k), rc.clone().addScaledVector(side, k).add(V(0, 1.0, 0)), 0.05, 0.05);
  railB.beam(rc.clone().addScaledVector(side, -3).add(V(0, 1.0, 0)), rc.clone().addScaledVector(side, 3).add(V(0, 1.0, 0)), 0.06, 0.06);
  const rail = new THREE.Mesh(railB.build(), white);
  for (const m of [deck, rail]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  rail.position.set(0, 0, 0);
  return { group, nightLights: [glassMat], petals: tips.length, cafeY, contains: (x, z) => pointInPoly(x, z, fp) };
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < xi + (z - zi) * (xj - xi) / (zj - zi)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// なぎさポニーランド：円い馬場、外の柵（檻のような縦の格子）、内側の柵、中央の小屋根、周回するポニー
// ---------------------------------------------------------------------------
export function createPonyRing({ toon, ring, heightAt, loop = 6, gateToward }) {
  const group = new THREE.Group();
  const { x: cx, z: cz, rIn, rOut, fenceR, centerR } = ring;
  const y0 = heightAt(cx, cz);
  // 走路（土の輪）：地形に沿わせて少し浮かせる
  const track = new THREE.RingGeometry(rIn, rOut, 48, 2).rotateX(-Math.PI / 2);
  const tp = track.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(cx + tp.getX(i), cz + tp.getZ(i)) - y0 + 0.04);
  track.computeVertexNormals();
  const trackMesh = new THREE.Mesh(track, toon({ color: '#b8956a' }));
  trackMesh.position.set(cx, y0, cz);
  trackMesh.receiveShadow = true;
  group.add(trackMesh);
  // 外の柵：門（幅 2.4 m）を gateToward の方に開ける
  const gateA = gateToward ? Math.atan2(gateToward.z - cz, gateToward.x - cx) : Math.PI / 2;
  const gateHalf = 1.2 / fenceR;
  const angDiff = a => Math.abs(Math.atan2(Math.sin(a - gateA), Math.cos(a - gateA)));
  const fence = new GeoBuilder(), inner = new GeoBuilder();
  const P = (a, r, y) => { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; return V(x, heightAt(x, z) + y, z); };
  const nBars = Math.round(2 * Math.PI * fenceR / 0.22);
  for (let i = 0; i < nBars; i++) {
    const a = i / nBars * Math.PI * 2;
    if (angDiff(a) < gateHalf) continue;
    fence.beam(P(a, fenceR, 0), P(a, fenceR, 1.3), i % 9 === 0 ? 0.1 : 0.04, i % 9 === 0 ? 0.1 : 0.04); // 縦の格子（9 本ごとに太い柱）
    const a1 = (i + 1) / nBars * Math.PI * 2;
    if (angDiff(a1) < gateHalf) continue;
    for (const y of [0.15, 1.3]) fence.beam(P(a, fenceR, y), P(a1, fenceR, y), 0.06, 0.06); // 上下の横桟
  }
  // 内側の低い柵（走路の内縁）と、中央の柱と八角の小屋根
  const nIn = 24;
  for (let i = 0; i < nIn; i++) {
    const a = i / nIn * Math.PI * 2, a1 = (i + 1) / nIn * Math.PI * 2;
    inner.beam(P(a, rIn - 0.1, 0), P(a, rIn - 0.1, 0.8), 0.08, 0.08);
    inner.beam(P(a, rIn - 0.1, 0.8), P(a1, rIn - 0.1, 0.8), 0.06, 0.06);
  }
  inner.beam(V(cx, y0, cz), V(cx, y0 + 2.8, cz), 0.25, 0.25);
  const fenceMesh = new THREE.Mesh(fence.build(), toon({ color: '#3f6a4a' }));
  const innerMesh = new THREE.Mesh(inner.build(), toon({ color: '#8a6a4a' }));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(centerR + 0.4, 0.9, 8), toon({ color: '#e0b84a' }));
  roof.position.set(cx, y0 + 3.2, cz);
  for (const m of [fenceMesh, innerMesh, roof]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  // ポニー 5 頭（同じ姿）：引く人と、乗る子ども。反時計回り（上から見て）
  const N = ring.ponies ?? 5;
  const rTrack = (rIn + rOut) / 2;
  const units = [];
  for (let i = 0; i < N; i++) {
    const pony = makeQuadruped(toon, { len: 1.35, h: 1.05, color: '#8a5a3a', mane: '#3a2a20', saddle: '#b8463f' });
    const handler = makePerson(toon, { height: 1.65, shirt: '#2f5a3a', pants: '#3a3a44', hat: '#2f5a3a' });
    const rider = makePerson(toon, { height: 1.15, shirt: '#f2c94c', pants: '#3a5a8a', hat: '#f4f4f2', seated: true });
    rider.group.position.y = pony.saddleY - 0.62;
    pony.group.add(rider.group);
    group.add(pony.group, handler.group);
    units.push({ pony, handler, rider });
  }
  const W0 = Math.PI * 2 / loop;
  const omega = Math.PI * 2 / N / loop; // 6 秒で 1 頭分（約 1.6 m/s の並足）
  return {
    group, units, rTrack,
    /**
     * @param {number} t      ループで折り返した時刻
     * @param {boolean} riding 乗馬の時間か（それ以外は輪の上に止まって休む）
     */
    update(t, riding) {
      const a0 = riding ? t * omega : 0;
      for (let i = 0; i < N; i++) {
        const u = units[i];
        const a = i / N * Math.PI * 2 + a0;
        const x = cx + Math.cos(a) * rTrack, z = cz + Math.sin(a) * rTrack;
        // 進む向き（反時計回り＝角度が増える向き）の接線。組の -z が頭
        const tx = -Math.sin(a), tz = Math.cos(a);
        const yaw = Math.atan2(-tx, -tz);
        u.pony.group.position.set(x, heightAt(x, z), z);
        u.pony.group.rotation.y = yaw;
        // 引く人：ポニーの内側（輪の中心より）・頭の横
        const hx = cx + Math.cos(a + 0.06) * (rTrack - 0.8), hz = cz + Math.sin(a + 0.06) * (rTrack - 0.8);
        u.handler.group.position.set(hx, heightAt(hx, hz), hz);
        u.handler.group.rotation.y = yaw;
        u.rider.group.visible = riding;
        u.handler.group.visible = riding;
        // 歩き：脚を振る（6 秒に 8 歩）、首を上下、乗る子どもが揺れる
        const s = riding ? Math.sin(t * W0 * 8) : 0;
        u.pony.legs.forEach((l, k) => { l.rotation.x = (k === 0 || k === 3 ? s : -s) * 0.35; });
        u.pony.head.position.y = u.pony.saddleY + 0.28 + (riding ? Math.abs(Math.sin(t * W0 * 8)) * 0.04 : Math.sin(t * W0) * 0.02);
        u.pony.tail.rotation.z = Math.sin(t * W0 * 2 + i) * 0.15;
        u.rider.group.position.y = u.pony.saddleY - 0.62 + Math.abs(s) * 0.03;
        u.handler.legs.forEach((l, k) => { l.rotation.x = (k ? s : -s) * 0.45; });
      }
    }
  };
}

// ヤギのふれあいコーナー：低い木の柵と白いヤギ 2 頭（草を食べるように首を上下）
export function createGoatPen({ toon, pen, heightAt, loop = 6 }) {
  const group = new THREE.Group();
  const f = new GeoBuilder();
  const { x, z, w, d } = pen;
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 1.5);
    for (let i = 0; i <= n; i++) {
      const px = x + ax + (bx - ax) * i / n, pz = z + az + (bz - az) * i / n;
      f.beam(V(px, heightAt(px, pz), pz), V(px, heightAt(px, pz) + 1.0, pz), 0.1, 0.1);
    }
    for (const y of [0.45, 0.95]) f.beam(V(x + ax, heightAt(x + ax, z + az) + y, z + az), V(x + bx, heightAt(x + bx, z + bz) + y, z + bz), 0.07, 0.07);
  }
  const fm = new THREE.Mesh(f.build(), toon({ color: '#8a6a4a' }));
  fm.castShadow = true;
  group.add(fm);
  const goats = [[-1.5, 0.5, 0.4], [1.6, -0.8, 2.2]].map(([gx, gz, yaw]) => {
    const g = makeQuadruped(toon, { len: 0.8, h: 0.62, color: '#f2f0ea', mane: '#d8d4cc' });
    g.group.position.set(x + gx, heightAt(x + gx, z + gz), z + gz);
    g.group.rotation.y = yaw;
    group.add(g.group);
    return g;
  });
  const W0 = Math.PI * 2 / loop;
  return {
    group,
    update(t) {
      goats.forEach((g, i) => {
        const dip = (Math.sin(t * W0 + i * 2) + 1) / 2; // 草を食べる：頭を下げる
        g.head.position.y = g.saddleY + 0.2 - dip * 0.35;
        g.tail.rotation.z = Math.sin(t * W0 * 3 + i) * 0.3;
      });
    }
  };
}

// 馬場の門の前で順番を待つ親子（止まって立つ。少し体を揺らす）
export function createQueue({ toon, at, toward, heightAt, loop = 6 }) {
  const group = new THREE.Group();
  const people = [
    { h: 1.62, shirt: '#c86a5a', pants: '#3a3a44' }, { h: 1.05, shirt: '#7ab0d8', pants: '#3a5a8a', hat: '#f2c94c' },
    { h: 1.7, shirt: '#e8e2d0', pants: '#5a5a62' }, { h: 1.15, shirt: '#e88a8e', pants: '#3a3a44' },
    { h: 0.95, shirt: '#8ac35b', pants: '#3a5a8a', hat: '#f4f4f2' }
  ];
  const dir = V(toward.x - at.x, 0, toward.z - at.z).normalize();
  const side = V(-dir.z, 0, dir.x);
  const yaw = Math.atan2(-dir.x, -dir.z);
  const list = people.map((p, i) => {
    const m = makePerson(toon, { height: p.h, shirt: p.shirt, pants: p.pants, hat: p.hat });
    const px = at.x - dir.x * i * 0.8 + side.x * (i % 2 ? 0.35 : -0.2), pz = at.z - dir.z * i * 0.8 + side.z * (i % 2 ? 0.35 : -0.2);
    m.group.position.set(px, heightAt(px, pz), pz);
    m.group.rotation.y = yaw;
    group.add(m.group);
    return m;
  });
  const W0 = Math.PI * 2 / loop;
  return { group, update(t) { list.forEach((m, i) => { m.group.rotation.z = Math.sin(t * W0 + i * 1.3) * 0.03; }); } };
}

// ---------------------------------------------------------------------------
// 旧江戸川の護岸の壁（胸の高さのコンクリート）。scene.json の facilities.seawall の線に沿って
// ---------------------------------------------------------------------------
export function createSeawall({ toon, line, heightAt, height = 1.1, thick = 0.45, minY = -1.5 }) {
  const b = new GeoBuilder();
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i], [x1, z1] = line[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01 || len > 9) continue; // 線が途切れている所はつながない
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const y = heightAt(mx, mz); // 歩く面（遊歩道）の高さから
    if (y < minY) continue; // 水の上（地面が水面に近い所）には立てない
    b.box(V(mx, y + height / 2 - 0.2, mz), len + 0.3, height + 0.4, thick, Math.atan2(-(z1 - z0), x1 - x0));
  }
  const m = new THREE.Mesh(b.build(), toon({ color: '#bdb8ac' }));
  m.castShadow = m.receiveShadow = true;
  return { group: m };
}

// ---------------------------------------------------------------------------
// 遊具広場：砂の広場の中に、とりでのような組み合わせ遊具（塔・すべり台・屋根）、ブランコ、うんてい。種類と配置は推定
// ---------------------------------------------------------------------------
export function createPlayground({ toon, pg, heightAt, loop = 6 }) {
  const group = new THREE.Group();
  const y = (x, z) => heightAt(x, z);
  const red = toon({ color: '#c8463f' }), yellow = toon({ color: '#e8c84a' }), blue = toon({ color: '#3f6ab8' }), green = toon({ color: '#4f9a4a' }), wood = toon({ color: '#9a7048' });
  const meshes = [];
  const box = (mat, w, h, d, x, z, yy, yaw = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y(x, z) + yy, z);
    m.rotation.y = yaw;
    group.add(m);
    meshes.push(m);
    return m;
  };
  const cx = pg.x, cz = pg.z;
  // 組み合わせ遊具：塔 2 つ（床 2 m・1.4 m）を橋でつなぎ、すべり台
  for (const [dx, dz, h] of [[-3, -2, 2.0], [2, -2, 1.4]]) {
    for (const [px, pz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) box(wood, 0.15, h + 1.2, 0.15, cx + dx + px, cz + dz + pz, (h + 1.2) / 2);
    box(yellow, 2, 0.15, 2, cx + dx, cz + dz, h);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.0, 4), dx < 0 ? red : blue);
    roof.position.set(cx + dx, y(cx + dx, cz + dz) + h + 1.7, cz + dz);
    roof.rotation.y = Math.PI / 4;
    group.add(roof); meshes.push(roof);
  }
  box(green, 3, 0.12, 0.9, cx - 0.5, cz - 2, 1.75);                                    // 橋
  const slide = box(red, 0.8, 0.1, 3.4, cx - 3, cz + 0.3, 1.0);                         // すべり台（塔の床 2 m から地面へ）
  slide.rotation.x = 0.62;
  // ブランコ（2 人乗り）：A 字の柱と横木、つり下がった座板
  const sx = cx + 5, sz = cz + 4;
  for (const s of [-1.6, 1.6]) {
    for (const t of [-0.6, 0.6]) {
      const leg = box(blue, 0.12, 2.5, 0.12, sx + s, sz + t * 0.9, 1.2);
      leg.rotation.x = t * 0.45;
    }
  }
  box(blue, 3.4, 0.12, 0.12, sx, sz, 2.4);
  const seats = [-0.7, 0.7].map(o => {
    const pivot = new THREE.Group();
    pivot.position.set(sx + o, y(sx, sz) + 2.4, sz);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 0.04).translate(0, -0.95, 0), toon({ color: '#5a5a62' }));
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.25).translate(0, -1.95, 0), yellow);
    pivot.add(rope, seat);
    group.add(pivot); meshes.push(rope, seat);
    return pivot;
  });
  // うんてい（はしごの横棒）
  for (let k = 0; k < 7; k++) box(green, 0.06, 0.06, 1.2, cx + 1 + k * 0.45, cz + 5, 2.0);
  for (const e of [0, 2.7]) for (const t of [-0.6, 0.6]) box(green, 0.1, 2.0, 0.1, cx + 1 + e, cz + 5 + t, 1.0);
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
  const W0 = Math.PI * 2 / loop;
  return {
    group,
    // ブランコが風で少しゆれる（6 秒周期）
    update(t) { seats.forEach((p, i) => { p.rotation.x = Math.sin(t * W0 + i * 2) * 0.06; }); }
  };
}

// ---------------------------------------------------------------------------
// ツツジ山：丘の斜面の低い株（10 月なので花はなく、濃い緑の丸い茂み）。株の群れごとに 3 株、まとめ描き
// ---------------------------------------------------------------------------
export function createAzaleas({ toon, clumps, heightAt, seed = 9 }) {
  let a = seed;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const n = clumps.length * 3;
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon({ color: '#ffffff', flatShading: true }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const greens = ['#355a2c', '#3f6a32', '#2f5228', '#4a7238'];
  let k = 0;
  for (const [x, z, r] of clumps) {
    for (let i = 0; i < 3; i++) {
      const ang = i / 3 * Math.PI * 2 + rnd(), d = r * 0.7;
      const bx = x + Math.cos(ang) * d, bz = z + Math.sin(ang) * d, br = r * (0.55 + rnd() * 0.25);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6);
      im.setMatrixAt(k, m.compose(p.set(bx, heightAt(bx, bz) + br * 0.35, bz), q, s.set(br, br * 0.62, br)));
      im.setColorAt(k, c.set(greens[(rnd() * greens.length) | 0]));
      k++;
    }
  }
  im.instanceMatrix.needsUpdate = true;
  im.instanceColor.needsUpdate = true;
  im.castShadow = im.receiveShadow = true;
  return { group: im, count: n };
}
