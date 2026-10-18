// ドット絵の水面（旧版 picnic_3d.html の作り方を移植）
//   ・細かく強い波（1mあたり28マスに揃えた法線）
//   ・波で歪む鏡面反射（画面と同じ解像度）
//   ・屈折：水の下の景色（川底）を波で歪めて見せ、深さで浅いエメラルド→深い青に沈める
//   ・川底に落ちる光の模様、岸の泡、太陽（夜は月）のきらめきの筋、波紋
import * as THREE from 'three';
import { glsl } from './pixel-kit.js';

const MAX_RIPPLES = 6;

const VERT = `
  uniform mat4 uTexMat;
  varying vec3 vWorld; varying vec4 vRefl; varying vec4 vClip;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vRefl = uTexMat * wp;
    vClip = projectionMatrix * viewMatrix * wp;
    gl_Position = vClip;
  }`;

const FRAG = `
  uniform sampler2D tRefl, tRefr, tDepth;
  uniform vec4 uBounds;          // 深さマップの範囲 x0, z0, x1, z1
  uniform float uMaxDepth, uTime, uLoop, uWave, uCaustic, uClarity, uFogNear, uFogFar;
  uniform vec2 uWaveFade;          // この距離の範囲で波を弱める（遠くの細かい波はちらつくため）
  uniform vec3 uShallow, uDeep, uFoam, uCausticCol, uLightDir, uLightCol, uFogColor;
  uniform vec4 uRip[${MAX_RIPPLES}]; // x, z, 半径（大きさ 1 のとき）, 強さ
  uniform float uRipS[${MAX_RIPPLES}]; // 大きさ（遠くの水面をタップしたときは大きく）
  varying vec3 vWorld; varying vec4 vRefl; varying vec4 vClip;

  float W0() { return 6.2831853 / uLoop; } // ループ周期に揃えた角速度
  float hsh2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float waveH(vec2 p) {
    float t = uTime * W0();
    return (sin(p.x * 6.5 - p.y * 4.2 - t * 3.0) * 0.018
          + cos(p.x * 4.8 + p.y * 7.1 + t * 2.0) * 0.014
          + sin(p.y * 11.0 - t * 4.0) * 0.008) * uWave;
  }
  float rippleH(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRip[i];
      if (r.w > 0.01 && r.z < 6.0) {
        float s = uRipS[i];
        float d = length(p - r.xy) / s, diff = abs(d - r.z);
        if (diff < 0.45) h += sin((d - r.z) * 18.0) * 0.035 * s * (1.0 - r.z / 6.0) * (1.0 - diff / 0.45) * r.w;
      }
    }
    return h;
  }
  float H(vec2 p) { return waveH(p) + rippleH(p); }

  void main(){
    float t = uTime * W0();
    // 法線を 1/28 m の格子で求める（ドット絵らしく、面ごとに切り替わる水面）
    vec2 q = floor(vWorld.xz * 28.0) / 28.0;
    float e = 0.035, hC = H(q);
    vec3 n = normalize(vec3(hC - H(q + vec2(e, 0.0)), e, hC - H(q + vec2(0.0, e))));
    float camDist = length(cameraPosition - vWorld);
    // nR: reflection / refraction lookups. far away the wave offset would grab the dark far bank, so flatten it.
    // the glint below keeps the full normal so the sun's glitter path still reaches the horizon
    // ripples (taps) are kept at any distance: the flattened target still carries the ripple-only normal
    float rC = rippleH(q);
    vec3 nFlat = normalize(vec3(rC - rippleH(q + vec2(e, 0.0)), e, rC - rippleH(q + vec2(0.0, e))));
    vec3 nR = normalize(mix(n, nFlat, smoothstep(uWaveFade.x, uWaveFade.y, camDist)));
    vec2 duv = (vWorld.xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
    // 深さマップの範囲の外は深いものとする
    float inside = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
    float depth = mix(uMaxDepth, texture2D(tDepth, duv).r * uMaxDepth, inside);
    vec3 V = normalize(cameraPosition - vWorld);

    // 反射：波で揺らした鏡像
    vec3 refl = texture2D(tRefl, vRefl.xy / vRefl.w + nR.xz * 0.6).rgb;

    // 屈折：水の下の景色を波で歪めて見る。浅いところほど川底がはっきり見える
    vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
    vec3 bed = texture2D(tRefr, suv + nR.xz * 0.3 * clamp(depth * 2.0, 0.0, 1.0)).rgb;
    // 川底に落ちる光の模様
    if (uCaustic > 0.01 && depth < 0.75) {
      vec2 c = floor((vWorld.xz + n.xz * 0.35) * 18.0) / 18.0;
      float c1 = sin(c.x * 9.5 + c.y * 7.2 - t * 2.0), c2 = cos(c.x * 8.1 - c.y * 10.4 + t * 2.0);
      if ((c1 + c2) * 0.5 > 0.52) bed += uCausticCol * (1.0 - depth / 0.75) * 0.55 * uCaustic;
    }
    float depthF = clamp(depth * 1.65 / uClarity, 0.0, 1.0);
    vec3 body = mix(uShallow, uDeep, depthF);
    vec3 refr = mix(body, bed, clamp(1.0 - depthF * 0.82, 0.15, 0.88));

    // フレネル：見下ろすと川底、浅い角度では景色が映る
    float fres = clamp(0.22 + 0.74 * pow(1.0 - clamp(dot(V, nR), 0.0, 1.0), 3.2), 0.2, 0.92);
    vec3 col = mix(refr, refl, fres);

    // 岸辺の泡（寄せては返す）
    if (depth < 0.05 + sin(vWorld.z * 5.5 + t * 3.0) * 0.02) col = uFoam;

    // 太陽（夜は月）のきらめきの筋：白い芯と水色のふち
    // far away the wave grid would alias into rings: flatten the glint normal there and use a sparkle path instead
    float far = smoothstep(uWaveFade.y, uWaveFade.y * 4.0, camDist);
    if (uLightDir.y > 0.0) {
      vec3 nG = normalize(mix(n, nFlat, far));
      float sp = pow(max(dot(nG, normalize(uLightDir + V)), 0.0), 60.0);
      if (sp > 0.38) col = sp > 0.62 ? uLightCol * 1.35 + 0.12 : mix(col, vec3(0.82, 0.96, 1.0) * max(uLightCol, vec3(0.35)), 0.55);
      if (far > 0.0) {
        // glitter path toward the sun: random cells light up, 12 patterns per loop (seamless)
        float lobe = pow(max(normalize(uLightDir + V).y, 0.0), 14.0);
        float k = floor(fract(uTime / uLoop) * 12.0);
        float g = hsh2(floor(vWorld.xz * vec2(0.7, 1.6)) + k * 13.7);
        if (g > 1.0 - lobe * 0.55) col = mix(col, uLightCol * 1.3 + 0.1, far);
      }
    }

    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, camDist));
    gl_FragColor = vec4(col, 1.0);
  }`;

