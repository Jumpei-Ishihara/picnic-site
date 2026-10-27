// なぎさ公園の施設：魔法の文学館（カフェ・キキ）、なぎさポニーランド（柵の中を周回するポニー）、ヤギのふれあいコーナー
// 形と位置は scene.json の facilities（OSM・空中写真・公式の案内から。docs/NAGISA_DESIGN.md 7 章）
// 周回ポニーは同じ姿で等間隔。6秒で1頭分進み、風景としてつながる。
import * as THREE from 'three';
import { GeoBuilder } from '../engine/structures.js';
import { createPony, sampleWalk, createTrackGround } from './pony.js';

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
  // 丘の芝に面した壁の大きな窓：いちご色の枠と、中の赤（実際の写真。館内の色）。平面の辺のうち、外向きが南西にいちばん近い所
  {
    let best = null;
    for (let i = 0; i < fp.length; i++) {
      const [ax, az] = fp[i], [bx, bz] = fp[(i + 1) % fp.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 6) continue;
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (pointInPoly(mx + nx * 0.5, mz + nz * 0.5, fp)) { nx = -nx; nz = -nz; }
      const score = nx * -0.707 + nz * 0.707; // 南西（-x, +z）
      if (!best || score > best.score) best = { score, mx, mz, nx, nz, len };
    }
    if (best) {
      const yaw = Math.atan2(best.nx, best.nz); // 箱の薄い向き（z）を壁の外向きに
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.4, 0.3).translate(0, cafeY + 0.4 + 1.7, 0), toon({ color: '#d8304a' }));
      const inner = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.8, 0.32).translate(0, cafeY + 0.4 + 1.7, 0), toon({ color: '#a8203a', emissive: 0xff8fa8, emissiveIntensity: 0 }));
      inner.material.userData.lampMax = 1.0;
      for (const m of [frame, inner]) { m.position.set(best.mx + best.nx * 0.12, 0, best.mz + best.nz * 0.12); m.rotation.y = yaw; group.add(m); }
      glassMat.userData.extra = inner.material;
    }
  }
  return { group, nightLights: [glassMat, ...(glassMat.userData.extra ? [glassMat.userData.extra] : [])], petals: tips.length, cafeY, contains: (x, z) => pointInPoly(x, z, fp) };
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
// style：'bars' は縦格子の柵（もとの作り）、'white' は白い 2 段の横木の丸い柵（なぎさポニーランドの写真の丸い馬場）
export function createPonyRing({ toon, ring, heightAt, loop = 6, gateToward, style = 'bars' }) {
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
  const groundAt = createTrackGround(trackMesh,heightAt);
  // 外の柵：門（幅 2.4 m）を gateToward の方に開ける
  const gateA = gateToward ? Math.atan2(gateToward.z - cz, gateToward.x - cx) : Math.PI / 2;
  const gateHalf = fenceR > 0 ? 1.2 / fenceR : 0;
  const angDiff = a => Math.abs(Math.atan2(Math.sin(a - gateA), Math.cos(a - gateA)));
  const fence = new GeoBuilder(), inner = new GeoBuilder();
  const P = (a, r, y) => { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; return V(x, heightAt(x, z) + y, z); };
  const nBars = style === 'white' || style === 'none' ? 0 : Math.round(2 * Math.PI * fenceR / 0.22);
  if (style === 'white') {
    // 白い柵：柱 2 m おき、横木 2 段（高さ 0.55 m と 1.05 m）
    const nPost = Math.max(8, Math.round(2 * Math.PI * fenceR / 2));
    for (let i = 0; i < nPost; i++) {
      const a = i / nPost * Math.PI * 2, a1 = (i + 1) / nPost * Math.PI * 2;
      if (angDiff(a) < gateHalf) continue;
      fence.beam(P(a, fenceR, 0), P(a, fenceR, 1.15), 0.12, 0.12);
      if (angDiff(a1) < gateHalf) continue;
      for (const y of [0.55, 1.05]) fence.beam(P(a, fenceR, y), P(a1, fenceR, y), 0.1, 0.14);
    }
  }
  for (let i = 0; i < nBars; i++) {
    const a = i / nBars * Math.PI * 2;
    if (angDiff(a) < gateHalf) continue;
    fence.beam(P(a, fenceR, 0), P(a, fenceR, 1.3), i % 9 === 0 ? 0.1 : 0.04, i % 9 === 0 ? 0.1 : 0.04); // 縦の格子（9 本ごとに太い柱）
    const a1 = (i + 1) / nBars * Math.PI * 2;
    if (angDiff(a1) < gateHalf) continue;
    for (const y of [0.15, 1.3]) fence.beam(P(a, fenceR, y), P(a1, fenceR, y), 0.06, 0.06); // 上下の横桟
  }
  // 内側の低い柵（走路の内縁）と、中央の柱と八角の小屋根
  const nIn = style !== 'none' && rIn >= 2.5 ? 24 : 0;
  for (let i = 0; i < nIn; i++) {
    const a = i / nIn * Math.PI * 2, a1 = (i + 1) / nIn * Math.PI * 2;
    inner.beam(P(a, rIn - 0.1, 0), P(a, rIn - 0.1, 0.8), 0.08, 0.08);
    inner.beam(P(a, rIn - 0.1, 0.8), P(a1, rIn - 0.1, 0.8), 0.06, 0.06);
  }
  const hasCenter = style !== 'none' && centerR > 0;
  if (hasCenter) inner.beam(V(cx, y0, cz), V(cx, y0 + 2.8, cz), 0.25, 0.25);
  const parts = [];
  if (!fence.empty) parts.push(new THREE.Mesh(fence.build(), toon({ color: style === 'white' ? '#f2f2ee' : '#3f6a4a' })));
  if (nIn || hasCenter) parts.push(new THREE.Mesh(inner.build(), toon({ color: '#8a6a4a' })));
  if (hasCenter) {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(centerR + 0.4, 0.9, 8), toon({ color: '#e0b84a' }));
    roof.position.set(cx, y0 + 3.2, cz);
    parts.push(roof);
  }
  for (const m of parts) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  // 周回個体は同じ姿。6秒後の置換でも鞍・歩行・尾・手綱が連続する。
  const N = ring.ponies ?? 5;
  const rTrack = (rIn + rOut) / 2;
  const units = [];
  for (let i = 0; i < N; i++) {
    const [coat, mane] = ring.coat ?? ['#8a5a3a', '#3a2a20'];
    const pony = createPony(toon, { color: coat, mane, saddle: '#b8463f' });
    const handler = makePerson(toon, { height: 1.65, shirt: ring.handler?.shirt ?? '#2f5a3a', pants: '#3a4a6a', hat: ring.handler?.hat ?? '#2f5a3a' });
    const rider = makePerson(toon, { height: 1.15, shirt: '#f2c94c', pants: '#3a5a8a', hat: '#f4f4f2', seated: true });
    rider.group.position.y = pony.saddleY - 0.62;
    pony.group.add(rider.group);
    group.add(pony.group, handler.group);
    const ropeGeo = new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(9),3));
    const rope = new THREE.Line(ropeGeo,new THREE.LineBasicMaterial({color:'#6a4935'}));
    rope.frustumCulled=false;group.add(rope);
    // Relaxed leading arm, with its end near the hand attachment.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.11,.42,.12),handler.group.children[2].material);
    arm.position.set(-.19,1.14,-.12);arm.rotation.x=.45;arm.castShadow=true;handler.group.add(arm);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(.12,.10,.13),handler.group.children[3].material);
    hand.position.set(0,-.21,0);hand.castShadow=true;arm.add(hand);
    units.push({ pony, handler, rider, hand, rope });
  }
  const W0 = Math.PI * 2 / loop;
  const route = {x:cx,z:cz,radius:rTrack,count:N,loop};
  const lead = new THREE.Vector3(),handPos = new THREE.Vector3();
  return {
    group, units, rTrack, route, groundAt, trackMesh, fenceParts:parts,
    /**
     * @param {number} t      ループで折り返した時刻
     * @param {boolean} riding 乗馬の時間か（それ以外は輪の上に止まって休む）
     */
    update(t, riding) {
      for (let i = 0; i < N; i++) {
        const u = units[i];
        const motion = sampleWalk(riding?t:0,i,route,groundAt);
        const {angle:a,x,z,yaw} = motion;
        // 進む向き（反時計回り＝角度が増える向き）の接線。組の -z が頭
        u.pony.group.position.set(x, motion.y, z);
        u.pony.group.rotation.y = yaw;
        // 引く人：ポニーの内側（輪の中心より）・頭の横
        const hx = cx + Math.cos(a + 0.16) * (rTrack - 0.75), hz = cz + Math.sin(a + 0.16) * (rTrack - 0.75);
        u.handler.group.position.set(hx, groundAt(hx, hz), hz);
        u.handler.group.rotation.y = yaw;
        u.rider.group.visible = riding;
        u.handler.group.visible = riding;
        u.rope.visible = riding;
        // 4拍子の常歩。接地は時間から求めた世界座標へ拘束する。
        const s = riding ? Math.sin(t * W0 * 8) : 0;
        if(riding){u.clamped=u.pony.setFeet(motion.feet);u.pony.neck.position.y=.95;u.pony.neck.rotation.x=-.30+s*.025;}
        else u.pony.idle(t,{heightAt:groundAt,loop});
        u.pony.tail.rotation.z = Math.sin(t * W0 * 2 + a) * 0.13;
        u.rider.group.position.y = u.pony.saddleY - 0.62 + s * 0.008;
        u.handler.legs.forEach((l, k) => { l.rotation.x = (k ? s : -s) * 0.45; });
        u.pony.group.updateWorldMatrix(true,true);u.handler.group.updateWorldMatrix(true,true);
        u.pony.leadPoint.getWorldPosition(lead);u.hand.getWorldPosition(handPos);
        group.worldToLocal(lead);group.worldToLocal(handPos);
        const pos=u.rope.geometry.attributes.position;
        pos.setXYZ(0,lead.x,lead.y,lead.z);pos.setXYZ(1,(lead.x+handPos.x)/2,(lead.y+handPos.y)/2-.08,(lead.z+handPos.z)/2);pos.setXYZ(2,handPos.x,handPos.y,handPos.z);pos.needsUpdate=true;
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
export function createSeawall({ toon, line, heightAt, height = 1.1, thick = 0.45, minY = -1.5, color = '#bdb8ac' }) {
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
  const m = new THREE.Mesh(b.build(), toon({ color }));
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

// ---------------------------------------------------------------------------
// なぎさポニーランドのまわり（Google マップの空中写真・来園者の写真・OSM の範囲から。大きさは推定）
//   大きな土の馬場（白い 2 段の柵）、その南の厩舎（黒い屋根と水色の屋根）、東の草の放牧場（茶色の 3 段の木の柵）で草を食むポニー、
//   入口の白い門（看板）、休み所の藤棚
// ---------------------------------------------------------------------------
export function createPonyLand({ toon, land, heightAt, loop = 6 }) {
  const group = new THREE.Group();
  const white = new GeoBuilder(), brown = new GeoBuilder();
  const H = (x, z) => heightAt(x, z);
  // 四角い範囲の縁に柵（rails の高さ、posts の間隔）
  function rectFence(b, [x0, z0, x1, z1], rails, step, gateAt = null) {
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[k + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const px = ax + (bx - ax) * t0, pz = az + (bz - az) * t0, qx = ax + (bx - ax) * t1, qz = az + (bz - az) * t1;
        if (gateAt && Math.hypot((px + qx) / 2 - gateAt[0], (pz + qz) / 2 - gateAt[1]) < 1.6) continue;
        b.beam(V(px, H(px, pz), pz), V(px, H(px, pz) + rails[rails.length - 1] + 0.1, pz), 0.14, 0.14);
        for (const y of rails) b.beam(V(px, H(px, pz) + y, pz), V(qx, H(qx, qz) + y, qz), 0.09, 0.13);
      }
    }
  }
  const A = land.arena;
  rectFence(white, A, [0.55, 1.05], 2.5);
  const P = land.paddock;
  rectFence(brown, P, [0.35, 0.75, 1.15], 2.2, land.paddockGate);
  for (const m of [new THREE.Mesh(white.build(), toon({ color: '#f0f0ec' })), new THREE.Mesh(brown.build(), toon({ color: '#4a3628' }))]) {
    m.castShadow = m.receiveShadow = true; group.add(m);
  }
  // 厩舎：低い建物（壁は木の色、屋根は黒と水色）
  for (const s of land.stables) {
    const [x0, z0, x1, z1] = s.rect, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y = H(cx, cz);
    const parts = [];
    if (s.open) {
      // 壁のない日よけ：白い柱（3 m おき）と淡い緑の屋根（写真）
      const posts = new GeoBuilder();
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.max(1, Math.round((x1 - x0) / 3))) for (const z of [z0, z1]) posts.beam(V(x, H(x, z), z), V(x, y + 2.8, z), 0.16, 0.16);
      parts.push(new THREE.Mesh(posts.build(), toon({ color: '#f2f2ee' })));
      parts.push(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1.2, 0.18, z1 - z0 + 1.2).translate(cx, y + 2.9, cz), toon({ color: s.roof })));
    } else {
      parts.push(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2.6, z1 - z0).translate(cx, y + 1.3, cz), toon({ color: s.wall ?? '#a88a68' })));
      parts.push(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.8, 0.3, z1 - z0 + 0.8).translate(cx, y + 2.75, cz), toon({ color: s.roof })));
    }
    for (const m of parts) { m.castShadow = m.receiveShadow = true; group.add(m); }
  }
  // 砂の広場のまわりの茶色の 2 段の横木の柵（北は小屋と日よけなので無し。入口の門の所は開ける）
  if (land.yardFence) {
    const yb = new GeoBuilder();
    const [x0, z0, x1, z1] = land.yard;
    const sides = [[[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]];
    for (const [[ax, az], [bx, bz]] of sides) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i < n; i++) {
        const px = ax + (bx - ax) * i / n, pz = az + (bz - az) * i / n, qx = ax + (bx - ax) * (i + 1) / n, qz = az + (bz - az) * (i + 1) / n;
        if (Math.hypot((px + qx) / 2 - land.gate[0], (pz + qz) / 2 - land.gate[1]) < 2.2) continue;
        yb.beam(V(px, H(px, pz), pz), V(px, H(px, pz) + 1.05, pz), 0.16, 0.16);
        for (const yy of [0.5, 0.95]) yb.beam(V(px, H(px, pz) + yy, pz), V(qx, H(qx, qz) + yy, qz), 0.13, 0.13);
      }
    }
    const m = new THREE.Mesh(yb.build(), toon({ color: '#5a4230' }));
    m.castShadow = m.receiveShadow = true; group.add(m);
  }
  // 乗り台（ポニーに乗るための段。緑と木の色）
  if (land.mountBlock) {
    const [mx, mz] = land.mountBlock, my = H(mx, mz);
    const steps=new GeoBuilder();
    for(let i=0;i<3;i++)steps.box(V(mx,my+(i+1)*.15,mz-i*.2),1.6,(i+1)*.30,1.2-i*.4);
    const m=new THREE.Mesh(steps.build(),toon({color:'#76ad79'}));m.castShadow=m.receiveShadow=true;group.add(m);
  }
  // 入口の門：白い柱 2 本と、上に看板（白地に桃色の文字の帯）
  {
    const [gx, gz, gyaw] = land.gate;
    const g = new THREE.Group();
    const post = toon({ color: '#f4f4f0' }), sign = toon({ color: '#f4f4f0' }), pink = toon({ color: '#e0607a' });
    for (const sx of [-1.8, 1.8]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), post); m.position.set(sx, 1.6, 0); g.add(m); }
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 0.2), sign); board.position.set(0, 3.2, 0); g.add(board);
    const text = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 0.22), pink); text.position.set(0, 3.25, 0); g.add(text);
    g.position.set(gx, H(gx, gz), gz); g.rotation.y = gyaw;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(g);
  }
  // 放牧場で草を食むポニー（毛色いろいろ：薄い金色・ぶち・鹿毛・葦毛）。首を上下、しっぽを振る（ループ周期）
  const grazers = [];
  const coats = [['#e8d8b0', '#f4ecd8'], ['#f2efe8', '#6a4030'], ['#7a4a2a', '#2a1a14'], ['#c8c4bc', '#8a8680']];
  land.grazing.forEach(([x, z, yaw], i) => {
    const [body, mane] = coats[i % coats.length];
    const p = createPony(toon, { len: 1.3, h: 1.0, color: body, mane, patch:i===1?'#79513b':null });
    p.group.position.set(x, H(x, z), z); p.group.rotation.y = yaw;
    group.add(p.group);
    grazers.push({ p, ph: i * 1.7 });
  });
  // 止まっているポニー（乗り台の栗毛、順番を待つぶち、丸い馬場の白いポニー）と、そばに立つ係の人（水色のシャツ）
  for (const [x, z, yaw, body, mane] of land.waiting ?? []) {
    const p = createPony(toon, { color: body, mane, saddle: '#b8463f',patch:body==='#f2efe8'&&mane==='#6a4030'?'#79513b':null });
    p.group.position.set(x, H(x, z), z); p.group.rotation.y = yaw;
    const staff = makePerson(toon, { height: 1.65, shirt: '#8ec4e0', pants: '#3a4a6a', hat: '#f4f4f0' });
    const sx = x + Math.cos(yaw) * 0.9, sz = z - Math.sin(yaw) * 0.9;
    staff.group.position.set(sx, H(sx, sz), sz); staff.group.rotation.y = yaw;
    group.add(p.group, staff.group);
    grazers.push({ p, ph: x * 0.3, idle: true });
  }
  return {
    group, grazers,
    update(t) {
      for (const g of grazers) {
        g.p.idle(t,{heightAt,grazing:!g.idle,phase:g.ph,loop});
      }
    }
  };
}

