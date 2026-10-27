// Reproducible local browser evidence. Run baseline before editing, then after.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const puppeteer=require('puppeteer');
const base=process.env.PONY_BASE||'http://127.0.0.1:8790/';
const published=new URL(base).protocol==='https:';
const variant=process.env.PONY_VARIANT||'after';
assert.ok(['before','after'].includes(variant));
const out=path.resolve(__dirname,'..',process.env.PONY_OUT||'docs/pony-validation');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:1280,height:720});
  await page.setCacheEnabled(false);
  const proof=published?require('./pages-proof.cjs').createPagesProof(page,{base,release:process.env.RELEASE_SHA}):null;
  const errors=[],shaderErrors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error'){console.error(m.text());if(/shader|GLSL|WebGLProgram|VALIDATE_STATUS/i.test(m.text()))shaderErrors.push(m.text());}});page.on('requestfailed',r=>console.error('Failed',r.url(),r.failure()));
  const baseline={};if(variant==='before')for(const file of ['nagisa.html','realsite/nagisa-facilities.js','scenes/nagisa/scene.json'])baseline['/'+file]=cp.execFileSync('/usr/bin/git',['show','26cb304:'+file],{encoding:'utf8'});
  if(!published){await page.setRequestInterception(true);page.on('request',r=>{
   if(r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js')return r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.THREE_LOCAL||'/private/tmp/picnic-three-r160.js','utf8')});
   const u=new URL(r.url());if(u.origin==='http://127.0.0.1:8790'&&baseline[u.pathname])return r.respond({status:200,contentType:u.pathname.endsWith('.html')?'text/html':u.pathname.endsWith('.json')?'application/json':'application/javascript',body:baseline[u.pathname]});
   return r.continue();
  });}
  await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>0;});
  await page.goto(`${base}nagisa.html?release=${process.env.RELEASE_SHA||'local'}#debug`,{waitUntil:'networkidle0',timeout:120000});
  await page.waitForFunction(()=>!!window.__nagisa,{polling:100});
  const report={variant,base,release:process.env.RELEASE_SHA||null,date:new Date().toISOString(),browser:await browser.version(),cases:[]};
  await page.evaluate(()=>{const a=window.__nagisa;a.begin('lunch');a.tod.auto=false;a.setView('pony');a.controls.settle();a.setHour(14);a.pixel.setFixedSize({width:320,height:180});for(let i=0;i<15;i++)a.step(0);for(const el of document.body.children)if(!['CANVAS','SCRIPT'].includes(el.tagName))el.style.visibility='hidden';});
  for(const view of ['pony','close','sunset']){
   const result=await page.evaluate(view=>{
    const a=window.__nagisa;if(view==='pony')a.setView('pony');
    if(view==='close'){a.player.x=-148.5;a.player.z=-42;a.player.yaw=0;a.player.pitch=.08;}
    if(view==='sunset')a.setView('sunset');
    a.controls.settle();for(let i=0;i<10;i++)a.step(0);
    const gl=a.pixel.renderer.getContext();const read=()=>{const p=new Uint8Array(320*180*4);gl.readPixels(0,0,320,180,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
    const diff=(x,y)=>{let changed=0,sum=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d)changed++;sum+=d;}return {changed,mean:sum/x.length};};
    const at=t=>{a.setElapsed(t);a.step(0);return read();};
    const start=at(0),endpoint=diff(start,at(6)),endpoint12=diff(start,at(12)),mid=diff(start,at(.375)),seam=diff(at(6-1/60),at(0)),ordinary=diff(at(3-1/60),at(3));
    // Model alone at t+6 must preserve the same spatial appearance, not just modulo input.
    const modelAt=t=>{a.ride.update(t,true);a.pixel.prepareShadows();a.water.renderReflection(a.pixel.size.width,a.pixel.size.height);a.pixel.render();return read();};
    const model0=modelAt(0),modelEndpoint=diff(model0,modelAt(6)),modelEndpoint12=diff(model0,modelAt(12));
    a.setElapsed(0);a.step(0);const r=a.pixel.renderer;r.info.autoReset=false;r.info.reset();a.step(0);const render={...r.info.render};r.info.autoReset=true;
    const times=[];for(let i=0;i<90;i++){const t=performance.now();a.setElapsed(i/60);a.step(0);gl.finish();times.push(performance.now()-t);}times.sort((x,y)=>x-y);
    return {view,hour:a.tod.hour,camera:a.camera.position.toArray(),endpoint,endpoint12,mid,seam,ordinary,modelEndpoint,modelEndpoint12,render,frameMs:{median:times[45],p95:times[85]},glError:gl.getError()};
   },view);
   report.cases.push(result);
   await page.evaluate(()=>{const a=window.__nagisa;a.setElapsed(0);a.step(0);});
   await page.screenshot({path:path.join(out,`${variant}-${view}.png`)});
   if(variant==='after'){assert.equal(result.endpoint.changed,0);assert.equal(result.endpoint12.changed,0);assert.equal(result.glError,0);if(view!=='sunset'){assert.equal(result.modelEndpoint.changed,0,'individual permutation seam');assert.equal(result.modelEndpoint12.changed,0,'12s individual permutation seam');}}
  }
  if(variant==='after'){
   report.contact=await page.evaluate(async()=>{
    const a=window.__nagisa,{sampleWalk}=await import('./realsite/pony.js');let maxError=0,clamped=0,minWaitingDistance=Infinity,minYardClearance=Infinity,maxSurfaceError=0,supportSamples=0,oldTerrainOnlyPenetration=0;
    const ray=new a.THREE.Raycaster(),down=new a.THREE.Vector3(0,-1,0);
    const yard=a.data.facilities.ponyLand.yard;
    for(let frame=0;frame<360;frame++){
     const t=frame/60;a.ride.update(t,true);
     a.ride.units.forEach((u,i)=>{
      const m=sampleWalk(t,i,a.ride.route,a.ride.groundAt);clamped+=u.clamped.filter(Boolean).length;
      u.pony.group.updateWorldMatrix(true,true);
      u.pony.legs.forEach((l,k)=>{
       const f=new a.THREE.Vector3(0,-.5,0).applyMatrix4(l.hoof.matrixWorld);maxError=Math.max(maxError,f.distanceTo(new a.THREE.Vector3().fromArray(m.feet[k].world)));
       if(m.feet[k].planted){ray.set(new a.THREE.Vector3(f.x,10,f.z),down);const hit=ray.intersectObject(a.ride.trackMesh)[0];if(!hit)throw Error('No rendered support under planted hoof');maxSurfaceError=Math.max(maxSurfaceError,Math.abs(hit.point.y-f.y));oldTerrainOnlyPenetration=Math.max(oldTerrainOnlyPenetration,hit.point.y-a.terrain.heightAt(f.x,f.z));supportSamples++;}
      });
      for(const [x,z]of a.data.facilities.ponyLand.waiting)minWaitingDistance=Math.min(minWaitingDistance,Math.hypot(m.x-x,m.z-z));
      minYardClearance=Math.min(minYardClearance,m.x-yard[0],yard[2]-m.x,m.z-yard[1],yard[3]-m.z);
     });
    }
    let idleSamples=0,maxIdleSurfaceError=0;
    for(const g of a.ponyLand.grazers){g.p.idle(0,{heightAt:(x,z)=>Math.max(a.ring.groundAt(x,z),a.ride.groundAt(x,z)),grazing:!g.idle});g.p.group.updateWorldMatrix(true,true);for(const leg of g.p.legs){const f=new a.THREE.Vector3(0,-.5,0).applyMatrix4(leg.hoof.matrixWorld);ray.set(new a.THREE.Vector3(f.x,10,f.z),down);const hits=ray.intersectObjects([a.terrain.near,a.ring.trackMesh,a.ride.trackMesh]);if(!hits[0])throw Error('No rendered ground under idle hoof');maxIdleSurfaceError=Math.max(maxIdleSurfaceError,Math.abs(f.y-hits[0].point.y));idleSamples++;}}
    return {samples:360*3*4,maxHoofTargetErrorMeters:maxError,supportSamples,maxRenderedSupportErrorMeters:maxSurfaceError,oldTerrainOnlyMaxPenetrationMeters:oldTerrainOnlyPenetration,idleSamples,maxIdleRenderedSupportErrorMeters:maxIdleSurfaceError,clamped,minWaitingCenterDistanceMeters:minWaitingDistance,minYardCenterClearanceMeters:minYardClearance};
   });
   assert.equal(report.contact.clamped,0);assert.ok(report.contact.maxHoofTargetErrorMeters<1e-7);assert.ok(report.contact.supportSamples>2000);assert.ok(report.contact.maxRenderedSupportErrorMeters<1e-7);assert.ok(report.contact.maxIdleRenderedSupportErrorMeters<1e-7);assert.ok(report.contact.minWaitingCenterDistanceMeters>2);assert.ok(report.contact.minYardCenterClearanceMeters>2);
   for(const t of [0,.1875,.375,.5625,5.983333]){await page.evaluate(t=>{const a=window.__nagisa;a.setView('pony');a.controls.settle();a.setHour(14);a.setElapsed(t);a.step(0);},t);await page.screenshot({path:path.join(out,`walk-${t}.png`)});}
  }
  report.errors=errors;report.shaderErrors=shaderErrors;assert.deepEqual(errors,[]);assert.deepEqual(shaderErrors,[]);if(proof)report.publishedFiles=await proof(path.join(out,'published-source.json'));fs.writeFileSync(path.join(out,`${variant}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
