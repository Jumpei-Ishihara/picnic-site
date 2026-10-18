// 太陽・環境光と、時間帯（キーフレームを連続補間）。sunPath を渡すと実際の太陽・月の位置を使う
import * as THREE from 'three';

// h: 時刻 / top・hor: 空の上・地平線 / sun・si: 太陽（夜は月）の色と強さ
// hs・hg・hi: 空と地面からの環境光の色と強さ / night: 夜らしさ（0〜1）
export const DEFAULT_TOD_KEYS = [
  { h: 0,    top: '#0b1030', hor: '#1d2752', sun: '#8fa8ff', si: 0.35, hs: '#2a3a70', hg: '#10121c', hi: 0.5,  night: 1 },
  { h: 4.8,  top: '#141a45', hor: '#3a3468', sun: '#8fa8ff', si: 0.3,  hs: '#323a74', hg: '#141420', hi: 0.5,  night: 0.95 },
  { h: 6.2,  top: '#4a64a6', hor: '#f29a6b', sun: '#ffb070', si: 1.2,  hs: '#8a90c0', hg: '#3a2a30', hi: 0.75, night: 0.35 },
  { h: 8.5,  top: '#3c7fd6', hor: '#b6dcf6', sun: '#fff0d0', si: 2.6,  hs: '#bfe0ff', hg: '#5a6a4a', hi: 1.0,  night: 0 },
  { h: 15.5, top: '#3a78d0', hor: '#c8e6fa', sun: '#fff4e0', si: 2.6,  hs: '#bfe0ff', hg: '#5a6a4a', hi: 1.0,  night: 0 },
  { h: 16.7, top: '#3a70c8', hor: '#dcecf2', sun: '#fff0d4', si: 2.4,  hs: '#c4dcf2', hg: '#5a6a4a', hi: 0.97, night: 0 }, // 夕方へ移る前は青みを保つ（中間色が灰色に減色されないように）
  { h: 17.4, top: '#4a5aa0', hor: '#f6c95b', sun: '#ffb060', si: 1.9,  hs: '#c8a8a8', hg: '#4a3a3a', hi: 0.85, night: 0.1 },
  { h: 18.6, top: '#3a2a6a', hor: '#e06a4f', sun: '#ff7a40', si: 1.0,  hs: '#8a6a90', hg: '#2a1a2a', hi: 0.65, night: 0.5 },
  { h: 19.8, top: '#141a40', hor: '#3a3a6a', sun: '#8fa8ff', si: 0.3,  hs: '#2a3a70', hg: '#10121c', hi: 0.5,  night: 0.95 },
  { h: 24,   top: '#0b1030', hor: '#1d2752', sun: '#8fa8ff', si: 0.35, hs: '#2a3a70', hg: '#10121c', hi: 0.5,  night: 1 }
];

