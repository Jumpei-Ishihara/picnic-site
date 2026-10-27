import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPony,sampleWalk,PONY_HIPS,solvePonyLeg,WALK_OFFSETS,STANCE,createGridGround} from '../realsite/pony.js';
import {createPonyRing,createPonyLand} from '../realsite/nagisa-facilities.js';
const toon=p=>new THREE.MeshBasicMaterial(p),route={x:-148.5,z:-48.5,radius:4.3,count:3,loop:6};
const H=(x,z)=>.012*x+.018*z;
const near=(x,y,e=1e-8)=>assert.ok(Math.abs(x-y)<e,`${x} != ${y}`);
test('walk contacts are a four beat RH RF LH LF sequence',()=>{
 assert.deepEqual(WALK_OFFSETS.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]),[3,1,2,0]);
 for(let i=0;i<4;i++)near(sampleWalk(WALK_OFFSETS[i]*.75+.001,0,route,H).feet[i].phase,.001/.75);
});
test('stance hooves stay fixed in world space and swing clears terrain',()=>{
 for(let leg=0;leg<4;leg++){
  const t=(WALK_OFFSETS[leg]+.1)*.75,a=sampleWalk(t,0,route,H).feet[leg],b=sampleWalk(t+.15,0,route,H).feet[leg];
  assert.ok(a.planted&&b.planted);a.world.forEach((v,i)=>near(v,b.world[i]));near(a.world[1],H(a.world[0],a.world[2]));
  const f=sampleWalk((WALK_OFFSETS[leg]+(STANCE+1)/2)*.75,0,route,H).feet[leg];assert.ok(!f.planted);assert.ok(f.world[1]-H(f.world[0],f.world[2])>.10);
 }
});
test('two-link IK keeps segment lengths, clamps extremes and remains finite',()=>{
 for(const foot of [[.18,.07,-.22],[.18,.15,-.7],[20,-9,4],PONY_HIPS[1]]){
  const r=solvePonyLeg(PONY_HIPS[1],foot,-1),h=new THREE.Vector3().fromArray(PONY_HIPS[1]),j=new THREE.Vector3().fromArray(r.joint),f=new THREE.Vector3().fromArray(r.foot);
  near(h.distanceTo(j),.34);near(j.distanceTo(f),.33);assert.ok([...r.foot,...r.joint].every(Number.isFinite));
 }
});
test('real rig hoof bottoms meet target terrain throughout circular walking',()=>{
 const p=createPony(toon,{saddle:'#b8463f'});let clamped=0,maxError=0;
 for(let i=0;i<720;i++){
  const m=sampleWalk(i/120,0,route,H);p.group.position.set(m.x,m.y,m.z);p.group.rotation.y=m.yaw;
  clamped+=p.setFeet(m.feet).filter(Boolean).length;p.group.updateMatrixWorld(true);
  p.legs.forEach((leg,k)=>{const v=new THREE.Vector3(0,-.5,0).applyMatrix4(leg.hoof.matrixWorld);const expected=m.feet[k].world;maxError=Math.max(maxError,v.distanceTo(new THREE.Vector3().fromArray(expected)));});
 }
 assert.equal(clamped,0);assert.ok(maxError<1e-7,`hoof target error ${maxError}`);
});
test('6 second permutation preserves every spatial pony and foot target',()=>{
 for(const t of [-.01,0,.17,.75,2.21,5.99])for(let i=0;i<3;i++){
  const a=sampleWalk(t+6,i,route,H),b=sampleWalk(t,(i+1)%3,route,H);near(a.x,b.x);near(a.z,b.z);
  a.feet.forEach((f,k)=>f.world.forEach((v,j)=>near(v,b.feet[k].world[j])));
 }
});
test('fenceless riding creates neither inner rails nor central shelter',()=>{
 const ring={x:0,z:0,rIn:3.2,rOut:5.4,fenceR:0,centerR:2,ponies:0};
 const a=createPonyRing({toon,ring,heightAt:()=>0,style:'none'});a.update(1,true);assert.equal(a.fenceParts.length,0);assert.equal(a.units.length,0);
 const b=createPonyRing({toon,ring:{...ring,fenceR:6,centerR:0},heightAt:()=>0,style:'white'});assert.ok(b.fenceParts.length>0);
});
test('grazing moves a connected neck hierarchy and fixed roots loop',()=>{
 const p=createPony(toon,{patch:'#79513b'});p.group.position.set(1,H(1,2),2);p.idle(.2,{heightAt:H,grazing:true});const angle=p.neck.rotation.x;
 assert.equal(p.leadPoint.parent,p.neck);p.group.updateMatrixWorld(true);const initial=p.leadPoint.getWorldPosition(new THREE.Vector3());
 p.idle(6.2,{heightAt:H,grazing:true});p.group.updateMatrixWorld(true);near(angle,p.neck.rotation.x);near(initial.distanceTo(p.leadPoint.getWorldPosition(new THREE.Vector3())),0);
});
test('planted hooves meet the rendered raised track, independently raycast',()=>{
 const terrain=(x,z)=>.04*Math.sin(x*.7)*Math.cos(z*.5);
 const ring=createPonyRing({toon,ring:{x:0,z:0,rIn:3.2,rOut:5.4,fenceR:0,centerR:0,ponies:3},heightAt:terrain,style:'none'});
 const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let samples=0;
 for(let frame=0;frame<120;frame++){
  const t=frame/20;ring.update(t,true);ring.group.updateMatrixWorld(true);
  ring.units.forEach((u,i)=>{
   const m=sampleWalk(t,i,ring.route,ring.groundAt);
   assert.ok(u.clamped.every(v=>!v));
   u.pony.legs.forEach((l,k)=>{
    if(!m.feet[k].planted)return;
    const foot=new THREE.Vector3(0,-.5,0).applyMatrix4(l.hoof.matrixWorld);ray.set(new THREE.Vector3(foot.x,10,foot.z),down);
    const hit=ray.intersectObject(ring.trackMesh)[0];assert.ok(hit);near(foot.y,hit.point.y,1e-7);samples++;
   });
  });
 }
 assert.ok(samples>800);near(ring.groundAt(0,0),terrain(0,0));near(ring.groundAt(10,10),terrain(10,10));
 ring.update(.17,false);ring.group.updateMatrixWorld(true);
 for(const u of ring.units){
  assert.equal(u.handler.group.visible,false);assert.equal(u.rider.group.visible,false);assert.equal(u.rope.visible,false);
  for(const leg of u.pony.legs){const f=new THREE.Vector3(0,-.5,0).applyMatrix4(leg.hoof.matrixWorld);ray.set(new THREE.Vector3(f.x,10,f.z),down);near(f.y,ray.intersectObject(ring.trackMesh)[0].point.y,1e-7);}
 }
});
test('lead attaches to the visible hand at the arm end on the pony side',()=>{
 const ring=createPonyRing({toon,ring:{x:0,z:0,rIn:3.2,rOut:5.4,fenceR:0,centerR:0,ponies:3},heightAt:()=>0,style:'none'});
 for(const t of [0,.7,5.99,6,12]){
  ring.update(t,true);ring.group.updateMatrixWorld(true);
  for(const u of ring.units){
   assert.equal(u.hand.isMesh,true);near(u.hand.position.y,-u.hand.parent.geometry.parameters.height/2);
   const hand=u.hand.getWorldPosition(new THREE.Vector3()),end=new THREE.Vector3().fromBufferAttribute(u.rope.geometry.attributes.position,2).applyMatrix4(ring.group.matrixWorld);
   near(hand.distanceTo(end),0,1e-6);
   const toward=u.pony.group.position.clone().sub(u.handler.group.position),offset=hand.clone().sub(u.handler.group.position);toward.y=offset.y=0;
   assert.ok(toward.dot(offset)>0);
  }
 }
});
test('pinto markings follow the barrel and the white waiting pony stays white',()=>{
 const land={arena:[-20,-20,-10,-10],paddock:[10,10,20,20],stables:[],gate:[0,20,0],grazing:[],waiting:[[0,0,0,'#f2efe8','#6a4030'],[4,0,0,'#f2efe8','#c8c4bc']]};
 const a=createPonyLand({toon,land,heightAt:()=>0});
 const patches=p=>p.group.children.filter(o=>o.material?.color?.getHexString()==='79513b');
 assert.equal(patches(a.grazers[0].p).length,1);assert.equal(patches(a.grazers[1].p).length,0);
 const pos=patches(a.grazers[0].p)[0].geometry.attributes.position;
 for(let i=0;i<pos.count;i++)near((pos.getX(i)/.262)**2+((pos.getY(i)-.81)/.257)**2+(pos.getZ(i)/.622)**2,1,1e-6);
});
test('idle feet avoid repeated IK and GPU uploads but invalidate after movement and walking',()=>{
 const p=createPony(toon);let samples=0;const ground=(x,z)=>{samples++;return H(x,z);};
 p.idle(0,{heightAt:ground});const before=[samples,p.legInstances.instanceMatrix.version],neck=p.neck.rotation.x;
 for(let i=1;i<100;i++)p.idle(i/60,{heightAt:ground});
 assert.deepEqual([samples,p.legInstances.instanceMatrix.version],before);assert.notEqual(p.neck.rotation.x,neck);
 p.group.position.x=1;p.idle(2,{heightAt:ground});assert.equal(samples,before[0]+4);assert.equal(p.legInstances.instanceMatrix.version,before[1]+1);
 const parent=new THREE.Group();parent.add(p.group);parent.position.z=2;p.idle(2,{heightAt:ground});assert.equal(samples,before[0]+8);
 p.invalidateFeet();p.idle(2,{heightAt:ground});assert.equal(samples,before[0]+12);
 const feet=PONY_HIPS.map(([x,,z])=>({world:[x,H(x,z),z]}));p.setFeet(feet);p.idle(2,{heightAt:ground});assert.equal(samples,before[0]+16);
});
test('terrain contact follows the indexed diagonal instead of bilinear height',()=>{
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1,1,1,1],3));geometry.setIndex([0,2,3,0,3,1]);
 const sample=createGridGround(geometry,{x0:0,z0:0,step:1,w:2,h:2},()=>-99);
 const mesh=new THREE.Mesh(geometry,toon({})),ray=new THREE.Raycaster();mesh.updateMatrixWorld(true);
 for(const [x,z]of [[.5,.5],[.7,.3],[.1,.9],[0,0],[1,1]]){
  ray.set(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0));near(sample(x,z),ray.intersectObject(mesh)[0].point.y);
 }
 near(sample(.5,.5),.5);assert.notEqual(sample(.5,.5),.5*.5);assert.equal(sample(-1,0),-99);
});