// 旧版の時間帯ごとの水の色（sRGB）：[浅い, 深い, 泡, 川底の光]
const TINTS = {
  day:   ['#47bdb3', '#1a5c8f', '#ebfaff', '#6bd1c7'],
  dusk:  ['#b8706b', '#3d295c', '#ffdbb8', '#d98c40'],
  night: ['#1f5475', '#0d1f40', '#7f99bf', '#3c6a8a']
};

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {{x0:number, z0:number, x1:number, z1:number}} o.bounds  水面を張る範囲（陸の下に隠れる部分は地形が覆う）
 * @param {(x:number, z:number) => number} o.groundHeight   川底・岸の高さ。深さの計算に使う
 * @param {number} [o.level]      水面の高さ
 * @param {number} [o.loop]       波の周期（秒）。動画のループと揃える
 * @param {number[][][]} [o.shape]  水面の形（[x, z] の点の並び。複数可）。省くと bounds の四角。広い川は水際に沿って張ると無駄が少ない
 * @param {{x0:number, z0:number, x1:number, z1:number}} [o.depthBounds]  深さマップの範囲（既定は bounds）。外は maxDepth の深さとみなす
 * @param {number} [o.clarity]    水の澄み具合。小さいほど浅くても川底が見えない（濁った川は 0.3 前後）
 * @param {number} [o.caustic]    川底の光の模様の強さ（0〜1）
 * @param {number} [o.wave]       波の強さ
 * @param {number[]} [o.waveFade] [近, 遠]（m）。この範囲でカメラから遠い波を弱める。広い川で遠くの水面がちらつくのを防ぐ
 */
