import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EQUINE_GAIT_DEFAULTS,
  earlySwingPulse,
  sampleEquineWalk,
  solveEquineLeg,
  createProtoPony
} from '../realsite/pony-gait-proto.js';
import { PONY_RIG } from '../realsite/pony-model.js';
import { PONY_HIPS, WALK_OFFSETS } from '../realsite/pony.js';

test('prototype equine walk maintains 4-beat grounded stance with zero IK clamping', () => {
  const pony = createProtoPony(p => new THREE.MeshBasicMaterial(p));
  const { period, stance } = EQUINE_GAIT_DEFAULTS;
  let clamped = 0;
  for (let i = 0; i < 120; i++) {
    const pose = sampleEquineWalk((i / 120) * period, { treadmill: false });
    clamped += pony.applyPose(pose).filter(Boolean).length;
  }
  assert.equal(clamped, 0, 'no leg should clamp during calm equine walk');

  // Verify planted foot stays fixed in world Z during stance.
  const t0 = (WALK_OFFSETS[0] + 0.1) * period;
  const t1 = (WALK_OFFSETS[0] + stance - 0.1) * period;
  const a = sampleEquineWalk(t0, { treadmill: false }).feet[0];
  const b = sampleEquineWalk(t1, { treadmill: false }).feet[0];
  assert.equal(a.planted, true);
  assert.equal(b.planted, true);
  assert.ok(Math.abs(a.world[2] - b.world[2]) < 1e-9, 'planted hoof must not slide');
});

test('foreleg folds sharply in early swing then extends before touchdown while hindleg stays lower', () => {
  assert.ok(earlySwingPulse(0.32) > earlySwingPulse(0.85) * 4, 'carpus fold peaks in early swing and extends before touchdown');
  const { period, stance } = EQUINE_GAIT_DEFAULTS;
  let foreMaxY = 0, hindMaxY = 0, foreEarlyFlex = 0, foreLateFlex = 0;
  for (let i = 0; i < 100; i++) {
    const u = i / 100;
    const tFore = (WALK_OFFSETS[0] + stance + (1 - stance) * u) * period;
    const tHind = (WALK_OFFSETS[2] + stance + (1 - stance) * u) * period;
    const f = sampleEquineWalk(tFore, { treadmill: true }).feet[0];
    const h = sampleEquineWalk(tHind, { treadmill: true }).feet[2];
    foreMaxY = Math.max(foreMaxY, f.world[1]);
    hindMaxY = Math.max(hindMaxY, h.world[1]);
    if (Math.abs(u - 0.34) < 0.02) foreEarlyFlex = f.flex;
    if (Math.abs(u - 0.86) < 0.02) foreLateFlex = f.flex;
  }
  assert.ok(foreMaxY > hindMaxY + 0.01, `fore (${foreMaxY}) should lift higher than hind (${hindMaxY})`);
  assert.ok(foreEarlyFlex > foreLateFlex * 4, `early flex (${foreEarlyFlex}) >> late flex (${foreLateFlex})`);
});

test('two-pivot neck and head nod seamlessly loops and exhibits overlapping follow-through', () => {
  const { period } = EQUINE_GAIT_DEFAULTS;
  const p0 = sampleEquineWalk(0, { treadmill: true });
  const p1 = sampleEquineWalk(period, { treadmill: true });
  assert.ok(Math.abs(p0.neckPitch - p1.neckPitch) < 1e-9);
  assert.ok(Math.abs(p0.headPitch - p1.headPitch) < 1e-9);
  // Head counter-pitches to keep the muzzle soft & level when neck drops.
  const samples = Array.from({ length: 60 }, (_, i) => sampleEquineWalk((i / 60) * period, { treadmill: true }));
  const neckMean = samples.reduce((s, x) => s + x.neckPitch, 0) / samples.length;
  const cov = samples.reduce((s, x) => s + (x.neckPitch - neckMean) * x.headPitch, 0);
  assert.ok(cov < 0, 'headPitch should counter-rotate relative to neckPitch');
});

test('hind hock maintains equine stance angle (140-160 deg) and realistic swing flexion ROM (30-50 deg)', () => {
  const angleDeg = (a, b, c) => {
    const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI;
  };
  const { period } = EQUINE_GAIT_DEFAULTS;
  let stanceMin = 180, stanceMax = 0, swingMin = 180;
  for (let i = 0; i < 120; i++) {
    const t = (WALK_OFFSETS[2] + i / 120) * period;
    const f = sampleEquineWalk(t, { treadmill: true }).feet[2];
    const r = solveEquineLeg(PONY_HIPS[2], [f.world[0], f.world[1] + PONY_RIG.hoof[1], f.world[2]], 1, f.flex || 0);
    const hock = angleDeg(r.elbow, r.joint, r.foot);
    if (f.planted) { stanceMin = Math.min(stanceMin, hock); stanceMax = Math.max(stanceMax, hock); }
    else swingMin = Math.min(swingMin, hock);
  }
  const rom = stanceMax - swingMin;
  assert.ok(stanceMin >= 140 && stanceMax <= 166, `hind hock stance ${stanceMin.toFixed(1)}-${stanceMax.toFixed(1)} deg`);
  assert.ok(swingMin >= 105 && swingMin <= 126, `hind hock swing min ${swingMin.toFixed(1)} deg`);
  assert.ok(rom >= 28 && rom <= 54, `hind hock ROM ${rom.toFixed(1)} deg`);

  // Standing hind limb conformation: stifle tucked aft under rump, hock slightly aft of hoof, cannon nearly vertical.
  const hip = PONY_HIPS[2];
  const stand = solveEquineLeg(hip, [hip[0], PONY_RIG.hoof[1], hip[2]], 1, 0);
  assert.ok(stand.elbow[1] > 0.55 && stand.elbow[2] >= 0.30, `stifle should sit aft inside rump: ${stand.elbow}`);
  assert.ok(stand.joint[2] >= hip[2], `standing hock (${stand.joint[2].toFixed(3)}) must not sit forward of hoof (${hip[2]})`);
  const cannonTiltDeg = Math.abs(Math.atan2(stand.foot[2] - stand.joint[2], stand.joint[1] - stand.foot[1]) * 180 / Math.PI);
  assert.ok(cannonTiltDeg < 5, `standing hind cannon should be nearly vertical, got ${cannonTiltDeg.toFixed(1)} deg`);
});
