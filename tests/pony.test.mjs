import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PONY_RIG} from '../realsite/pony-model.js';
import {createPony,sampleWalk,PONY_HIPS,solvePonyLeg,WALK_OFFSETS,STANCE,createGridGround,computeBodyTilt,stridesForRoute} from '../realsite/pony.js';
import {createPonyRing,createPonyLand} from '../realsite/nagisa-facilities.js';
const toon=p=>new THREE.MeshBasicMaterial(p),route={x:-148.5,z:-48.5,radius:4.3,count:3,loop:6};
const H=(x,z)=>.012*x+.018*z;
const near=(x,y,e=1e-8)=>assert.ok(Math.abs(x-y)<e,`${x} != ${y}`);
test('walk contacts are a four beat RH RF LH LF sequence',()=>{
 assert.deepEqual(WALK_OFFSETS.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]),[3,1,2,0]);
 const period=route.loop/PONY_RIG.stridesPerLoop;for(let i=0;i<4;i++)near(sampleWalk(WALK_OFFSETS[i]*period+.001,0,route,H).feet[i].phase,.001/period);
});
test('stance hooves stay fixed in world space and swing clears terrain',()=>{
 for(let leg=0;leg<4;leg++){
  const period=route.loop/PONY_RIG.stridesPerLoop,t=(WALK_OFFSETS[leg]+.1)*period,a=sampleWalk(t,0,route,H).feet[leg],b=sampleWalk(t+.1,0,route,H).feet[leg];
  assert.ok(a.planted&&b.planted);a.world.forEach((v,i)=>near(v,b.world[i]));near(a.world[1],H(a.world[0],a.world[2]));
  const f=sampleWalk((WALK_OFFSETS[leg]+(STANCE+1)/2)*period,0,route,H).feet[leg];assert.ok(!f.planted);const clearance=f.world[1]-H(f.world[0],f.world[2]);assert.ok(clearance>.048&&clearance<.08,`natural walk clearance ${clearance}`);
 }
});
test('three-section fore and hind IK keep lengths, clamp extremes and remain finite',()=>{
 for(const foot of [[.18,.07,-.22],[.18,.15,-.7],[20,-9,4],PONY_HIPS[1]]){
  for(const leg of [1,3]){const bend=leg<2?-1:1,rig=leg<2?PONY_RIG.fore:PONY_RIG.hind,r=solvePonyLeg(PONY_HIPS[leg],foot,bend),h=new THREE.Vector3().fromArray(PONY_HIPS[leg]),e=new THREE.Vector3().fromArray(r.elbow),j=new THREE.Vector3().fromArray(r.joint),f=new THREE.Vector3().fromArray(r.foot);
  near(h.distanceTo(e),rig.proximal);near(e.distanceTo(j),rig.upper);near(j.distanceTo(f),rig.lower);assert.ok([...r.foot,...r.joint,...r.elbow].every(Number.isFinite));}
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
test('block pinto markings stay against the flat barrel and the white waiting pony stays white',()=>{
 const land={arena:[-20,-20,-10,-10],paddock:[10,10,20,20],stables:[],gate:[0,20,0],grazing:[],waiting:[[0,0,0,'#f2efe8','#6a4030'],[4,0,0,'#f2efe8','#c8c4bc']]};
 const a=createPonyLand({toon,land,heightAt:()=>0});
 const patches=p=>p.group.children.filter(o=>o.material?.color?.getHexString()==='79513b');
 assert.equal(patches(a.grazers[0].p).length,1);assert.equal(patches(a.grazers[1].p).length,0);
 const pos=patches(a.grazers[0].p)[0].geometry.attributes.position;
 for(let i=0;i<pos.count;i++){assert.ok(Math.abs(pos.getX(i))>=.245&&Math.abs(pos.getX(i))<=.261);assert.ok(pos.getY(i)>.55&&pos.getY(i)<1.05);assert.ok(Math.abs(pos.getZ(i))<.55);}
});
test('idle feet avoid repeated IK and GPU uploads but invalidate after movement and walking',()=>{
 const p=createPony(toon);let samples=0;const ground=(x,z)=>{samples++;return H(x,z);};
 p.idle(0,{heightAt:ground});const before=[samples,p.hoofInstances.instanceMatrix.version],neck=p.neck.rotation.x;
 for(let i=1;i<100;i++)p.idle(i/60,{heightAt:ground});
 assert.deepEqual([samples,p.hoofInstances.instanceMatrix.version],before);assert.notEqual(p.neck.rotation.x,neck);
 p.group.position.x=1;p.idle(2,{heightAt:ground});assert.equal(samples,before[0]+4);assert.equal(p.hoofInstances.instanceMatrix.version,before[1]+1);
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


test('hoof pitch eases into and out of swing without an angular snap at contact',()=>{
 const period=route.loop/PONY_RIG.stridesPerLoop,epsilon=1e-6;
 for(let leg=0;leg<4;leg++)for(const phase of [STANCE,1]){
  const time=(WALK_OFFSETS[leg]+phase)*period;
  const pitch=t=>sampleWalk(t,0,route,H).feet[leg].pitch||0;
  assert.ok(Math.abs(pitch(time-epsilon)-pitch(time+epsilon))/(2*epsilon)<.01,'contact angular velocity should tend to zero');
 }
});

test('planted hooves align to sloped terrain normals and hinge IK avoids Z-axis singularity',()=>{
 const geometry=new THREE.BufferGeometry();
 // Uniform slope: y = 0.25 * z (uphill toward +z, downhill toward -z).
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-2,-.5,-2, 2,-.5,-2, -2,.5,2, 2,.5,2],3));
 geometry.setIndex([0,2,3,0,3,1]);
 const ground=createGridGround(geometry,{x0:-2,z0:-2,step:4,w:2,h:2},()=>0);
 const s=ground.sample(0,0),expectedN=new THREE.Vector3(0,1,-.25).normalize();
 near(s.nx,expectedN.x,1e-6);near(s.ny,expectedN.y,1e-6);near(s.nz,expectedN.z,1e-6);
 const p=createPony(toon);p.idle(0,{heightAt:ground});p.group.updateMatrixWorld(true);
 for(const leg of p.legs){
  const hoofUp=new THREE.Vector3(0,1,0).applyQuaternion(leg.hoof.quaternion);
  near(hoofUp.dot(expectedN),1,1e-6);
 }
 // Compute body tilt: front (-z) lower than hind (+z) => negative pitch; clamped on steep slopes.
 const tilt=computeBodyTilt([{world:[0,0,0]},{world:[0,0,0]},{world:[0,.2,0]},{world:[0,.2,0]}]);
 assert.ok(tilt.pitch<0&&tilt.pitch>=-.20);
 const steep=computeBodyTilt([{world:[0,5,0]},{world:[0,5,0]},{world:[0,0,0]},{world:[0,0,0]}]);
 near(steep.pitch,.20,1e-9);
 // Extreme forward target along -Z: hinge plane stays in hip X without jumping sideways.
 const hip=PONY_HIPS[1],r=solvePonyLeg(hip,[hip[0],hip[1],hip[2]-.55],-1);
 near(r.elbow[0],hip[0],1e-6);near(r.joint[0],hip[0],1e-6);near(r.foot[0],hip[0],1e-6);
});

test('flat walking keeps body tilt level without swing-induced wobbling and uses asymmetric lift',()=>{
 const flat=()=>0,period=route.loop/PONY_RIG.stridesPerLoop;
 for(let i=0;i<60;i++){
  const m=sampleWalk(i/60*period,0,route,flat);
  const tilt=computeBodyTilt(m.feet);
  near(tilt.pitch,0,1e-6);near(tilt.roll,0,1e-6);
 }
 // Natural walk swing peaks earlier (after lift-off) and lowers gently before touch-down.
 const early=sampleWalk((WALK_OFFSETS[0]+STANCE+(1-STANCE)*.38)*period,0,route,flat).feet[0].world[1];
 const late=sampleWalk((WALK_OFFSETS[0]+STANCE+(1-STANCE)*.72)*period,0,route,flat).feet[0].world[1];
 assert.ok(early>late&&early>.045&&early<.075,`early ${early}, late ${late}`);
});

test('calm walk scales strides to route speed and nods the neck smoothly without chatter',()=>{
 assert.equal(stridesForRoute({radius:4.3,count:5,loop:6}),6);
 const ring=createPonyRing({toon,ring:{x:0,z:0,rIn:3.2,rOut:5.4,fenceR:0,centerR:0,ponies:5},heightAt:()=>0,style:'none'});
 const pitches=[],yaws=[];
 for(let i=0;i<120;i++){
  ring.update(i/20,true);
  const u=ring.units[0];
  assert.ok(u.clamped.every(v=>!v));
  pitches.push(u.pony.neck.rotation.x);
  yaws.push(u.pony.neck.rotation.y);
 }
 const pitchSpan=Math.max(...pitches)-Math.min(...pitches);
 const yawSpan=Math.max(...yaws)-Math.min(...yaws);
 assert.ok(pitchSpan>.08&&pitchSpan<.16,`neck pitch span ${pitchSpan}`);
 assert.ok(yawSpan>.02&&yawSpan<.06,`neck yaw span ${yawSpan}`);
 ring.update(0,true);const p0=ring.units[0].pony.neck.rotation.x,y0=ring.units[0].pony.neck.rotation.y;
 ring.update(6,true);near(ring.units[0].pony.neck.rotation.x,p0,1e-7);near(ring.units[0].pony.neck.rotation.y,y0,1e-7);
});

test('nagisa scene pony riding hours cover daytime 11:00 to 16:00',async()=>{
 const fs=await import('node:fs/promises');
 const data=JSON.parse(await fs.readFile(new URL('../scenes/nagisa/scene.json',import.meta.url),'utf8'));
 for(const key of ['ponyRide','ponyRing']){
  const hours=data.facilities[key].hours;
  const active=h=>hours.some(([a,b])=>h>=a&&h<b);
  assert.equal(active(10.5),false,`${key} before 11:00`);
  for(const h of [11,12,13.5,15.5])assert.equal(active(h),true,`${key} at ${h}`);
  assert.equal(active(16),false,`${key} at 16:00`);
 }
});