export function createPixelWater({ renderer, scene, camera, bounds, groundHeight, level = 0, maxDepth = 1.0, loop = 6, depthRes = 256, tints = TINTS, shape = null, depthBounds = bounds, clarity = 1, caustic = 1, wave = 1, waveFade = [1e4, 2e4] }) {
  // 深さマップ：地形から一度だけ焼く
  const data = new Uint8Array(depthRes * depthRes);
  for (let j = 0; j < depthRes; j++) for (let i = 0; i < depthRes; i++) {
    const x = depthBounds.x0 + (i + 0.5) / depthRes * (depthBounds.x1 - depthBounds.x0);
    const z = depthBounds.z0 + (j + 0.5) / depthRes * (depthBounds.z1 - depthBounds.z0);
    data[j * depthRes + i] = Math.round(255 * Math.min(1, Math.max(0, level - groundHeight(x, z)) / maxDepth));
  }
  const depthTex = new THREE.DataTexture(data, depthRes, depthRes, THREE.RedFormat);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  // Color は sRGB の16進を線形に直して持つ
  const T = Object.fromEntries(Object.entries(tints).map(([k, v]) => [k, v.map(h => new THREE.Color(h))]));
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 99, 0));
  const rippleScale = new Array(MAX_RIPPLES).fill(1);
  const uniforms = {
    tRefl: { value: null }, tRefr: { value: null }, tDepth: { value: depthTex }, uTexMat: { value: new THREE.Matrix4() },
    uBounds: { value: new THREE.Vector4(depthBounds.x0, depthBounds.z0, depthBounds.x1, depthBounds.z1) },
    uMaxDepth: { value: maxDepth }, uTime: { value: 0 }, uLoop: { value: loop }, uWave: { value: wave }, uCaustic: { value: caustic }, uClarity: { value: clarity }, uWaveFade: { value: new THREE.Vector2(...waveFade) },
    uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() }, uCausticCol: { value: new THREE.Color() },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color() }, uFogNear: { value: 1e4 }, uFogFar: { value: 2e4 },
    uRip: { value: ripples }, uRipS: { value: rippleScale }
  };
  // ShapeGeometry は xy 平面に作られ、x 軸で -90° 回すと (x, y) → (x, -y) が (x, z) になる
  const geo = shape
    ? new THREE.ShapeGeometry(shape.map(poly => new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))))).rotateX(-Math.PI / 2)
    : new THREE.PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: glsl(VERT), fragmentShader: glsl(FRAG) }));
  if (shape) mesh.position.y = level;
  else mesh.position.set((bounds.x0 + bounds.x1) / 2, level, (bounds.z0 + bounds.z1) / 2);
  scene.add(mesh);

  // 反射用カメラ：水面で上下を折り返した位置から、水面より上だけを描く
  const mirrorCam = new THREE.PerspectiveCamera();
  const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level + 0.02);
  const dir = new THREE.Vector3(), look = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  let reflRT = null, refrRT = null;
  const makeRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

  // 水面を描く前に毎フレーム呼ぶ：反射（鏡像）と屈折（水の下の景色）を描いておく
  function renderReflection(width, height) {
    if (!reflRT || reflRT.width !== width || reflRT.height !== height) {
      if (reflRT) { reflRT.dispose(); refrRT.dispose(); }
      reflRT = makeRT(width, height);
      refrRT = makeRT(width, height);
      uniforms.tRefl.value = reflRT.texture;
      uniforms.tRefr.value = refrRT.texture;
    }
    camera.updateMatrixWorld();
    mirrorCam.copy(camera);
    mirrorCam.position.y = 2 * level - camera.position.y;
    camera.getWorldDirection(dir);
    dir.y = -dir.y;
    mirrorCam.up.set(0, 1, 0);
    mirrorCam.lookAt(look.copy(mirrorCam.position).add(dir));
    mirrorCam.updateMatrixWorld();
    mirrorCam.updateProjectionMatrix();
    uniforms.uTexMat.value.copy(bias).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);

    mesh.visible = false;
    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = [clip];
    renderer.setRenderTarget(reflRT);
    renderer.render(scene, mirrorCam);
    renderer.clippingPlanes = prevClip;
    renderer.setRenderTarget(refrRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    mesh.visible = true;
  }

  const a = new THREE.Color();
  // 昼・夕・夜の色を重みで混ぜる
  const blend = (target, i, warm, night) => {
    const day = Math.max(0, 1 - warm - night);
    target.setRGB(0, 0, 0)
      .add(a.copy(T.day[i]).multiplyScalar(day))
      .add(a.copy(T.dusk[i]).multiplyScalar(warm))
      .add(a.copy(T.night[i]).multiplyScalar(night));
  };

  return {
    mesh, uniforms, renderReflection,
    // 水深（m）。岸の外は 0
    depthAt(x, z) { return Math.max(0, level - groundHeight(x, z)); },
    clearRipples() { for (const r of ripples) r.set(0, 0, 99, 0); },
    /**
     * 波紋を起こす。scale は波紋の大きさ（輪の幅・広がる速さ・最大の半径が scale 倍。傾きは同じ）。
     * 遠くの水面をタップしたとき、画面での見え方を近くと同じくらいにするのに使う
     */
    addRipple(x, z, strength = 1, scale = 1) {
      let best = 0;
      for (let i = 0; i < ripples.length; i++) if (ripples[i].z > ripples[best].z) best = i; // 一番広がった（古い）枠を使う
      ripples[best].set(x, z, 0.05, strength);
      rippleScale[best] = scale;
    },
    /**
     * 毎フレーム：時刻・光・霧・波紋を更新
     * @param {{ sun: THREE.DirectionalLight, night: number, warm?: number, fog?: THREE.Fog }} env  warm は夕暮れらしさ（0〜1）
     */
    update(dt, elapsed, { sun, night, warm = 0, fog }) {
      uniforms.uTime.value = elapsed;
      const w = Math.min(warm, 1 - night);
      blend(uniforms.uShallow.value, 0, w, night);
      blend(uniforms.uDeep.value, 1, w, night);
      blend(uniforms.uFoam.value, 2, w, night);
      blend(uniforms.uCausticCol.value, 3, w, night);
      uniforms.uCaustic.value = caustic * (1 - night * 0.8);
      uniforms.uLightDir.value.copy(sun.position).sub(sun.target.position).normalize();
      uniforms.uLightCol.value.copy(sun.color).multiplyScalar(Math.min(1, sun.intensity / 2.6) * 0.8 + 0.2);
      if (fog) { uniforms.uFogColor.value.copy(fog.color); uniforms.uFogNear.value = fog.near; uniforms.uFogFar.value = fog.far; }
      for (const r of ripples) if (r.z < 6.5) r.z += dt * 1.45;
    }
  };
}
