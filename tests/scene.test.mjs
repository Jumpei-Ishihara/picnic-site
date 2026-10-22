import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
function vec() { return { set() {} }; }
test('grass skips stationary placement work and uploads but continues wind time', async () => {
  const src = (await fs.readFile(new URL('../real/js/grass.js', import.meta.url), 'utf8')).replace("import * as THREE from 'three';", '').replaceAll('export ', '');
  let writes = 0, heights = 0, visible = true;
  const three = {
    BufferGeometry: class { setAttribute() {} setIndex() {} }, BufferAttribute: class {}, Sphere: class {}, Vector3: class { set() {} }, Vector2: class { normalize() { return this; } }, Vector4: class {},
    DataTexture: class {}, DataUtils: { toHalfFloat: v => v }, MeshStandardMaterial: class {},
    Matrix4: class { multiplyMatrices() {} makeTranslation() {} },
    Frustum: class { setFromProjectionMatrix() {} intersectsBox() { return visible; } }, Box3: class { min = vec(); max = vec(); },
    InstancedMesh: class { instanceMatrix = {}; layers = { set() {} }; setMatrixAt() { writes++; } }
  };
  const context = vm.createContext({ THREE: three }); vm.runInContext(src, context);
  const terrain = { grid: { x0: -2, z0: -2, w: 5, h: 5 }, bounds: { near: { x0: -2, z0: -2, x1: 2, z1: 2 } }, groundAt: () => 'lawn', heightAt: () => { heights++; return 0; }, cellColor: new Float32Array(75).fill(1) };
  const grass = context.createRealGrass({ scene: { add() {} }, terrain, quality: { rings: [{ tile: 2, perM2: 1, to: 12, width: 1 }] } });
  const cam = { position: { x: 0, z: 0 }, matrixWorld: { elements: new Array(16).fill(0) }, projectionMatrix: { elements: new Array(16).fill(0) }, matrixWorldInverse: {} };
  grass.update(0, cam); const before = [writes, heights, grass.stats.placements];
  for (let i = 1; i <= 120; i++) grass.update(i / 60, cam);
  assert.deepEqual([writes, heights, grass.stats.placements], before); assert.equal(grass.uniforms.uTime.value, 2);
  cam.matrixWorld.elements[0] = 1; grass.update(3, cam);
  assert.equal(grass.stats.placements, before[2] + 1); assert.equal(writes, before[0]);
  visible = false; cam.projectionMatrix.elements[0] = 1; grass.update(4, cam);
  assert.equal(grass.layers[0].count, 0); assert.equal(grass.stats.uploads, 2);
  grass.invalidate(); visible = true; grass.update(5, cam); assert.ok(writes > before[0]);
});
test('touch joystick exposes actual movement independently from autowalk', async () => {
  const src = (await fs.readFile(new URL('../engine/player.js', import.meta.url), 'utf8')).replace(/^import .*;$/mg, '').replace('export function', 'function');
  const target = () => { const events = {}; return { addEventListener: (n, f) => events[n] = f, fire: (n, e) => events[n]?.(e), setPointerCapture() {} }; };
  const canvas = target(), win = target(); win.innerWidth = 400;
  class Vector { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); } }
  const three = { Vector3: Vector, Vector2: Vector, Mesh: class { rotation = {}; position = new Vector(); }, RingGeometry: class {}, MeshBasicMaterial: class {}, Raycaster: class {} };
  const context = vm.createContext({ THREE: three, window: win, matchMedia: () => ({ matches: true }), performance }); vm.runInContext(src, context);
  let blocked = false;
  const controls = context.createPlayerController({ canvas, camera: { position: new Vector(), rotation: { y: 0, set() {} } }, scene: { add() {} }, collider: { solidAt: () => blocked }, start: { x: 0, z: 0 } });
  controls.setEye(0.25, true);
  canvas.fire('pointerdown', { pointerType: 'touch', clientX: 50, clientY: 200, pointerId: 1 }); canvas.fire('pointermove', { clientX: 50, clientY: 150, pointerId: 1 });
  controls.update(0.05); assert.ok(controls.movedDistance > 0.15); assert.equal(controls.walking, false);
  canvas.fire('pointerup', { pointerId: 1, type: 'pointerup' }); controls.update(0.05); assert.equal(controls.movedDistance, 0);
});

