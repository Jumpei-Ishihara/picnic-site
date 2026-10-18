// 江戸川の場面の絵作り（10 月中旬）：時間帯の色の表、秋の地面の 3 色、時刻ごとの仕上げ
import * as THREE from 'three';

// 2026-10-18 の実際の時刻で書いた色の表（createTimeOfDay の keyClock: 'real' で使う）
//   日の出 5:48、南中 11:25、日の入り 17:02、市民薄明の終わり 約 17:28
// h: 時刻 / top・hor: 空の上・地平線 / sun・si: 太陽（夜は月）の色と強さ / hs・hg・hi: 空と地面からの環境光 / night: 夜らしさ
export const EDO_TOD_KEYS = [
  { h: 0,     top: '#0b1030', hor: '#1d2752', sun: '#8fa8ff', si: 0.35, hs: '#2a3a70', hg: '#10121c', hi: 0.5,  night: 1 },
  { h: 4.9,   top: '#141a45', hor: '#3a3468', sun: '#8fa8ff', si: 0.3,  hs: '#323a74', hg: '#141420', hi: 0.5,  night: 0.95 },
  { h: 5.5,   top: '#3a4a8a', hor: '#d88a6a', sun: '#ffa060', si: 0.8,  hs: '#7a80b0', hg: '#2a2228', hi: 0.65, night: 0.4 },
  { h: 6.3,   top: '#4a6aa8', hor: '#f2b07a', sun: '#ffc080', si: 1.6,  hs: '#a0a8c8', hg: '#4a3a30', hi: 0.8,  night: 0.05 },
  { h: 7.6,   top: '#3c7fd6', hor: '#bfe0f6', sun: '#fff0d0', si: 2.4,  hs: '#bfe0ff', hg: '#6a6a48', hi: 1.0,  night: 0 },
  // 秋晴れの昼：空の上は深い青、地平線は澄んだ水色。太陽は南中でも高さ 44° なので、夏より少し弱く黄みがある
  { h: 11.4,  top: '#3874cc', hor: '#cfe6f6', sun: '#fff2dc', si: 2.5,  hs: '#c4dcf0', hg: '#6a6a48', hi: 1.0,  night: 0 },
  { h: 14.6,  top: '#3a76cc', hor: '#d6e8f2', sun: '#fff0d4', si: 2.45, hs: '#c4dcf0', hg: '#6a6a48', hi: 1.0,  night: 0 },
  // 15 時台から光が金色に（10 月は日が短い）
  { h: 15.6,  top: '#4676c4', hor: '#e6e6d2', sun: '#ffdca8', si: 2.25, hs: '#c8d4e4', hg: '#6a5e44', hi: 0.97, night: 0 },
  { h: 16.4,  top: '#556eb0', hor: '#f2cc92', sun: '#ffb870', si: 1.85, hs: '#c8b4b0', hg: '#5a4a3a', hi: 0.92, night: 0 },
  { h: 16.95, top: '#4a4a8e', hor: '#f0905a', sun: '#ff8a4a', si: 1.25, hs: '#b08aa8', hg: '#4a3640', hi: 0.85, night: 0.02 },
  { h: 17.3,  top: '#2e2a5e', hor: '#c86a6a', sun: '#8fa8ff', si: 0.45, hs: '#6a6090', hg: '#22182a', hi: 0.65, night: 0.3 },
  { h: 17.9,  top: '#141a40', hor: '#3a3a6a', sun: '#8fa8ff', si: 0.35, hs: '#2a3a70', hg: '#10121c', hi: 0.52, night: 0.9 },
  { h: 24,    top: '#0b1030', hor: '#1d2752', sun: '#8fa8ff', si: 0.35, hs: '#2a3a70', hg: '#10121c', hi: 0.5,  night: 1 }
];