// 影を落とす太陽（夜は月）と、空・地面からの環境光
export function createLights(scene, { shadowSize = 2048, extent = 42, far = 160 } = {}) {
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x5a6a4a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.12;
  scene.add(sun, sun.target);
  return { sun, hemi };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene   霧の色を地平線に合わせる
 * @param {ReturnType<import('./sky.js').createSky>} o.sky
 * @param {THREE.DirectionalLight} o.sun
 * @param {THREE.HemisphereLight} o.hemi
 * @param {(state: {hour:number, night:number, sunDir:THREE.Vector3}) => void} [o.onApply]  窓の明かりなど場面固有の更新
 * @param {number} [o.hoursPerSecond]  自動で進めるときの速さ（既定：現実の15秒 = 1時間）
 * @param {number} [o.sunZ]  太陽の通り道の南北のずれ（+ で南側、- で北側）。逆光の構図にしたい場面では北側に
 * @param {number[]} [o.moonDir]  月（夜の光）の方向
 * @param {number} [o.fogSkyMix]  霧（遠景）の色を地平線から空の上の色へ寄せる割合。0〜1。遠景が灰色に沈むのを防ぐ
 * @param {ReturnType<import('./sun.js').createSunPath>} [o.sunPath]  実際の太陽・月の通り道。渡すと sunZ・moonDir の代わりに使い、
 *   時間帯の色の表は日の出・日の入りに合わせて読み替える
 * @param {number} [o.lightDistance]  影を落とす光を置く距離（影の中心から）
 * @param {'sun'|'real'} [o.keyClock]  sunPath があるとき、色の表の時刻の読み方。'sun'：日の出・日の入りに合わせて読み替える、'real'：その日の実際の時刻で書いた表
 */
export function createTimeOfDay({ scene, sky, sun, hemi, keys = DEFAULT_TOD_KEYS, hour = 14, fogFar = 72, fogNightShrink = 18, hoursPerSecond = 1 / 15, fogSkyMix = 0, sunZ = 0.45, moonDir: moonDirArr = [-0.5, 0.7, 0.35], sunPath = null, lightDistance = 70, keyClock = 'sun', onApply }) {
  const cA = new THREE.Color(), cB = new THREE.Color(), white = new THREE.Color(1, 1, 1);
  const lerpHex = (target, a, b, t) => target.copy(cA.set(a)).lerp(cB.set(b), t);
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3().fromArray(moonDirArr).normalize();
  const state = { hour, night: 0, sunDir, auto: false };
  const u = sky.uniforms;
  // 影の中心（setShadowCenter で動かす）。影の格子の 1 マス単位に揃えて、動いても影がちらつかないようにする
  const center = new THREE.Vector3(), snapped = new THREE.Vector3();
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function placeLight(dir) {
    const cam = sun.shadow.camera;
    const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
    az.copy(dir);
    ax.crossVectors(Math.abs(az.y) > 0.999 ? ax.set(1, 0, 0) : UP, az).normalize();
    ay.crossVectors(az, ax);
    const cx = Math.round(center.dot(ax) / texel) * texel, cy = Math.round(center.dot(ay) / texel) * texel;
    snapped.copy(ax).multiplyScalar(cx).addScaledVector(ay, cy).addScaledVector(az, center.dot(az));
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(dir, lightDistance);
  }

  function apply(h = state.hour) {
    state.hour = h;
    const kh = sunPath && keyClock === 'sun' ? sunPath.keyHour(h) : h;
    let i = 0;
    while (i < keys.length - 2 && kh >= keys[i + 1].h) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const t = Math.min(1, Math.max(0, (kh - k0.h) / (k1.h - k0.h)));
    const L = (a, b) => a + (b - a) * t;
    lerpHex(u.uTop.value, k0.top, k1.top, t);
    lerpHex(u.uHor.value, k0.hor, k1.hor, t);
    lerpHex(sun.color, k0.sun, k1.sun, t);
    lerpHex(hemi.color, k0.hs, k1.hs, t);
    lerpHex(hemi.groundColor, k0.hg, k1.hg, t);
    sun.intensity = L(k0.si, k1.si);
    hemi.intensity = L(k0.hi, k1.hi);
    state.night = L(k0.night, k1.night);

    if (sunPath) {
      // 実際の太陽と月。月が沈んでいる夜は、決めておいた向き（moonDir）から弱く照らす
      sunPath.sunDir(h, sunDir);
      sunPath.moonDir(h, moonDir);
      if (moonDir.y < 0.05) moonDir.fromArray(moonDirArr).normalize();
    } else {
      // 5:30 に東から昇り 19:00 に西へ沈む。沈んでいる間は月の方向から照らす。
      const a = (h - 5.5) / 13.5 * Math.PI;
      sunDir.set(Math.cos(a), Math.sin(a), sunZ).normalize();
    }
    u.uSunDir.value.copy(sunDir);
    u.uMoonDir.value.copy(moonDir);
    u.uSunCol.value.copy(sun.color);
    u.uNight.value = state.night;
    placeLight(sunDir.y > 0.06 ? sunDir : moonDir);

    if (scene.fog) {
      scene.fog.color.copy(u.uHor.value).lerp(u.uTop.value, fogSkyMix);
      scene.fog.far = fogFar - state.night * fogNightShrink;
    }
    sky.farMat.color.copy(u.uHor.value).lerp(u.uTop.value, 0.45).multiplyScalar(0.78);
    sky.cloudMat.color.copy(u.uHor.value).lerp(white, 0.55 - state.night * 0.4);
    if (onApply) onApply(state);
    return state;
  }

  return {
    state, apply, sunPath,
    // 影を付ける範囲の中心（カメラの位置など）。広い場面で毎フレーム呼ぶ
    setShadowCenter(v) { center.set(v.x, 0, v.z); },
    get hour() { return state.hour; },
    set hour(h) { state.hour = ((h % 24) + 24) % 24; },
    get night() { return state.night; },
    get auto() { return state.auto; },
    set auto(v) { state.auto = v; },
    // 毎フレーム：自動で時間を進めてから反映
    update(dt) {
      if (state.auto) state.hour = (state.hour + dt * hoursPerSecond) % 24;
      return apply(state.hour);
    }
  };
}
