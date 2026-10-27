// Pony-only rig. All motion is sampled from time, including planted hooves.
import * as THREE from 'three';
const TAU = Math.PI * 2;
const mod = (x, n) => ((x % n) + n) % n;
export const PONY_HIPS = [[-.18,.59,-.45],[.18,.59,-.45],[-.18,.59,.45],[.18,.59,.45]];
// LF, RF, LH, RH: RH -> RF -> LH -> LF, one contact each quarter stride.
export const WALK_OFFSETS = [.75,.25,.5,0];
export const STANCE = .64;
const UPPER = .34, LOWER = .33;

// Near terrain is rendered as two indexed triangles per grid cell, whereas
// terrain.heightAt uses bilinear interpolation. Use the actual indices for feet.
// Geometry/field share world x/z coordinates, as in terrain.gridGeometry.
export function createGridGround(geometry,field,fallback) {
  const p=geometry.attributes.position,index=geometry.index,{x0,z0,step,w,h}=field;
  return (x,z)=>{
    const fx=(x-x0)/step,fz=(z-z0)/step;
    if(fx<0||fz<0||fx>w-1||fz>h-1)return fallback(x,z);
    const i=Math.min(w-2,Math.floor(fx)),j=Math.min(h-2,Math.floor(fz)),start=(j*(w-1)+i)*6;
    for(let k=0;k<6;k+=3){
      const a=index.getX(start+k),b=index.getX(start+k+1),c=index.getX(start+k+2);
      const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c);
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if(Math.abs(den)<1e-12)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
      if(u>=-1e-9&&v>=-1e-9&&u+v<=1+1e-9)return u*p.getY(a)+v*p.getY(b)+(1-u-v)*p.getY(c);
    }
    return fallback(x,z);
  };
}

