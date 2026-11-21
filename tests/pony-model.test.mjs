import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PONY_MODEL,PONY_RIG,PONY_LEG_VERTEX_COUNT,ponyPartMesh,ponyLegPart,writePonyLegBuffers} from '../realsite/pony-model.js';
import {createPony} from '../realsite/pony.js';

test('shared pony surfaces have outward winding, finite vertices and usable bounds',()=>{
  for(const parts of Object.values(PONY_MODEL))for(const part of Array.isArray(parts)?parts:[parts]){
    const {vertices:v,indices:idx}=ponyPartMesh(part);
    assert.ok(v.every(Number.isFinite),part.name);
    assert.ok(idx.every(i=>Number.isInteger(i)&&i>=0&&i<v.length/3),part.name);
    let volume=0;
    for(let i=0;i<idx.length;i+=3){
      const [a,b,c]=idx.slice(i,i+3).map(j=>new THREE.Vector3().fromArray(v,j*3));
      volume+=a.dot(b.cross(c))/6;
    }
    assert.ok(volume>1e-9,`${part.name}: inward or degenerate surface`);
  }
});

test('site consumes the shared body geometry and shares it across same-coat ponies',()=>{
  const toon=p=>new THREE.MeshToonMaterial(p),a=createPony(toon),b=createPony(toon);
  const body=a.group.getObjectByName('Pony Body'),other=b.group.getObjectByName('Pony Body');
  const expected=PONY_MODEL.body.flatMap(p=>ponyPartMesh(p).vertices);
  assert.deepEqual(Array.from(body.geometry.attributes.position.array),Array.from(new Float32Array(expected)));
  assert.equal(body.geometry,other.geometry);assert.equal(body.material,other.material);
  assert.equal(body.material.isMeshToonMaterial,true);assert.equal(body.material.flatShading,true);
});

test('grazing keeps all face details on the head/neck hierarchy and the saddle anchor on the body',()=>{
  const p=createPony(x=>new THREE.MeshBasicMaterial(x),{saddle:'#b8463f'});
  assert.equal(p.head.parent,p.neck);
  assert.equal(p.group.getObjectByName('Pony Mane').parent,p.neck);
  for(const name of ['Pony Head','Pony Eyes','Pony Forelock','Pony Halter'])assert.equal(p.group.getObjectByName(name).parent,p.head,name);
  const head=p.group.getObjectByName('Pony Head');p.group.updateWorldMatrix(true,true);
  const facePoint=()=>new THREE.Vector3(0,0,-.08).applyMatrix4(head.matrixWorld);
  const before=facePoint();
  const seat=p.group.getObjectByName('Pony Saddle Seat'),seatBefore=seat.getWorldPosition(new THREE.Vector3());
  p.idle(1,{heightAt:()=>0,grazing:true});p.group.updateWorldMatrix(true,true);
  assert.ok(facePoint().distanceTo(before)>.4);
  assert.ok(seat.getWorldPosition(new THREE.Vector3()).distanceTo(seatBefore)<1e-9);
  assert.equal(p.leadPoint.parent,p.head);
  const expectedLead=PONY_RIG.lead.map((v,i)=>v-PONY_RIG.poll[i]);
  p.leadPoint.position.toArray().forEach((v,i)=>assert.ok(Math.abs(v-expectedLead[i])<1e-9));
  assert.equal(p.hoofInstances.count,4);
  assert.equal(p.legMesh.geometry.attributes.position.count,224);
  p.idle(0,{heightAt:()=>0});p.group.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(p.group.getObjectByName('Pony Body'));
  assert.ok(box.max.y<1.12&&box.min.y>.49,'body dimensions in metres');
});

test('standing fore support is nearly straight and hind stifle and hock have distinct contours',()=>{
  const p=createPony(x=>new THREE.MeshBasicMaterial(x));p.idle(0,{heightAt:()=>0});
  const front=p.legs[0].points,hind=p.legs[2].points;
  assert.ok(Math.abs(front[2][2]-front[3][2])<.06,'carpus must not jut 21cm in front of the hoof');
  assert.ok(front[2][1]>.28&&front[2][1]<.35);
  assert.ok(hind[1][2]<hind[0][2]-.10,'stifle forward under the thigh');
  assert.ok(hind[2][2]>hind[3][2]+.01&&hind[2][2]<hind[3][2]+.05,'hock slightly behind cannon with nearly vertical standing lower leg');
});

test('continuous flexed leg has shared joint rings and a closed manifold surface',()=>{
  const p=createPony(x=>new THREE.MeshBasicMaterial(x));p.idle(0,{heightAt:()=>0});
  // Four square rings per leg. Weld coincident hard-normal vertices to inspect surface closure.
  const geometry=p.legMesh.geometry,positions=geometry.attributes.position,welded=new Map(),canonical=[];
  for(let i=0;i<positions.count;i++){const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(v=>v.toFixed(6)).join(',');if(!welded.has(key))welded.set(key,welded.size);canonical.push(welded.get(key));}
  const index=Array.from(geometry.index.array,i=>canonical[i]),edges=new Map();
  for(let i=0;i<index.length;i+=3)for(const [a,b]of [[index[i],index[i+1]],[index[i+1],index[i+2]],[index[i+2],index[i]]]){const key=[Math.min(a,b),Math.max(a,b)].join(',');edges.set(key,(edges.get(key)||0)+1);}
  assert.ok([...edges.values()].every(n=>n===2),'every surface edge belongs to exactly two triangles');
  assert.ok([...p.legMesh.geometry.attributes.position.array].every(Number.isFinite));
});

test('zero-allocation leg buffer writer matches ponyPartMesh vertices and writes unit outward normals',()=>{
  const p=createPony(x=>new THREE.MeshBasicMaterial(x));p.idle(0,{heightAt:()=>0});
  const outPos=new Float32Array(PONY_LEG_VERTEX_COUNT*3),outNorm=new Float32Array(PONY_LEG_VERTEX_COUNT*3);
  for(let leg=0;leg<4;leg++){
    const footUp=[.1,.99,.1];
    writePonyLegBuffers(outPos,outNorm,0,p.legs[leg].points,leg,footUp);
    const ref=ponyPartMesh(ponyLegPart(p.legs[leg].points,leg,footUp));
    assert.equal(ref.vertices.length,outPos.length);
    for(let i=0;i<ref.vertices.length;i++)assert.ok(Math.abs(outPos[i]-ref.vertices[i])<1e-6,`leg ${leg} v[${i}]`);
    for(let i=0;i<outNorm.length;i+=3){
      const len=Math.hypot(outNorm[i],outNorm[i+1],outNorm[i+2]);
      assert.ok(Math.abs(len-1)<1e-5,`leg ${leg} normal length ${len}`);
    }
  }
  // Degenerate zero-length segment must still produce finite coordinates and normals.
  writePonyLegBuffers(outPos,outNorm,0,[[0,.5,0],[0,.5,0],[0,.2,0],[0,0,0]],0,[0,1,0]);
  assert.ok([...outPos,...outNorm].every(Number.isFinite));
});
