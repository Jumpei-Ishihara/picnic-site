// Supplement the numeric/loop checks with reproducible model and time-of-day views.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const out=path.resolve(process.env.PONY_OUT||'docs/pony-validation/spline-improvement/after');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:1280,height:720});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|GLSL|WebGLProgram/.test(m.text()))errors.push(m.text());});
  await page.setRequestInterception(true);page.on('request',r=>r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'?r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync('/private/tmp/picnic-three-r160.js','utf8')}):r.continue());
  await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>0;});
  await page.goto('http://127.0.0.1:8790/nagisa.html#debug',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.__nagisa);
  await page.evaluate(()=>{const a=window.__nagisa;a.begin('lunch');a.setView('pony');a.tod.auto=false;a.controls.settle();a.pixel.setFixedSize({width:320,height:180});for(const el of document.body.children)if(!['CANVAS','SCRIPT'].includes(el.tagName))el.style.visibility='hidden';});
  const cases=[
   {name:'front-day',hour:10.75,offset:[-2,1,-2.5]},
   {name:'side-day',hour:14,offset:[-3,1,0]},
   {name:'front-evening',hour:16.85,offset:[2,1,-2.5]},
   {name:'front-night',hour:20,offset:[2,1,-2.5]},
   {name:'grazing',hour:14,offset:[2,1,-2.5],grazing:true}
  ];
  const report=[];
  for(const c of cases){
   const result=await page.evaluate(c=>{
    const a=window.__nagisa,T=a.THREE;a.setHour(c.hour);a.setElapsed(.1875);for(let i=0;i<10;i++)a.step(0);
    const pony=c.grazing?a.ponyLand.grazers.find(g=>!g.idle).p:a.ride.units[0].pony;
    pony.group.updateWorldMatrix(true,true);
    const target=new T.Vector3(0,.85,-.08).applyMatrix4(pony.group.matrixWorld);
    const offset=new T.Vector3().fromArray(c.offset).applyQuaternion(pony.group.getWorldQuaternion(new T.Quaternion()));
    a.camera.position.copy(target).add(offset);a.camera.lookAt(target);a.camera.updateMatrixWorld();
    a.pixel.prepareShadows();a.water.renderReflection(a.pixel.size.width,a.pixel.size.height);a.pixel.render();
    const gl=a.pixel.renderer.getContext();
    return {name:c.name,hour:a.tod.hour,glError:gl.getError(),neckAngle:pony.neck.rotation.x,
      headParent:pony.group.getObjectByName('Pony Head').parent.name,material:pony.group.getObjectByName('Pony Body').material.type};
   },c);
   assert.equal(result.glError,0);assert.equal(result.headParent,'Pony Neck Pivot');assert.equal(result.material,'MeshToonMaterial');
   await page.screenshot({path:path.join(out,`${c.name}.png`)});report.push(result);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'appearance.json'),JSON.stringify({cases:report,errors},null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
