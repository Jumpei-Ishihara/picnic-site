// Generate bounded Spline DSL batches from the SAME geometry used by the site.
// Run from the repository root, then execute batches in numeric order in the open file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PONY_MODEL, PONY_PALETTE, PONY_RIG, ponyPartMesh, ponyLegPart} from '../realsite/pony-model.js';
import {createPony} from '../realsite/pony.js';

const out=path.resolve(process.env.PONY_SPLINE_OUT||'docs/pony-validation/voxel-pony/spline');
fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('scenes/nagisa/scene.json','utf8'));
const [coat,mane]=data.facilities.ponyRide.coat;
const palette={coat,mane,...PONY_PALETTE};
const unit=100; // Build at editor-friendly units, keep root scale 1; convert by .01 when exporting to metres.
const batches=[];
const write=(label,code)=>{const file=String(batches.length).padStart(2,'0')+'-'+label+'.js';fs.writeFileSync(path.join(out,file),code+'\n');batches.push(file);};
const vector=a=>({x:a[0],y:a[1],z:a[2]});
const vec=a=>JSON.stringify(vector(a));
const degrees=q=>new THREE.Euler().setFromQuaternion(q).toArray().slice(0,3).map(x=>x*180/Math.PI);
const nodes=[
  {name:'Pony Neck Pivot',parent:'Nagisa Pony',p:PONY_RIG.neck,r:[PONY_RIG.neckAngle*180/Math.PI,0,0]},
  {name:'Pony Tail Pivot',parent:'Nagisa Pony',p:PONY_RIG.tail,r:[.28*180/Math.PI,0,0]},
  {name:'Pony Lead Point',parent:'Pony Neck Pivot',p:PONY_RIG.lead},
  {name:'Pony Seat Anchor',parent:'Nagisa Pony',p:[0,PONY_RIG.saddleY,0]}
];
const meshes=[
  ['Body','body','coat','Nagisa Pony'],['Neck','neck','coat','Pony Neck Pivot'],
  ['Head','head','coat','Pony Neck Pivot'],['Eyes','eyes','hoof','Pony Neck Pivot'],
  ['Mane','mane','mane','Pony Neck Pivot'],['Tail','tail','mane','Pony Tail Pivot'],
  ['Halter','halter','tack','Pony Neck Pivot'],['Saddle Blanket','saddle','saddle','Nagisa Pony'],
  ['Saddle Seat','seat','tack','Nagisa Pony']
].map(([name,key,mat,parent])=>({name:'Pony '+name,parts:PONY_MODEL[key],mat,parent}));

// Bind pose uses the actual site's IK solution, including bent knees and grounded hooves.
const pony=createPony(p=>new THREE.MeshToonMaterial(p),{color:coat,mane,saddle:palette.saddle});
pony.idle(0,{heightAt:()=>0});
for(let i=0;i<4;i++){
  const name=['LF','RF','LH','RH'][i],rig=i<2?PONY_RIG.fore:PONY_RIG.hind;
  const proximal=pony.legs[i].proximal.quaternion,upper=pony.legs[i].upper.quaternion,lower=pony.legs[i].lower.quaternion;
  nodes.push(
    {name:'Pony '+name+' Shoulder',parent:'Nagisa Pony',p:PONY_RIG.hips[i],r:degrees(proximal)},
    {name:'Pony '+name+' Elbow',parent:'Pony '+name+' Shoulder',p:[0,rig.proximal,0],r:degrees(proximal.clone().invert().multiply(upper))},
    {name:'Pony '+name+' Joint',parent:'Pony '+name+' Elbow',p:[0,rig.upper,0],r:degrees(upper.clone().invert().multiply(lower))},
    {name:'Pony '+name+' Foot',parent:'Pony '+name+' Joint',p:[0,rig.lower,0],r:degrees(lower.clone().invert())}
  );
  meshes.push({name:'Pony '+name+' Leg',parent:'Nagisa Pony',mat:'coat',parts:[ponyLegPart(pony.legs[i].points,i,pony.legs[i].footUp)]});
  meshes.push({name:'Pony '+name+' Hoof',parent:'Pony '+name+' Foot',mat:'hoof',
    parts:[{...PONY_MODEL.limb,p:[0,-PONY_RIG.hoof[1]/2,0],s:PONY_RIG.hoof}]});
}
const preamble=ponyPartMesh.toString()+'\n'+`const units=${unit};\n`;
const emitMeshes=items=>preamble+
  `const items=${JSON.stringify(items)};\n`+
  `for(const item of items){
const vertices=[],indices=[];
for(const part of item.parts){const g=ponyPartMesh(part),n=vertices.length/3;for(const v of g.vertices)vertices.push(v*units);for(const i of g.indices)indices.push(i+n);}
customMesh({vertices,indices});
position({x:0,y:0,z:0});
applyMaterial('Nagisa '+item.mat);
rename(item.name);
visibility({flatShading:true});
shadows(true);
}`;

