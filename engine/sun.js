// 実際の太陽・月の位置（日付・緯度経度・時刻から）と、場面の座標への変換
//   太陽：NOAA の近似式（誤差 0.1° 程度）
//   月：Paul Schlyter の簡易式（主な摂動つき、誤差 1° 程度。地平線での視差も補正）
// 方位は北を 0° とした時計回り。場面の座標は「-z が upstreamBearing の方位、+x がその右 90°」。
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const rev = d => ((d % 360) + 360) % 360;
const sind = d => Math.sin(d * D2R), cosd = d => Math.cos(d * D2R);

// 日付（'YYYY-MM-DD'）・現地時刻（時）・時差（時）から、2000年1月0日 0時（UT）からの日数
function dayNumber(date, hour, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + (hour - tz) * 3600e3;
  return ms / 86400e3 - (Date.UTC(1999, 11, 31) / 86400e3);
}

/** 太陽の高さ・方位（度）。NOAA の近似式。 */
export function solarPosition(date, hour, lat, lon, tz = 9) {
  const [y, m, d] = date.split('-').map(Number);
  const N = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400e3 + 1;
  const g = 2 * Math.PI / 365 * (N - 1 + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eq + 4 * lon - 60 * tz;
  const ha = (tst / 4 - 180) * D2R, la = lat * D2R;
  const cz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) * R2D + 180;
  return { elevation: 90 - zen * R2D, azimuth: rev(az) };
}

/** 月の高さ・方位（度）と満ち欠け（0 = 新月、1 = 満月）。 */
export function lunarPosition(date, hour, lat, lon, tz = 9) {
  const d = dayNumber(date, hour, tz);
  const ecl = 23.4393 - 3.563e-7 * d;
  // 太陽
  const ws = rev(282.9404 + 4.70935e-5 * d), Ms = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);
  // 月の軌道要素
  const Nm = rev(125.1228 - 0.0529538083 * d), i = 5.1454, w = rev(318.0634 + 0.1643573223 * d);
  const a = 60.2666, e = 0.0549, M = rev(115.3654 + 13.0649929509 * d);
  let E = M + R2D * e * sind(M) * (1 + e * cosd(M));
  for (let k = 0; k < 5; k++) E = E - (E - R2D * e * sind(E) - M) / (1 - e * cosd(E));
  const xv = a * (cosd(E) - e), yv = a * Math.sqrt(1 - e * e) * sind(E);
  const v = Math.atan2(yv, xv) * R2D, r = Math.hypot(xv, yv);
  const xh = r * (cosd(Nm) * cosd(v + w) - sind(Nm) * sind(v + w) * cosd(i));
  const yh = r * (sind(Nm) * cosd(v + w) + cosd(Nm) * sind(v + w) * cosd(i));
  const zh = r * sind(v + w) * sind(i);
  let mlon = Math.atan2(yh, xh) * R2D, mlat = Math.atan2(zh, Math.hypot(xh, yh)) * R2D;
  // 主な摂動
  const Lm = rev(Nm + w + M), D = rev(Lm - Ls), F = rev(Lm - Nm);
  mlon += -1.274 * sind(M - 2 * D) + 0.658 * sind(2 * D) - 0.186 * sind(Ms) - 0.059 * sind(2 * M - 2 * D)
    - 0.057 * sind(M - 2 * D + Ms) + 0.053 * sind(M + 2 * D) + 0.046 * sind(2 * D - Ms) + 0.041 * sind(M - Ms)
    - 0.035 * sind(D) - 0.031 * sind(M + Ms) - 0.015 * sind(2 * F - 2 * D) + 0.011 * sind(M - 4 * D);
  mlat += -0.173 * sind(F - 2 * D) - 0.055 * sind(M - F - 2 * D) - 0.046 * sind(M + F - 2 * D) + 0.033 * sind(F + 2 * D) + 0.017 * sind(2 * M + F);
  // 黄道 → 赤道 → 地平
  const x = cosd(mlat) * cosd(mlon), y = cosd(mlat) * sind(mlon), z = sind(mlat);
  const ye = y * cosd(ecl) - z * sind(ecl), ze = y * sind(ecl) + z * cosd(ecl);
  const ra = Math.atan2(ye, x) * R2D, dec = Math.atan2(ze, Math.hypot(x, ye)) * R2D;
  const ut = hour - tz;
  const ha = rev(Ls + 180 + ut * 15 + lon - ra);
  const hx = cosd(ha) * cosd(dec), hy = sind(ha) * cosd(dec), hz = sind(dec);
  const xhor = hx * sind(lat) - hz * cosd(lat), zhor = hx * cosd(lat) + hz * sind(lat);
  let alt = Math.asin(Math.max(-1, Math.min(1, zhor))) * R2D;
  alt -= Math.asin(cosd(alt) / r) * R2D; // 地球の上から見た視差
  const az = rev(Math.atan2(hy, xhor) * R2D + 180);
  const elong = Math.acos(cosd(mlat) * cosd(mlon - Ls)) * R2D;
  return { elevation: alt, azimuth: az, phase: (1 - cosd(elong)) / 2 };
}

