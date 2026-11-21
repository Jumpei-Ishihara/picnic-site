// Prototype equine walk biomechanics based on side-view slow-motion reference analysis:
// 1. Fore vs hind asymmetry: forelegs support nearly straight, fold at carpus in early swing,
//    then extend cleanly before touchdown; hindlegs travel lower and push further aft.
// 2. Two-pivot neck + head overlap (follow-through): head lags slightly behind neck nod.
// 3. Quintic smootherstep horizontal swing + smoothMax IK for zero acceleration snaps.
import * as THREE from 'three';
import { PONY_MODEL, PONY_PALETTE, PONY_RIG, PONY_LEG_VERTEX_COUNT, ponyPartMesh, ponyLegPart, writePonyLegBuffers } from './pony-model.js';
import { PONY_HIPS, WALK_OFFSETS } from './pony.js';

const TAU = Math.PI * 2;
const mod = (x, n) => ((x % n) + n) % n;
const smootherstep = u => u * u * u * (u * (6 * u - 15) + 10);
const smoothMax = (a, b, k = .025) => .5 * (a + b + Math.hypot(a - b, k));

export const EQUINE_GAIT_DEFAULTS = {
  stance: .60,          // 60% duty factor -> continuous 2/3-leg support, unhurried swing
  period: 1.15,         // 1.15s per stride (~0.87 Hz): calm lead-line pony tempo
  speed: .78,           // ~0.78 m/s (2.8 km/h) -> stride length ~0.90 m
  foreLift: .058,       // fore hoof peak clearance (m)
  hindLift: .040,       // hind hoof stays lower, skimming ground
  foreFlex: .085,       // carpus fold in early swing (m of virtual reach reduction)
  hindFlex: .075,       // realistic hock swing flexion (~40 deg ROM from 145-155 deg stance)
  foreBiasZ: -.03,      // fore stance slightly forward under shoulder
  hindBiasZ: .03,       // hind stance slightly aft under hip
  neckBaseAngle: -.58,  // relaxed lower neck carriage for calm walk (rad; default standing is -0.30)
  headRestPitch: .16,   // gentle poll counter-pitch so the face stays softly forward when neck is lowered
  neckNod: .055,        // neck base pitch amplitude (rad)
  headLag: .65,         // head counter-pitch ratio & phase lag for soft poll follow-through
  neckSway: .022,       // 1x stride gentle lateral sway (rad)
  bodyBob: .006,        // subtle withers vertical oscillation (m)
  bodyRoll: .012        // gentle 1x weight shift onto supporting side (rad)
};

// Asymmetric bell curve peaking near u ~ 0.34 (early swing fold) and decaying cleanly to 0 at u=0,1.
export function earlySwingPulse(u) {
  if (u <= 0 || u >= 1) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s * Math.pow(1 - u, 1.15) * 1.85;
}

// Asymmetric lift: rises smoothly after breakover, peaks ~0.38, glides down before touchdown.
export function swingLiftProfile(u) {
  if (u <= 0 || u >= 1) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s * (1 + .32 * Math.cos(Math.PI * u));
}

// Asymmetric nod waveform: slightly slower drop (~58%), gentle lift (~42%), C-infinity smooth.
export function equineNodWave(phase2) {
  return Math.cos(phase2 - .35) + .18 * Math.sin(phase2 * 2 - .7);
}

const EQUINE_HIND_RIG = { proximal: .27, upper: .295, lower: .275, baseReach: .538 };

