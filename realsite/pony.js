// Pony-only rig. All motion is sampled from time, including planted hooves.
import * as THREE from 'three';
import {PONY_MODEL, PONY_PALETTE, PONY_RIG, PONY_LEG_VERTEX_COUNT, ponyPartMesh, ponyLegPart, writePonyLegBuffers} from './pony-model.js';
const TAU = Math.PI * 2;
const mod = (x, n) => ((x % n) + n) % n;
export const PONY_HIPS = PONY_RIG.hips;
// LF, RF, LH, RH: RH -> RF -> LH -> LF, one contact each quarter stride.
export const WALK_OFFSETS = [.75,.25,.5,0];
export const STANCE = .56;

export function stridesForRoute(route) {
  if (Number.isInteger(route?.strides) && route.strides > 0) return route.strides;
  if (route?.radius > 0 && route?.count > 0) return Math.max(1, Math.round((TAU * route.radius / route.count) / .85));
  return PONY_RIG.stridesPerLoop;
}

function triNormal(ax,ay,az,bx,by,bz,cx,cy,cz){
  const e1x=bx-ax,e1y=by-ay,e1z=bz-az,e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
  let nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;
  const len=Math.hypot(nx,ny,nz);
  if(len<1e-12)return [0,1,0];
  if(ny<0){nx=-nx;ny=-ny;nz=-nz;}
  return [nx/len,ny/len,nz/len];
}
function sampleSurface(heightAt,x,z){
  if(typeof heightAt.sample==='function')return heightAt.sample(x,z);
  return {y:heightAt(x,z),nx:0,ny:1,nz:0};
}

// Near terrain is rendered as two indexed triangles per grid cell, whereas
// terrain.heightAt uses bilinear interpolation. Use the actual indices for feet.
// Geometry/field share world x/z coordinates, as in terrain.gridGeometry.
export function createGridGround(geometry,field,fallback) {
  const p=geometry.attributes.position,index=geometry.index,{x0,z0,step,w,h}=field;
  function sample(x,z){
    const fx=(x-x0)/step,fz=(z-z0)/step;
    if(fx<0||fz<0||fx>w-1||fz>h-1)return sampleSurface(fallback,x,z);
    const i=Math.min(w-2,Math.floor(fx)),j=Math.min(h-2,Math.floor(fz)),start=(j*(w-1)+i)*6;
    for(let k=0;k<6;k+=3){
      const a=index.getX(start+k),b=index.getX(start+k+1),c=index.getX(start+k+2);
      const ax=p.getX(a),ay=p.getY(a),az=p.getZ(a);
      const bx=p.getX(b),by=p.getY(b),bz=p.getZ(b);
      const cx=p.getX(c),cy=p.getY(c),cz=p.getZ(c);
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if(Math.abs(den)<1e-12)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
      if(u>=-1e-9&&v>=-1e-9&&u+v<=1+1e-9){
        const [nx,ny,nz]=triNormal(ax,ay,az,bx,by,bz,cx,cy,cz);
        return {y:u*ay+v*by+(1-u-v)*cy,nx,ny,nz};
      }
    }
    return sampleSurface(fallback,x,z);
  }
  const fn=(x,z)=>sample(x,z).y;
  fn.sample=sample;
  return fn;
}

