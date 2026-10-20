// ピクニックの持ち物（すべてのピクニックの場面で共通。企画提案書の「身軽ピクニック」がもと）：
//   いつも：レジャーシート 200×140（紺とからし色のチェック）、二重構造のカップ 2 つ、パン（クラフト紙にコッペパン 2 つ）、
//           ジュートのトートバッグ、保冷のランチバッグ、エアクッションと枕、文庫本（風でページがめくれる）、小さなランタン（夕方・夜に灯る）
//   季節で変わる：秋・冬はスープジャー 400 ml（カップとジャーから湯気）、春・夏は冷たいお茶の水筒（湯気なし）。夏は麦わら帽子、冬はひざ掛け
// シートの向き：組の -z が正面（座って眺める側）、+z が座る側。単位は m。座る所はシートの中心から +z へ 0.9 m（SIT_BACK）。
import * as THREE from 'three';
import { makeCanvas, pixelTex } from './pixel-kit.js';

export const SHEET = { w: 2.0, d: 1.4 }; // シートの大きさ
export const SIT_BACK = 0.9;              // 座る所：シートの中心から後ろ（+z）へ
export const EYE_SIT = 0.75;              // 座った目の高さ
const W = SHEET.w, D = SHEET.d;

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(p:object) => THREE.Material} o.toon
 * @param {{ x:number, z:number }} o.at
 * @param {number} o.yaw       シートの向き（カメラの yaw と同じ考え方。-z が川）
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {number} [o.loop]
 * @param {'spring'|'summer'|'autumn'|'winter'} [o.season]  飲み物（温かい・冷たい）と、帽子・ひざ掛け
 */
