// 風で揺れる草（まとめ描き）：芝の房、ススキ・オギの株と穂。頂点シェーダーでループ周期に揃えて揺らす
import * as THREE from 'three';

// 細い葉を何枚か束ねた形（足元が原点、高さ h）
function bladeGeometry({ blades = 3, width = 0.07, height = 0.26, spread = 0.05, droop = 0 }) {
  const pos = [];
  for (let k = 0; k < blades; k++) {
    const a = k / blades * Math.PI, h = height * (0.85 + 0.3 * (k % 2)), lean = spread * (k - (blades - 1) / 2);
    const c = Math.cos(a), s = Math.sin(a);
    const P = (x, y) => [x * c, y, x * s];
    // 先が垂れる葉：中ほどで折る
    if (droop > 0) {
      const mx = lean * 0.6, my = h * 0.7;
      pos.push(...P(-width / 2, 0), ...P(width / 2, 0), ...[mx * c, my, mx * s]);
      pos.push(...[mx * c - width * 0.3 * s, my, mx * s + width * 0.3 * c], ...[mx * c + width * 0.3 * s, my, mx * s - width * 0.3 * c], ...[(lean + droop) * c, h - droop * 0.5, (lean + droop) * s]);
    } else {
      pos.push(...P(-width / 2, 0), ...P(width / 2, 0), ...[lean * c, h, lean * s]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 地面と同じ向きに照らす（細い葉の向きで明るさがばらつかないように）
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

// 穂（ススキ）：先の垂れた細長い房
function plumeGeometry({ length = 0.35, width = 0.06 }) {
  const pos = [];
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    // 根元 → 先（少し横へ垂れる）
    pos.push(-width / 2 * c, 0, -width / 2 * s, width / 2 * c, 0, width / 2 * s, length * 0.35, length, length * 0.1);
    pos.push(-width / 2 * c, 0, -width / 2 * s, length * 0.35, length, length * 0.1, -width * 0.2 * c, length * 0.6, -width * 0.2 * s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

/**
 * 風で揺れる草の群れ。place で置き場所を返し、ループ周期 loop 秒で揺れる。
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(p:object) => THREE.Material} o.material   トゥーンのマテリアルを作る関数
 * @param {number} o.count
 * @param {() => ({x:number, y:number, z:number, scale?:number, color:string}|null)} o.place  置く場所（null なら置かない）
 * @param {{ value: number }} o.time     経過時間（秒）。毎フレーム更新する
 * @param {number} [o.loop]   揺れの周期（秒）
 * @param {number} [o.amp]    揺れの大きさ（高さ 1 m あたり）
 * @param {'tuft'|'reed'|'plume'} [o.kind]
 * @param {number} [o.heightScale]
 */
export function createSwayingGrass({ scene, material, count, place, time, loop = 6, amp = 0.22, kind = 'tuft', blade = {}, rnd = Math.random, wind = [1, 0.5] }) {
  const geo = kind === 'plume' ? plumeGeometry(blade)
    : kind === 'reed' ? bladeGeometry({ blades: 7, width: 0.05, height: 1.5, spread: 0.12, droop: 0.25, ...blade })
      : bladeGeometry(blade);
  // 深度を書かない：細い葉に輪郭線が付いて黒い棘に見えるのを防ぐ
  const mat = material({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const W0 = Math.PI * 2 / loop;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uGrassTime = time;
    sh.vertexShader = 'uniform float uGrassTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float sw = sin(uGrassTime * ${W0.toFixed(6)} + ip.x * 0.7 + ip.y * 0.45) * ${amp.toFixed(3)}
                 + sin(uGrassTime * ${(2 * W0).toFixed(6)} + ip.x * 1.9 - ip.y) * ${(amp * 0.36).toFixed(3)};
        float k = position.y * position.y / max(position.y + 0.3, 0.3);
        transformed.x += sw * k * ${wind[0].toFixed(3)};
        transformed.z += sw * k * ${wind[1].toFixed(3)};
      #endif`);
  };
  mat.customProgramCacheKey = () => 'sway-' + kind;

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 8; tries++) {
    const s = place();
    if (!s) continue;
    const k = s.scale ?? 1;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw ?? rnd() * Math.PI * 2);
    m.compose(p.set(s.x, s.y, s.z), q, sc.set(k, k * (s.stretch ?? 1), k));
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, col.set(s.color));
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
