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