export function solveEquineLeg(hip, foot, bend = 1, flex = 0) {
  const isFore = bend < 0;
  const rig = isFore ? PONY_RIG.fore : EQUINE_HIND_RIG;
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1], dz = foot[2] - hip[2];
  const distance = Math.hypot(dx, dy, dz);
  // Forelegs stay straighter in stance (+0.008) and fold crisply at carpus during early swing;
  // hindlegs use anatomical rump-tucked stifle & ~150 deg hock with nearly vertical standing cannon.
  const baseReach = isFore ? rig.reach + .008 : rig.baseReach;
  const targetReach = baseReach - flex;
  const reach = THREE.MathUtils.clamp(
    smoothMax(targetReach, distance - rig.proximal + .012, .025),
    Math.abs(rig.upper - rig.lower) + .002,
    rig.upper + rig.lower - .0004
  );

  function twoLink(h, f, upper, lower, b) {
    let vx = f[0] - h[0], vy = f[1] - h[1], vz = f[2] - h[2];
    const actual = Math.hypot(vx, vy, vz);
    const dist = THREE.MathUtils.clamp(actual, Math.abs(upper - lower) + 1e-5, upper + lower - 1e-5);
    if (actual < 1e-8) { vx = 0; vy = -1; vz = 0; } else { vx /= actual; vy /= actual; vz /= actual; }
    const along = (upper * upper - lower * lower + dist * dist) / (2 * dist);
    let sx = 0, sy = b * vz, sz = -b * vy, sl = Math.hypot(sy, sz);
    if (sl < 1e-8) { sx = 0; sy = 0; sz = b; } else { sy /= sl; sz /= sl; }
    const ortho = Math.sqrt(Math.max(0, upper * upper - along * along));
    return {
      joint: [h[0] + vx * along + sx * ortho, h[1] + vy * along + sy * ortho, h[2] + vz * along + sz * ortho],
      foot: [h[0] + vx * dist, h[1] + vy * dist, h[2] + vz * dist],
      clamped: Math.abs(dist - actual) > 1e-6
    };
  }

  const proximal = twoLink(hip, foot, rig.proximal, reach, -bend);
  const distal = twoLink(proximal.joint, proximal.foot, rig.upper, rig.lower, bend);
  return { elbow: proximal.joint, joint: distal.joint, foot: distal.foot, clamped: proximal.clamped || distal.clamped };
}

/**
 * Sample straight-line (treadmill or track) equine walk pose at time t.
 * Forward is -Z. Ground is sampled via heightAt(x, z).
 */
export function sampleEquineWalk(t, opts = {}) {
  const cfg = { ...EQUINE_GAIT_DEFAULTS, ...opts };
  const heightAt = opts.heightAt ?? (() => 0);
  const worldZ = opts.treadmill ? 0 : -cfg.speed * t;
  const strideLen = cfg.speed * cfg.period;
  const stridePhase = mod(t / cfg.period, 1);
  const walkRad = stridePhase * TAU;

  const feet = PONY_HIPS.map(([hx, , hz], leg) => {
    const isFore = leg < 2;
    const biasZ = isFore ? cfg.foreBiasZ : cfg.hindBiasZ;
    const stride = t / cfg.period - WALK_OFFSETS[leg];
    const phase = mod(stride, 1);
    const cycle = Math.floor(stride);
    const contactT = (cycle + WALK_OFFSETS[leg] + cfg.stance * .5) * cfg.period;
    const anchorZ = (opts.treadmill ? -cfg.speed * (contactT - t) : -cfg.speed * contactT) + hz + biasZ;
    const nextAnchorZ = anchorZ - strideLen;

    if (phase < cfg.stance) {
      const gy = heightAt(hx, anchorZ);
      let stanceFlex = 0;
      if (!isFore) {
        const stU = phase / cfg.stance;
        // Brief loading yield on initial contact, then smooth propulsion extension in late stance.
        if (stU < .25) stanceFlex = .005 * Math.sin(Math.PI * stU / .25) ** 2;
        else if (stU > .30) stanceFlex = -.012 * Math.sin(Math.PI * (stU - .30) / .70) ** 2;
      }
      return { world: [hx, gy, anchorZ], groundY: gy, phase, planted: true, pitch: 0, flex: stanceFlex };
    }
    const u = (phase - cfg.stance) / (1 - cfg.stance);
    const s = smootherstep(u);
    const z = anchorZ + (nextAnchorZ - anchorZ) * s;
    const gy = heightAt(hx, z);
    const liftAmp = isFore ? cfg.foreLift : cfg.hindLift;
    const lift = liftAmp * swingLiftProfile(u);
    // Breakover tilts toe down gently at lift-off, then levels out before touchdown.
    const pitch = (isFore ? .14 : .11) * Math.sin(TAU * u) * Math.sin(Math.PI * u) * (1 - .35 * u);
    const flex = (isFore ? cfg.foreFlex : cfg.hindFlex) * earlySwingPulse(u);
    return { world: [hx, gy + lift, z], groundY: gy, phase, planted: false, pitch, flex };
  });

  const nod = equineNodWave(walkRad * 2);
  const headNod = equineNodWave(walkRad * 2 - .55);
  return {
    x: 0,
    y: heightAt(0, worldZ) + Math.cos(walkRad * 2) * cfg.bodyBob,
    z: worldZ,
    bodyRoll: Math.sin(walkRad) * cfg.bodyRoll,
    bodyPitch: Math.cos(walkRad * 2 - .2) * .006,
    neckY: PONY_RIG.neck[1] - .03 + nod * .008,
    neckPitch: cfg.neckBaseAngle + nod * cfg.neckNod,
    neckYaw: Math.sin(walkRad) * cfg.neckSway,
    // Head counter-rotates slightly with phase lag to keep muzzle level & soft (poll suppleness).
    headPitch: cfg.headRestPitch - headNod * cfg.neckNod * cfg.headLag,
    tailSway: Math.sin(walkRad) * .09,
    feet
  };
}