// 秋（10 月中旬）の地面の 3 色（暗・中・明）。芝は少し黄ばみ、ススキの所は枯れ色
export const EDO_GROUND_LOOKS = {
  water:      { c: ['#4a4a32', '#5a573a', '#6b6744'], pattern: 'mud' },
  lawn:       { c: ['#567a32', '#6f9042', '#8da656'], pattern: 'grass' },
  lawnWorn:   { c: ['#84884c', '#9d9f62', '#b8b67e'], pattern: 'grass' },
  dirt:       { c: ['#a8875e', '#bfa076', '#d6bb90'], pattern: 'speckle' },
  paved:      { c: ['#9a9a92', '#b2b2aa', '#c8c8c0'], pattern: 'slab' },
  revetment:  { c: ['#7a7a72', '#908f86', '#a6a59a'], pattern: 'block' },
  leveeGrass: { c: ['#52763a', '#678a44', '#82a052'], pattern: 'grass' },
  road:       { c: ['#55565c', '#64656b', '#75767c'], pattern: 'asphalt' },
  tree:       { c: ['#46682c', '#587a36', '#6f9042'], pattern: 'grass' },
  reeds:      { c: ['#8a8445', '#a39c56', '#bdb46a'], pattern: 'grass' },
  other:      { c: ['#6f7f48', '#86955a', '#9fae6c'], pattern: 'grass' }
};
export const EDO_MID_LOOKS = { town: '#8e877c', grass: '#78924a', pitch: '#9aa060', water: '#4a4a32' };

const mix3 = parts => {
  const out = [0, 0, 0];
  for (const [w, v] of parts) for (let i = 0; i < 3; i++) out[i] += w * v[i];
  return out;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * 時刻ごとの仕上げ：素材ごとの 3 色の色ずらし、色の段階、空気中の光の筋、太陽の光の筋、電線・湯気・窓明かり
 * @returns {{ update(): { day:number, warm:number, night:number, sunEl:number } }}
 */
export function createLook({ pixel, RAMP, tod, sun, sunPath, sky, wires, steam, nightLights = [] }) {
  const cSky = new THREE.Color(), cWire = new THREE.Color(0x5a5e68);
  const state = { day: 1, warm: 0, night: 0, sunEl: 45 };
  return {
    state,
    update() {
      const night = tod.night, sd = tod.state.sunDir;
      const sunEl = sunPath.sunAt(tod.hour).elevation;
      // 朝夕らしさ：太陽の高さ 16° から地平線にかけて強まる。沈んだあとは夜に移る
      const warm = smooth(16, 1.5, sunEl) * (1 - night) * (sunEl > -6 ? 1 : 0);
      const day = Math.max(0, 1 - warm - night);
      Object.assign(state, { day, warm, night, sunEl });
      // 3 色：昼は影を青緑、朝夕は影を紫・光を橙、夜は青
      RAMP.shadow.value.fromArray(mix3([[day, [0.26, 0.3, 0.36]], [warm, [0.32, 0.22, 0.36]], [night, [0.2, 0.24, 0.36]]]));
      RAMP.mid.value.fromArray(mix3([[day, [0.76, 0.77, 0.76]], [warm, [0.84, 0.7, 0.64]], [night, [0.62, 0.7, 0.86]]]));
      RAMP.high.value.fromArray(mix3([[day, [1.2, 1.14, 0.94]], [warm, [1.3, 1.02, 0.76]], [night, [1.05, 1.0, 0.95]]]));
      pixel.setGrade({
        shadow: mix3([[day, [0, 0, 0.015]], [warm, [0.015, -0.01, 0.03]], [night, [-0.01, 0, 0.025]]]),
        highlight: mix3([[day, [0.012, 0.006, -0.012]], [warm, [0.03, 0.01, -0.025]], [night, [0, 0, 0.01]]])
      });
      // 空気中の光の筋：遮るもの（木）が少ない河川敷なので弱め。夕日のときだけ鉄塔や木の影から出る
      pixel.setVolumetric(sun, day * 0.12 + warm * 0.75 + night * 0.25, sun.color, 60);
      pixel.setSunRays(sd, sd.y > 0.0 ? warm * 0.85 : 0, sun.color);
      // 電線：空の色に寄せて、地平線のあたりで黒い束にならないように
      if (wires) {
        cSky.copy(sky.uniforms.uHor.value).lerp(sky.uniforms.uTop.value, 0.3);
        wires.material.color.copy(cWire).multiplyScalar(0.6 + 0.4 * day).lerp(cSky, 0.45);
      }
      // 湯気：逆光・日陰・夕方ほど見える
      if (steam) steam.material.uniforms.uOpacity.value = 0.5 + warm * 0.3 + (1 - Math.max(0, sd.y)) * 0.15;
      // 窓明かり（家・建物・電車）：日が沈むと灯る
      const lamp = smooth(0.05, 0.6, night);
      for (const m of nightLights) m.emissiveIntensity = lamp * (m.userData.lampMax ?? 1.2);
      return state;
    }
  };
}
