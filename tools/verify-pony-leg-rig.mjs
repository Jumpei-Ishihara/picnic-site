// Independent readback and reproducible old/new posture metrics; no Spline calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PONY_RIG,ponyLegPart,ponyPartMesh} from '../realsite/pony-model.js';
import {createPony,sampleWalk} from '../realsite/pony.js';
import {solvePonyLeg as oldSolve,PONY_HIPS as oldHips} from '../docs/pony-validation/leg-revision/before/pony.js';
const dir=process.env.PONY_REVIEW_ROOT||'docs/pony-validation/voxel-pony';
const original=oldSolve(oldHips[0],[-.18,.07,-.45],-1);
const originalOffset=Math.abs(original.joint[2]+.45);
assert.ok(Math.abs(originalOffset-.211207236314473)<1e-9);
const p=createPony(o=>new T.MeshBasicMaterial(o));p.idle(0,{heightAt:()=>0});
const standing=p.legs.map((l,i)=>({leg:['LF','RF','LH','RH'][i],points:l.points,distalAngleFromVerticalDegrees:Math.atan2(Math.abs(l.points[2][2]-l.points[3][2]),l.points[2][1]-l.points[3][1])*180/Math.PI}));
let maxSoleTargetError=0,clamped=0,minLegY=Infinity,plantedPitchMax=0,swingPitchMax=0,samples=0;
const route={x:0,z:0,radius:4.3,count:3,loop:6},foot=new T.Vector3();
for(let frame=0;frame<720;frame++){
 const m=sampleWalk(frame/120,0,route,()=>0);p.group.position.set(m.x,m.y,m.z);p.group.rotation.y=m.yaw;clamped+=p.setFeet(m.feet).filter(Boolean).length;p.group.updateMatrixWorld(true);
 p.legs.forEach((l,i)=>{foot.set(0,-.5,0).applyMatrix4(l.hoof.matrixWorld);maxSoleTargetError=Math.max(maxSoleTargetError,foot.distanceTo(new T.Vector3().fromArray(m.feet[i].world)));const pitch=Math.abs(l.hoof.rotation.x);if(m.feet[i].planted)plantedPitchMax=Math.max(plantedPitchMax,pitch);else swingPitchMax=Math.max(swingPitchMax,pitch);const g=ponyPartMesh(ponyLegPart(l.points,i));for(let v=1;v<g.vertices.length;v+=3)minLegY=Math.min(minLegY,g.vertices[v]);samples++;});
}
assert.equal(clamped,0);assert.ok(maxSoleTargetError<1e-7);assert.equal(plantedPitchMax,0);assert.ok(swingPitchMax>.2&&swingPitchMax<=.301);assert.ok(minLegY>0);
const buffer=fs.readFileSync(dir+'/spline/nagisa-pony.glb');
const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
gltf.scene.updateMatrixWorld(true);
const manifest=JSON.parse(fs.readFileSync(dir+'/spline/manifest.json','utf8'));
let readbackMeshes=0;const points=[];
gltf.scene.traverse(o=>{if(!o.isMesh)return;readbackMeshes++;const signature=manifest.meshes.find(x=>x.name.replaceAll(' ','_')===o.name);assert.ok(signature,o.name);assert.equal(o.geometry.attributes.position.count,signature.vertices);assert.equal(o.geometry.index.count/3,signature.triangles);for(let i=0;i<o.geometry.attributes.position.count;i++){const v=new T.Vector3().fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld);assert.ok(v.toArray().every(Number.isFinite));points.push(v);}});
assert.equal(readbackMeshes,17);const bounds=new T.Box3().setFromPoints(points);
const result={date:new Date().toISOString(),before:{upper:.34,lower:.33,verticalDistance:.52,jointOffsetMetres:originalOffset,joint:original.joint},after:{standing,periodSeconds:route.loop/PONY_RIG.stridesPerLoop,stridesPer6Seconds:PONY_RIG.stridesPerLoop,samples,clamped,maxSoleTargetErrorMetres:maxSoleTargetError,minContinuousLegVertexY:minLegY,plantedPitchMaxRadians:plantedPitchMax,swingPitchMaxRadians:swingPitchMax},glb:{readbackMeshes,pivots:manifest.nodes.length,bytes:buffer.length,boundsMetres:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new T.Vector3()).toArray()}},scope:'Local rig and GLB only. No live Spline read; see the active review folder RESUME.md.'};
fs.writeFileSync(dir+'/rig-validation.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