function makeGeo(parts, offsetY = 0, offsetZ = 0) {
  const positions = [], normals = [], indices = [];
  let offset = 0;
  for (const part of parts) {
    const shifted = (offsetY || offsetZ) ? { ...part, p: [part.p[0], part.p[1] + offsetY, part.p[2] + offsetZ] } : part;
    const { vertices, indices: idx } = ponyPartMesh(shifted);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
    indices.push(...Array.from(g.index.array, i => i + offset));
    offset += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// Prototype pony rig with separate Poll (head) pivot so the head can overlap/follow-through the neck nod.
export function createProtoPony(toon, { color = '#e6d8b8', mane = '#f4ecd8', saddle = PONY_PALETTE.saddle } = {}) {
  const flat = p => { const m = toon(p); m.flatShading = true; return m; };
  const coatMat = flat({ color }), maneMat = flat({ color: mane }), hoofMat = flat({ color: PONY_PALETTE.hoof }), tackMat = flat({ color: PONY_PALETTE.tack }), saddleMat = flat({ color: saddle });
  const group = new THREE.Group();
  const addMesh = (geo, mat, parent = group) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

  addMesh(makeGeo(PONY_MODEL.body), coatMat);
  if (saddle) { addMesh(makeGeo(PONY_MODEL.saddle), saddleMat); addMesh(makeGeo(PONY_MODEL.seat), tackMat); }

  const neck = new THREE.Group();
  neck.position.fromArray(PONY_RIG.neck);
  neck.rotation.x = PONY_RIG.neckAngle;
  group.add(neck);
  addMesh(makeGeo(PONY_MODEL.neck), coatMat, neck);
  addMesh(makeGeo([PONY_MODEL.mane[0]]), maneMat, neck); // mane strip follows neck

  // Poll pivot at top of neck (0, 0.44, -0.10 in neck-local space) so the head nods independently.
  const poll = [0, .44, -.10];
  const head = new THREE.Group();
  head.position.fromArray(poll);
  neck.add(head);
  addMesh(makeGeo(PONY_MODEL.head, -poll[1], -poll[2]), coatMat, head);
  addMesh(makeGeo(PONY_MODEL.eyes, -poll[1], -poll[2]), hoofMat, head);
  addMesh(makeGeo([PONY_MODEL.mane[1]], -poll[1], -poll[2]), maneMat, head); // forelock follows head
  addMesh(makeGeo(PONY_MODEL.halter, -poll[1], -poll[2]), tackMat, head);

  const tail = addMesh(makeGeo(PONY_MODEL.tail), maneMat);
  tail.position.fromArray(PONY_RIG.tail);
  tail.rotation.x = .28;

  const legParts = PONY_HIPS.map((hip, i) => {
    const r = solveEquineLeg(hip, [hip[0], PONY_RIG.hoof[1], hip[2]], i < 2 ? -1 : 1, 0);
    return ponyLegPart([hip, r.elbow, r.joint, r.foot], i, [0, 1, 0]);
  });
  const legGeo = makeGeo(legParts);
  legGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  legGeo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  legGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .5, 0), 1.6);
  const legMesh = addMesh(legGeo, coatMat);

  const hoofInstances = new THREE.InstancedMesh(makeGeo([PONY_MODEL.limb]), hoofMat, 4);
  hoofInstances.castShadow = hoofInstances.receiveShadow = true;
  hoofInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(hoofInstances);

  const up = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
  const inverse = new THREE.Matrix4(), sole = new THREE.Vector3(), top = new THREE.Vector3(), hoofUp = new THREE.Vector3();
  const hoofObj = new THREE.Object3D();
  const posArr = legGeo.attributes.position.array, normArr = legGeo.attributes.normal.array;
  const footUpArr = [0, 1, 0], topArr = [0, 0, 0];

  function applyPose(pose) {
    group.position.set(pose.x, pose.y, pose.z);
    group.rotation.set(pose.bodyPitch, 0, pose.bodyRoll, 'YXZ');
    neck.position.y = pose.neckY;
    neck.rotation.set(pose.neckPitch, pose.neckYaw, 0, 'YXZ');
    head.rotation.x = pose.headPitch;
    tail.rotation.z = pose.tailSway;
    group.updateWorldMatrix(true, false);
    inverse.copy(group.matrixWorld).invert();
    const clamped = [];
    for (let i = 0; i < 4; i++) {
      const f = pose.feet[i];
      sole.fromArray(f.world).applyMatrix4(inverse);
      if (f.planted === false) hoofObj.quaternion.setFromAxisAngle(xAxis, f.pitch || 0);
      else hoofObj.quaternion.identity();
      hoofUp.copy(up).applyQuaternion(hoofObj.quaternion);
      footUpArr[0] = hoofUp.x; footUpArr[1] = hoofUp.y; footUpArr[2] = hoofUp.z;
      top.copy(sole).addScaledVector(hoofUp, PONY_RIG.hoof[1]);
      topArr[0] = top.x; topArr[1] = top.y; topArr[2] = top.z;
      const solved = solveEquineLeg(PONY_HIPS[i], topArr, i < 2 ? -1 : 1, f.flex || 0);
      writePonyLegBuffers(posArr, normArr, i * PONY_LEG_VERTEX_COUNT, [PONY_HIPS[i], solved.elbow, solved.joint, solved.foot], i, footUpArr);
      hoofObj.position.fromArray(solved.foot).addScaledVector(hoofUp, -PONY_RIG.hoof[1] * .5);
      hoofObj.scale.fromArray(PONY_RIG.hoof);
      hoofObj.updateMatrix();
      hoofInstances.setMatrixAt(i, hoofObj.matrix);
      clamped.push(solved.clamped);
    }
    legGeo.attributes.position.needsUpdate = true;
    legGeo.attributes.normal.needsUpdate = true;
    hoofInstances.instanceMatrix.needsUpdate = true;
    return clamped;
  }

  return { group, neck, head, tail, legMesh, hoofInstances, applyPose };
}
