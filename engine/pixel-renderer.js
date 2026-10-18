// ドット絵レンダラー：低解像度で描画 → 輪郭線・ディザ・パレット減色 → CSS で拡大
import * as THREE from 'three';
import { MASTER_PALETTE, glsl } from './pixel-kit.js';

const hexToVec3 = h => {
  const n = parseInt(h.slice(1), 16);
  return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const POST_FRAG = `
  uniform sampler2D tColor, tDepth, tNormal;
  uniform vec2 uRes; uniform float uNear, uFar, uOutline, uPaletteOn, uDither;
  uniform vec3 uPal[PAL_N];
  uniform vec3 uShadowShift, uHighShift;       // 色の段階：暗部と明部の色相をずらす量（sRGB）
  uniform vec2 uSunUv; uniform float uRays;     // 光の筋：太陽の画面位置と強さ
  uniform vec3 uRayColor;
  uniform float uBloom;                         // 明るい点（太陽・きらめき・灯り）のにじみ
  uniform float uLevels;                        // パレットを使わないときの、各色の段階数-1（31 なら 32 段階）
  // 空気中の光の筋：視線に沿って影マップを調べ、日の当たる空気だけを光らせる
  uniform float uVol; uniform sampler2D tShadow; uniform mat4 uShadowMat, uInvProj, uCamWorld;
  uniform vec3 uCamPos, uVolDir, uVolColor; uniform float uVolMax;
  varying vec2 vUv;
  float unpackShadowDepth(vec4 v) { const float D = 255.0 / 256.0; return dot(v, D / vec4(16777216.0, 65536.0, 256.0, 1.0)); }
  vec3 worldAt(vec2 uv, float z) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); v /= v.w; return (uCamWorld * v).xyz; }
  vec3 over1(vec2 uv){ return max(texture2D(tColor, uv).rgb - 1.25, 0.0) * 1.6; } // only real light sources (sun, glints, lamps) glow
  float linDepth(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  vec3 nrm(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
  float bayer4(vec2 p){
    const float B[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    ivec2 q = ivec2(mod(p, 4.0));
    return (B[q.x + q.y * 4] + 0.5) / 16.0;
  }
  vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  void main(){
    vec2 px = 1.0 / uRes;
    vec3 col = texture2D(tColor, vUv).rgb;
    float d = linDepth(vUv);
    if (uOutline > 0.5 && d < uFar * 0.9) {
      // 平面では 1/depth が画面上で線形 → 2階差分で「手前に飛び出した」画素だけを輪郭にする
      float w  = 1.0 / d;
      float wl = 1.0 / linDepth(vUv - vec2(px.x, 0.0)), wr = 1.0 / linDepth(vUv + vec2(px.x, 0.0));
      float wd = 1.0 / linDepth(vUv - vec2(0.0, px.y)), wu = 1.0 / linDepth(vUv + vec2(0.0, px.y));
      float sil = max(max(w - wl, w - wr), max(w - wd, w - wu)) / w;
      float lap = max(2.0 * w - wl - wr, 2.0 * w - wd - wu) / w;
      vec3 n = nrm(vUv);
      float crease = 0.0;
      if (abs(wr - w) / w < 0.08) crease = max(crease, 1.0 - dot(n, nrm(vUv + vec2(px.x, 0.0))));
      if (abs(wu - w) / w < 0.08) crease = max(crease, 1.0 - dot(n, nrm(vUv + vec2(0.0, px.y))));
      float fade = 1.0 - smoothstep(32.0, 70.0, d);
      if (sil > 0.12 && lap > 0.06) col *= mix(1.0, 0.32, fade);
      else if (crease > 0.3) col *= mix(1.0, 1.28, fade);
    }
    float dith = bayer4(gl_FragCoord.xy);
    // にじみ：とても明るい点（1.25超）だけを、上下左右1〜2ドットと斜めに少しだけ広げる（ドット絵らしい十字の光）
    if (uBloom > 0.001) {
      vec3 g = over1(vUv + vec2(px.x, 0.0)) + over1(vUv - vec2(px.x, 0.0)) + over1(vUv + vec2(0.0, px.y)) + over1(vUv - vec2(0.0, px.y));
      g += 0.45 * (over1(vUv + vec2(2.0 * px.x, 0.0)) + over1(vUv - vec2(2.0 * px.x, 0.0)) + over1(vUv + vec2(0.0, 2.0 * px.y)) + over1(vUv - vec2(0.0, 2.0 * px.y)));
      g += 0.35 * (over1(vUv + px) + over1(vUv - px) + over1(vUv + vec2(px.x, -px.y)) + over1(vUv + vec2(-px.x, px.y)));
      col += g * 0.22 * uBloom;
    }
    // 光の筋：太陽へ向かって空（奥行きが最遠）が見えている割合を集める
    if (uRays > 0.001) {
      vec2 dir = uSunUv - vUv;
      float acc = 0.0;
      for (int i = 0; i < 20; i++) {
        vec2 uv = vUv + dir * ((float(i) + dith) / 20.0);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) acc += step(0.99995, texture2D(tDepth, uv).x);
      }
      col += uRayColor * (acc / 20.0) * exp(-length(dir * vec2(uRes.x / uRes.y, 1.0)) * 2.4) * uRays;
    }
    // 空気中の光の筋（木の葉のすき間を通る光が、空気に筋として見える）
    if (uVol > 0.001) {
      vec3 wp = worldAt(vUv, min(texture2D(tDepth, vUv).x, 0.99999));
      vec3 dir = wp - uCamPos;
      float len = min(length(dir), uVolMax);
      dir = normalize(dir);
      float stepL = len / 24.0, acc = 0.0;
      for (int i = 0; i < 24; i++) {
        vec3 p = uCamPos + dir * stepL * (float(i) + dith);
        vec4 sc = uShadowMat * vec4(p, 1.0);
        sc.xyz /= sc.w;
        float lit = 1.0;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) lit = step(sc.z - 0.003, unpackShadowDepth(texture2D(tShadow, sc.xy)));
        acc += lit * exp(-max(p.y, 0.0) * 0.35);   // low air is denser
      }
      acc *= stepL / uVolMax;
      float phase = 0.3 + 1.5 * pow(max(dot(dir, uVolDir), 0.0), 5.0);   // brighter toward the light
      col += uVolColor * acc * phase * uVol;
    }
    col = clamp(toSRGB(col), 0.0, 1.0); // 発光で 1 を超えた色を収める（下の pow が NaN にならないように）
    // 色の段階：影は青紫へ、光は黄みへ（色相をずらして平坦な明暗にしない）
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += uShadowShift * pow(1.0 - lum, 1.5) + uHighShift * pow(lum, 1.5);
    vec3 cd = col + (dith - 0.5) * uDither;
    if (uPaletteOn > 0.5) {
      float best = 1e9; vec3 bc = cd;
      for (int i = 0; i < PAL_N; i++) {
        vec3 dv = cd - uPal[i];
        float dist = dot(dv * dv, vec3(0.3, 0.59, 0.11));
        if (dist < best) { best = dist; bc = uPal[i]; }
      }
      col = bc;
    } else {
      col = floor(clamp(cd, 0.0, 1.0) * uLevels + 0.5) / uLevels;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {string[]} [o.palette]   減色に使う sRGB の色
 * @param {number} [o.pixelScale]  1ドットあたりの CSS ピクセル数
 * @param {number} [o.fov]         横長画面での縦FOV。縦長画面では横約70°を確保するよう自動で広げる
 */
export function createPixelRenderer({ canvas, scene, camera, palette = MASTER_PALETTE, pixelScale = 3, fov = 62, dither = 0.075 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // ドット絵向きのくっきりした影
  // 影は1フレームに1回だけ計算する（法線パス・反射パスでは前回のものを使い回す）
  renderer.shadowMap.autoUpdate = false;

  const normalMat = new THREE.MeshNormalMaterial();
  const camVec = new THREE.Vector3(), camDir = new THREE.Vector3(), camFwd = new THREE.Vector3();
  const postMat = new THREE.ShaderMaterial({
    defines: { PAL_N: palette.length },
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
      uRes: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far },
      uOutline: { value: 1 }, uPaletteOn: { value: 1 }, uDither: { value: dither },
      uPal: { value: palette.map(hexToVec3) },
      uShadowShift: { value: new THREE.Vector3() }, uHighShift: { value: new THREE.Vector3() },
      uSunUv: { value: new THREE.Vector2(0.5, 2) }, uRays: { value: 0 }, uRayColor: { value: new THREE.Color(1, 0.8, 0.5) },
      uBloom: { value: 0 }, uLevels: { value: 15 },
      uVol: { value: 0 }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() },
      uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld }, uCamPos: { value: camera.position },
      uVolDir: { value: new THREE.Vector3(0, 1, 0) }, uVolColor: { value: new THREE.Color(1, 0.9, 0.7) }, uVolMax: { value: 30 }
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: glsl(POST_FRAG),
    depthTest: false, depthWrite: false
  });
  const postScene = new THREE.Scene();
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 法線パスで描かないもの（空・パーティクルなど）
  const hideInNormalPass = new Set();
  let colorRT = null, normalRT = null, lowW = 320, lowH = 180;
  let fixed = null; // 書き出し中は決まった解像度で描く（例 320×180 → 4倍で 1280×720）

  function resize() {
    if (fixed) { lowW = fixed.width; lowH = fixed.height; }
    else {
      lowW = Math.max(160, Math.floor(window.innerWidth / pixelScale));
      lowH = Math.max(90, Math.floor(window.innerHeight / pixelScale));
    }
    canvas.style.objectFit = fixed ? 'contain' : ''; // 画面の比率が違っても歪めずに表示
    renderer.setSize(lowW, lowH, false);
    camera.aspect = lowW / lowH;
    // 縦長画面では横の視野が狭くなりすぎるので、縦FOVを広げて横約70°を確保する
    camera.fov = camera.aspect >= 1 ? fov : Math.min(95, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / camera.aspect) * 180 / Math.PI);
    camera.updateProjectionMatrix();
    if (colorRT) { colorRT.dispose(); colorRT.depthTexture.dispose(); normalRT.dispose(); }
    colorRT = new THREE.WebGLRenderTarget(lowW, lowH, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(lowW, lowH)
    });
    normalRT = new THREE.WebGLRenderTarget(lowW, lowH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    postMat.uniforms.tColor.value = colorRT.texture;
    postMat.uniforms.tDepth.value = colorRT.depthTexture;
    postMat.uniforms.tNormal.value = normalRT.texture;
    postMat.uniforms.uRes.value.set(lowW, lowH);
  }
  window.addEventListener('resize', resize);
  resize();

  // 水面の反射・屈折など、本描画の前に別の描画をするときは先に呼ぶ（その描画でも、このコマの影を使うように）
  let shadowsPrepared = false;
  function prepareShadows() { renderer.shadowMap.needsUpdate = true; shadowsPrepared = true; }

  function render() {
    // 影は 1 コマに 1 回。prepareShadows() を呼んでいれば、そのとき（最初の描画）に計算済み
    if (!shadowsPrepared) renderer.shadowMap.needsUpdate = true;
    shadowsPrepared = false;
    renderer.setRenderTarget(colorRT);
    renderer.render(scene, camera);

    for (const o of hideInNormalPass) o.visible = false;
    scene.overrideMaterial = normalMat;
    renderer.setClearColor(0x8080ff, 1);
    renderer.setRenderTarget(normalRT);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of hideInNormalPass) o.visible = true;

    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  return {
    renderer, render, prepareShadows, resize, hideInNormalPass,
    get size() { return { width: lowW, height: lowH }; },
    get pixelScale() { return pixelScale; },
    setPixelScale(s) { pixelScale = s; resize(); },
    // 解像度を固定する（null で画面サイズに戻す）
    setFixedSize(size) { fixed = size; resize(); },
    get outline() { return postMat.uniforms.uOutline.value > 0.5; },
    setOutline(on) { postMat.uniforms.uOutline.value = on ? 1 : 0; },
    /**
     * パレットを使わないときの色の段階と、ディザの強さ。
     * 例：setQuantize(32, 0.032) → 各色 32 段階（旧版と同じ）でなめらかに
     */
    setQuantize(levels, ditherAmount) {
      postMat.uniforms.uLevels.value = levels - 1;
      if (ditherAmount !== undefined) postMat.uniforms.uDither.value = ditherAmount;
    },
    /**
     * 空気中の光の筋。影を落とす光（DirectionalLight）の影マップを視線に沿って調べる。
     * 毎フレーム呼ぶ。strength 0 で無効。
     * @param {THREE.DirectionalLight} light
     */
    setVolumetric(light, strength, color, maxDistance = 30) {
      const u = postMat.uniforms;
      u.uVol.value = light.shadow.map ? strength : 0; // 影マップは最初の描画で作られる
      if (!light.shadow.map) return;
      u.tShadow.value = light.shadow.map.texture;
      u.uShadowMat.value = light.shadow.matrix;
      u.uVolDir.value.copy(light.position).sub(light.target.position).normalize();
      if (color) u.uVolColor.value.copy(color);
      u.uVolMax.value = maxDistance;
    },
    // 明るい点のにじみの強さ（0 で無効。既定 0）
    setBloom(v) { postMat.uniforms.uBloom.value = v; },
    get paletteOn() { return postMat.uniforms.uPaletteOn.value > 0.5; },
    setPaletteOn(on) { postMat.uniforms.uPaletteOn.value = on ? 1 : 0; },
    /**
     * 色の段階：暗部・明部に足す色のずれ（sRGB, 各 -0.1〜0.1 程度）。既定はずらさない。
     * @param {{ shadow: number[], highlight: number[] }} g
     */
    setGrade({ shadow = [0, 0, 0], highlight = [0, 0, 0] }) {
      postMat.uniforms.uShadowShift.value.fromArray(shadow);
      postMat.uniforms.uHighShift.value.fromArray(highlight);
    },
    /**
     * 光の筋（太陽が画面の近くにあるとき、木や建物の隙間から差す光）。strength 0 で無効。
     * @param {THREE.Vector3} sunDir  太陽の方向（ワールド）
     * @param {number} strength
     * @param {THREE.Color} [color]  線形色
     */
    setSunRays(sunDir, strength, color) {
      const u = postMat.uniforms;
      const p = camVec.copy(camera.position).addScaledVector(sunDir, 100).project(camera);
      const facing = camDir.copy(sunDir).dot(camera.getWorldDirection(camFwd));
      // 太陽が背後にあるときは消す。画面外でも近ければ弱く残す
      const off = Math.max(0, Math.max(Math.abs(p.x), Math.abs(p.y)) - 1);
      u.uRays.value = facing > 0 ? strength * Math.max(0, 1 - off * 0.8) : 0;
      u.uSunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      if (color) u.uRayColor.value.copy(color);
    },
    uniforms: postMat.uniforms
  };
}
