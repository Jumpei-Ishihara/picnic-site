#!/usr/bin/env node
/**
 * Riverside Picnic Pixel Art — Direct ~/Downloads Exporter & Local Bridge Server
 * Renders crisp 1280x720 (4x nearest-neighbor from 320x180) PNGs and 60fps H.264 MP4 loop videos
 * directly into ~/Downloads (or $EXPORT_DIR).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const { spawnSync, spawn } = require('child_process');

const W = 320;
const H = 180;
const SCALE = 4; // 1280 x 720 output
const OUT_W = W * SCALE;
const OUT_H = H * SCALE;
const LOOP_PERIOD = 6.0;
const W0 = (Math.PI * 2) / LOOP_PERIOD;

const DOWNLOADS_DIR = process.env.EXPORT_DIR || path.join(os.homedir(), 'Downloads');
const FFMPEG_BIN = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';

const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
];

function rgb(r, g, b) {
  return (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

function mixColor(c1, c2, t) {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const r1 = c1 & 255, g1 = (c1 >> 8) & 255, b1 = (c1 >> 16) & 255;
  const r2 = c2 & 255, g2 = (c2 >> 8) & 255, b2 = (c2 >> 16) & 255;
  const r = (r1 + (r2 - r1) * t) | 0;
  const g = (g1 + (g2 - g1) * t) | 0;
  const b = (b1 + (b2 - b1) * t) | 0;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function addLight(c, rAdd, gAdd, bAdd) {
  const r = Math.min(255, Math.max(0, (c & 255) + rAdd)) | 0;
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) + gAdd)) | 0;
  const b = Math.min(255, Math.max(0, ((c >> 16) & 255) + bAdd)) | 0;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function ditherColor(x, y, c1, c2, t) {
  const threshold = (BAYER4[y & 3][x & 3] + 0.5) / 16.0;
  return t > threshold ? c2 : c1;
}

function hash2D(x, y) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) ^ Math.imul(x, 1274126177);
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

const PALETTES = {
  day: {
    skyTop: rgb(68, 152, 238),
    skyMid: rgb(125, 198, 250),
    skyHorizon: rgb(212, 244, 255),
    sunCore: rgb(255, 255, 240),
    sunHalo: rgb(255, 244, 180),
    cloudLight: rgb(255, 253, 248),
    cloudMid: rgb(224, 238, 250),
    cloudShadow: rgb(172, 200, 230),
    mtFar: rgb(138, 178, 218),
    mtNear: rgb(95, 146, 184),
    farTreesLit: rgb(118, 188, 112),
    farTreesMid: rgb(68, 142, 96),
    farTreesDark: rgb(38, 92, 82),
    grassHi: rgb(166, 222, 92),
    grassLit: rgb(112, 188, 74),
    grassMid: rgb(68, 144, 64),
    grassShadow: rgb(36, 94, 58),
    grassDeep: rgb(22, 60, 48),
    barkLit: rgb(156, 110, 74),
    barkMid: rgb(108, 70, 52),
    barkDark: rgb(64, 40, 38),
    leafSpark: rgb(216, 245, 130),
    leafHi: rgb(148, 212, 82),
    leafMid: rgb(82, 162, 66),
    leafShadow: rgb(42, 106, 60),
    leafDeep: rgb(22, 62, 48),
    waterShallow: rgb(74, 186, 178),
    waterMid: rgb(38, 132, 168),
    waterDeep: rgb(24, 82, 136),
    waterSparkle: rgb(255, 255, 235),
    waterSubSparkle: rgb(195, 248, 255),
    foam: rgb(235, 252, 255),
    rayR: 72, rayG: 64, rayB: 28,
    causticR: 55, causticG: 85, causticB: 70
  },
  sunset: {
    skyTop: rgb(58, 42, 108),
    skyMid: rgb(178, 76, 112),
    skyHorizon: rgb(255, 176, 92),
    sunCore: rgb(255, 250, 210),
    sunHalo: rgb(255, 140, 72),
    cloudLight: rgb(255, 220, 156),
    cloudMid: rgb(232, 128, 110),
    cloudShadow: rgb(112, 62, 104),
    mtFar: rgb(128, 78, 124),
    mtNear: rgb(88, 52, 98),
    farTreesLit: rgb(186, 112, 78),
    farTreesMid: rgb(104, 62, 76),
    farTreesDark: rgb(54, 34, 62),
    grassHi: rgb(218, 168, 74),
    grassLit: rgb(156, 128, 58),
    grassMid: rgb(98, 92, 52),
    grassShadow: rgb(56, 54, 52),
    grassDeep: rgb(34, 30, 44),
    barkLit: rgb(198, 114, 68),
    barkMid: rgb(112, 58, 52),
    barkDark: rgb(58, 30, 42),
    leafSpark: rgb(255, 206, 108),
    leafHi: rgb(196, 142, 62),
    leafMid: rgb(114, 88, 54),
    leafShadow: rgb(62, 48, 54),
    leafDeep: rgb(34, 26, 42),
    waterShallow: rgb(184, 114, 102),
    waterMid: rgb(118, 68, 104),
    waterDeep: rgb(54, 38, 84),
    waterSparkle: rgb(255, 246, 190),
    waterSubSparkle: rgb(255, 172, 98),
    foam: rgb(255, 214, 175),
    rayR: 96, rayG: 52, rayB: 14,
    causticR: 88, causticG: 54, causticB: 28
  },
  night: {
    skyTop: rgb(12, 18, 44),
    skyMid: rgb(22, 36, 76),
    skyHorizon: rgb(42, 68, 112),
    sunCore: rgb(245, 250, 255),
    sunHalo: rgb(140, 185, 235),
    cloudLight: rgb(92, 122, 168),
    cloudMid: rgb(52, 74, 118),
    cloudShadow: rgb(26, 38, 72),
    mtFar: rgb(30, 48, 86),
    mtNear: rgb(20, 34, 66),
    farTreesLit: rgb(46, 86, 108),
    farTreesMid: rgb(26, 54, 78),
    farTreesDark: rgb(14, 30, 52),
    grassHi: rgb(74, 138, 132),
    grassLit: rgb(46, 98, 104),
    grassMid: rgb(28, 66, 82),
    grassShadow: rgb(18, 42, 60),
    grassDeep: rgb(10, 24, 40),
    barkLit: rgb(88, 78, 92),
    barkMid: rgb(52, 46, 66),
    barkDark: rgb(28, 24, 42),
    leafSpark: rgb(130, 198, 210),
    leafHi: rgb(68, 128, 142),
    leafMid: rgb(38, 82, 102),
    leafShadow: rgb(20, 48, 70),
    leafDeep: rgb(12, 28, 46),
    waterShallow: rgb(32, 84, 118),
    waterMid: rgb(20, 54, 92),
    waterDeep: rgb(12, 30, 62),
    waterSparkle: rgb(235, 250, 255),
    waterSubSparkle: rgb(135, 215, 245),
    foam: rgb(160, 215, 240),
    rayR: 26, rayG: 48, rayB: 68,
    causticR: 28, causticG: 68, causticB: 88
  }
};

const farShoreY = new Int16Array(W);
const nearBankY = new Int16Array(W);
for (let x = 0; x < W; x++) {
  farShoreY[x] = Math.round(74 + Math.sin(x * 0.025) * 3 + Math.cos(x * 0.06) * 1.5);
  if (x < 36) {
    nearBankY[x] = Math.round(164 + (x / 36) * 18 + Math.sin(x * 0.25) * 1.5);
  } else if (x < 102) {
    nearBankY[x] = 190;
  } else {
    const u = Math.min(1, (x - 102) / 145);
    const smooth = u * u * (3 - 2 * u);
    const wave = Math.sin(x * 0.08) * 2.2 + Math.cos(x * 0.19) * 1.2;
    nearBankY[x] = Math.round(180 - smooth * 80 + wave);
  }
}

const pebbles = [];
for (let i = 0; i < 190; i++) {
  const px = (hash2D(i, 11) * W) | 0;
  const py = (76 + hash2D(i, 23) * 102) | 0;
  const rx = 2 + ((hash2D(i, 37) * 4) | 0);
  const ry = 1 + ((hash2D(i, 53) * 2) | 0);
  const shade = hash2D(i, 71);
  pebbles.push({ x: px, y: py, rx, ry, shade });
}

const canopyClusters = [
  { cx: 295, cy: 12, r: 34, layer: 0 },
  { cx: 262, cy: 16, r: 30, layer: 0 },
  { cx: 230, cy: 14, r: 26, layer: 0 },
  { cx: 202, cy: 10, r: 22, layer: 0 },
  { cx: 310, cy: 36, r: 28, layer: 1 },
  { cx: 278, cy: 30, r: 25, layer: 1 },
  { cx: 245, cy: 25, r: 22, layer: 1 },
  { cx: 216, cy: 20, r: 18, layer: 1 },
  { cx: 190, cy: 14, r: 15, layer: 1 },
  { cx: 288, cy: 22, r: 20, layer: 2 },
  { cx: 255, cy: 18, r: 18, layer: 2 },
  { cx: 225, cy: 15, r: 15, layer: 2 },
  { cx: 12, cy: 10, r: 24, layer: 0 },
  { cx: 38, cy: 8, r: 20, layer: 1 },
  { cx: 20, cy: 22, r: 18, layer: 2 }
];

const sunRays = [
  { xTop: 155, width: 22, phase: 0.0, weight: 1.0 },
  { xTop: 192, width: 16, phase: 1.4, weight: 0.85 },
  { xTop: 224, width: 26, phase: 2.7, weight: 1.1 },
  { xTop: 264, width: 18, phase: 4.1, weight: 0.9 },
  { xTop: 118, width: 15, phase: 5.2, weight: 0.65 }
];

const petals = [];
for (let i = 0; i < 24; i++) {
  petals.push({
    baseX: 40 + hash2D(i, 19) * 265,
    baseY: 16 + hash2D(i, 29) * 145,
    offset: hash2D(i, 41),
    ampX: 8 + hash2D(i, 59) * 10,
    colorType: i % 3,
    onWater: (76 + hash2D(i, 29) * 95) > 98 && (40 + hash2D(i, 19) * 265) < 135
  });
}

const flyers = [];
for (let i = 0; i < 18; i++) {
  flyers.push({
    x: 30 + hash2D(i, 73) * 265,
    y: 45 + hash2D(i, 89) * 112,
    phase: hash2D(i, 97) * Math.PI * 2,
    harmX: (i % 2) + 1,
    harmY: (i % 3) + 1
  });
}

const clouds = [
  { baseX: 42, y: 22, w: 46, h: 14, phase: 0.2 },
  { baseX: 128, y: 16, w: 58, h: 17, phase: 1.7 },
  { baseX: 215, y: 28, w: 38, h: 11, phase: 3.1 },
  { baseX: 280, y: 19, w: 44, h: 13, phase: 4.8 }
];

const ducks = [
  { baseX: 82, y: 106, isMother: true, offset: 0.0 },
  { baseX: 70, y: 108, isMother: false, offset: 0.35 },
  { baseX: 61, y: 109, isMother: false, offset: 0.7 }
];

const sceneBuf = new Uint32Array(W * H);
const outBuf = new Uint32Array(W * H);

function setPx(buf, x, y, col) {
  if (x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = col;
}
function getPx(buf, x, y) {
  const cx = x < 0 ? 0 : (x >= W ? W - 1 : x);
  const cy = y < 0 ? 0 : (y >= H ? H - 1 : y);
  return buf[cy * W + cx];
}
function fillRect(buf, x0, y0, w, h, col) {
  const sx = Math.max(0, x0 | 0), sy = Math.max(0, y0 | 0);
  const ex = Math.min(W, (x0 + w) | 0), ey = Math.min(H, (y0 + h) | 0);
  for (let y = sy; y < ey; y++) {
    const row = y * W;
    for (let x = sx; x < ex; x++) buf[row + x] = col;
  }
}
function fillCircleDither(buf, cx, cy, r, colInner, colOuter) {
  const r2 = r * r;
  const sx = Math.max(0, Math.floor(cx - r)), ex = Math.min(W - 1, Math.ceil(cx + r));
  const sy = Math.max(0, Math.floor(cy - r)), ey = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        const u = Math.sqrt(d2) / r;
        buf[y * W + x] = ditherColor(x, y, colInner, colOuter, u * u);
      }
    }
  }
}

function renderFrame(time, currentMode = 'day', lightIntensity = 1.0, waveIntensity = 1.0, causticsIntensity = 1.0) {
  const pal = PALETTES[currentMode] || PALETTES.day;

  // Pass 1: Scene
  const skyH = 82;
  for (let y = 0; y < skyH; y++) {
    const t = y / skyH;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      sceneBuf[row + x] = t < 0.5
        ? ditherColor(x, y, pal.skyTop, pal.skyMid, t * 2.0)
        : ditherColor(x, y, pal.skyMid, pal.skyHorizon, (t - 0.5) * 2.0);
    }
  }

  if (currentMode === 'night') {
    for (let i = 0; i < 65; i++) {
      const sx = (hash2D(i, 101) * W) | 0;
      const sy = (hash2D(i, 202) * 58) | 0;
      const twinkle = Math.sin(time * (3 * W0) + i * 1.7);
      if (twinkle > -0.2) {
        setPx(sceneBuf, sx, sy, twinkle > 0.7 ? rgb(255, 255, 255) : rgb(165, 205, 245));
      }
    }
  }

  const sunX = 96;
  const sunY = currentMode === 'sunset' ? 44 : 26;
  const sunR = currentMode === 'sunset' ? 16 : 11;
  fillCircleDither(sceneBuf, sunX, sunY, sunR + 12, pal.sunHalo, pal.skyMid);
  for (let y = sunY - sunR; y <= sunY + sunR; y++) {
    for (let x = sunX - sunR; x <= sunX + sunR; x++) {
      const dx = x - sunX, dy = y - sunY;
      if (dx * dx + dy * dy <= sunR * sunR) {
        if (currentMode === 'night' && (dx - 4) * (dx - 4) + (dy - 2) * (dy - 2) <= (sunR - 2) * (sunR - 2)) continue;
        setPx(sceneBuf, x, y, pal.sunCore);
      }
    }
  }

  for (const cl of clouds) {
    const cx = Math.round(cl.baseX + Math.sin(time * W0 + cl.phase) * 4 * waveIntensity);
    const cy = cl.y;
    const puffs = [
      { dx: 0, dy: 2, r: cl.h * 0.6 },
      { dx: cl.w * 0.28, dy: -2, r: cl.h * 0.8 },
      { dx: cl.w * 0.58, dy: 0, r: cl.h * 0.7 },
      { dx: cl.w * 0.82, dy: 3, r: cl.h * 0.5 }
    ];
    for (const pf of puffs) {
      const px = Math.round(cx + pf.dx), py = Math.round(cy + pf.dy), pr = Math.round(pf.r);
      for (let y = py - pr; y <= py + 4; y++) {
        for (let x = px - pr; x <= px + pr; x++) {
          const dx = x - px, dy = y - py;
          if (dx * dx + dy * dy <= pr * pr) {
            let col = pal.cloudLight;
            if (dy > pr * 0.35) col = pal.cloudShadow;
            else if (dy > 0 || dx > pr * 0.4) col = ditherColor(x, y, pal.cloudLight, pal.cloudMid, 0.5);
            setPx(sceneBuf, x, y, col);
          }
        }
      }
    }
  }

  for (let x = 0; x < W; x++) {
    const m1 = Math.round(46 - Math.sin(x * 0.018 + 0.5) * 14 - Math.cos(x * 0.045) * 6);
    const m2 = Math.round(56 - Math.sin(x * 0.028 + 2.1) * 9 - Math.sin(x * 0.08) * 3);
    const shore = farShoreY[x];
    for (let y = Math.max(0, m1); y <= shore; y++) {
      if (y < m2) {
        const t = (y - m1) / Math.max(1, m2 - m1);
        setPx(sceneBuf, x, y, ditherColor(x, y, pal.mtFar, pal.skyHorizon, t * 0.45));
      } else {
        setPx(sceneBuf, x, y, pal.mtNear);
      }
    }
    const treeTop = Math.round(shore - 15 - Math.abs(Math.sin(x * 0.09)) * 11 - Math.sin(x * 0.23) * 4);
    for (let y = treeTop; y <= shore; y++) {
      const relY = (y - treeTop) / Math.max(1, shore - treeTop);
      const n = hash2D(x >> 1, y >> 1);
      let col = pal.farTreesMid;
      if (relY < 0.32 && (x % 14 < 8)) col = n > 0.35 ? pal.farTreesLit : pal.farTreesMid;
      else if (relY > 0.72 || n < 0.3) col = pal.farTreesDark;
      setPx(sceneBuf, x, y, col);
    }
    setPx(sceneBuf, x, shore - 1, pal.grassMid);
    setPx(sceneBuf, x, shore, pal.barkMid);
  }

  for (let x = 36; x <= 68; x++) {
    const u = (x - 52) / 16;
    const archY = Math.round(69 + u * u * 5);
    setPx(sceneBuf, x, archY, pal.barkLit);
    setPx(sceneBuf, x, archY + 1, pal.barkMid);
    if ((x - 36) % 5 === 0) {
      for (let y = archY - 4; y < archY; y++) setPx(sceneBuf, x, y, pal.barkMid);
    }
    setPx(sceneBuf, x, archY - 4, pal.barkLit);
  }

  for (let y = 18; y <= 108; y++) {
    const flare = y > 75 ? Math.pow((y - 75) / 33, 1.8) * 14 : 0;
    const leftEdge = Math.round(276 - flare + Math.sin(y * 0.12) * 1.5);
    const rightEdge = Math.round(302 + flare * 0.7);
    for (let x = leftEdge; x <= rightEdge; x++) {
      const u = (x - leftEdge) / Math.max(1, rightEdge - leftEdge);
      const barkTex = hash2D(x >> 1, (y / 3) | 0);
      let col = pal.barkMid;
      if (u < 0.22 + barkTex * 0.12) col = pal.barkLit;
      else if (u > 0.65 - barkTex * 0.15) col = pal.barkDark;
      setPx(sceneBuf, x, y, col);
    }
  }

  const windOffset = Math.sin(time * (2 * W0)) * waveIntensity;
  for (let x = 0; x < W; x++) {
    const bankTop = nearBankY[x];
    if (bankTop >= H) continue;
    const lipH = x < 45 ? 4 : 5;
    for (let y = bankTop; y < Math.min(H, bankTop + lipH); y++) {
      const stoneCluster = Math.sin(x * 0.35) + Math.cos(y * 0.5);
      if (stoneCluster > 0.2) {
        setPx(sceneBuf, x, y, y <= bankTop + 1 ? rgb(172, 178, 186) : rgb(105, 112, 124));
      } else {
        setPx(sceneBuf, x, y, y === bankTop ? pal.barkLit : pal.barkDark);
      }
    }
    for (let y = bankTop + lipH; y < H; y++) {
      const depthY = (y - bankTop) / Math.max(1, H - bankTop);
      const swayX = Math.round(x + Math.sin(y * 0.35 + time * (2 * W0)) * 0.8 * waveIntensity);
      const n = hash2D(swayX >> 1, y >> 1);
      const inCanopyShadow = (x > 245 && y < 130 && ((x - 245) + (130 - y) > 35));
      let col = pal.grassMid;
      if (inCanopyShadow) col = n > 0.45 ? pal.grassShadow : pal.grassDeep;
      else if (depthY < 0.28) col = ditherColor(x, y, pal.grassHi, pal.grassLit, depthY * 3.0);
      else if (n > 0.68) col = pal.grassHi;
      else if (n > 0.32) col = pal.grassLit;
      else if (n < 0.14) col = pal.grassShadow;
      setPx(sceneBuf, x, y, col);
    }
    if (x % 2 === 0 && bankTop > 80 && bankTop < 178) {
      const bladeH = 2 + ((hash2D(x, 9) * 4) | 0);
      const tipBend = Math.round(windOffset * 0.8);
      for (let b = 0; b < bladeH; b++) {
        setPx(sceneBuf, x + (b === bladeH - 1 ? tipBend : 0), bankTop - b, b >= bladeH - 1 ? pal.grassHi : pal.grassLit);
      }
    }
  }

  const flowerSpots = [
    { x: 142, y: 158, c: rgb(255, 245, 130) },
    { x: 155, y: 146, c: rgb(255, 255, 255) },
    { x: 168, y: 166, c: rgb(255, 165, 195) },
    { x: 248, y: 112, c: rgb(255, 245, 130) },
    { x: 262, y: 120, c: rgb(255, 255, 255) },
    { x: 302, y: 132, c: rgb(255, 180, 210) },
    { x: 288, y: 158, c: rgb(255, 240, 120) },
    { x: 128, y: 168, c: rgb(255, 255, 255) }
  ];
  for (const fl of flowerSpots) {
    const sway = Math.round(Math.sin(time * (2 * W0) + fl.x) * 0.7 * waveIntensity);
    setPx(sceneBuf, fl.x + sway, fl.y, fl.c);
    setPx(sceneBuf, fl.x + sway + 1, fl.y, fl.c);
    setPx(sceneBuf, fl.x + sway, fl.y + 1, rgb(255, 200, 60));
  }

  // Picnic props
  const redDark = currentMode === 'night' ? rgb(118, 38, 62) : rgb(204, 52, 64);
  const redMid  = currentMode === 'night' ? rgb(148, 56, 78) : rgb(236, 82, 88);
  const cream   = currentMode === 'night' ? rgb(172, 182, 205) : rgb(252, 244, 230);
  const fringe  = currentMode === 'night' ? rgb(140, 148, 175) : rgb(235, 222, 198);

  for (let y = 118; y <= 165; y++) {
    const dy = y - 141;
    const leftX = Math.round(166 - dy * 0.55);
    const rightX = Math.round(268 + dy * 0.35);
    for (let x = leftX; x <= rightX; x++) {
      const fold = Math.sin((x + y) * 0.15) * 0.5;
      const u = Math.floor((x - leftX + fold) / 5);
      const v = Math.floor((y - 118) / 4);
      if (y === 165 || x === rightX) { setPx(sceneBuf, x, y, pal.grassDeep); continue; }
      if ((x <= leftX + 1 || y >= 163) && ((x + y) % 2 === 0)) { setPx(sceneBuf, x, y, fringe); continue; }
      const checkU = u & 1, checkV = v & 1;
      let col = (checkU === 0 && checkV === 0) ? cream : (checkU === 1 && checkV === 1) ? redDark : ditherColor(x, y, redMid, cream, 0.35);
      setPx(sceneBuf, x, y, col);
    }
  }

  const wicLit = rgb(228, 172, 96), wicMid = rgb(184, 126, 62), wicDark = rgb(124, 78, 38);
  fillRect(sceneBuf, 230, 133, 30, 3, rgb(95, 35, 42));
  for (let y = 118; y <= 133; y++) {
    for (let x = 232; x <= 257; x++) {
      const weave = ((x + y) % 3 === 0);
      let c = weave ? wicLit : wicMid;
      if (x > 250 || y > 130) c = weave ? wicMid : wicDark;
      if (y === 120 || y === 121) c = wicDark;
      setPx(sceneBuf, x, y, c);
    }
  }
  for (let x = 240; x <= 249; x++) {
    const hy = 111 + Math.round(Math.pow((x - 244.5) / 4.5, 2) * 5);
    setPx(sceneBuf, x, hy, wicLit);
    setPx(sceneBuf, x, hy + 1, wicDark);
  }
  for (let i = 0; i < 9; i++) {
    setPx(sceneBuf, 227 + i, 117 - (i >> 1), rgb(242, 188, 94));
    setPx(sceneBuf, 227 + i, 118 - (i >> 1), rgb(204, 138, 52));
  }

  for (let y = 138; y <= 146; y++) {
    for (let x = 196; x <= 220; x++) {
      if ((x === 196 || x === 220) && (y === 138 || y === 146)) continue;
      setPx(sceneBuf, x, y, y === 146 ? wicDark : wicLit);
    }
  }
  fillRect(sceneBuf, 200, 136, 8, 5, rgb(235, 168, 68));
  fillRect(sceneBuf, 202, 135, 5, 4, rgb(252, 204, 102));
  setPx(sceneBuf, 204, 136, rgb(255, 235, 165));
  const berries = [{ x: 212, y: 138 }, { x: 216, y: 140 }, { x: 211, y: 142 }];
  for (const b of berries) {
    fillRect(sceneBuf, b.x, b.y, 3, 3, rgb(235, 42, 58));
    setPx(sceneBuf, b.x + 1, b.y, rgb(255, 145, 155));
    setPx(sceneBuf, b.x, b.y - 1, rgb(72, 185, 76));
  }

  const glintPulse = Math.sin(time * (3 * W0)) > 0.25;
  for (let y = 121; y <= 135; y++) {
    const w = y < 125 ? 3 : 4;
    for (let x = 186 - w; x <= 186 + w; x++) {
      const isEdge = (x === 186 - w || x === 186 + w || y === 135);
      if (isEdge) setPx(sceneBuf, x, y, rgb(220, 245, 255));
      else if (y >= 125) setPx(sceneBuf, x, y, y < 128 ? rgb(255, 242, 135) : rgb(248, 198, 68));
      else setPx(sceneBuf, x, y, addLight(getPx(sceneBuf, x, y), 45, 55, 65));
    }
  }
  setPx(sceneBuf, 183, 126, rgb(255, 255, 255));
  setPx(sceneBuf, 183, 127, rgb(255, 255, 255));
  if (glintPulse) {
    setPx(sceneBuf, 182, 125, rgb(255, 255, 255));
    setPx(sceneBuf, 184, 125, rgb(255, 255, 255));
  }
  setPx(sceneBuf, 192, 136, rgb(255, 245, 160));
  setPx(sceneBuf, 193, 136, rgb(255, 235, 130));

  const glasses = [{ cx: 173, by: 136 }, { cx: 178, by: 138 }];
  for (const g of glasses) {
    fillRect(sceneBuf, g.cx - 2, g.by - 7, 5, 4, rgb(215, 242, 255));
    fillRect(sceneBuf, g.cx - 1, g.by - 6, 3, 3, rgb(255, 215, 90));
    setPx(sceneBuf, g.cx - 2, g.by - 6, rgb(255, 255, 255));
    setPx(sceneBuf, g.cx, g.by - 3, rgb(215, 242, 255));
    setPx(sceneBuf, g.cx, g.by - 2, rgb(215, 242, 255));
    fillRect(sceneBuf, g.cx - 1, g.by - 1, 3, 1, rgb(225, 248, 255));
  }

  fillRect(sceneBuf, 172, 150, 17, 7, rgb(142, 74, 52));
  fillRect(sceneBuf, 173, 149, 7, 7, rgb(252, 248, 235));
  fillRect(sceneBuf, 181, 149, 7, 7, rgb(242, 236, 220));
  setPx(sceneBuf, 180, 150, rgb(180, 170, 155));
  for (let py = 151; py <= 154; py += 2) {
    fillRect(sceneBuf, 174, py, 5, 1, rgb(165, 158, 148));
    fillRect(sceneBuf, 182, py, 5, 1, rgb(165, 158, 148));
  }
  const pageLift = Math.round(Math.max(0, Math.sin(time * (2 * W0))) * 2 * waveIntensity);
  if (pageLift > 0) fillRect(sceneBuf, 181, 149 - pageLift, 6, 2, rgb(255, 253, 245));

  for (let y = 148; y <= 155; y++) {
    const rx = y < 152 ? 5 : 9;
    for (let x = 248 - rx; x <= 248 + rx; x++) {
      let c = (x + y) % 2 === 0 ? rgb(245, 212, 132) : rgb(222, 182, 98);
      if (y === 151 && Math.abs(x - 248) <= 5) c = rgb(212, 52, 64);
      setPx(sceneBuf, x, y, c);
    }
  }

  const breath = Math.sin(time * (2 * W0)) > 0 ? 1 : 0;
  for (let y = 150 - breath; y <= 157; y++) {
    for (let x = 213; x <= 225; x++) {
      const dx = (x - 219) / 6, dy = (y - 154) / 4;
      if (dx * dx + dy * dy <= 1.0) {
        let c = rgb(250, 244, 236);
        if (x > 220 && y < 154) c = rgb(230, 138, 62);
        else if (x < 216 && y < 154) c = rgb(68, 56, 52);
        setPx(sceneBuf, x, y, c);
      }
    }
  }
  setPx(sceneBuf, 214, 149 - breath, rgb(68, 56, 52));
  setPx(sceneBuf, 217, 149 - breath, rgb(230, 138, 62));
  const tailWag = Math.round(Math.sin(time * W0) * 1);
  fillRect(sceneBuf, 225, 155 + tailWag, 4, 2, rgb(230, 138, 62));

  fillRect(sceneBuf, 155, 141, 6, 2, rgb(62, 58, 66));
  fillRect(sceneBuf, 155, 134, 6, 2, rgb(62, 58, 66));
  setPx(sceneBuf, 157, 133, rgb(90, 85, 95));
  setPx(sceneBuf, 158, 133, rgb(90, 85, 95));
  const lanternCore = currentMode === 'night' ? rgb(255, 248, 200) : rgb(255, 225, 130);
  fillRect(sceneBuf, 156, 136, 4, 5, rgb(255, 180, 68));
  fillRect(sceneBuf, 157, 137, 2, 3, lanternCore);

  if (currentMode !== 'day') {
    const glowR = currentMode === 'night' ? 28 : 16;
    for (let y = 138 - glowR; y <= 138 + glowR; y++) {
      for (let x = 158 - glowR; x <= 158 + glowR; x++) {
        const d = Math.hypot(x - 158, y - 138);
        if (d < glowR) {
          const falloff = Math.pow(1 - d / glowR, 2) * (currentMode === 'night' ? 0.65 : 0.35);
          setPx(sceneBuf, x, y, addLight(getPx(sceneBuf, x, y), 180 * falloff, 115 * falloff, 30 * falloff));
        }
      }
    }
  }

  // Canopy
  for (const cl of canopyClusters) {
    const swayX = Math.round(Math.sin(time * (2 * W0) + cl.cx * 0.05) * (1.2 + cl.layer * 0.5) * waveIntensity);
    const swayY = Math.round(Math.cos(time * (2 * W0) + cl.cy * 0.05) * 0.7 * waveIntensity);
    const cx = cl.cx + swayX, cy = cl.cy + swayY, r = cl.r;
    const sx = Math.max(0, cx - r - 2), ex = Math.min(W - 1, cx + r + 2);
    const sy = Math.max(0, cy - r - 2), ey = Math.min(H - 1, cy + r + 2);
    for (let y = sy; y <= ey; y++) {
      for (let x = sx; x <= ex; x++) {
        const dx = x - cx, dy = y - cy;
        const angle = Math.atan2(dy, dx);
        const leafBump = Math.sin(angle * 7 + cl.cx) * 2.2 + Math.cos(angle * 11) * 1.3;
        if (Math.hypot(dx, dy) <= r + leafBump) {
          const lightVal = (-dx * 0.55 - dy * 0.65) / r + cl.layer * 0.22;
          const v = lightVal + (BAYER4[y & 3][x & 3] - 7.5) / 32.0;
          let col = v > 0.52 ? pal.leafSpark : v > 0.22 ? pal.leafHi : v > -0.12 ? pal.leafMid : v > -0.42 ? pal.leafShadow : pal.leafDeep;
          setPx(sceneBuf, x, y, col);
        }
      }
    }
  }
  for (let vx = 8; vx <= 50; vx += 6) {
    const vineLen = 22 + ((vx * 7) % 18);
    for (let vy = 12; vy < 12 + vineLen; vy++) {
      const sway = Math.round(Math.sin(time * (2 * W0) + vy * 0.12 + vx) * ((vy - 10) * 0.09) * waveIntensity);
      setPx(sceneBuf, vx + sway, vy, vy % 2 === 0 ? (vy > 12 + vineLen - 5 ? pal.leafSpark : pal.leafHi) : pal.leafMid);
    }
  }

  // Pass 2: Water & Light
  outBuf.set(sceneBuf);
  for (let x = 0; x < W; x++) {
    const yStart = farShoreY[x] + 1;
    const yEnd = Math.min(H - 1, nearBankY[x] - 1);
    if (yStart > yEnd) continue;
    for (let y = yStart; y <= yEnd; y++) {
      const distFromFarShore = y - yStart;
      const distToNearBank = nearBankY[x] - y;
      const persp = Math.min(1, distFromFarShore / 95);
      const shallowNear = Math.max(0, 1 - distToNearBank / 28);
      const shallowFar = Math.max(0, 1 - distFromFarShore / 12);
      const shallowness = Math.max(shallowNear, shallowFar * 0.65);

      const freqY = 0.48 - persp * 0.26;
      const wave1 = Math.sin(y * freqY - time * (3 * W0) + x * 0.03) * (1.2 + persp * 2.6);
      const wave2 = Math.cos(y * (freqY * 1.7) + time * (2 * W0) - x * 0.05) * (0.8 + persp * 1.5);
      const rawDx = (wave1 + wave2) * waveIntensity;
      const rawDy = Math.sin(x * 0.11 + y * 0.32 - time * (3 * W0)) * (0.7 + persp * 1.2) * waveIntensity;
      const snapDx = Math.round(rawDx);
      const snapDy = Math.round(rawDy);

      const refY = (x > 96 && distToNearBank < 42 && y > 105)
        ? Math.round(yStart - distFromFarShore * 0.78 + snapDy)
        : Math.round(yStart - distFromFarShore * 0.82 + snapDy);
      const reflCol = getPx(sceneBuf, x + snapDx, refY);

      let waterBase = ditherColor(x, y, pal.waterMid, pal.waterDeep, Math.min(1, persp * 1.15));
      if (shallowness > 0.15) waterBase = ditherColor(x, y, waterBase, pal.waterShallow, shallowness * 0.85);

      if (causticsIntensity > 0.01 && (shallowness > 0.05 || persp > 0.35)) {
        const cx1 = Math.sin((x + snapDx) * 0.22 + y * 0.35 - time * (2 * W0));
        const cx2 = Math.cos((x - snapDx) * 0.19 - y * 0.41 + time * (2 * W0));
        if ((cx1 + cx2) * 0.5 > 0.58) {
          const cBoost = (shallowness * 0.7 + 0.3) * causticsIntensity;
          waterBase = addLight(waterBase, pal.causticR * cBoost, pal.causticG * cBoost, pal.causticB * cBoost);
        }
      }

      const reflWeight = Math.max(0.28, 0.68 - shallowness * 0.32 - persp * 0.12);
      let finalCol = mixColor(waterBase, reflCol, reflWeight);

      const lanternDistX = Math.abs((x + snapDx) - 156);
      if (lanternDistX < 12 && y > 135 && y < 168) {
        const lGlow = (1 - lanternDistX / 12) * (1 - (y - 135) / 33) * (currentMode === 'night' ? 0.95 : 0.45);
        const shimmerStep = Math.floor(((time / LOOP_PERIOD) * 12) % 2);
        if (((y + shimmerStep) & 1) === 0) finalCol = addLight(finalCol, 220 * lGlow, 145 * lGlow, 40 * lGlow);
      }

      const crest = Math.sin(y * 0.65 - time * (4 * W0) + x * 0.08 + rawDx * 0.4);
      if (crest > 0.86 && ((x + y) % 2 === 0)) finalCol = mixColor(finalCol, pal.waterSubSparkle, 0.38);

      const foamWave = Math.sin(x * 0.18 + time * (3 * W0)) * 1.2;
      const foamPhase = Math.floor(((time / LOOP_PERIOD) * 18) % 3);
      if (distFromFarShore <= 1 + (foamWave > 0.4 ? 1 : 0)) {
        if ((x + foamPhase) % 3 !== 0) finalCol = pal.foam;
      } else if (distToNearBank <= 2 + Math.round(Math.max(0, foamWave))) {
        if (distToNearBank === 1 || ((x + y) % 2 === 0)) finalCol = pal.foam;
      }

      const sunPathWidth = 22 + distFromFarShore * 0.42;
      const distFromSunPath = Math.abs((x + snapDx * 1.4) - sunX);
      if (distFromSunPath < sunPathWidth && crest > 0.62 * (2.0 - lightIntensity * 0.7)) {
        const pathFactor = 1 - distFromSunPath / sunPathWidth;
        finalCol = (crest > 0.84 || (pathFactor > 0.6 && ((y + foamPhase) % 3 === 0))) ? pal.waterSparkle : pal.waterSubSparkle;
      }

      outBuf[y * W + x] = finalCol;
    }
  }

  if (causticsIntensity > 0.1) {
    for (const pb of pebbles) {
      const nearB = nearBankY[pb.x];
      if (pb.y > farShoreY[pb.x] + 3 && pb.y < nearB - 2 && (nearB - pb.y) < 28) {
        const clarity = (1 - (nearB - pb.y) / 28) * 0.45 * causticsIntensity;
        const pCol = pb.shade > 0.5 ? rgb(140, 165, 160) : rgb(82, 118, 128);
        for (let dy = -pb.ry; dy <= pb.ry; dy++) {
          for (let dx = -pb.rx; dx <= pb.rx; dx++) {
            if (dx * dx + dy * dy * 2 <= pb.rx * pb.rx) {
              setPx(outBuf, pb.x + dx, pb.y + dy, mixColor(getPx(outBuf, pb.x + dx, pb.y + dy), pCol, clarity));
            }
          }
        }
      }
    }
  }

  const numSparkles = Math.round(32 * lightIntensity);
  for (let i = 0; i < numSparkles; i++) {
    const inSunPath = (i % 3 !== 0);
    const baseX = inSunPath ? Math.round(sunX + (hash2D(i, 31) - 0.5) * 68) : Math.round(135 + hash2D(i, 47) * 95);
    const baseY = Math.round(80 + hash2D(i, 61) * 88);
    if (baseY <= farShoreY[baseX] + 2 || baseY >= nearBankY[baseX] - 3) continue;
    const cycle = (((time / LOOP_PERIOD) * 3.0 + i * 0.21) % 1.0) * 4.0;
    if (cycle < 1.8) {
      const sx = baseX + Math.round(Math.sin(time * (2 * W0) + i) * 1), sy = baseY;
      const core = pal.waterSparkle, sub = pal.waterSubSparkle;
      if (cycle < 0.45 || cycle > 1.35) {
        setPx(outBuf, sx, sy, core);
      } else if (cycle < 0.85 || cycle > 1.05) {
        setPx(outBuf, sx, sy, core);
        setPx(outBuf, sx - 1, sy, sub); setPx(outBuf, sx + 1, sy, sub);
        setPx(outBuf, sx, sy - 1, sub); setPx(outBuf, sx, sy + 1, sub);
      } else {
        setPx(outBuf, sx, sy, core);
        setPx(outBuf, sx - 1, sy, core); setPx(outBuf, sx + 1, sy, core);
        setPx(outBuf, sx, sy - 1, core); setPx(outBuf, sx, sy + 1, core);
        setPx(outBuf, sx - 2, sy, sub); setPx(outBuf, sx + 2, sy, sub);
        setPx(outBuf, sx, sy - 2, sub); setPx(outBuf, sx, sy + 2, sub);
      }
    }
  }

  if (causticsIntensity > 0.1) {
    const bounceBoost = causticsIntensity * lightIntensity * 0.65;
    for (let x = 104; x < W; x++) {
      const bankY = nearBankY[x];
      if (bankY >= H) continue;
      for (let y = bankY; y < Math.min(H, bankY + 6); y++) {
        const waveLight = Math.sin(x * 0.28 - time * (3 * W0) + y * 0.5) + Math.cos(x * 0.19 + time * (2 * W0));
        if (waveLight > 0.75) {
          const fade = (1 - (y - bankY) / 6) * bounceBoost;
          setPx(outBuf, x, y, addLight(getPx(outBuf, x, y), 48 * fade, 72 * fade, 68 * fade));
        }
      }
    }
  }

  // Ducks
  const glide = Math.sin(time * W0) * 18;
  const dir = Math.cos(time * W0) >= 0 ? 1 : -1;
  for (let i = 0; i < ducks.length; i++) {
    const d = ducks[i];
    const dx = Math.round(d.baseX + glide - dir * (i * 9));
    const dy = Math.round(d.y + Math.sin(time * (3 * W0) + i) * 0.6);
    const bodyCol = d.isMother ? rgb(238, 232, 220) : rgb(248, 222, 110);
    const wingCol = d.isMother ? rgb(168, 128, 92) : rgb(225, 185, 72);
    const headCol = d.isMother ? rgb(42, 118, 86) : rgb(248, 222, 110);
    const w = d.isMother ? 5 : 3;
    fillRect(outBuf, dx - w, dy - 2, w * 2, 3, bodyCol);
    fillRect(outBuf, dx - w + 1, dy - 1, w, 2, wingCol);
    const hx = dir > 0 ? dx + w - 1 : dx - w;
    fillRect(outBuf, hx, dy - 4, 2, 2, headCol);
    setPx(outBuf, hx + (dir > 0 ? 2 : -1), dy - 3, rgb(245, 152, 48));
    setPx(outBuf, dx - w - 1, dy + 1, pal.foam);
    setPx(outBuf, dx + w, dy + 1, pal.foam);
    const reflShift = Math.round(Math.sin(time * (4 * W0) + dy) * 1);
    fillRect(outBuf, dx - w + reflShift, dy + 2, w * 2 - 1, 2, mixColor(pal.waterMid, bodyCol, 0.45));
  }

  // God rays
  if (lightIntensity > 0.05) {
    const slope = currentMode === 'sunset' ? -0.78 : -0.58;
    for (const ray of sunRays) {
      const pulse = 0.78 + Math.sin(time * W0 + ray.phase) * 0.22;
      const halfW = (ray.width * 0.5) * pulse;
      const rayCenterTop = ray.xTop + Math.sin(time * W0 + ray.phase) * 3.0 * waveIntensity;
      for (let y = 14; y < H; y++) {
        const vFade = 1.0 - (y / H) * 0.35;
        const centerX = rayCenterTop + y * slope;
        const sx = Math.max(0, Math.floor(centerX - halfW)), ex = Math.min(W - 1, Math.ceil(centerX + halfW));
        const bayerRow = BAYER4[y & 3], rowOffset = y * W;
        for (let x = sx; x <= ex; x++) {
          const dist = Math.abs(x - centerX) / halfW;
          const strength = Math.max(0, 1 - dist * dist) * vFade * ray.weight * lightIntensity;
          const threshold = (bayerRow[x & 3] + 0.5) / 16.0;
          if (strength * 0.85 > threshold * 0.55) {
            const boost = strength * 0.58;
            outBuf[rowOffset + x] = addLight(outBuf[rowOffset + x], pal.rayR * boost, pal.rayG * boost, pal.rayB * boost);
          } else if (strength > 0.25) {
            const boost = strength * 0.24;
            outBuf[rowOffset + x] = addLight(outBuf[rowOffset + x], pal.rayR * boost, pal.rayG * boost, pal.rayB * boost);
          }
        }
      }
    }
  }

  // Petals & Flyers
  for (const p of petals) {
    const phaseU = ((time / LOOP_PERIOD) + p.offset) % 1.0;
    const px = p.onWater
      ? Math.round(p.baseX - Math.sin(phaseU * Math.PI * 2) * 8 * waveIntensity)
      : Math.round(p.baseX + Math.sin(phaseU * Math.PI * 2) * p.ampX * waveIntensity);
    const py = p.onWater
      ? Math.round(p.baseY + Math.cos(phaseU * Math.PI * 2) * 1.2)
      : Math.round(16 + phaseU * 140);
    const pCol = p.colorType === 1 ? rgb(255, 252, 210) : p.colorType === 2 ? pal.leafSpark : rgb(255, 240, 245);
    setPx(outBuf, px, py, pCol);
    if (p.onWater) {
      setPx(outBuf, px + 1, py, pCol);
      setPx(outBuf, px, py + 1, pal.waterSubSparkle);
    }
  }

  for (let i = 0; i < flyers.length; i++) {
    const f = flyers[i];
    const fx = Math.round(f.x + Math.sin(time * (f.harmX * W0) + f.phase) * 16);
    const fy = Math.round(f.y + Math.cos(time * (f.harmY * W0) + f.phase) * 8);
    if (currentMode === 'night' || (currentMode === 'sunset' && i % 2 === 0)) {
      const blink = 0.5 + 0.5 * Math.sin(time * (3 * W0) + f.phase * 2.0);
      if (blink > 0.25) {
        setPx(outBuf, fx, fy, rgb(245, 255, 150));
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > 0 && d <= 3) {
              const glow = (1 - d / 3.2) * blink * 0.65;
              setPx(outBuf, fx + dx, fy + dy, addLight(getPx(outBuf, fx + dx, fy + dy), 165 * glow, 215 * glow, 60 * glow));
            }
          }
        }
        if (fx >= 0 && fx < W && fy > farShoreY[fx] && fy < nearBankY[fx] - 6) {
          const reflY = Math.min(nearBankY[fx] - 2, fy + 8 + ((i % 3) * 2));
          const waveShift = Math.round(Math.sin(time * (3 * W0) + reflY) * 1);
          setPx(outBuf, fx + waveShift, reflY, rgb(195, 240, 120));
          setPx(outBuf, fx + waveShift + 1, reflY, rgb(135, 195, 95));
        }
      }
    } else if (i < 5) {
      const wingOpen = Math.sin(time * (12 * W0) + f.phase) > 0;
      const bCol = i % 2 === 0 ? rgb(255, 250, 235) : rgb(255, 215, 95);
      setPx(outBuf, fx, fy, bCol);
      if (wingOpen) { setPx(outBuf, fx - 1, fy - 1, bCol); setPx(outBuf, fx + 1, fy - 1, bCol); }
      else setPx(outBuf, fx, fy - 1, bCol);
    }
  }
}

// Upscale 320x180 outBuf to 1280x720 RGB24 Buffer for PNG / FFmpeg
function getUpscaledRGB24() {
  const buf = Buffer.allocUnsafe(OUT_W * OUT_H * 3);
  let ptr = 0;
  for (let y = 0; y < OUT_H; y++) {
    const srcY = (y / SCALE) | 0;
    const rowOff = srcY * W;
    for (let x = 0; x < OUT_W; x++) {
      const c = outBuf[rowOff + ((x / SCALE) | 0)];
      buf[ptr++] = c & 255;
      buf[ptr++] = (c >> 8) & 255;
      buf[ptr++] = (c >> 16) & 255;
    }
  }
  return buf;
}

// Minimal CRC32 & PNG Encoder (Zero external dependencies)
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgb24Buf) {
  const raw = Buffer.allocUnsafe(height * (1 + width * 3));
  let srcPtr = 0, dstPtr = 0;
  for (let y = 0; y < height; y++) {
    raw[dstPtr++] = 0; // Filter type 0 (None)
    rgb24Buf.copy(raw, dstPtr, srcPtr, srcPtr + width * 3);
    srcPtr += width * 3;
    dstPtr += width * 3;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function savePNGToDir(targetDir, mode = 'day', timeSec = 1.2, light = 1.0, wave = 1.0, caustics = 1.0) {
  renderFrame(timeSec, mode, light, wave, caustics);
  const rgb24 = getUpscaledRGB24();
  const pngBuf = encodePNG(OUT_W, OUT_H, rgb24);
  const filename = `riverside-picnic-${mode}.png`;
  const fullPath = path.join(targetDir, filename);
  fs.writeFileSync(fullPath, pngBuf);
  return { filename, fullPath, buffer: pngBuf };
}

function saveVideoToDir(targetDir, mode = 'day', durationSec = 6.0, light = 1.0, wave = 1.0, caustics = 1.0) {
  const fps = 60;
  const totalFrames = Math.max(30, Math.round(durationSec * fps));
  const durStr = Number.isInteger(durationSec) ? `${durationSec}s` : `${durationSec.toFixed(1)}s`;
  const filename = `riverside-picnic-${mode}-${durStr}.mp4`;
  const fullPath = path.join(targetDir, filename);

  const ff = spawnSync(FFMPEG_BIN, [
    '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-s', `${OUT_W}x${OUT_H}`,
    '-pix_fmt', 'rgb24',
    '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '16',
    '-movflags', '+faststart',
    fullPath
  ], {
    input: (() => {
      const allFrames = Buffer.allocUnsafe(OUT_W * OUT_H * 3 * totalFrames);
      let offset = 0;
      for (let f = 0; f < totalFrames; f++) {
        const t = f / fps;
        renderFrame(t, mode, light, wave, caustics);
        const rgb24 = getUpscaledRGB24();
        rgb24.copy(allFrames, offset);
        offset += rgb24.length;
      }
      return allFrames;
    })(),
    maxBuffer: 1024 * 1024 * 512
  });

  if (ff.error) throw ff.error;
  return { filename, fullPath };
}

// CLI / Daemon Entrypoint
if (process.argv.includes('--test-scratch')) {
  const scratchOut = path.join(__dirname, '..', 'legacy', 'exports');
  fs.mkdirSync(scratchOut, { recursive: true });
  const pngRes = savePNGToDir(scratchOut, 'day', 1.2);
  const vidRes = saveVideoToDir(scratchOut, 'day', 6.0);
  console.log('Scratch test complete:', pngRes.fullPath, vidRes.fullPath);
  process.exit(0);
}

// Generate initial PNGs and 6.0s loop MP4 directly into ~/Downloads on start!
// --bridge-only: skip this and just run the save bridge (used by picnic.html / town_3d.html exports)
if (!process.argv.includes('--bridge-only')) try {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const pDay = savePNGToDir(DOWNLOADS_DIR, 'day', 1.2);
  const vDay = saveVideoToDir(DOWNLOADS_DIR, 'day', 6.0);
  console.log(`Initial files saved to ${DOWNLOADS_DIR}:`);
  console.log(` - ${pDay.fullPath}`);
  console.log(` - ${vDay.fullPath}`);
} catch (err) {
  console.error('Initial save warning:', err.message);
}

// Start Local Bridge Server on 127.0.0.1:18923 so any click in the UI saves straight to ~/Downloads
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://127.0.0.1:18923');

  // Lets the page check that the bridge is running before it uploads
  if (urlObj.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dir: DOWNLOADS_DIR }));
    return;
  }

  if (urlObj.pathname === '/save-png') {
    const mode = urlObj.searchParams.get('mode') || 'day';
    const t = parseFloat(urlObj.searchParams.get('t') || '1.2');
    const light = parseFloat(urlObj.searchParams.get('light') || '1.0');
    const wave = parseFloat(urlObj.searchParams.get('wave') || '1.0');
    const caustics = parseFloat(urlObj.searchParams.get('caustics') || '1.0');
    try {
      const out = savePNGToDir(DOWNLOADS_DIR, mode, t, light, wave, caustics);
      console.log('Saved PNG to Downloads:', out.fullPath);
      res.writeHead(200, {
        'Content-Type': 'application/json'
      });
      res.end(JSON.stringify({ ok: true, path: out.fullPath, filename: out.filename }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (urlObj.pathname === '/save-video') {
    const mode = urlObj.searchParams.get('mode') || 'day';
    const duration = Math.min(60, Math.max(1, parseFloat(urlObj.searchParams.get('duration') || '6.0')));
    const light = parseFloat(urlObj.searchParams.get('light') || '1.0');
    const wave = parseFloat(urlObj.searchParams.get('wave') || '1.0');
    const caustics = parseFloat(urlObj.searchParams.get('caustics') || '1.0');
    try {
      const out = saveVideoToDir(DOWNLOADS_DIR, mode, duration, light, wave, caustics);
      console.log('Saved MP4 Video to Downloads:', out.fullPath);
      res.writeHead(200, {
        'Content-Type': 'application/json'
      });
      res.end(JSON.stringify({ ok: true, path: out.fullPath, filename: out.filename }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (urlObj.pathname === '/save-blob' && req.method === 'POST') {
    const rawName = urlObj.searchParams.get('filename') || `riverside-picnic-3d-${Date.now()}.png`;
    const safeName = path.basename(rawName);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fullPath = path.join(DOWNLOADS_DIR, safeName);

        // If target is .mp4 and browser sent WebM/MP4 stream, transcode/remux with ffmpeg for universal QuickTime/macOS compatibility
        if (safeName.endsWith('.mp4') && buffer.length > 0) {
          const tmpInput = path.join('/tmp', `upload-${Date.now()}.webm`);
          fs.writeFileSync(tmpInput, buffer);
          const ff = spawnSync(FFMPEG_BIN, [
            '-y',
            '-i', tmpInput,
            '-vf', 'scale=1280:720:flags=neighbor',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'fast',
            '-crf', '16',
            '-movflags', '+faststart',
            fullPath
          ]);
          try { fs.unlinkSync(tmpInput); } catch (e) {}
          if (ff.status !== 0) {
            // Fallback: write raw buffer if already mp4
            fs.writeFileSync(fullPath, buffer);
          }
        } else {
          fs.writeFileSync(fullPath, buffer);
        }

        console.log('Saved 3D export to Downloads:', fullPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: fullPath, filename: safeName }));
      } catch (e) {
        console.error('Error saving blob:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Riverside Picnic Export Bridge Active');
});

server.listen(18923, '127.0.0.1', () => {
  console.log('Export bridge listening on http://127.0.0.1:18923 -> saving to ' + DOWNLOADS_DIR);
});