// The riding surface is raised above terrain and linearly interpolated by the
// GPU. Cache its triangles in a small x/z grid instead of raycasting each hoof
// every frame. This sampler is for the fixed facility mesh, not moving meshes.
export function createTrackGround(mesh,heightAt) {
  mesh.updateWorldMatrix(true,false);
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  const buckets=new Map(),cell=2,eps=1e-6,v=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3){
    const points=[];for(let j=0;j<3;j++){v.fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(mesh.matrixWorld);points.push([v.x,v.y,v.z]);}
    const [a,b,c]=points,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(den)<1e-12)continue;
    const normal=triNormal(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
    const tri={a,b,c,den,normal};
    const minX=Math.floor((Math.min(a[0],b[0],c[0])-eps)/cell),maxX=Math.floor((Math.max(a[0],b[0],c[0])+eps)/cell);
    const minZ=Math.floor((Math.min(a[2],b[2],c[2])-eps)/cell),maxZ=Math.floor((Math.max(a[2],b[2],c[2])+eps)/cell);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
      const key=`${x},${z}`;let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push(tri);
    }
  }
  function sample(x,z){
    let best=sampleSurface(heightAt,x,z);
    const list=buckets.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`);
    if(list)for(const {a,b,c,den,normal}of list){
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const w=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
      if(u>=-1e-9&&w>=-1e-9&&u+w<=1+1e-9){
        const y=u*a[1]+w*b[1]+(1-u-w)*c[1];
        if(y>=best.y)best={y,nx:normal[0],ny:normal[1],nz:normal[2]};
      }
    }
    return best;
  }
  const fn=(x,z)=>sample(x,z).y;
  fn.sample=sample;
  return fn;
}

export function circlePose(t, index, { x, z, radius, count, loop }) {
  const angle = (index + t / loop) * TAU / count;
  return { x:x+Math.cos(angle)*radius, z:z+Math.sin(angle)*radius, yaw:Math.atan2(Math.sin(angle),-Math.cos(angle)), angle };
}
function hoofAnchor(t,index,leg,route,heightAt) {
  const p=circlePose(t,index,route),[x,,z]=PONY_HIPS[leg];
  const wx=p.x+Math.cos(p.yaw)*x+Math.sin(p.yaw)*z;
  const wz=p.z-Math.sin(p.yaw)*x+Math.cos(p.yaw)*z;
  const s=sampleSurface(heightAt,wx,wz);
  return {world:[wx,s.y,wz],normal:[s.nx,s.ny,s.nz]};
}
export function sampleWalk(t,index,route,heightAt) {
  const pose=circlePose(t,index,route),period=route.loop/(route.strides??PONY_RIG.stridesPerLoop);
  const feet=PONY_HIPS.map((_,leg)=>{
    const stride=t/period-WALK_OFFSETS[leg],cycle=Math.floor(stride),phase=mod(stride,1);
    const contact=(cycle+WALK_OFFSETS[leg]+STANCE/2)*period;
    const from=hoofAnchor(contact,index,leg,route,heightAt);
    if(phase<STANCE)return {world:from.world,groundY:from.world[1],normal:from.normal,phase,planted:true};
    const to=hoofAnchor(contact+period,index,leg,route,heightAt);
    const u=(phase-STANCE)/(1-STANCE),s=u*u*u*(u*(6*u-15)+10);
    const x=from.world[0]+(to.world[0]-from.world[0])*s,z=from.world[2]+(to.world[2]-from.world[2])*s;
    const groundHere=heightAt(x,z);
    const pitch=.08*Math.sin(TAU*u)*Math.sin(Math.PI*u);
    // Account for tilted toe/heel drop so the rectangular hoof clears uneven ground.
    const toeDrop=.5*PONY_RIG.hoof[2]*Math.abs(Math.sin(pitch));
    // Gentle, low-arc equine walk lift: smooth liftoff and unhurried touch-down.
    const lift=.058*Math.sin(Math.PI*u)**2*(1+.30*Math.cos(Math.PI*u));
    const y=Math.max(from.world[1]+(to.world[1]-from.world[1])*s,groundHere+toeDrop)+lift;
    return {world:[x,y,z],groundY:groundHere,phase,planted:false,pitch};
  });
  return { ...pose, y:heightAt(pose.x,pose.z), feet };
}

// Compute gentle body pitch/roll from ground heights under the four feet (never swing air height).
const _bodyLength=PONY_HIPS[2][2]-PONY_HIPS[0][2],_bodyWidth=PONY_HIPS[1][0]-PONY_HIPS[0][0];
const _footGroundY=f=>f.groundY??f.world[1];
export function computeBodyTilt(feet,maxTilt=.20){
  const yF=(_footGroundY(feet[0])+_footGroundY(feet[1]))*.5,yH=(_footGroundY(feet[2])+_footGroundY(feet[3]))*.5;
  const yL=(_footGroundY(feet[0])+_footGroundY(feet[2]))*.5,yR=(_footGroundY(feet[1])+_footGroundY(feet[3]))*.5;
  return {
    pitch:THREE.MathUtils.clamp(Math.atan2(yF-yH,_bodyLength)*.85,-maxTilt,maxTilt),
    roll:THREE.MathUtils.clamp(Math.atan2(yR-yL,_bodyWidth)*.85,-maxTilt,maxTilt)
  };
}

// Two analytic solves give an anatomical three-section silhouette. The proximal
// segment stays in the shoulder/thigh; fore carpus and hind hock have independent
// proportions and bend planes. Bend direction uses the anatomical local +X hinge
// axis (cross(d, +X)), avoiding singularities when a leg swings far fore/aft.
function solveTwoLink(hip,foot,upper,lower,bend) {
  let dx=foot[0]-hip[0],dy=foot[1]-hip[1],dz=foot[2]-hip[2];
  const actual=Math.hypot(dx,dy,dz);
  const distance=THREE.MathUtils.clamp(actual,Math.abs(upper-lower)+.00001,upper+lower-.00001);
  if(actual<1e-8){dx=0;dy=-1;dz=0;}else{dx/=actual;dy/=actual;dz/=actual;}
  const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
  // cross(d, [1,0,0]) * bend = (0, bend * dz, -bend * dy); orthogonal to d.
  let sx=0,sy=bend*dz,sz=-bend*dy,sl=Math.hypot(sy,sz);
  if(sl<1e-8){sx=0;sy=0;sz=bend;}else{sy/=sl;sz/=sl;}
  const h=Math.sqrt(Math.max(0,upper*upper-along*along));
  return {
    joint:[hip[0]+dx*along+sx*h,hip[1]+dy*along+sy*h,hip[2]+dz*along+sz*h],
    foot:[hip[0]+dx*distance,hip[1]+dy*distance,hip[2]+dz*distance],
    clamped:Math.abs(distance-actual)>1e-6
  };
}
const smoothMax=(a,b,k=.02)=>.5*(a+b+Math.hypot(a-b,k));
export function solvePonyLeg(hip,foot,bend=1,swing=0) {
  const rig=bend<0?PONY_RIG.fore:PONY_RIG.hind;
  const distance=Math.hypot(foot[0]-hip[0],foot[1]-hip[1],foot[2]-hip[2]);
  const reach=THREE.MathUtils.clamp(smoothMax(rig.reach-.025*swing,distance-rig.proximal+.015),Math.abs(rig.upper-rig.lower)+.001,rig.upper+rig.lower-.0003);
  const proximal=solveTwoLink(hip,foot,rig.proximal,reach,-bend);
  const distal=solveTwoLink(proximal.joint,proximal.foot,rig.upper,rig.lower,bend);
  return {elbow:proximal.joint,joint:distal.joint,foot:distal.foot,clamped:proximal.clamped||distal.clamped};
}

// Static parts with one material are merged once per coat; rigs share the result.
function merge(parts) {
  const positions=[],normals=[],indices=[];let offset=0;
  for(const g of parts){positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);indices.push(...Array.from(g.index.array,i=>i+offset));offset+=g.attributes.position.count;g.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);g.computeBoundingSphere();return g;
}
const kits=new WeakMap();
function modelGeometry(parts) {
  return merge(parts.map(part=>{
    const {vertices,indices}=ponyPartMesh(part),g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }));
}
function ponyKit(toon,color,mane,saddle,patch) {
  let cache=kits.get(toon);if(!cache){cache=new Map();kits.set(toon,cache);}
  const key=JSON.stringify([color,mane,saddle,patch]);if(cache.has(key))return cache.get(key);
  const flat=p=>{const material=toon(p);material.flatShading=true;return material;};
  const coat=flat({color}),dark=flat({color:mane}),hoof=flat({color:PONY_PALETTE.hoof}),tack=flat({color:PONY_PALETTE.tack});
  const kit={coat,dark,hoof,tack,unitBox:modelGeometry([PONY_MODEL.limb]),
    body:modelGeometry(PONY_MODEL.body),neck:modelGeometry(PONY_MODEL.neck),
    head:modelGeometry(PONY_MODEL.head),eyes:modelGeometry(PONY_MODEL.eyes),
    maneGeo:modelGeometry(PONY_MODEL.mane),tailGeo:modelGeometry(PONY_MODEL.tail),
    saddle:saddle?modelGeometry(PONY_MODEL.saddle):null,saddleMat:saddle?flat({color:saddle}):null,
    seat:saddle?modelGeometry(PONY_MODEL.seat):null,
    patchGeo:patch?modelGeometry(PONY_MODEL.patch):null,patchMat:patch?flat({color:patch}):null,
    halter:modelGeometry(PONY_MODEL.halter)};
  cache.set(key,kit);return kit;
}

export function createPony(toon,{color='#8a5a3a',mane='#3a2a20',saddle=null,patch=null,len=1.35,h=1.05}={}) {
  const kit=ponyKit(toon,color,mane,saddle,patch),group=new THREE.Group(),neck=new THREE.Group();
  group.name='Nagisa Pony';neck.name='Pony Neck Pivot';
  group.scale.set(len/1.35,h/1.05,len/1.35);
  const mesh=(geo,mat,parent=group,name='')=>{const m=new THREE.Mesh(geo,mat);m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  mesh(kit.body,kit.coat,group,'Pony Body');if(kit.patchGeo)mesh(kit.patchGeo,kit.patchMat,group,'Pony Pinto Patch');
  neck.position.fromArray(PONY_RIG.neck);neck.rotation.x=PONY_RIG.neckAngle;group.add(neck);
  mesh(kit.neck,kit.coat,neck,'Pony Neck');mesh(kit.head,kit.coat,neck,'Pony Head');mesh(kit.eyes,kit.hoof,neck,'Pony Eyes');mesh(kit.maneGeo,kit.dark,neck,'Pony Mane');mesh(kit.halter,kit.tack,neck,'Pony Halter');
  const leadPoint=new THREE.Object3D();leadPoint.name='Pony Lead Point';leadPoint.position.fromArray(PONY_RIG.lead);neck.add(leadPoint);
  const tail=mesh(kit.tailGeo,kit.dark,group,'Pony Tail');tail.position.fromArray(PONY_RIG.tail);tail.rotation.x=.28;
  if(kit.saddle){mesh(kit.saddle,kit.saddleMat,group,'Pony Saddle Blanket');mesh(kit.seat,kit.tack,group,'Pony Saddle Seat');}
  // Four continuous low-poly surfaces share one dynamic mesh. A shared ring at
  // each joint closes the silhouette without joint balls or intersecting caps.
  const legParts=PONY_HIPS.map((hip,i)=>{const r=solvePonyLeg(hip,[hip[0],PONY_RIG.hoof[1],hip[2]],i<2?-1:1);return ponyLegPart([hip,r.elbow,r.joint,r.foot],i,[0,1,0]);});
  const legGeometry=modelGeometry(legParts);
  legGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  legGeometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  legGeometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.5,0),1.5);
  const legMesh=mesh(legGeometry,kit.coat,group,'Pony Continuous Legs');
  const hoofInstances=new THREE.InstancedMesh(kit.unitBox,kit.hoof,4);
  hoofInstances.castShadow=hoofInstances.receiveShadow=true;
  hoofInstances.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.4,0),1.5);
  hoofInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(hoofInstances);
  const legs=PONY_HIPS.map((_,i)=>{
    const pieces={footUp:[0,1,0]};for(const key of ['proximal','upper','lower','hoof']){
      const part=new THREE.Object3D();part.name='Pony '+['LF','RF','LH','RH'][i]+' '+key;group.add(part);pieces[key]=part;
    }return pieces;
  });
  const up=new THREE.Vector3(0,1,0),xAxis=new THREE.Vector3(1,0,0),a=new THREE.Vector3(),b=new THREE.Vector3(),dir=new THREE.Vector3(),unitDir=new THREE.Vector3();
  const inverse=new THREE.Matrix4(),sole=new THREE.Vector3(),top=new THREE.Vector3(),hoofUp=new THREE.Vector3(),localNormal=new THREE.Vector3(),idleProbe=new THREE.Vector3();
  const topArr=[0,0,0],clamped=[false,false,false,false];
  const legPosArr=legGeometry.attributes.position.array,legNormArr=legGeometry.attributes.normal.array;
  let idleFeetValid=false,lastIdleGround=null;
  const lastIdleMatrix=new THREE.Matrix4();
  function beam(m,from,to,width){
    a.fromArray(from);b.fromArray(to);dir.subVectors(b,a);
    const len=dir.length();
    m.position.copy(a).add(b).multiplyScalar(.5);
    if(len>1e-8){unitDir.copy(dir).divideScalar(len);m.quaternion.setFromUnitVectors(up,unitDir);}
    else m.quaternion.identity();
    m.scale.set(width,len,width);
  }
  function setFeet(feet){
    idleFeetValid=false;
    // Caller may move the root independently; invert only once per pose.
    group.updateWorldMatrix(true,false);
    inverse.copy(group.matrixWorld).invert();
    const me=group.matrixWorld.elements;
    for(let i=0;i<feet.length;i++){
      const f=feet[i],leg=legs[i];
      sole.fromArray(f.world).applyMatrix4(inverse);
      if(f.planted===false){
        leg.hoof.quaternion.setFromAxisAngle(xAxis,f.pitch||0);
      }else if(f.normal){
        // Transform world surface normal into local space via M^T so the hoof sole stays flush.
        const nx=f.normal[0],ny=f.normal[1],nz=f.normal[2];
        localNormal.set(me[0]*nx+me[1]*ny+me[2]*nz,me[4]*nx+me[5]*ny+me[6]*nz,me[8]*nx+me[9]*ny+me[10]*nz);
        if(localNormal.lengthSq()>1e-12){localNormal.normalize();leg.hoof.quaternion.setFromUnitVectors(up,localNormal);}
        else leg.hoof.quaternion.identity();
      }else{
        leg.hoof.quaternion.identity();
      }
      hoofUp.copy(up).applyQuaternion(leg.hoof.quaternion);
      leg.footUp[0]=hoofUp.x;leg.footUp[1]=hoofUp.y;leg.footUp[2]=hoofUp.z;
      top.copy(sole).addScaledVector(hoofUp,PONY_RIG.hoof[1]);
      topArr[0]=top.x;topArr[1]=top.y;topArr[2]=top.z;
      const swing=f.planted===false?Math.sin(Math.PI*(f.phase-STANCE)/(1-STANCE))**2:0;
      const solved=solvePonyLeg(PONY_HIPS[i],topArr,i<2?-1:1,swing);
      beam(leg.proximal,PONY_HIPS[i],solved.elbow,1);beam(leg.upper,solved.elbow,solved.joint,1);beam(leg.lower,solved.joint,solved.foot,1);
      leg.points=[PONY_HIPS[i],solved.elbow,solved.joint,solved.foot];
      writePonyLegBuffers(legPosArr,legNormArr,i*PONY_LEG_VERTEX_COUNT,leg.points,i,leg.footUp);
      leg.hoof.position.fromArray(solved.foot).addScaledVector(hoofUp,-PONY_RIG.hoof[1]*.5);
      leg.hoof.scale.fromArray(PONY_RIG.hoof);leg.hoof.updateMatrix();hoofInstances.setMatrixAt(i,leg.hoof.matrix);
      clamped[i]=solved.clamped;
    }
    legGeometry.attributes.position.needsUpdate=true;
    legGeometry.attributes.normal.needsUpdate=true;
    hoofInstances.instanceMatrix.needsUpdate=true;
    return clamped.slice();
  }
  function idle(t,{heightAt,grazing=false,phase=0,loop=6}={}){
    const p=t*TAU/loop+phase;
    neck.position.y=grazing?.69:PONY_RIG.neck[1];
    neck.rotation.x=grazing?-1.90+Math.sin(p)*.035:PONY_RIG.neckAngle+Math.sin(p)*.025;
    neck.rotation.y=0;
    tail.rotation.z=Math.sin(p*2)*.13;
    group.updateWorldMatrix(true,false);
    // Idle neck/tail motion does not change planted feet on this static ground.
    // Recompute after walking, root/parent transforms, or explicit invalidation.
    if(!idleFeetValid||lastIdleGround!==heightAt||!lastIdleMatrix.equals(group.matrixWorld)){
      const feet=PONY_HIPS.map(([x,,z])=>{
        idleProbe.set(x,0,z).applyMatrix4(group.matrixWorld);
        const s=sampleSurface(heightAt,idleProbe.x,idleProbe.z);
        return {world:[idleProbe.x,s.y,idleProbe.z],normal:[s.nx,s.ny,s.nz]};
      });
      setFeet(feet);
      lastIdleMatrix.copy(group.matrixWorld);lastIdleGround=heightAt;idleFeetValid=true;
    }
  }
  return {group,neck,tail,legs,legMesh,hoofInstances,leadPoint,setFeet,idle,invalidateFeet:()=>{idleFeetValid=false;},saddleY:PONY_RIG.saddleY};
}