// 藤棚（休み所）：黒っぽい木の柱と、上に格子の梁（展望の丘・ポニーランドの写真）
export function createPergola({ toon, at, w = 5, d = 3.5, h = 2.6, yaw = 0, heightAt }) {
  const b = new GeoBuilder();
  const g = new THREE.Group();
  for (const sx of [-w / 2, w / 2]) for (const sz of [-d / 2, 0, d / 2]) b.beam(V(sx, 0, sz), V(sx, h, sz), 0.2, 0.2);
  for (const sz of [-d / 2, d / 2]) b.beam(V(-w / 2 - 0.3, h, sz), V(w / 2 + 0.3, h, sz), 0.18, 0.25);
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.6) b.beam(V(x, h + 0.2, -d / 2 - 0.3), V(x, h + 0.2, d / 2 + 0.3), 0.08, 0.12);
  const m = new THREE.Mesh(b.build(), toon({ color: '#5a4636' }));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  g.position.set(at.x, heightAt(at.x, at.z), at.z); g.rotation.y = yaw;
  return { group: g };
}

// 木のピクニックテーブル（長いすつき）
export function createPicnicTable({ toon, at, yaw = 0, heightAt }) {
  const g = new THREE.Group();
  const wood = toon({ color: '#b8a080' });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.8), wood); top.position.y = 0.72; g.add(top);
  for (const sz of [-0.7, 0.7]) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.3), wood); s.position.set(0, 0.42, sz); g.add(s); }
  for (const sx of [-0.75, 0.75]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 1.7), wood); l.position.set(sx, 0.36, 0); g.add(l); }
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.position.set(at.x, heightAt(at.x, at.z), at.z); g.rotation.y = yaw;
  return { group: g };
}

