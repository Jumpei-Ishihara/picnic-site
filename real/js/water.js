// 写実版の水面：空と対岸を映す平面反射（three の Reflector）、手続きで作る風の波、濁った江戸川の水の色、
//   見る角度で変わる反射の強さ（フレネル）、太陽のきらめき、浅い所の川底と岸の小さな泡
//   水深は地形（heightAt）から起動時に一度だけ計算してテクスチャにする
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  uniform mat4 textureMatrix;
  varying vec4 vRefl;
  varying vec3 vW;
  void main() {
    vRefl = textureMatrix * vec4(position, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D tDiffuse;
  uniform vec3 color;
  uniform sampler2D tDepth;
  uniform vec4 uDepthBox;     // x0, z0, x1, z1（水深テクスチャの範囲）
  uniform float uTime, uMaxDepth, uReflMix, uWave, uChop;
  uniform vec2 uFlow;         // 流れ・風の向き（xz）
  uniform vec3 uSunDir, uSunColor, uSky, uBody, uBed;
  uniform vec2 uResolution;
  varying vec4 vRefl;
  varying vec3 vW;

  float wHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
  }
  // 波の高さの勾配（いくつかの向きの波＋細かいさざ波のノイズ）。遠くは細かい波を弱める
  vec2 waveGrad(vec2 p, float dist) {
    vec2 g = vec2(0.0);
    float fadeFine = 1.0 - smoothstep(15.0, 120.0, dist);
    float fadeMid = 1.0 - smoothstep(80.0, 600.0, dist);
    vec2 f = normalize(uFlow), s = vec2(-f.y, f.x);
    // 向き・波長（m）・高さ（m）・速さ
    vec2 dirs[6]; float lens[6]; float amps[6];
    dirs[0] = normalize(f + 0.3 * s); lens[0] = 7.0;  amps[0] = 0.012;
    dirs[1] = normalize(f - 0.5 * s); lens[1] = 4.3;  amps[1] = 0.010;
    dirs[2] = normalize(s + 0.2 * f); lens[2] = 2.9;  amps[2] = 0.008;
    dirs[3] = normalize(-s + 0.6 * f); lens[3] = 1.7; amps[3] = 0.006;
    dirs[4] = normalize(f + 1.4 * s); lens[4] = 1.1;  amps[4] = 0.006;
    dirs[5] = normalize(f - 1.1 * s); lens[5] = 0.7;  amps[5] = 0.004;
    for (int i = 0; i < 6; i++) {
      float k = 6.2831853 / lens[i];
      float w = sqrt(9.8 * k);
      float fade = i < 2 ? fadeMid : fadeFine;
      g += dirs[i] * (amps[i] * k * cos(dot(dirs[i], p) * k - w * uTime)) * fade;
    }
    // さざ波（風で流れるノイズ）
    vec2 q = p * 1.7 + f * uTime * 0.6;
    float e = 0.05;
    float n0 = wNoise(q), nx = wNoise(q + vec2(e, 0.0)), nz = wNoise(q + vec2(0.0, e));
    vec2 q2 = p * 4.1 - s * uTime * 0.4;
    float m0 = wNoise(q2), mx = wNoise(q2 + vec2(e, 0.0)), mz = wNoise(q2 + vec2(0.0, e));
    g += (vec2(nx - n0, nz - n0) / e * 0.045 + vec2(mx - m0, mz - m0) / e * 0.018) * uChop * fadeFine;
    // 遠くのさざ波（大きめのノイズ。縞にならないように）
    vec2 q3 = p * 0.35 + f * uTime * 0.25;
    float o0 = wNoise(q3), ox = wNoise(q3 + vec2(e, 0.0)), oz = wNoise(q3 + vec2(0.0, e));
    g += vec2(ox - o0, oz - o0) / e * 0.06 * fadeMid;
    return g * uWave;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 toCam = cameraPosition - vW;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 g = waveGrad(vW.xz, dist);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    // 水深（地形から）。範囲の外は深い
    vec2 duv = (vW.xz - uDepthBox.xy) / (uDepthBox.zw - uDepthBox.xy);
    float depth = (duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0) ? uMaxDepth : texture2D(tDepth, duv).r * uMaxDepth;

    // 反射：波で映り込みをゆがめる（近いほど強く）
    vec2 rOff = N.xz * (0.035 + 0.25 / (1.0 + dist * 0.15));
    vec4 rp = vRefl; rp.xy += rOff * rp.w;
    vec3 refl = texture2DProj(tDiffuse, rp).rgb;
    refl = mix(uSky, refl, uReflMix);

    // フレネル（水の F0 = 0.02）
    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

    // 水の中の色：濁った緑褐色。浅い所は川底が透ける
    float sunUp = clamp(uSunDir.y * 2.0, 0.0, 1.0);
    vec3 light = uSunColor * (0.25 * sunUp) + uSky * 0.55;
    vec3 body = uBody * light;
    float shallow = 1.0 - smoothstep(0.0, 0.9, depth);
    body = mix(body, uBed * light, shallow * 0.6);

    vec3 col = mix(body, refl, F);

    // 太陽のきらめき（細い光沢＋ちらちらした点）
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    float spec = pow(nh, 900.0) * 6.0 + pow(nh, 120.0) * 0.25;
    col += uSunColor * spec * F * 8.0 * smoothstep(-0.02, 0.05, uSunDir.y);

    // 岸の小さな泡（水深 8 cm より浅い所に、波で揺れる帯）
    float foamN = wNoise(vW.xz * 3.0 + uTime * 0.3) * 0.6 + wNoise(vW.xz * 9.0 - uTime * 0.5) * 0.4;
    float foam = (1.0 - smoothstep(0.0, 0.12, depth)) * smoothstep(0.45, 0.75, foamN) * (1.0 - smoothstep(30.0, 90.0, dist));
    col = mix(col, light * 0.7, foam * 0.3);

    // 水際は薄く（地面との継ぎ目を目立たせない）
    float edge = smoothstep(0.0, 0.05, depth);
    gl_FragColor = vec4(col, mix(0.0, 1.0, edge));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {number} o.level              水面の高さ（y）
 * @param {{x0:number,z0:number,x1:number,z1:number}} o.bounds  水面を張る範囲
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {{x0:number,z0:number,x1:number,z1:number}} o.depthBox 水深を細かく計算する範囲（近景）
 * @param {number} [o.reflScale]        反射の解像度（画面に対する割合。0 で空の色だけ）
 * @param {number[]} [o.flow]           流れ・風の向き（xz）
 */
export function createRealWater({ scene, level, bounds, heightAt, depthBox, reflScale = 0.5, flow = [0.2, 1], maxDepth = 4 }) {
  // ---- 水深のテクスチャ（50 cm ごと）
  const step = 0.5;
  const dw = Math.round((depthBox.x1 - depthBox.x0) / step) + 1, dh = Math.round((depthBox.z1 - depthBox.z0) / step) + 1;
  const dd = new Uint8Array(dw * dh * 4);
  for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
    const d = Math.min(1, Math.max(0, (level - heightAt(depthBox.x0 + i * step, depthBox.z0 + j * step)) / maxDepth));
    dd[(j * dw + i) * 4] = Math.round(d * 255);
    dd[(j * dw + i) * 4 + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(dd, dw, dh, THREE.RGBAFormat);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const shader = {
    name: 'RealWater',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      tDepth: { value: null }, uDepthBox: { value: new THREE.Vector4() },
      uTime: { value: 0 }, uMaxDepth: { value: maxDepth }, uReflMix: { value: 1 }, uWave: { value: 1 }, uChop: { value: 1 },
      uFlow: { value: new THREE.Vector2() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSky: { value: new THREE.Color() },
      uBody: { value: new THREE.Color('#5c6040') }, uBed: { value: new THREE.Color('#7a7050') },
      uResolution: { value: new THREE.Vector2(1, 1) }
    }]),
    vertexShader: VERT,
    fragmentShader: FRAG
  };
  const W = bounds.x1 - bounds.x0, H = bounds.z1 - bounds.z0;
  const size = new THREE.Vector2(innerWidth * devicePixelRatio, innerHeight * devicePixelRatio);
  const tw = Math.max(64, Math.round(size.x * Math.max(reflScale, 0.1))), th = Math.max(64, Math.round(size.y * Math.max(reflScale, 0.1)));
  const mesh = new Reflector(new THREE.PlaneGeometry(W, H), { shader, textureWidth: tw, textureHeight: th, clipBias: 0.002, multisample: 0 });
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((bounds.x0 + bounds.x1) / 2, level, (bounds.z0 + bounds.z1) / 2);
  mesh.name = 'water';
  const mat = mesh.material;
  mat.fog = true;
  mat.transparent = true;
  mat.depthWrite = true;
  const U = mat.uniforms;
  U.tDepth.value = depthTex;
  U.uDepthBox.value.set(depthBox.x0, depthBox.z0, depthBox.x1, depthBox.z1);
  U.uFlow.value.set(flow[0], flow[1]);
  U.uReflMix.value = reflScale > 0 ? 1 : 0;
  if (reflScale <= 0) mesh.onBeforeRender = () => {}; // 反射を描かない（空の色だけ）
  scene.add(mesh);

  return {
    mesh,
    /** 毎フレーム：時間と光 */
    update(t, { sun, skyColor }) {
      U.uTime.value = t;
      U.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      U.uSunColor.value.copy(sun.color).multiplyScalar(sun.visible ? sun.intensity / Math.PI : 0);
      U.uSky.value.copy(skyColor);
    },
    resize(w, h) { if (reflScale > 0) mesh.getRenderTarget().setSize(Math.round(w * reflScale), Math.round(h * reflScale)); }
  };
}
