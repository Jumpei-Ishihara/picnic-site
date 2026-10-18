// 実在の場所の場面（江戸川・なぎさ公園）の生き物と動き（10 月中旬）
//   ループ周期（6 秒）で繰り返すもの：赤とんぼ、トビ、芝の揺れ、水際のススキ・オギの揺れ
//   繰り返さないもの（交通）：鉄橋を渡る電車、市川橋の車、川を行く小さな船。traffic.enabled で止められる（ループ動画の書き出し用）
import * as THREE from 'three';
import { createSwayingGrass } from '../engine/grass.js';

// 位置から決まる乱数とまだら模様（草の群れの濃い・薄いに使う）
function hash2(i, j) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), tx = x - i, tz = z - j;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

// 折れ線（[x, z] の並び）を、端の向きのまま ext m ずつ延ばして、長さに沿った位置を引けるようにする
function track(path, ext = 0) {
  const p = path.map(([x, z]) => new THREE.Vector2(x, z));
  if (ext > 0) {
    const a = p[0].clone().sub(p[1]).normalize(), b = p[p.length - 1].clone().sub(p[p.length - 2]).normalize();
    p.unshift(p[0].clone().addScaledVector(a, ext));
    p.push(p[p.length - 1].clone().addScaledVector(b, ext));
  }
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + p[i].distanceTo(p[i - 1]));
  const L = cum[cum.length - 1];
  return {
    L,
    at(s, out = {}) {
      s = Math.min(Math.max(s, 0), L);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      out.x = p[i - 1].x + (p[i].x - p[i - 1].x) * t;
      out.z = p[i - 1].y + (p[i].y - p[i - 1].y) * t;
      const d = p[i].clone().sub(p[i - 1]).normalize();
      out.dx = d.x; out.dz = d.y;
      return out;
    }
  };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(p:object) => THREE.Material} o.toon
 * @param {object} o.data      scene.json
 * @param {ReturnType<import('../engine/terrain.js').createHeightTerrain>} o.terrain
 * @param {{ hideInNormalPass: Set<THREE.Object3D> }} o.pixel
 * @param {() => number} o.rnd
 * @param {boolean} [o.light]  スマホ向けに数を減らす
 * @param {string[]} [o.carBridges]  車を走らせる橋の id
 * @param {number[][]} [o.boatPath]   船の通り道（[x, z] の並び）。省くと両岸の水際の真ん中
 * @param {{x:number, z:number, r:number}} [o.gulls]  カモメ（ユリカモメ）を飛ばす水の上の範囲
 * @param {boolean} [o.reeds]    水際のススキ・オギ（江戸川の断面データがあるとき）
 */
