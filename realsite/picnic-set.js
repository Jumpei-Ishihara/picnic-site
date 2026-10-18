// 実在の場所の場面のピクニックの持ち物（企画提案書の「身軽ピクニック」）：
//   レジャーシート 200×140、スープジャー 400 ml と湯気、二重構造のカップ 2 つ、ジュートのトートバッグ、
//   エアクッションと枕、保冷のランチバッグ、パン
// シートの向き：組の -z が川の側（座ると正面）、+z が座る側。単位は m。
import * as THREE from 'three';
import { makeCanvas, pixelTex } from '../engine/pixel-kit.js';

const W = 2.0, D = 1.4; // シートの大きさ

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(p:object) => THREE.Material} o.toon
 * @param {{ x:number, z:number }} o.at
 * @param {number} o.yaw       シートの向き（カメラの yaw と同じ考え方。-z が川）
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {number} [o.loop]
 */
export function createPicnicSet({ scene, toon, at, yaw, heightAt, loop = 6 }) {
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
  const jarX = 0.12, jarZ = -0.12;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.036, 0.15, 10), steel), jarX, 0.012 + 0.075, jarZ);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.0385, 0.0385, 0.05, 10), band), jarX, 0.012 + 0.05, jarZ);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.004, 10), soup), jarX, 0.012 + 0.148, jarZ);
  const lid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.04, 10), band), jarX + 0.13, 0.012 + 0.02, jarZ + 0.04);
  lid.name = 'jar-lid';

  // ---- 二重構造のカップ 2 つ（直径 8 cm、高さ 10 cm）。手前は自分の、奥は相手の
  const cupMats = [toon({ color: '#e9e4da' }), toon({ color: '#9fb59a' })];
  const cups = [[-0.2, 0.28], [0.42, -0.38]];
  cups.forEach(([x, z], i) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 10), cupMats[i]), x, 0.012 + 0.05, z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 10), soup), x, 0.012 + 0.092, z);
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

  // ---- 湯気（ジャーとカップ）
  group.updateMatrixWorld(true);
  const sources = [
    { p: new THREE.Vector3(jarX, 0.18, jarZ), n: 26, rise: 0.38, spread: 0.035 },
    ...cups.map(([x, z]) => ({ p: new THREE.Vector3(x, 0.12, z), n: 14, rise: 0.26, spread: 0.03 }))
  ].map(s => ({ ...s, p: s.p.applyMatrix4(group.matrixWorld) }));
  const steam = createSteam({ scene, sources, loop });

  const items = {
    sheet: { w: W, d: D }, soupJar: '400 ml', cups: cups.length, tote: 'jute', cushion: 'air', pillow: true, lunchBag: true, bread: 2
  };
  return { group, steam, items, update: steam.update };
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
