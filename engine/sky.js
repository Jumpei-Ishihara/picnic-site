// 空（グラデーション＋太陽・月・星）と、遠景の山並み・雲
import * as THREE from 'three';
import { glsl } from './pixel-kit.js';

const SKY_FRAG = `
  uniform vec3 uTop, uHor, uSunDir, uMoonDir, uSunCol; uniform float uNight, uTime, uCirrus;
  varying vec3 vDir;
  float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main(){
    vec3 d = normalize(vDir);
    float e = clamp(d.y, 0.0, 1.0);
    vec3 c = d.y < 0.0 ? uHor * 0.9 : mix(uHor, uTop, pow(e, 0.6));
    float s = dot(d, uSunDir);
    c += uSunCol * pow(max(s, 0.0), 18.0) * 0.35;
    c = mix(c, uSunCol * 1.6, smoothstep(0.9970, 0.9985, s) * step(0.0, uSunDir.y + 0.03));
    // cirrocumulus: small puffs in rows on a high layer, gathered into patches. still (no drift) so loops stay seamless
    if (uCirrus > 0.0 && d.y > 0.03) {
      vec2 p = d.xz / d.y * 2.2;
      float patchm = smoothstep(0.5, 0.82, vnoise(p * 0.35 + 3.0) * 0.7 + vnoise(p * 0.9) * 0.3);
      vec2 q = p * 3.2 * vec2(1.0, 1.4);
      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;
      vec2 jit = vec2(hsh(cell), hsh(cell + 7.1)) - 0.5;
      float r = length((f - jit * 0.35) * vec2(1.0, 1.6));
      float puff = 1.0 - smoothstep(0.14, 0.33, r);
      float a = patchm * puff * smoothstep(0.03, 0.2, d.y) * uCirrus;
      vec3 lit = mix(mix(vec3(1.0), uSunCol, 0.4), uHor * 1.1, 0.25);
      lit = mix(lit, mix(uHor, uTop, 0.5) * 1.25, uNight); // at night only faintly lighter than the sky
      c = mix(c, lit, a * (1.0 - uNight * 0.6));
    }
    float m = dot(d, uMoonDir);
    c = mix(c, vec3(0.92, 0.95, 1.0), smoothstep(0.9982, 0.9990, m) * uNight);
    if (uNight > 0.3 && d.y > 0.04) {
      vec3 g = floor(d * 160.0);
      float h = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      // 瞬きは6秒周期（ループ動画で継ぎ目が出ない）
      if (h > 0.9965) c += vec3(0.85, 0.9, 1.0) * (uNight - 0.3) * (0.55 + 0.45 * sin(uTime * 2.0943951 + h * 300.0));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

/**
 * @param {THREE.Scene} scene
 * @param {object} o
 * @param {() => number} o.rnd  山・雲の配置に使う乱数
 * @param {number} [o.radius]      空の球の半径（カメラの far より小さく、遠景より大きく）
 * @param {number} [o.cloudScale]  雲の距離・高さ・大きさの倍率（広い場面では大きく）
 * @param {number} [o.cirrus]      高い空のうろこ雲（巻積雲）の濃さ（0〜1、既定 0 = なし）
 */
export function createSky(scene, { rnd, mountains = 28, clouds: cloudCount = 9, radius = 250, cloudScale = 1, cirrus = 0 }) {
  const uniforms = {
    uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 }, uCirrus: { value: cirrus }
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: glsl(SKY_FRAG)
    })
  );
  mesh.frustumCulled = false;
  scene.add(mesh);

  // 霧の影響を受けない単色シルエット。色は時間帯で変わる。
  const farMat = new THREE.MeshBasicMaterial({ color: 0x5a8fd1, fog: false });
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < mountains; i++) {
    const a = (i / mountains) * Math.PI * 2 + rnd() * 0.1;
    const hgt = 14 + rnd() * 26;
    const m = new THREE.Mesh(new THREE.ConeGeometry(18 + rnd() * 14, hgt, 5), farMat);
    m.position.set(Math.cos(a) * 150, hgt / 2 - 4, Math.sin(a) * 150);
    m.rotation.y = rnd() * 3;
    scene.add(m);
  }
  const clouds = [];
  for (let i = 0; i < cloudCount; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry((4 + rnd() * 3) * cloudScale, 0), cloudMat);
      s.position.set((k * 5 - 5) * cloudScale, rnd() * 1.5 * cloudScale, rnd() * 3 * cloudScale);
      s.scale.y = 0.45;
      g.add(s);
    }
    const a = rnd() * Math.PI * 2;
    g.position.set(Math.cos(a) * 110 * cloudScale, (38 + rnd() * 18) * cloudScale, Math.sin(a) * 110 * cloudScale);
    g.lookAt(0, g.position.y, 0);
    clouds.push(g);
    scene.add(g);
  }

  return {
    mesh, uniforms, farMat, cloudMat, clouds,
    // 毎フレーム：星の瞬き・雲の流れ・空をカメラに追従
    update(dt, elapsed, cameraPos) {
      uniforms.uTime.value = elapsed;
      for (const c of clouds) c.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dt * 0.004);
      mesh.position.copy(cameraPos);
    }
  };
}