export function createLife({ scene, toon, data, terrain, pixel, rnd, loop = 6, light = false, ext = 500,
  carBridges = ['ichikawa-bridge'], boatPath = null, gulls = null, reeds: withReeds = !!data.section, trainExtra = 200 }) {
  const W0 = Math.PI * 2 / loop;
  const NB = terrain.bounds.near;
  const S = data.sheet;
  const grassTime = { value: 0 };
  const counts = {};
  const pick = arr => arr[(rnd() * arr.length) | 0];

  // ==========================================================================
  // 芝の房（シートの周り 20 m）。芝・すり減った芝・堤防の芝の所だけ
  // ==========================================================================
  const LAWN = new Set(['lawn', 'lawnWorn', 'leveeGrass']);
  const lawnColors = ['#7aa24c', '#8fb25c', '#6f9645', '#a3ae62', '#86a650'];
  const tufts = createSwayingGrass({
    scene, material: toon, count: light ? 1400 : 2600, time: grassTime, loop, rnd,
    place() {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 20;
      const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
      if (!LAWN.has(terrain.groundAt(x, z))) return null;
      // シートの上には生やさない（シートは方位 285° に向いた 2.0×1.4 m。少し広めに空ける）
      if (Math.hypot(x - S.x, z - S.z) < 1.5) return null;
      return { x, y: terrain.heightAt(x, z) - 0.02, z, scale: 0.5 + rnd() * 0.35, color: pick(lawnColors) };
    }
  });
  pixel.hideInNormalPass.add(tufts);
  counts.tufts = tufts.count;

  // ==========================================================================
  // 水際のススキ・オギ：護岸の上の端に沿って株を並べる。群れの濃淡はまだら模様で。
  // シートの正面（川を眺める向き）は空けて、座った目線から川面が見えるようにする
  // ==========================================================================
  const bank = z => {
    const sec = data.section;
    let a = sec[0], b = sec[sec.length - 1];
    for (let i = 0; i < sec.length - 1; i++) if (sec[i].z <= z && sec[i + 1].z >= z) { a = sec[i]; b = sec[i + 1]; break; }
    const t = (z - a.z) / Math.max(1e-6, b.z - a.z);
    return a.bankTop + (b.bankTop - a.bankTop) * Math.min(1, Math.max(0, t));
  };
  const reedSpots = [];
  for (let z = NB.z0 + 2; withReeds && z < NB.z1 - 2; z += 0.6) {
    if (z > S.z - 30 && z < S.z + 10) continue; // シートから見て正面〜左手（上流側）の水際は空ける
    if (noise(z * 0.08, 3.1) < 0.42) continue;
    const x = bank(z) + (rnd() - 0.4) * 1.6;
    const g = terrain.groundAt(x + 1, z);
    if (g === 'paved' || g === 'road') continue; // 水際の広場は空ける
    reedSpots.push({ x, z, s: 0.75 + rnd() * 0.45, y: terrain.heightAt(x, z) });
  }
  const reedColors = ['#7a8a4a', '#8f9a52', '#a39a5a', '#6f8044'];
  let ri = 0;
  const reeds = reedSpots.length && createSwayingGrass({
    scene, material: toon, kind: 'reed', count: reedSpots.length, time: grassTime, loop, rnd, amp: 0.12,
    place() { const p = reedSpots[ri++]; return p && { x: p.x, y: p.y - 0.05, z: p.z, scale: p.s, color: pick(reedColors) }; }
  });
  let pi = 0;
  const plumeSpots = reedSpots.flatMap(p => [0, 1, 2].map(k => ({ ...p, k })));
  const plumes = plumeSpots.length && createSwayingGrass({
    scene, material: toon, kind: 'plume', count: plumeSpots.length, time: grassTime, loop, rnd, amp: 0.12,
    blade: { length: 0.34, width: 0.07 },
    place() {
      const p = plumeSpots[pi++];
      if (!p) return null;
      const a = p.k * 2.1 + p.x;
      // 穂は葉の先あたり（株の高さ 1.5 m × 大きさ）
      return { x: p.x + Math.cos(a) * 0.12 * p.s, y: p.y + 1.25 * p.s, z: p.z + Math.sin(a) * 0.12 * p.s, scale: p.s, color: pick(['#d8c79a', '#c9b88a', '#e2d6b0']) };
    }
  });
  for (const m of [reeds, plumes]) if (m) pixel.hideInNormalPass.add(m);
  counts.reeds = reeds ? reeds.count : 0;
  counts.plumes = plumes ? plumes.count : 0;

  // ==========================================================================
  // 赤とんぼ：シートの周りを低く飛ぶ（6 秒で元の位置に戻る 8 の字）
  // ==========================================================================
  const nDf = light ? 10 : 16;
  const dfSeeds = Array.from({ length: nDf }, () => {
    const a = rnd() * Math.PI * 2, r = 3 + rnd() * 14;
    return { cx: S.x + Math.cos(a) * r, cz: S.z + Math.sin(a) * r, y: 0.8 + rnd() * 1.4, rx: 1 + rnd() * 2.5, rz: 1 + rnd() * 2.5, ph: rnd() * 6.28, k: 1 + (rnd() * 2 | 0) };
  });
  const dfGeo = new THREE.BufferGeometry();
  dfGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nDf * 3), 3));
  const dfMat = new THREE.PointsMaterial({ color: 0xc8402a, size: 2, sizeAttenuation: false, transparent: true, depthWrite: false });
  const dragonflies = new THREE.Points(dfGeo, dfMat);
  dragonflies.frustumCulled = false;
  scene.add(dragonflies);
  pixel.hideInNormalPass.add(dragonflies);
  counts.dragonflies = nDf;

  // ==========================================================================
  // トビ：空の高い所で輪を描く。1 羽はシートから見上げた先（昼寝の視点で見える）
  // ==========================================================================
  const kiteMat = toon({ color: '#4a3a2e' });
  function makeKite() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.55), kiteMat);
    g.add(body);
    // 翼：先が少し後ろへ流れた細長い板（翼開長 1.6 m）
    const wing = new THREE.BufferGeometry();
    const v = [0, 0, -0.12, 0.8, 0.05, 0.05, 0.75, 0.04, 0.22, 0, 0, 0.12];
    const tri = (a, b, c) => [...v.slice(a * 3, a * 3 + 3), ...v.slice(b * 3, b * 3 + 3), ...v.slice(c * 3, c * 3 + 3)];
    const half = [...tri(0, 1, 2), ...tri(0, 2, 3)];
    const both = [...half, ...half.map((x, i) => (i % 3 === 0 ? -x : x))];
    wing.setAttribute('position', new THREE.Float32BufferAttribute(both, 3));
    wing.computeVertexNormals();
    const wings = new THREE.Mesh(wing, kiteMat);
    kiteMat.side = THREE.DoubleSide;
    g.add(wings);
    // 尾：三味線のばちのような形（トビの尾はほぼ真っすぐで端が少しくぼむ）
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), kiteMat);
    tail.position.z = 0.38;
    g.add(tail);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    return g;
  }
  const dirOf = (bearing, d) => { // シートから方位 bearing へ d m の場所
    const rel = (bearing - data.frame.upstreamBearing) * Math.PI / 180;
    return { x: S.x + Math.sin(rel) * d, z: S.z - Math.cos(rel) * d };
  };
  const kiteSeeds = [
    { c: dirOf(250, 17), h: 30, r: 8, ph: 0, dir: 1 },   // 昼寝の視点（方位 250°・見上げ 60°）の先
    { c: dirOf(230, 120), h: 70, r: 11, ph: 2.1, dir: -1 },
    { c: dirOf(300, 200), h: 58, r: 10, ph: 4.0, dir: 1 }
  ];
  // 少し大きめ（1.4 倍）：実寸だと見上げた空で 2〜3 ドットにしかならない
  const kites = kiteSeeds.map(() => { const g = makeKite(); g.scale.setScalar(1.4); return g; });
  counts.kites = kites.length;

  // カモメ（ユリカモメ）：水の上を低く輪を描いて飛ぶ。白い体に灰色の翼（形はトビと同じ作りを小さく）
  const gullSeeds = [], gullBirds = [];
  if (gulls) {
    const white = toon({ color: '#f2f2ee' }), grey = toon({ color: '#b9bec6', side: THREE.DoubleSide });
    for (let i = 0; i < (light ? 5 : 8); i++) {
      const g = makeKite();
      g.children[0].material = white; g.children[2].material = white; g.children[1].material = grey;
      g.scale.setScalar(0.7);
      gullBirds.push(g);
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * gulls.r;
      gullSeeds.push({ c: { x: gulls.x + Math.cos(a) * d, z: gulls.z + Math.sin(a) * d }, h: 5 + rnd() * 14, r: 6 + rnd() * 8, ph: rnd() * 6.28, dir: rnd() < 0.5 ? 1 : -1, water: true });
    }
  }
  counts.gulls = gullBirds.length;

  // ==========================================================================
  // 電車（JR 総武線の各駅停車・快速、京成線）と市川橋の車、川の小さな船
  // ==========================================================================
  const traffic = { enabled: true, trains: [], cars: null, boat: null };
  const nightLights = [];
  const TRAIN_LOOKS = {
    'jr-sobu-local': { band: '#f2c200', cars: 10, len: 20, v: 22, every: 150 },  // 黄色の帯
    'jr-sobu-rapid': { band: '#2a4d9a', cars: 11, len: 20, v: 25, every: 180, top: '#e8e2d0' }, // 紺とクリーム
    'keisei': { band: '#c8323a', cars: 8, len: 18, v: 20, every: 200, band2: '#2a4d9a' },  // 赤と青の帯
    'jr-keiyo': { band: '#9a1f3a', cars: 10, len: 20, v: 24, every: 170 },                // 京葉線：ワインレッドの帯
    'tozai-line': { band: '#2a9ad6', cars: 10, len: 20, v: 22, every: 160 }               // 東西線：水色の帯
  };
  const bodyMat = toon({ color: '#c9ccd1' }), winMat = toon({ color: '#2a2f3a', emissive: 0xfff0c8, emissiveIntensity: 0 });
  winMat.userData.lampMax = 1.4;
  for (const b of data.landmarks.bridges) {
    const look = TRAIN_LOOKS[b.id];
    if (!look) continue;
    const tr = track(b.path, ext);
    const bandMat = toon({ color: look.band }), band2Mat = look.band2 ? toon({ color: look.band2 }) : null;
    const topMat = look.top ? toon({ color: look.top }) : bodyMat;
    for (const dir of [1, -1]) {
      const cars = [];
      for (let k = 0; k < look.cars; k++) {
        const g = new THREE.Group();
        const L = look.len - 0.6;
        const body = new THREE.Mesh(new THREE.BoxGeometry(L, 3.0, 2.9), bodyMat); body.position.y = 1.5; g.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.6, 2.7), topMat); top.position.y = 3.3; g.add(top);
        const win = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.8, 2.95), winMat); win.position.y = 2.1; g.add(win);
        const band = new THREE.Mesh(new THREE.BoxGeometry(L * 1.001, 0.35, 2.96), bandMat); band.position.y = 1.35; g.add(band);
        if (band2Mat) { const b2 = new THREE.Mesh(new THREE.BoxGeometry(L * 1.001, 0.2, 2.96), band2Mat); b2.position.y = 1.05; g.add(b2); }
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.visible = false;
        scene.add(g);
        cars.push(g);
      }
      traffic.trains.push({ id: b.id, dir, cars, tr, look, deckY: b.deckY, offset: dir > 0 ? rnd() * look.every : look.every * 0.5 + rnd() * 30, side: dir * 1.8 });
    }
  }
  counts.trains = traffic.trains.length;
  nightLights.push(winMat);

  // 橋の車：4 車線、まとめ描き（carBridges の橋ごと）
  traffic.carSets = [];
  for (const id of carBridges) {
    const b = data.landmarks.bridges.find(x => x.id === id);
    if (b) {
      const tr = track(b.path, 120);
      const n = Math.round((light ? 16 : 28) * Math.min(2, Math.max(0.6, tr.L / 400)));
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 1.5, 1.8).translate(0, 0.75, 0), toon({ color: '#ffffff' }), n);
      const colors = ['#f4f4f2', '#c3c4c8', '#2b2b30', '#9497a0', '#8c2f39', '#2c4a7a', '#f4f4f2'];
      const c = new THREE.Color();
      const seeds = Array.from({ length: n }, (_, i) => {
        im.setColorAt(i, c.set(pick(colors)));
        const lane = [-5, -2, 2, 5][i % 4];
        return { lane, dir: lane > 0 ? 1 : -1, s0: rnd() * tr.L, v: 11 + rnd() * 4 };
      });
      im.instanceColor.needsUpdate = true;
      im.castShadow = true;
      scene.add(im);
      traffic.carSets.push({ im, tr, seeds, deckY: b.deckY });
      counts.cars = (counts.cars ?? 0) + n;
    }
  }

  // 小さな船：川の真ん中を下る（まれに）
  if (boatPath || data.water.westShore) {
    const west = data.water.westShore, east = data.water.eastShore;
    const center = boatPath ?? west.filter(([, z]) => z > -1000 && z < 500).map(([x, z]) => {
      const e = east.reduce((a, q) => Math.abs(q[1] - z) < Math.abs(a[1] - z) ? q : a);
      return [(x + e[0]) / 2 + 12, z]; // 真ん中より少し東寄り（下りの船）
    }).sort((a, b) => a[1] - b[1]);
    const tr = track(center);
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 5.5), toon({ color: '#f4f4f2' })); hull.position.y = 0.2; g.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), toon({ color: '#f4f4f2' })); bow.position.set(0, 0.2, 3.4); bow.scale.set(1, 0.55, 1); g.add(bow);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.8), toon({ color: '#5a8fd1' })); cabin.position.set(0, 1.0, -0.6); g.add(cabin);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.15, 5.52), toon({ color: '#b8463f' })); stripe.position.y = 0.45; g.add(stripe);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    scene.add(g);
    traffic.boat = { g, tr, v: 3.5, every: 420, offset: 60 };
  }

  // ==========================================================================
  // 毎フレーム
  // ==========================================================================
  const tmp = {}, up = new THREE.Vector3(0, 1, 0);
  const dfPos = dfGeo.attributes.position;
  function placeOnTrack(obj, tr, s, y, side) {
    tr.at(s, tmp);
    obj.position.set(tmp.x + tmp.dz * side, y, tmp.z - tmp.dx * side);
    obj.rotation.y = Math.atan2(-tmp.dz, tmp.dx);
  }
  return {
    counts, traffic, kites, gulls: gullBirds, dragonflies, tufts, reeds, plumes, grassTime, nightLights,
    /**
     * @param {number} t        ループに使う経過時間（秒）
     * @param {number} clock    交通に使う時計（秒）。ループ動画の間は止めてよい
     * @param {{ sunElevation: number, night: number, level: number }} env
     */
    update(t, clock, { sunElevation, level }) {
      grassTime.value = t;
      const a = t * W0;
      // 赤とんぼ：昼間だけ（日が低くなると消える）
      dfMat.opacity = Math.min(1, Math.max(0, (sunElevation - 2) / 6));
      dragonflies.visible = dfMat.opacity > 0.02;
      dfSeeds.forEach((d, i) => {
        const u = a * d.k + d.ph;
        // ふだんはゆっくり、ときどきすっと移る（sin の 3 乗で緩急）
        const dart = Math.sin(u) ** 3;
        dfPos.setXYZ(i, d.cx + d.rx * dart + Math.sin(u * 2) * 0.3, terrain.heightAt(d.cx, d.cz) + d.y + Math.sin(u * 3) * 0.15, d.cz + d.rz * Math.sin(u * 2 + 1) * 0.6);
      });
      dfPos.needsUpdate = true;
      // トビ：6 秒で 1 周、旋回の内側へ傾ける
      const birds = [...kiteSeeds.map((k, i) => [k, kites[i]]), ...gullSeeds.map((k, i) => [k, gullBirds[i]])];
      birds.forEach(([k, g], i) => {
        const th = a * k.dir + k.ph;
        const base = k.water ? level : terrain.heightAt(k.c.x, k.c.z);
        g.position.set(k.c.x + Math.cos(th) * k.r, base + k.h + Math.sin(a * 2 + i) * 0.6, k.c.z + Math.sin(th) * k.r);
        // 進む向き（接線）。組の +z が後ろ（尾）なので、-z を進む向きに合わせる
        const vx = -Math.sin(th) * k.dir, vz = Math.cos(th) * k.dir;
        g.rotation.set(0, Math.atan2(-vx, -vz), 0);
        g.rotateZ(-0.4 * k.dir);
        g.children[1].rotation.z = Math.sin(a * 4 + i) * 0.04; // 翼のわずかな揺れ
      });
      // 交通
      const on = traffic.enabled;
      for (const T of traffic.trains) {
        const total = T.look.cars * T.look.len;
        // 時刻表：every 秒ごとに 1 本。入ってから出るまで (L + 編成長) / v 秒
        const ph = ((clock + T.offset) % T.look.every + T.look.every) % T.look.every;
        const head = ph * T.look.v;
        const run = on && head < T.tr.L + total;
        T.cars.forEach((g, k) => {
          const sAlong = head - k * T.look.len - T.look.len / 2;
          const s = T.dir > 0 ? sAlong : T.tr.L - sAlong;
          // 延ばした線路（高架や築堤は作っていない）の遠くでは見せない：橋の両端から 200 m まで
          g.visible = run && sAlong > ext - trainExtra && sAlong < T.tr.L - ext + trainExtra;
          if (g.visible) placeOnTrack(g, T.tr, s, T.deckY + 0.4, T.side);
        });
      }
      for (const C of traffic.carSets) {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
        C.im.visible = on;
        C.seeds.forEach((c, i) => {
          const s0 = ((c.s0 + c.v * clock) % C.tr.L + C.tr.L) % C.tr.L;
          const s = c.dir > 0 ? s0 : C.tr.L - s0;
          C.tr.at(s, tmp);
          q.setFromAxisAngle(up, Math.atan2(-tmp.dz, tmp.dx));
          C.im.setMatrixAt(i, m.compose(p.set(tmp.x + tmp.dz * c.lane, C.deckY, tmp.z - tmp.dx * c.lane), q, one));
        });
        C.im.instanceMatrix.needsUpdate = true;
      }
      if (traffic.boat) {
        const B = traffic.boat;
        const s = (((clock + B.offset) % B.every) + B.every) % B.every * B.v;
        B.g.visible = on && s < B.tr.L;
        if (B.g.visible) {
          B.tr.at(s, tmp);
          B.g.position.set(tmp.x, level + Math.sin(clock * 2) * 0.03, tmp.z);
          B.g.rotation.y = Math.atan2(tmp.dx, tmp.dz);
        }
      }
    }
  };
}
