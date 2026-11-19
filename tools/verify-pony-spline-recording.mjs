// Validate recorded Spline tool responses against the independent GLB readback.
// This does not make new live calls or turn failed image gates into a pass.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const dir='docs/pony-validation/leg-revision/spline/';
const manifest=JSON.parse(fs.readFileSync(dir+'manifest.json','utf8'));
const text=fs.readFileSync(dir+'geometry-live-20261029.txt','utf8');
const records=text.split('\n').filter(x=>x.startsWith('getGeometry')).map(x=>JSON.parse(x.split(' → ')[1]));
const buffer=fs.readFileSync(dir+'nagisa-pony.glb');
const model=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
model.scene.updateMatrixWorld(true);
let maxBoundsError=0;
for(const r of records){const mesh=model.scene.getObjectByName(r.name.replaceAll(' ','_'));assert.ok(mesh,r.name);assert.equal(mesh.geometry.attributes.position.count,r.vertexCount);assert.equal(mesh.geometry.index.count/3,r.triangleCount);const box=new T.Box3(),v=new T.Vector3();for(let i=0;i<mesh.geometry.attributes.position.count;i++)box.expandByPoint(v.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld));for(const edge of ['min','max'])for(let a=0;a<3;a++)maxBoundsError=Math.max(maxBoundsError,Math.abs(box[edge].getComponent(a)*100-r.bounds[edge][a]));}
assert.equal(records.length,17);assert.ok(maxBoundsError<.0011);
function parseScene(file){const nodes=new Map(),stack=[];for(const line of fs.readFileSync(file,'utf8').split('\n')){const m=/^( *)(.+?) \[([^\]]+)\] ([a-f0-9-]{36}) p=([^ ]+)/.exec(line);if(!m)continue;const depth=m[1].length/2,read=key=>{const match=new RegExp(' '+key+'=([^ ]+)').exec(line);return match?match[1].split(',').map(Number):[key==='s'?1:0,key==='s'?1:0,key==='s'?1:0];};const n={name:m[2],type:m[3],id:m[4],p:m[5].split(',').map(Number),r:read('r'),s:read('s'),parent:depth?stack[depth-1]:null};nodes.set(n.name,n);stack[depth]=n.name;}return nodes;}
const before=parseScene(dir+'scene-before-20261029.txt'),after=parseScene(dir+'scene-after-20261029.txt');
for(const n of manifest.nodes){const live=after.get(n.name);assert.ok(live,n.name);assert.equal(live.parent,n.parent);n.p.forEach((v,a)=>assert.ok(Math.abs(v*100-live.p[a])<.006));(n.r||[0,0,0]).forEach((v,a)=>assert.ok(Math.abs(v-live.r[a])<.006));}
const preserved=[];for(const [name,n]of before){if(/^Pony (LF|RF|LH|RH) /.test(name))continue;const live=after.get(name);assert.deepEqual(live,n,name);preserved.push(n.id);}
const materials=fs.readFileSync(dir+'materials-before-20261029.txt','utf8').split('\n').filter(x=>x.startsWith('getMaterial')).map(x=>JSON.parse(x.split(' → ')[1]));
for(const [key,color]of Object.entries(manifest.palette)){const material=materials.find(m=>m.name==='Nagisa '+key);assert.ok(material.layers.filter(l=>l.type==='color'||l.type==='light').every(l=>l.color===color));}
const result={recorded:'2026-10-29 09:02–09:16 JST',file:manifest.file,sourceSha256:manifest.sha256,geometry:{meshes:records.length,vertexAndTriangleCountsMatch:true,maxBoundsErrorEditorUnits:maxBoundsError,toleranceEditorUnits:.0011,unitsPerMetre:100,hoofBottomY:records.filter(r=>r.name.endsWith('Hoof')).map(r=>r.bounds.min[1])},hierarchy:{pivotsVerified:manifest.nodes.length,localPositionsAndAnglesMatch:true,rootScale:after.get('Nagisa Pony').s,preservedObjectIds:preserved},materials:{sharedPaletteMatch:true,definitionsReadBeforeReplacement:true,afterAssetUsage:{coat:7,mane:2,hoof:5,tack:2,saddle:1},note:'Same shared asset ids were reapplied; no material asset mutations were made.'},camera:{addedAfterSceneDigest:true,id:'068175f6-e005-4f08-9513-c63403b64b3d',name:'Pony Review Camera',position:[-300,180,-400],rotationXYZDegrees:[-165.85875522107057,-37.07497085912348,-171.3633980605891],latestReportedObjectCount:41},review:{threeQuarter:'Visible; provisional only',side:'Black image; NOT reviewed',front:'Background only; NOT reviewed',back:'NOT captured',live:{exposure:'FAILED: washed out',framing:'PASS',hero:'PASS'},requiredNext:['Reduce preview exposure and recheck live gates','Capture and review side/front/back plus three-quarter from the actual Spline model','Read final scene/camera and confirm saved version']},limit:{fixApplied:false,nextReset:'2026-10-30 00:00 UTC / 2026-10-30 09:00 JST',evidence:'exposure-limit-20261029.txt'},complete:false};
assert.ok(result.geometry.hoofBottomY.every(y=>Math.abs(y)<1e-6));
fs.writeFileSync(dir+'live-validation-20261029.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