export function createPicnicSet({ scene, toon, at, yaw, heightAt, loop = 6, season = 'autumn' }) {
  const warm = season === 'autumn' || season === 'winter';
  const W0 = Math.PI * 2 / loop;
  const group = new THREE.Group();
  group.position.set(at.x, heightAt(at.x, at.z), at.z);
  group.rotation.y = yaw;
  scene.add(group);
  const add = (mesh, x, y, z, ry = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ---- レジャーシート：紺とからし色のチェック、縁は紺
  {
    const [cv, g] = makeCanvas(40, 28);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 40; x++) {
      const a = Math.floor(x / 4) % 2, b = Math.floor(y / 4) % 2;
      g.fillStyle = a && b ? '#2f4a6e' : (a || b) ? '#d6a94a' : '#efe4c8';
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#26304f';
    g.fillRect(0, 0, 40, 1); g.fillRect(0, 27, 40, 1); g.fillRect(0, 0, 1, 28); g.fillRect(39, 0, 1, 28);
    const sheet = add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.012, D), toon({ map: pixelTex(cv) })), 0, 0.006, 0);
    sheet.castShadow = false;
    sheet.name = 'sheet';
  }

  // ---- スープジャー（400 ml：直径 7.5 cm、高さ 16 cm）。ふたは開けて横に置く
  const steel = toon({ color: '#c3c6cc' }), band = toon({ color: '#5a7a9a' }), soup = toon({ color: '#d98c40', emissive: 0x6a3010, emissiveIntensity: 0.12 });
  const tea = toon({ color: '#b8823a', emissive: 0x3a2008, emissiveIntensity: 0.1 }); // 冷たいお茶（春・夏）
  const jarX = 0.12, jarZ = -0.12;
  if (warm) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.036, 0.15, 10), steel), jarX, 0.012 + 0.075, jarZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.0385, 0.05, 10), band), jarX, 0.012 + 0.05, jarZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.004, 10), soup), jarX, 0.012 + 0.148, jarZ);
    const lid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.04, 10), band), jarX + 0.13, 0.012 + 0.02, jarZ + 0.04);
    lid.name = 'jar-lid';
  } else {
    // 水筒（500 ml：直径 7 cm、高さ 22 cm）。ふたはコップを兼ねて横に置く
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), toon({ color: '#5a8a9a' })), jarX, 0.012 + 0.1, jarZ);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 10), steel), jarX, 0.012 + 0.215, jarZ);
  }

  // ---- 二重構造のカップ 2 つ（直径 8 cm、高さ 10 cm）。手前は自分の、奥は相手の
  const cupMats = [toon({ color: '#e9e4da' }), toon({ color: '#9fb59a' })];
  const cups = [[-0.2, 0.28], [0.42, -0.38]];
  cups.forEach(([x, z], i) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 10), cupMats[i]), x, 0.012 + 0.05, z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 10), warm ? soup : tea), x, 0.012 + 0.092, z);
  });

  // ---- パン（クラフト紙の上にコッペパン 2 つ）
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.004, 0.24), toon({ color: '#b8956a' })), -0.25, 0.014, -0.12, 0.2);
  for (const [x, z, r] of [[-0.3, -0.1, 0.3], [-0.2, -0.16, 0.1]]) {
    const bun = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 3, 6), toon({ color: '#c98a42' })), x, 0.05, z, r);
    bun.rotation.z = Math.PI / 2;
    bun.rotation.order = 'YZX';
  }

  // ---- ジュートのトートバッグ（40×35×12 cm）。シートの奥の角に立てて置く
  {
    const [cv, g] = makeCanvas(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#c2a574' : '#a8895a'; g.fillRect(x, y, 1, 1); }
    const tex = pixelTex(cv, true);
    tex.repeat.set(4, 4);
    const bag = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.12), toon({ map: tex })), 0.82, 0.012 + 0.175, -0.5, -0.3);
    bag.rotation.z = 0.06;
    for (const s of [-1, 1]) {
      const h = add(new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 4, 8, Math.PI), toon({ color: '#5b3d2b' })), 0.82 + s * 0.035, 0.012 + 0.35, -0.5 + s * 0.012, -0.3);
      h.rotation.y = -0.3;
    }
  }

  // ---- 保冷のランチバッグ（25×18×20 cm、くすんだ緑、ファスナーの線）
  add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.18), toon({ color: '#6f8a6a' })), -0.62, 0.012 + 0.1, -0.42, 0.25);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.012, 0.03), toon({ color: '#2f3a33' })), -0.62, 0.012 + 0.2, -0.42, 0.25);

  // ---- エアクッション（座る所）と枕（昼寝用、シートの左端）
  const air = toon({ color: '#e6d8b8' });
  const cushion = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 3, 8), air), 0.0, 0.012 + 0.07, 0.48);
  cushion.rotation.z = Math.PI / 2;
  cushion.scale.set(0.9, 1, 3.0);
  const pillow = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 3, 8), toon({ color: '#9ab0c4' })), -0.78, 0.012 + 0.05, 0.05);
  pillow.rotation.z = Math.PI / 2;
  pillow.scale.set(1, 1, 2.2);

  // ---- 文庫本（シートの右手前、開いて伏せずに置く）：右のページが風でめくれる（ループ周期で 1 回）
  const book = new THREE.Group();
  book.position.set(0.55, 0.014, 0.36); book.rotation.y = -0.5;
  const paper = toon({ color: '#fff6d6' });
  book.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.012, 0.16), toon({ color: '#2c4a7a' })));
  const leftPage = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.014, 0.15), paper); leftPage.position.set(-0.078, 0.01, 0); leftPage.rotation.z = 0.06; book.add(leftPage);
  const flip = new THREE.Group(); flip.position.set(0, 0.012, 0);
  flip.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.15).translate(0.075, 0, 0), paper));
  book.add(flip);
  book.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  group.add(book);

  // ---- 小さなランタン（LED。シートの左奥の角）：夕方から灯り、夜はシートのまわりを照らす
  const lanX = -0.82, lanZ = 0.52;
  const dark = toon({ color: '#26304f' });
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 8), dark), lanX, 0.027, lanZ);
  const glow = toon({ color: '#fff6d6', emissive: 0xffd98a, emissiveIntensity: 0.2 });
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 8), glow), lanX, 0.11, lanZ);
  const cap = add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.06, 4), dark), lanX, 0.2, lanZ); cap.rotation.y = Math.PI / 4;
  const lanLight = new THREE.PointLight(0xffc870, 0, 6, 1.6);
  lanLight.position.set(lanX, 0.3, lanZ);
  group.add(lanLight);

  // ---- 季節の小物：夏は麦わら帽子（赤いリボン）、冬はひざ掛け（たたんでクッションの横）
  if (season === 'summer') {
    const straw = toon({ color: '#f0c860' });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.02, 12), straw), -0.42, 0.022, 0.42);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.09, 10), straw), -0.42, 0.07, 0.42);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.117, 0.117, 0.03, 10), toon({ color: '#b8463f' })), -0.42, 0.045, 0.42);
  } else if (season === 'winter') {
    const [cv, g] = makeCanvas(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? '#a8463a' : '#e8dcc4'; g.fillRect(x, y, 1, 1); }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.3), toon({ map: pixelTex(cv) })), -0.45, 0.037, 0.42, 0.15);
  }

  // ---- 湯気（ジャーとカップ。秋・冬だけ）
  group.updateMatrixWorld(true);
  const sources = (warm ? [
    { p: new THREE.Vector3(jarX, 0.18, jarZ), n: 26, rise: 0.38, spread: 0.035 },
    ...cups.map(([x, z]) => ({ p: new THREE.Vector3(x, 0.12, z), n: 14, rise: 0.26, spread: 0.03 }))
  ] : []).map(s => ({ ...s, local: s.p.clone(), p: s.p.applyMatrix4(group.matrixWorld) }));
  const steam = createSteam({ scene, sources, loop });
  // 組を動かしたあと：湯気の出どころを合わせる
  function relocate() {
    group.updateMatrixWorld(true);
    for (const s of sources) s.p.copy(s.local).applyMatrix4(group.matrixWorld);
  }

  const items = {
    sheet: { w: W, d: D }, drink: warm ? 'soup jar 400 ml' : 'iced tea bottle 500 ml', cups: cups.length, tote: 'jute', cushion: 'air', pillow: true,
    lunchBag: true, bread: 2, book: true, lantern: true, extra: season === 'summer' ? 'straw hat' : season === 'winter' ? 'lap blanket' : null
  };
  const sheet = group.getObjectByName('sheet');
  return {
    group, steam, items, relocate, sheet, lantern: { mat: glow, light: lanLight },
    /**
     * @param {number} t   ループで折り返した時刻
     * @param {{night?:number, dusk?:number}} [env]  夜（0〜1）と夕暮れどき（0〜1）：ランタンの明るさ
     */
    update(t, env = null) {
      steam.update(t);
      flip.rotation.z = -(Math.max(0, Math.sin(t * W0)) ** 3) * 1.2;
      if (env) {
        glow.emissiveIntensity = 0.2 + (env.night ?? 0) * 2.2 + (env.dusk ?? 0) * 0.8;
        lanLight.intensity = (env.night ?? 0) * 4.5 + (env.dusk ?? 0) * 1.2;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 湯気：点ごとに薄くなる。位置はループ周期の関数なので、ループ動画の継ぎ目が出ない
// ---------------------------------------------------------------------------
const STEAM_VERT = `
  attribute float alpha;
  varying float vA;
  uniform float uSize;
  void main() {
    vA = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }`;
const STEAM_FRAG = `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vA;
  void main() {
    if (vA * uOpacity < 0.02) discard;
    gl_FragColor = vec4(uColor, vA * uOpacity);
  }`;

export function createSteam({ scene, sources, loop = 6, size = 2, wind = new THREE.Vector3(0.05, 0, 0.12) }) {
  const W0 = Math.PI * 2 / loop;
  const seeds = [];
  sources.forEach((s, si) => {
    for (let i = 0; i < s.n; i++) seeds.push({ s, ph: (i + 0.5) / s.n, a: i * 2.399 + si, speed: 1 + (i % 2) }); // 1 周または 2 周（6 秒・3 秒）
  });
  const n = seeds.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xf4f4f2) }, uOpacity: { value: 0.55 }, uSize: { value: size } },
    vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const pos = geo.attributes.position, al = geo.attributes.alpha;
  return {
    points: pts, material: mat, count: n,
    /** @param {number} t  経過時間（秒） */
    update(t) {
      seeds.forEach((d, i) => {
        const f = (t / loop * d.speed + d.ph) % 1;
        const sw = Math.sin(t * W0 * d.speed + d.a) * d.s.spread * (0.4 + f);
        pos.setXYZ(i,
          d.s.p.x + wind.x * f + sw * Math.cos(d.a),
          d.s.p.y + d.s.rise * f,
          d.s.p.z + wind.z * f + sw * Math.sin(d.a));
        al.setX(i, Math.sin(f * Math.PI) * (1 - f * 0.5));
      });
      pos.needsUpdate = al.needsUpdate = true;
    }
  };
}