test('stroll wheel input is ignored while frozen or input-disabled, and works after restoration', async () => {
  const src = (await fs.readFile(new URL('../engine/player.js', import.meta.url), 'utf8')).replace(/^import .*;$/mg, '').replace('export function', 'function');
  const target = () => { const events = {}; return { addEventListener: (n, f) => events[n] = f, fire: (n, e) => events[n]?.(e) }; };
  class Vector { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  const canvas = target(), win = target();
  const three = { Vector3: Vector, Vector2: Vector, Mesh: class { rotation = {}; position = new Vector(); }, RingGeometry: class {}, MeshBasicMaterial: class {}, Raycaster: class {} };
  const context = vm.createContext({ THREE: three, window: win, matchMedia: () => ({ matches: false }), performance }); vm.runInContext(src, context);
  let enabled = true, frozen = false;
  const route = { getLength: () => 100, getPointAt: (u, v = new Vector()) => v.set(u * 100, 0, 0), getTangentAt: (u, v) => v.set(1, 0, 0) };
  const controls = context.createPlayerController({ canvas, camera: { position: new Vector(), rotation: { set() {} } }, scene: { add() {} }, collider: { solidAt: () => false }, start: { x: 0, z: 0 }, route, isInputEnabled: () => enabled, isFrozen: () => frozen });
  controls.setMode('stroll'); controls.update(0);
  const wheel = () => canvas.fire('wheel', { deltaY: 100, preventDefault() {} });
  const x = controls.player.x;
  frozen = true; wheel(); controls.update(0); assert.equal(controls.player.x, x);
  frozen = false; enabled = false; wheel(); controls.update(0); assert.equal(controls.player.x, x);
  enabled = true; wheel(); controls.update(0); assert.ok(controls.player.x > x + 0.39);
});

test('picnic keyboard blocks scene actions while capturing but permits recording stop', async () => {
  const src = await fs.readFile(new URL('../picnic.html', import.meta.url), 'utf8');
  const start = src.indexOf("    window.addEventListener('keydown', e => {");
  const handler = src.slice(start, src.indexOf('\n    // ===', start));
  let keydown, actions = [];
  const action = name => () => actions.push(name);
  const capture = { busy: true, recording: false, stopVideo: action('stop') };
  const controls = { mode: 'walk', togglePause: action('pause') };
  const scope = { window: { addEventListener: (k, f) => { keydown = f; } }, started: true, capture, controls, sitting: false, player: { x: 0, z: 0 }, interact: action('interact'), setSitting: action('sit'), sitOnBlanket: action('view1'), lieDown: action('view2'), sunsetView: action('view3'), goBridge: action('view4'), skipStone: action('stone'), exportPNG: action('png'), recordLoop: action('record') };
  vm.runInNewContext(handler, scope);
  const key = code => keydown({ code, repeat: false, preventDefault() {} });
  for (const recording of [false, true]) {
    capture.recording = recording;
    for (const code of ['KeyE', 'KeyC', 'KeyF', 'KeyP', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Space']) key(code);
    key('KeyR');
    assert.deepEqual(actions, recording ? ['stop'] : []); actions = [];
  }
  capture.busy = false;
  for (const code of ['KeyE', 'KeyC', 'KeyF', 'KeyP', 'Digit1', 'KeyR']) key(code);
  controls.mode = 'stroll'; key('Space');
  assert.deepEqual(actions, ['interact', 'sit', 'stone', 'png', 'view1', 'record', 'pause']);
});

test('terrain readiness rejects to its late consumer without an unhandled rejection', async () => {
  const { spawnSync } = await import('node:child_process');
  const probe = `
    const fs = require('node:fs'), vm = require('node:vm');
    let unhandled = 0;
    process.on('unhandledRejection', () => unhandled++);
    process.on('rejectionHandled', () => {});
    const pixel = process.argv[1] === 'pixel';
    const file = pixel ? 'engine/terrain.js' : 'real/js/terrain.js';
    const src = fs.readFileSync(file, 'utf8');
    const rejected = () => Promise.reject(Error('fallback failed'));
    const context = vm.createContext({
      makeCanvas: () => [{}, {}], pixelTex: () => ({}), navigator: {hardwareConcurrency: 2},
      URL, runWorkerTask: rejected, bakeGroundPixels() {}, buildMeshes: rejected,
      createGroundMaterial: async () => ({}), timings: {}, job: {}, tw: 0,
      performance, layerOfCell: [], N: {x0: 0, z0: 0, w: 2, h: 2}, colorSize: 1, normalSize: 1
    });
    let ready;
    if (pixel) {
      const code = src.slice(src.indexOf('function bakeGroundTexture(')).replace('import.meta.url', JSON.stringify('file:///terrain.js'));
      vm.runInContext(code, context);
      ready = context.bakeGroundTexture({N:{w:2,h:2},ppm:1}).ready;
    } else {
      const start = src.indexOf('  const ready = Promise.all([');
      ready = vm.runInContext(src.slice(start, src.indexOf('  return {', start)) + '\\nready;', context);
    }
    setImmediate(async () => {
      let rejectedToConsumer = false;
      try { await ready; } catch { rejectedToConsumer = true; }
      console.log(JSON.stringify({unhandled, rejectedToConsumer}));
    });
  `;
  for (const kind of ['pixel', 'real']) {
    const result = spawnSync(process.execPath, ['-e', probe, kind], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { unhandled: 0, rejectedToConsumer: true }, kind);
  }
});
