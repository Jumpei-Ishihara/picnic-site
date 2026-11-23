import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function leafKit() {
  const source = (await fs.readFile(new URL('../engine/trees.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replaceAll('export ', '');
  class Vector3 {
    constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
    copy(v) { Object.assign(this,v); return this; }
    sub(v) { this.x-=v.x; this.y-=v.y; this.z-=v.z; return this; }
    lengthSq() { return this.x*this.x+this.y*this.y+this.z*this.z; }
    set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
    normalize() { const l=Math.sqrt(this.lengthSq()); this.x/=l;this.y/=l;this.z/=l;return this; }
  }
  const context = vm.createContext({ THREE: { Vector3, MeshDepthMaterial: class { dispose() {} }, DataTexture: class { constructor(data) { this.image={data}; } dispose() { this.disposed=true; } } }, mulberry32: seed => () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296) });
  vm.runInContext(source,context);
  return context.createLeafKit;
}
test('leaf shadow uses target-relative light, periodic time, and a finite fallback direction', async () => {
  const create = await leafKit(); const k=create({loop:6,softDapple:true});
  const light={position:{x:11,y:22,z:33},target:{position:{x:10,y:20,z:30}}};
  k.update(1.25,light); const initial=k.uniforms.time.value;
  const l=k.uniforms.light.value;
  assert.ok(Math.abs(l.x-1/Math.sqrt(14))<1e-12);
  k.update(7.25,light); assert.equal(k.uniforms.time.value,initial);
  k.update(-4.75,light); assert.equal(k.uniforms.time.value,initial);
  k.update(0,{position:{x:1,y:2,z:3},target:{position:{x:1,y:2,z:3}}});
  assert.deepEqual([l.x,l.y,l.z],[0,1,0]);
  assert.equal(k.uniforms.soft.value,1); assert.equal(create().uniforms.soft.value,0);
  for(const loop of [0,-1,Infinity,NaN]) assert.throws(()=>create({loop}),/positive/);
});
test('shared leaf shader injects its own world position without erasing the material colour hook', async () => {
  const create = await leafKit(); const k=create({softDapple:true});
  const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'void main() { }'};
  k.depthMat.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uLeafSoft,k.uniforms.soft);
  assert.equal(shader.uniforms.uLeafNoise.value.image.data.length,1024);
  k.dispose(); assert.equal(shader.uniforms.uLeafNoise.value.disposed,true);
  assert.match(shader.fragmentShader,/leafGap\(vLeafW\)/); assert.match(shader.vertexShader,/modelMatrix/);
  const mat={}; k.leafify(mat);
  const colour={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <color_fragment>'};
  mat.onBeforeCompile(colour); assert.match(colour.fragmentShader,/diffuseColor.rgb/);
});

test('classic look preserves low-sun glow without a second horizon fade', async () => {
  const source = (await fs.readFile(new URL('../realsite/look.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replaceAll('export ', '');
  const context = vm.createContext({ THREE: { Color: class {} } });
  vm.runInContext(source, context);
  const calls = {}, sunDir = { x: 1, y: .024279238848413046, z: 0 };
  const rampUniform = () => ({ value: { fromArray() {} } });
  const look = context.createLook({
    pixel: { setGrade() {}, setVolumetric(...v) { calls.volume = v; }, setSunRays(...v) { calls.rays = v; } },
    RAMP: { shadow: rampUniform(), mid: rampUniform(), high: rampUniform() },
    tod: { night: .02, state: { sunDir }, hour: 18.65 }, sun: { color: {} },
    sunPath: { sunAt: () => ({ elevation: 1.3912346231380184 }) }
  });
  const state = look.update();
  assert.ok(calls.rays[1] > .8, 'sunset must retain its broad glow');
  assert.equal(calls.rays[1], state.warm * .85);
  assert.equal(calls.volume[3], 60);
});

test('picnic preserves original sunset glow, daylight shafts and moonlit atmosphere', async () => {
  const html=await fs.readFile(new URL('../picnic.html',import.meta.url),'utf8');
  const start=html.indexOf('    function updateLook() {');
  const end=html.indexOf('    function updateWorld(',start);
  assert.ok(start>0 && end>start);
  const calls={}, uniform=()=>({value:{fromArray(){}}});
  const scope={
    tod:{hour:18.35,night:5/12,state:{sunDir:{x:0,y:.13741354152293137,z:-1}}},
    RAMP:{shadow:uniform(),mid:uniform(),high:uniform()},
    pixel:{setGrade(){},setVolumetric(...v){calls.volume=v;},setSunRays(...v){calls.rays=v;}},
    sun:{color:{}},mix3:()=>[0,0,0],warmNow:0,
    leafKit:{update(){}},elapsed:0,LOOP:6,GRASS_TIME:{value:0}
  };
  const context=vm.createContext(scope);vm.runInContext(html.slice(start,end),context);
  context.updateLook();
  assert.ok(Math.abs(calls.rays[1]-.6490384615384629)<1e-10);
  assert.ok(Math.abs(calls.volume[1]-.9391025641025659)<1e-10);
  assert.equal(calls.volume[3],28);
  scope.tod.hour=12;scope.tod.night=0;context.updateLook();
  assert.equal(calls.volume[1],.3);assert.equal(calls.rays[1],0);
  scope.tod.hour=21;scope.tod.night=1;scope.tod.state.sunDir.y=-.2;context.updateLook();
  assert.equal(calls.volume[1],.35);assert.equal(calls.rays[1],0);
});

test('real-site pixel pages configure high-resolution water depth, clarity, caustics, and mid-range wave fade', async () => {
  const expected = {
    'edogawa.html':    { depthRes: 512, minClarity: 0.55, minCaustic: 0.45, minWave: 0.9, minFadeFar: 26 },
    'nagisa.html':     { depthRes: 512, minClarity: 0.60, minCaustic: 0.50, minWave: 0.9, minFadeFar: 26 },
    'myoden.html':     { depthRes: 512, minClarity: 0.60, minCaustic: 0.50, minWave: 0.9, minFadeFar: 26 },
    'myoden-far.html': { depthRes: 512, minClarity: 0.60, minCaustic: 0.50, minWave: 0.9, minFadeFar: 26 }
  };
  for (const [file, spec] of Object.entries(expected)) {
    const html = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const block = html.match(/createPixelWater\s*\(\{[\s\S]*?\}\);/);
    assert.ok(block, `${file}: createPixelWater call not found`);
    const call = block[0];
    const num = key => {
      const m = call.match(new RegExp(`${key}\\s*:\\s*([0-9.]+)`));
      return m ? Number(m[1]) : NaN;
    };
    assert.equal(num('depthRes'), spec.depthRes, `${file}: depthRes`);
    assert.ok(num('clarity') >= spec.minClarity, `${file}: clarity >= ${spec.minClarity}`);
    assert.ok(num('caustic') >= spec.minCaustic, `${file}: caustic >= ${spec.minCaustic}`);
    assert.ok(num('wave') >= spec.minWave, `${file}: wave >= ${spec.minWave}`);
    const fade = call.match(/waveFade\s*:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/);
    assert.ok(fade && Number(fade[2]) >= spec.minFadeFar, `${file}: waveFade far >= ${spec.minFadeFar}`);
  }
  const waterSrc = await fs.readFile(new URL('../engine/water.js', import.meta.url), 'utf8');
  assert.match(waterSrc, /reflDistort\s*=\s*0\.6\s*\*\s*mix\(/, 'water.js: distance-tapered reflection distortion');
});

test('all four real-site pixel pages unify softDapple leafKit and sync shadows in step and renderOnly', async () => {
  for (const file of ['edogawa.html', 'nagisa.html', 'myoden.html', 'myoden-far.html']) {
    const html = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /createLeafKit\s*\(\s*\{\s*loop\s*:\s*LOOP\s*,\s*softDapple\s*:\s*true\s*\}\s*\)/, `${file}: softDapple: true`);
    const renderOnly = html.match(/function renderOnly\(\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(renderOnly, `${file}: renderOnly() not found`);
    const ro = renderOnly[0];
    const roLeaf = ro.indexOf('leafKit.update('), roShadow = ro.indexOf('pixel.prepareShadows()');
    assert.ok(roLeaf > 0 && roShadow > roLeaf, `${file}: renderOnly() must call leafKit.update before pixel.prepareShadows()`);
    const stepStart = html.indexOf('function step(dt');
    assert.ok(stepStart > 0, `${file}: step() not found`);
    const stepBody = html.slice(stepStart, html.indexOf('\n    }', stepStart));
    const stLeaf = stepBody.indexOf('leafKit.update('), stShadow = stepBody.indexOf('pixel.prepareShadows()');
    assert.ok(stLeaf > 0 && stShadow > stLeaf, `${file}: step() must call leafKit.update before pixel.prepareShadows()`);
  }
  const edo = await fs.readFile(new URL('../edogawa.html', import.meta.url), 'utf8');
  assert.match(edo, /leafKit\.leafify\(/, 'edogawa.html: leafify applied');
  assert.match(edo, /customDepthMaterial\s*=\s*leafKit\.depthMat/, 'edogawa.html: leaf depthMat applied');
});

test('createLook supports custom atmosphere and day RAMP overrides while preserving sunset rays', async () => {
  const source = (await fs.readFile(new URL('../realsite/look.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replaceAll('export ', '');
  const context = vm.createContext({ THREE: { Color: class {} } });
  vm.runInContext(source, context);
  const calls = {}, ramp = { shadow: [], mid: [], high: [] };
  const rampUniform = key => ({ value: { fromArray(v) { ramp[key] = v; } } });
  let sunEl = 45, night = 0, sunY = 0.7;
  const look = context.createLook({
    pixel: { setGrade() {}, setVolumetric(...v) { calls.volume = v; }, setSunRays(...v) { calls.rays = v; } },
    RAMP: { shadow: rampUniform('shadow'), mid: rampUniform('mid'), high: rampUniform('high') },
    tod: { get night() { return night; }, state: { sunDir: { get y() { return sunY; }, x: 1, z: 0 } }, hour: 12 },
    sun: { color: {} },
    sunPath: { sunAt: () => ({ elevation: sunEl }) },
    volDay: 0.22, volWarm: 0.9, volNight: 0.3, volMax: 42,
    dayShadow: [0.24, 0.3, 0.36], dayMid: [0.74, 0.77, 0.78]
  });
  look.update();
  assert.ok(Math.abs(calls.volume[1] - 0.22) < 1e-12, 'day volumetric override');
  assert.equal(calls.volume[3], 42, 'volMax override');
  assert.deepEqual([...ramp.shadow], [0.24, 0.3, 0.36]);
  assert.deepEqual([...ramp.mid], [0.74, 0.77, 0.78]);

  // Low sunset must still keep full sunset rays >= 0.8 and elevated volWarm
  sunEl = 1.3912346231380184; night = 0.02; sunY = 0.024279238848413046;
  const state = look.update();
  assert.ok(calls.rays[1] > 0.8, 'sunset rays preserved');
  assert.equal(calls.rays[1], state.warm * 0.85);
  assert.ok(Math.abs(calls.volume[1] - (state.day * 0.22 + state.warm * 0.9 + state.night * 0.3)) < 1e-12);

  // Night volumetric override
  sunEl = -20; night = 1; sunY = -0.3;
  look.update();
  assert.ok(Math.abs(calls.volume[1] - 0.3) < 1e-12, 'night volumetric override');
  assert.equal(calls.rays[1], 0);
});

test('all four real-site pixel pages configure tightened shadows, bloom 1.0, tuned atmosphere, and classic profile', async () => {
  const expected = {
    'edogawa.html':    { volDay: 0.18, volMax: 45 },
    'nagisa.html':     { volDay: 0.22, volMax: 42 },
    'myoden.html':     { volDay: 0.18, volMax: 45 },
    'myoden-far.html': { volDay: 0.18, volMax: 45 }
  };
  for (const [file, spec] of Object.entries(expected)) {
    const html = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /pixel\.setBloom\(\s*1(\.0)?\s*\)/, `${file}: setBloom(1.0)`);
    assert.doesNotMatch(html, /softLighting\s*:\s*true/, `${file}: keep classic sunset profile`);
    const light = html.match(/createLights\s*\([^)]*extent\s*:\s*([0-9.]+)/);
    assert.ok(light && Number(light[1]) <= 46, `${file}: shadow extent <= 46`);
    const lookCall = html.match(/createLook\s*\(\{[\s\S]*?\}\);/);
    assert.ok(lookCall, `${file}: createLook call not found`);
    assert.match(lookCall[0], new RegExp(`volDay\\s*:\\s*${spec.volDay}`), `${file}: volDay`);
    assert.match(lookCall[0], new RegExp(`volMax\\s*:\\s*${spec.volMax}`), `${file}: volMax`);
    assert.match(lookCall[0], /volWarm\s*:\s*0\.9/, `${file}: volWarm`);
    assert.match(lookCall[0], /volNight\s*:\s*0\.3/, `${file}: volNight`);
  }
});