write('root',`// Fill only after verifying the current root and saving its version.
const verifiedReplacementIds=[];
if(verifiedReplacementIds.length===0){report({blocked:'Read the current scene and fill verifiedReplacementIds first.'});}else{
select(o=>verifiedReplacementIds.includes(o.id));
remove();
add('Empty');
position({x:0,y:0,z:0});
rename('Nagisa Pony');
`+Object.entries(palette).map(([key,value])=>`createMaterial('Nagisa ${key}',{layers:[{type:'color',color:'${value}'},{type:'light',category:'lambert',color:'${value}',alpha:1}]});`).join('\n')+'\n}');
write('body',emitMeshes(meshes.slice(0,5)));
write('tack-tail',emitMeshes(meshes.slice(5,9)));
write('limbs',emitMeshes(meshes.slice(9)));
write('pivots',nodes.map(n=>`add('Empty');\nposition({x:0,y:0,z:0});\nrename('${n.name}');`).join('\n'));
write('hierarchy',[
  ...meshes.map(m=>`select('${m.name}');\nmoveInto('${m.parent}');`),
  ...nodes.map(n=>`select('${n.name}');\nmoveInto('${n.parent}');`)
].join('\n'));
// Explicit XYZ lookAt pose matched to the 2026-10-31 approved live framing.
const reviewCameraPosition=[-315,184.85,-419.25];
const reviewCameraRotation=[-165.85875522107057,-37.07497085912348,-171.3633980605891];
const reviewFraming=`unselect();
select(o=>o.name==='Pony Review Camera');
const cameraMatches=get('selection');
if(cameraMatches.length>1){report({blocked:'Resolve duplicate review camera names by verified id first.'});}else{
let reviewCamera=cameraMatches[0];
if(!reviewCamera){reviewCamera=add('PerspectiveCamera');rename('Pony Review Camera');}
position(${vec(reviewCameraPosition)});
rotation(${vec(reviewCameraRotation)});
activateCamera(reviewCamera);
setPlayCamera(reviewCamera);
unselect();
}`;

// All reparenting happens while pivots are identity, then parent/local poses are set.
write('pose',nodes.map(n=>`select('${n.name}');\nposition(${vec(n.p.map(x=>x*unit))});\nrotation(${vec(n.r||[0,0,0])});`).join('\n')+`
select('Nagisa Pony');
scale({x:1,y:1,z:1});
component();
select('Preview Shadow Floor');
geometry({width:600,height:600});
position({x:0,y:-.1,z:0});
visibility({shadowCatcher:false});
color('#897760');
shading({category:'toon'});
select('Directional Light');
position({x:-200,y:400,z:-300});
updateLight({intensity:.75,color:'#fff4de',size:800,shadows:true,shadowRadius:1});
background('#78909c');
environment({ambient:{color:'#dae5ff',intensity:.40},ao:{enabled:true,radius:8,bias:.1},softShadow:'normal'});
${reviewFraming}`);

// Minimal resume batches preserve the existing body, tack, root and lighting.
const legNodes=nodes.filter(n=>/^Pony (LF|RF|LH|RH) /.test(n.name)),legMeshes=meshes.slice(9);
fs.writeFileSync(path.join(out,'resume-00-remove-legs.js'),`// Fresh ids from the verified Nagisa Pony subtree only; empty list is a safe no-op.\nconst verifiedLegObjectIds=[];\nif(verifiedLegObjectIds.length===0){report({blocked:'Verify root descendants and fill verifiedLegObjectIds first.'});}else{\nselect(o=>verifiedLegObjectIds.includes(o.id));\nremove();\nunselect();\n}\n`);
fs.writeFileSync(path.join(out,'resume-01-leg-pivots.js'),legNodes.map(n=>`add('Empty');position({x:0,y:0,z:0});rename('${n.name}');`).join('\n')+'\n');
fs.writeFileSync(path.join(out,'resume-02-leg-hierarchy.js'),[...legMeshes.map(m=>`select('${m.name}');moveInto('${m.parent}');`),...legNodes.map(n=>`select('${n.name}');moveInto('${n.parent}');`)].join('\n')+'\n');
fs.writeFileSync(path.join(out,'resume-03-leg-pose.js'),legNodes.map(n=>`select('${n.name}');position(${vec(n.p.map(x=>x*unit))});rotation(${vec(n.r||[0,0,0])});`).join('\n')+'\n'+reviewFraming+'\n');