/** 方位・高さ（度）を場面の向きのベクトルにする。 */
export function bearingToDir(azimuth, elevation, upstreamBearing = 0, out = new THREE.Vector3()) {
  const rel = (azimuth - upstreamBearing) * D2R, el = elevation * D2R;
  return out.set(Math.cos(el) * Math.sin(rel), Math.sin(el), -Math.cos(el) * Math.cos(rel));
}

/**
 * その日の太陽と月の通り道。createTimeOfDay の sunPath に渡す。
 * @param {object} o
 * @param {number} o.lat
 * @param {number} o.lon
 * @param {string} o.date           'YYYY-MM-DD'
 * @param {number} [o.tz]           時差（日本は 9）
 * @param {number} [o.upstreamBearing]  場面の -z の方位
 */
export function createSunPath({ lat, lon, date, tz = 9, upstreamBearing = 0 }) {
  const sunAt = h => solarPosition(date, h, lat, lon, tz);
  const moonAt = h => lunarPosition(date, h, lat, lon, tz);
  // 高さが el になる時刻を二分法で探す
  const cross = (f, el, a, b) => {
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if ((f(a).elevation - el) * (f(m).elevation - el) <= 0) b = m; else a = m;
    }
    return (a + b) / 2;
  };
  let noon = 12, best = -90;
  for (let h = 9; h <= 15; h += 0.01) { const e = sunAt(h).elevation; if (e > best) { best = e; noon = h; } }
  const sunrise = cross(sunAt, -0.83, 0, noon), sunset = cross(sunAt, -0.83, noon, 24);
  // 時間帯の色の表（DEFAULT_TOD_KEYS）は「5:30 に昇り 19:00 に沈む」前提で作ってある。
  // 実際の日の出・南中・日の入りを、その前提の時刻に合わせて読み替える
  const K_RISE = 5.5, K_NOON = 12.25, K_SET = 19.0;
  function keyHour(h) {
    if (h < sunrise) return K_RISE - (sunrise - h) * (K_RISE / sunrise);
    if (h < noon) return K_RISE + (h - sunrise) / (noon - sunrise) * (K_NOON - K_RISE);
    if (h < sunset) return K_NOON + (h - noon) / (sunset - noon) * (K_SET - K_NOON);
    return K_SET + (h - sunset) / (24 - sunset) * (24 - K_SET);
  }
  return {
    lat, lon, date, tz, upstreamBearing, sunrise, sunset, noon, keyHour, sunAt, moonAt,
    sunDir(h, out = new THREE.Vector3()) { const p = sunAt(h); return bearingToDir(p.azimuth, p.elevation, upstreamBearing, out); },
    moonDir(h, out = new THREE.Vector3()) { const p = moonAt(h); return bearingToDir(p.azimuth, p.elevation, upstreamBearing, out); },
    // 方位（度）から場面の水平な向き
    dirOfBearing(b, out = new THREE.Vector3()) { return bearingToDir(b, 0, upstreamBearing, out); },
    // 場面での yaw（カメラの rotation.y）。方位 b を向く
    yawOfBearing(b) { return -(b - upstreamBearing) * D2R; }
  };
}