// The riding surface is raised above terrain and linearly interpolated by the
// GPU. Cache its triangles in a small x/z grid instead of raycasting each hoof
// every frame. This sampler is for the fixed facility mesh, not moving meshes.
export function createTrackGround(mesh,heightAt) {
  mesh.updateWorldMatrix(true,false);
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  const buckets=new Map(),cell=2,v=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3){
    const points=[];for(let j=0;j<3;j++){v.fromBufferAttribute(p,index.getX(i+j)).applyMatrix4(mesh.matrixWorld);points.push([v.x,v.y,v.z]);}
    const [a,b,c]=points,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(den)<1e-12)continue;
    const tri={a,b,c,den};
    for(let x=Math.floor(Math.min(a[0],b[0],c[0])/cell);x<=Math.floor(Math.max(a[0],b[0],c[0])/cell);x++)
      for(let z=Math.floor(Math.min(a[2],b[2],c[2])/cell);z<=Math.floor(Math.max(a[2],b[2],c[2])/cell);z++){
        const key=`${x},${z}`;let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push(tri);
      }
  }
  return (x,z)=>{
    const base=heightAt(x,z),list=buckets.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`);
    if(list)for(const {a,b,c,den}of list){
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const w=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
      if(u>=-1e-9&&w>=-1e-9&&u+w<=1+1e-9)return Math.max(base,u*a[1]+w*b[1]+(1-u-w)*c[1]);
    }
    return base;
  };
}

export function circlePose(t, index, { x, z, radius, count, loop }) {
  const angle = (index + t / loop) * TAU / count;
  return { x:x+Math.cos(angle)*radius, z:z+Math.sin(angle)*radius, yaw:Math.atan2(Math.sin(angle),-Math.cos(angle)), angle };
}
function hoofAnchor(t,index,leg,route,heightAt) {
  const p=circlePose(t,index,route),[x,,z]=PONY_HIPS[leg];
  const wx=p.x+Math.cos(p.yaw)*x+Math.sin(p.yaw)*z;
  const wz=p.z-Math.sin(p.yaw)*x+Math.cos(p.yaw)*z;
  return [wx,heightAt(wx,wz),wz];
}
export function sampleWalk(t,index,route,heightAt) {
  const pose=circlePose(t,index,route),period=route.loop/8;
  const feet=PONY_HIPS.map((_,leg)=>{
    const stride=t/period-WALK_OFFSETS[leg],cycle=Math.floor(stride),phase=mod(stride,1);
    const contact=(cycle+WALK_OFFSETS[leg]+STANCE/2)*period;
    const from=hoofAnchor(contact,index,leg,route,heightAt);
    if(phase<STANCE)return {world:from,phase,planted:true};
    const to=hoofAnchor(contact+period,index,leg,route,heightAt);
    const u=(phase-STANCE)/(1-STANCE),s=u*u*(3-2*u);
    const x=from[0]+(to[0]-from[0])*s,z=from[2]+(to[2]-from[2])*s;
    // Terrain is sampled throughout swing, so a hump between contacts is cleared.
    const y=Math.max(from[1]+(to[1]-from[1])*s,heightAt(x,z))+.105*Math.sin(Math.PI*u)**2;
    return {world:[x,y,z],phase,planted:false};
  });
  return { ...pose, y:heightAt(pose.x,pose.z), feet };
}

// Analytic two-link solution, also exported for regression tests.
export function solvePonyLeg(hip,foot,bend=1) {
  const d=new THREE.Vector3().fromArray(foot).sub(new THREE.Vector3().fromArray(hip));
  const actual=d.length(),distance=THREE.MathUtils.clamp(actual,.025,UPPER+LOWER-.00001);
  if(actual<1e-8)d.set(0,-1,0);else d.divideScalar(actual);
  const along=(UPPER*UPPER-LOWER*LOWER+distance*distance)/(2*distance);
  const side=new THREE.Vector3(0,0,bend).addScaledVector(d,-bend*d.z);
  if(side.lengthSq()<1e-8)side.set(1,0,0);side.normalize();
  const joint=new THREE.Vector3().fromArray(hip).addScaledVector(d,along).addScaledVector(side,Math.sqrt(Math.max(0,UPPER*UPPER-along*along)));
  const end=new THREE.Vector3().fromArray(hip).addScaledVector(d,distance);
  return {joint:joint.toArray(),foot:end.toArray(),clamped:Math.abs(distance-actual)>1e-6};
}

// Static parts with one material are merged once per coat; rigs share the result.
function merge(parts) {
  const positions=[],normals=[],indices=[];let offset=0;
  for(const g of parts){positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);indices.push(...Array.from(g.index.array,i=>i+offset));offset+=g.attributes.position.count;g.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);g.computeBoundingSphere();return g;
}
const kits=new WeakMap();
function ponyKit(toon,color,mane,saddle,patch) {
  let cache=kits.get(toon);if(!cache){cache=new Map();kits.set(toon,cache);}
  const key=JSON.stringify([color,mane,saddle,patch]);if(cache.has(key))return cache.get(key);
  const ell=(x,y,z,sx,sy,sz)=>new THREE.SphereGeometry(1,8,6).scale(sx,sy,sz).translate(x,y,z);
  const box=(x,y,z,sx,sy,sz)=>new THREE.BoxGeometry(sx,sy,sz).translate(x,y,z);
  const coat=toon({color}),dark=toon({color:mane}),hoof=toon({color:'#443b36'}),tack=toon({color:'#654636'});
  const kit={coat,dark,hoof,tack,legMat:toon({color:'#ffffff'}),unitBox:new THREE.BoxGeometry(1,1,1),
    body:merge([ell(0,.81,0,.26,.255,.62),ell(0,.84,-.39,.245,.27,.27),ell(0,.81,.40,.26,.25,.28)]),
    neck:merge([ell(0,.18,-.06,.155,.33,.20)]),
    head:merge([ell(0,.44,-.18,.155,.17,.24),box(0,.37,-.38,.20,.16,.22),box(-.10,.64,-.12,.075,.20,.085),box(.10,.64,-.12,.075,.20,.085)]),
    eyes:merge([box(-.149,.47,-.24,.022,.035,.04),box(.149,.47,-.24,.022,.035,.04)]),
    maneGeo:box(0,.21,.10,.12,.44,.09),tailGeo:box(0,-.20,0,.10,.40,.11),
    saddle: saddle?box(0,1.05,0,.48,.075,.40):null,saddleMat:saddle?toon({color:saddle}):null,
    patchGeo:patch?merge([new THREE.SphereGeometry(1,8,4,.10,.55,Math.PI/2-.42,.84).scale(.262,.257,.622).translate(0,.81,0),new THREE.SphereGeometry(1,8,4,Math.PI-.10,.65,Math.PI/2-.38,.76).scale(.262,.257,.622).translate(0,.81,0)]):null,patchMat:patch?toon({color:patch}):null,
    halter:merge([box(0,.38,-.45,.215,.055,.035),box(0,.50,-.14,.30,.035,.035)])};
  cache.set(key,kit);return kit;
}

export function createPony(toon,{color='#8a5a3a',mane='#3a2a20',saddle=null,patch=null,len=1.35,h=1.05}={}) {
  const kit=ponyKit(toon,color,mane,saddle,patch),group=new THREE.Group(),neck=new THREE.Group();
  group.scale.set(len/1.35,h/1.05,len/1.35);
  const mesh=(geo,mat,parent=group)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  mesh(kit.body,kit.coat);if(kit.patchGeo)mesh(kit.patchGeo,kit.patchMat);
  neck.position.set(0,.95,-.43);neck.rotation.x=-.30;group.add(neck);
  mesh(kit.neck,kit.coat,neck);mesh(kit.head,kit.coat,neck);mesh(kit.eyes,kit.hoof,neck);mesh(kit.maneGeo,kit.dark,neck);mesh(kit.halter,kit.tack,neck);
  const leadPoint=new THREE.Object3D();leadPoint.position.set(-.11,.36,-.47);neck.add(leadPoint);
  const tail=mesh(kit.tailGeo,kit.dark);tail.position.set(0,.94,.61);tail.rotation.x=.28;
  if(kit.saddle)mesh(kit.saddle,kit.saddleMat);
  // 12 leg pieces share one draw call per pony, including shadow/normal passes.
  const legInstances=new THREE.InstancedMesh(kit.unitBox,kit.legMat,12);
  legInstances.castShadow=legInstances.receiveShadow=true;
  // Fixed conservative local bounds cover every reachable foot pose without
  // recomputing 12 instance bounds each frame or disabling frustum culling.
  legInstances.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.4,0),1.5);
  legInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(legInstances);
  const legs=PONY_HIPS.map((_,i)=>{
    const pieces={};for(const [j,key] of ['upper','lower','hoof'].entries()){
      const part=new THREE.Object3D();group.add(part);pieces[key]=part;
      legInstances.setColorAt(i*3+j,j===2?kit.hoof.color:kit.coat.color);
    }return pieces;
  });
  const up=new THREE.Vector3(0,1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),dir=new THREE.Vector3();
  let idleFeetValid=false,lastIdleGround=null;
  const lastIdleMatrix=new THREE.Matrix4();
  function beam(m,from,to,width){a.fromArray(from);b.fromArray(to);dir.subVectors(b,a);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(up,dir.clone().normalize());m.scale.set(width,dir.length(),width);}
  function setFeet(feet){
    idleFeetValid=false;
    // Caller may move the root independently; invert only once per pose.
    group.updateWorldMatrix(true,false);const inverse=group.matrixWorld.clone().invert();
    const clamped=feet.map((f,i)=>{
      const local=new THREE.Vector3().fromArray(f.world).applyMatrix4(inverse);local.y+=.07; // joint ends at hoof top
      const solved=solvePonyLeg(PONY_HIPS[i],local.toArray(),i<2?-1:1),leg=legs[i];
      beam(leg.upper,PONY_HIPS[i],solved.joint,.085);beam(leg.lower,solved.joint,solved.foot,.065);
      leg.hoof.position.fromArray(solved.foot);leg.hoof.position.y-=.035;leg.hoof.scale.set(.11,.07,.15);
      leg.hoof.quaternion.identity();
      for(const [j,key] of ['upper','lower','hoof'].entries()){leg[key].updateMatrix();legInstances.setMatrixAt(i*3+j,leg[key].matrix);}
      return solved.clamped;
    });
    legInstances.instanceMatrix.needsUpdate=true;
    return clamped;
  }
  function idle(t,{heightAt,grazing=false,phase=0,loop=6}={}){
    const p=t*TAU/loop+phase;
    neck.position.y=grazing?.69:.95;
    neck.rotation.x=grazing?-1.90+Math.sin(p)*.035:-.30+Math.sin(p)*.025;
    tail.rotation.z=Math.sin(p*2)*.13;
    group.updateWorldMatrix(true,false);
    // Idle neck/tail motion does not change planted feet on this static ground.
    // Recompute after walking, root/parent transforms, or explicit invalidation.
    if(!idleFeetValid||lastIdleGround!==heightAt||!lastIdleMatrix.equals(group.matrixWorld)){
      const feet=PONY_HIPS.map(([x,,z])=>{const v=new THREE.Vector3(x,0,z).applyMatrix4(group.matrixWorld);return {world:[v.x,heightAt(v.x,v.z),v.z]};});setFeet(feet);
      lastIdleMatrix.copy(group.matrixWorld);lastIdleGround=heightAt;idleFeetValid=true;
    }
  }
  return {group,neck,tail,legs,legInstances,leadPoint,setFeet,idle,invalidateFeet:()=>{idleFeetValid=false;},saddleY:1.10};
}