/**
 * 道ぞいの電柱（コンクリートの灰色、高さ 10 m）と電線 3 本。線に沿って every m おき、side 側へ offset m
 * @param {number[][]} line
 */
export function createUtilityPoles({ toon, line, heightAt, every = 35, offset = 0, height = 10, bounds = null }) {
  const group = new THREE.Group();
  const b = new GeoBuilder();
  const tops = [];
  let carry = 0;
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let s = carry; s < len; s += every) {
      const x = ax + (bx - ax) * s / len + nx * offset, z = az + (bz - az) * s / len + nz * offset;
      if (bounds && !bounds(x, z)) { tops.push(null); continue; }
      const y = heightAt(x, z);
      b.beam(V(x, y, z), V(x, y + height, z), 0.3, 0.3);
      b.beam(V(x - nx * 0.9, y + height - 0.6, z - nz * 0.9), V(x + nx * 0.9, y + height - 0.6, z + nz * 0.9), 0.12, 0.12);
      tops.push([x, y + height, z, nx, nz]);
    }
    carry = ((carry - len) % every + every) % every;
  }
  const m = new THREE.Mesh(b.build(), toon({ color: '#a4a4a0' }));
  m.castShadow = true;
  group.add(m);
  // 電線：となりの電柱どうしを 3 本で結ぶ（わずかにたるむ）
  const pos = [];
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i], c = tops[i + 1];
    if (!a || !c) continue;
    for (const off of [-0.8, 0, 0.8]) {
      const N = 6;
      for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N, sag = t => -Math.sin(Math.PI * t) * 0.6;
        const p0 = [a[0] + (c[0] - a[0]) * t0 + a[3] * off, a[1] - 0.6 + (c[1] - a[1]) * t0 + sag(t0), a[2] + (c[2] - a[2]) * t0 + a[4] * off];
        const p1 = [a[0] + (c[0] - a[0]) * t1 + a[3] * off, a[1] - 0.6 + (c[1] - a[1]) * t1 + sag(t1), a[2] + (c[2] - a[2]) * t1 + a[4] * off];
        pos.push(...p0, ...p1);
      }
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x4a4a50 }));
  group.add(wires);
  return { group, wires };
}

