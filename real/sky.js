// 写実版の空と光：太陽の高さで色の変わる空、実際の太陽の位置の日光、空から作る環境光（PMREM）、霞
//   空は解析的なグラデーション（天頂・地平・太陽側の暖色・太陽のまわりの光・太陽の円盤）。
//   three の Sky（Preetham）は晴れた日の天頂が白っぽくなるので使わない
//   時刻を変えたときだけ環境光を作り直す（毎フレームは作らない）
import * as THREE from 'three';

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = hex => new THREE.Color(hex); // ColorManagement で sRGB → 線形

// 太陽の高さ（度）ごとの空の色（sRGB）。間は補間する
const KEYS = [
  { el: -12, zenith: '#03060f', horizon: '#0a0f1c', warm: '#0a0f1c' },
  { el: -6,  zenith: '#0e1730', horizon: '#3a3a52', warm: '#7a4a48' },
  { el: -2,  zenith: '#22355e', horizon: '#9a7a78', warm: '#e0805a' },
  { el: 2,   zenith: '#3a5a92', horizon: '#d8b8a0', warm: '#ffa060' },
  { el: 8,   zenith: '#3f6aac', horizon: '#d2d4d6', warm: '#ffc890' },
  { el: 20,  zenith: '#3e72bc', horizon: '#c6d6e4', warm: '#f2e6d2' },
  { el: 60,  zenith: '#3a74c4', horizon: '#c4d6e6', warm: '#e8eef2' }
];

function keyColors(el) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = smooth(a.el, b.el, el);
  const mix = k => lin(a[k]).lerp(lin(b[k]), t);
  return { zenith: mix('zenith'), horizon: mix('horizon'), warm: mix('warm') };
}

const SKY_VERT = /* glsl */`
  #include <common>
  varying vec3 vDir;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const SKY_FRAG = /* glsl */`
  uniform vec3 uSun, uZenith, uHorizon, uWarm, uGround;
  uniform float uScale, uDisk, uGlow;
  varying vec3 vDir;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    // 天頂へ向かって濃くなる（地平の近くが厚い）
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
    // 太陽の方位の地平は暖色（夕方に強く）
    vec2 sh = normalize(uSun.xz + 1e-5), dh = normalize(d.xz + 1e-5);
    float side = pow(max(dot(sh, dh), 0.0) * 0.5 + 0.5, 3.0);
    float low = 1.0 - smoothstep(0.0, 0.5, up);
    col = mix(col, uWarm, side * low * 0.85);
    // 太陽のまわりの光（ミー散乱）と円盤
    float mu = max(dot(d, uSun), 0.0);
    col += uWarm * (pow(mu, 12.0) * 0.35 + pow(mu, 200.0) * 0.8) * uGlow;
    col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99985, 0.99995, mu) * uDisk;
    // 地平の下は霞の色から地面の色へ
    if (d.y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, 0.25, -d.y));
    gl_FragColor = vec4(col * uScale, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {object} o.sunPath     engine/sun.js の createSunPath（または season.js の seasonalSunPath）
 * @param {number} [o.shadowSize] 影の解像度
 * @param {number} [o.shadowExtent] 影の範囲（カメラのまわり、m）
 * @param {number} [o.haze]      霞の濃さ（FogExp2 の density）
 */
export function createRealSky({ renderer, scene, sunPath, shadowSize = 2048, shadowExtent = 70, haze = 0.0004, hour = 12, exposure = 0.55 }) {
  const uniforms = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uWarm: { value: new THREE.Color() },
    uGround: { value: lin('#3a3c30') },
    uScale: { value: 1 }, uDisk: { value: 40 }, uGlow: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  sky.scale.setScalar(4500);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.name = 'sky';
  scene.add(sky);
  renderer.toneMappingExposure = exposure;

  // 環境光を作るための空（同じマテリアル）
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, material);
  envSky.scale.setScalar(100);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  // ---- 日光と空の光
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -shadowExtent; sc.right = sc.top = shadowExtent;
  sc.near = 1; sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd4ee, 0x4a4a34, 0.1); // 夜の暗がりを真っ黒にしないための補い
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(0xbfcfdc, haze);

  const sunDir = new THREE.Vector3();
  const warmSun = lin('#ff9a52'), whiteSun = lin('#fff4e4');
  const state = { hour: -1, elevation: 0, day: 1, night: 0, sunDir };
  let envHour = -99;

  function apply(h) {
    state.hour = h;
    sunPath.sunDir(h, sunDir);
    const el = sunPath.sunAt(h).elevation;
    state.elevation = el;
    const day = smooth(-4, 5, el), golden = 1 - smooth(3, 25, el);
    state.day = day; state.night = 1 - smooth(-10, -1, el);
    const k = keyColors(el);
    uniforms.uSun.value.copy(sunDir);
    uniforms.uZenith.value.copy(k.zenith);
    uniforms.uHorizon.value.copy(k.horizon);
    uniforms.uWarm.value.copy(k.warm);
    uniforms.uScale.value = 1.5;
    uniforms.uDisk.value = 60 * smooth(-1, 1, el);
    uniforms.uGlow.value = 0.6 + 1.2 * golden;
    // 日光：夕方は暖色で弱く
    sun.color.copy(whiteSun).lerp(warmSun, golden);
    sun.intensity = 8.2 * day * (0.45 + 0.55 * smooth(0, 20, el));
    sun.visible = day > 0.01;
    hemi.intensity = 0.04 + 0.1 * day;
    // 霞の色は地平の色（太陽の反対側と太陽側の間）に合わせて、遠くが空に溶けるように
    scene.fog.color.copy(k.horizon).lerp(k.warm, 0.25 * golden).multiplyScalar(uniforms.uScale.value);
    if (Math.abs(h - envHour) > 0.04) {
      envRT?.dispose();
      envRT = pmrem.fromScene(envScene, 0, 1, 200);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.7;
      envHour = h;
    }
  }

  // 影の範囲をカメラのまわりに。光の向きは太陽の向き
  function follow(center) {
    const d = 320;
    // 影の格子に合わせて動かす（歩くたびに影の縁がちらつかないように）
    const texel = (2 * shadowExtent) / shadowSize;
    sun.target.position.set(Math.round(center.x / texel) * texel, center.y, Math.round(center.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, d);
  }

  apply(hour);
  return { sky, sun, hemi, state, uniforms, apply, follow, get hour() { return state.hour; } };
}