// Geometry-only style replacement: preserve the existing root, pivots and camera.
fs.writeFileSync(path.join(out,'voxel-00-remove-verified-meshes.js'),`// Fill ids only from the freshly verified Nagisa Pony subtree. Do not include pivots/root/camera.\nconst verifiedMeshIds=[];\nif(verifiedMeshIds.length!==17){report({blocked:'Verify all 17 model mesh ids first.'});}else{select(o=>verifiedMeshIds.includes(o.id));remove();unselect();}\n`);
fs.writeFileSync(path.join(out,'voxel-01-parent-meshes.js'),meshes.map(m=>`select('${m.name}');moveInto('${m.parent}');position({x:0,y:0,z:0});rotation({x:0,y:0,z:0});`).join('\n')+'\nunselect();\n');
fs.writeFileSync(path.join(out,'voxel-02-lead-point.js'),`select('Pony Lead Point');position(${vec(PONY_RIG.lead.map(x=>x*unit))});unselect();\n`);

// Geometry-space signature is invariant under parenting and pose.
const signature=meshes.map(m=>{
  const all=m.parts.map(ponyPartMesh);
  const vertices=all.flatMap(x=>x.vertices.map(v=>v*unit));
  return {name:m.name,parent:m.parent,vertices:vertices.length/3,triangles:all.reduce((n,g)=>n+g.indices.length/3,0),
    min:[0,1,2].map(a=>Math.min(...vertices.filter((_,i)=>i%3===a))),
    max:[0,1,2].map(a=>Math.max(...vertices.filter((_,i)=>i%3===a)))};
});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({
  file:'a1128a35-c694-4f87-b2c0-0c58af54ec62',source:'realsite/pony-model.js',
  sha256:crypto.createHash('sha256').update(fs.readFileSync('realsite/pony-model.js')).digest('hex'),
  unitsPerMetre:unit,rootScale:1,siteScale:1/unit,forward:'-Z',rig:PONY_RIG,continuousLegs:true,palette,nodes,meshes:signature,batches
},null,2)+'\n');

// A portable, fully parented model is also available when the Spline connector
// is unavailable. This is a static bind pose; site code owns walking/grounding.
const design=new THREE.Group();design.name='Nagisa Pony';
const objects=new Map([['Nagisa Pony',design]]);
for(const n of nodes){const group=new THREE.Group();group.name=n.name;objects.set(n.name,group);}
for(const n of nodes){const group=objects.get(n.name);objects.get(n.parent).add(group);group.position.fromArray(n.p);group.rotation.set(...(n.r||[0,0,0]).map(x=>x*Math.PI/180));}
const materials=Object.fromEntries(Object.entries(palette).map(([key,color])=>[key,new THREE.MeshStandardMaterial({color,roughness:1,metalness:0})]));
let maxPoseError=0;
const sourceNames={'Pony Eyes':'Pony Eyes','Pony Saddle Blanket':'Pony Saddle Blanket','Pony Saddle Seat':'Pony Saddle Seat'};
for(const m of meshes){
  const vertices=[],indices=[];
  for(const part of m.parts){const g=ponyPartMesh(part),offset=vertices.length/3;vertices.push(...g.vertices);indices.push(...g.indices.map(x=>x+offset));}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,materials[m.mat]);mesh.name=m.name;objects.get(m.parent).add(mesh);mesh.updateWorldMatrix(true,false);
  const limb=/^Pony (LF|RF|LH|RH) (Leg|Hoof)$/.exec(m.name);
  let source,sourceGeometry,vertexOffset=0;
  if(limb){const i=['LF','RF','LH','RH'].indexOf(limb[1]);if(limb[2]==='Leg'){source=pony.legMesh;sourceGeometry=source.geometry;vertexOffset=i*sourceGeometry.attributes.position.count/4;}else{source=pony.legs[i].hoof;sourceGeometry=pony.hoofInstances.geometry;}}
  else{source=pony.group.getObjectByName(sourceNames[m.name]||m.name);sourceGeometry=source.geometry;}
  source.updateWorldMatrix(true,false);
  const actual=new THREE.Vector3(),expected=new THREE.Vector3();
  for(let i=0;i<geometry.attributes.position.count;i++){
    actual.fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
    expected.fromBufferAttribute(sourceGeometry.attributes.position,i+vertexOffset).applyMatrix4(source.matrixWorld);
    maxPoseError=Math.max(maxPoseError,actual.distanceTo(expected));
  }
}
assert.ok(maxPoseError<1e-6,`design rig does not match site bind pose: ${maxPoseError}`);
design.userData={source:'realsite/pony-model.js',units:'metres',forward:'-Z'};
const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
// GLTFExporter uses the browser FileReader interface for Blob packing.
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+blob.type+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.();});}
};
const glb=await new GLTFExporter().parseAsync(design,{binary:true,onlyVisible:false});
fs.writeFileSync(path.join(out,'nagisa-pony.glb'),Buffer.from(glb));
fs.writeFileSync(path.join(out,'bind-pose-check.json'),JSON.stringify({maxVertexErrorMetres:maxPoseError,meshes:meshes.length,pivots:nodes.length,glbBytes:glb.byteLength},null,2)+'\n');
console.log(JSON.stringify({out,batches,meshes:meshes.length,pivots:nodes.length,maxPoseError,glbBytes:glb.byteLength}));