/** 刈り込んだ生け垣（低い角ばった植え込み）を線に沿って。offset は線の横へのずらし */
export function createHedge({ toon, line, heightAt, offset = 0, h = 0.9, w = 1.0, bounds = null }) {
  const b = new GeoBuilder();
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5 || len > 12) continue;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const mx = (ax + bx) / 2 + nx * offset, mz = (az + bz) / 2 + nz * offset;
    if (bounds && !bounds(mx, mz)) continue;
    b.box(V(mx, heightAt(mx, mz) + h / 2 - 0.05, mz), len + 0.2, h, w, Math.atan2(-(bz - az), bx - ax));
  }
  const m = new THREE.Mesh(b.build(), toon({ color: '#4a6e34' }));
  m.castShadow = m.receiveShadow = true;
  return { group: m };
}

// ---------------------------------------------------------------------------
// カフェ・キキのデッキ（展望の丘と同じ高さ）：濃い茶色の板の床、丸いハイテーブル、桜を植えた丸い芝の島、川側の鎖の柵、丘の側のベンチ
//   実際の写真と Google マップの空中写真から。大きさは推定
// ---------------------------------------------------------------------------
export function createCafeDeck({ toon, deck }) {
  const group = new THREE.Group();
  group.name = 'cafe-deck';
  const y = deck.y;
  // 床：板の目（細い明暗の縞）
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 8;
  const c = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { c.fillStyle = i % 4 === 3 ? '#3e2e22' : i % 2 ? '#5a4434' : '#624a38'; c.fillRect(0, i, 4, 1); }
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(0.5, 0.6);
  const shape = new THREE.Shape(deck.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const isl = deck.island;
  const hole = new THREE.Path(); hole.absarc(isl.x, -isl.z, isl.r, 0, Math.PI * 2, true); shape.holes.push(hole);
  const floor = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y - 0.3, 0), toon({ color: '#ffffff', map: tex }));
  floor.receiveShadow = true;
  group.add(floor);
  // 芝の島（縁は低い）
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(isl.r, isl.r, 0.3, 24).translate(isl.x, y - 0.1, isl.z), toon({ color: '#6a8a3a' }));
  lawn.receiveShadow = true; group.add(lawn);
  const B = new GeoBuilder(), steel = new GeoBuilder(), wood = new GeoBuilder();
  // 丸いハイテーブル（白い天板・灰色の脚と台）
  const tops = [];
  for (const [x, z] of deck.tables) {
    steel.beam(V(x, y, z), V(x, y + 1.02, z), 0.08, 0.08);
    for (const a of [0, Math.PI / 2]) steel.beam(V(x - Math.cos(a) * 0.35, y + 0.03, z - Math.sin(a) * 0.35), V(x + Math.cos(a) * 0.35, y + 0.03, z + Math.sin(a) * 0.35), 0.06, 0.06);
    tops.push(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 16).translate(x, y + 1.05, z));
  }
  for (const g of tops) group.add(Object.assign(new THREE.Mesh(g, toon({ color: '#ecebe6' })), { castShadow: true }));
  // ベンチ（木の座面・金属の脚）。[x, z, 長さ]
  for (const [x, z, len] of deck.benches ?? []) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.45).translate(x, y + 0.45, z), toon({ color: '#8a6a4a' }));
    seat.castShadow = true; group.add(seat);
    for (const sx of [-len / 2 + 0.3, len / 2 - 0.3]) steel.beam(V(x + sx, y, z), V(x + sx, y + 0.42, z), 0.06, 0.06);
  }
  // 川側の鎖の柵：ステンレスの柱（2 m おき、高さ 0.85 m）と、たるんだ鎖
  const [[ax, az], [bx, bz]] = deck.chain;
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
    B.beam(V(x, y, z), V(x, y + 0.85, z), 0.07, 0.07);
    if (i < n) {
      const x2 = ax + (bx - ax) * (i + 1) / n, z2 = az + (bz - az) * (i + 1) / n;
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push(new THREE.Vector3(x + (x2 - x) * t, y + 0.75 - Math.sin(t * Math.PI) * 0.18, z + (z2 - z) * t)); if (k > 0 && k < 4) pts.push(pts[pts.length - 1].clone()); }
    }
  }
  const chain = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9a9ca0 }));
  group.add(chain);
  for (const [b, color] of [[B, '#c8cacc'], [steel, '#6a6c70'], [wood, '#8a6a4a']]) {
    if (b.empty) continue;
    const m = new THREE.Mesh(b.build(), toon({ color })); m.castShadow = m.receiveShadow = true; group.add(m);
  }
  return { group, chain, contains: (x, z) => pointInPoly(x, z, deck.poly) };
}
