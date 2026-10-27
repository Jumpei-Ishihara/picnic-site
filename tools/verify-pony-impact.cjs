// Check shared capture change against the other pixel pages without changing evidence elsewhere.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const out=path.resolve(__dirname,'..',process.env.PONY_OUT||'docs/pony-validation');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});const report=[];
 try{
  const session=await browser.target().createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'deny'});
  for(const name of ['picnic','edogawa','myoden','myoden-far']){
   const page=await browser.newPage();await page.setViewport({width:1280,height:720});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setRequestInterception(true);page.on('request',r=>r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'?r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync('/private/tmp/picnic-three-r160.js','utf8')}):r.continue());
   await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>0;});
   await page.goto(`http://127.0.0.1:8790/${name}.html#debug`,{waitUntil:'networkidle0'});const key=name==='edogawa'?'__edo':'__'+name.replaceAll('-','');
   await page.waitForFunction(key=>!!window[key],{polling:100},key);
   const result=await page.evaluate(async({name,key})=>{
    const a=window[key];a.step(0);const result={name,soft:a.pixel.uniforms.uSoftLighting.value,glError:a.pixel.renderer.getContext().getError()};
    if(name==='picnic'){
     document.querySelector('#s-sit').click();a.tod.auto=false;a.step(0);
     const png=await a.capture.png('pony-impact');const b=await createImageBitmap(await fetch(png.url).then(r=>r.blob()));result.png={width:b.width,height:b.height};b.close();png.dispose();
     const p=a.capture.startVideo({duration:6,filename:'pony-impact'});const timer=setInterval(()=>a.step(1/60),16);
     try{const video=await p,blob=await fetch(video.url).then(r=>r.blob());result.video={mime:blob.type,bytes:blob.size};video.dispose();}finally{clearInterval(timer);}
     result.state=a.capture.state;
    }return result;
   },{name,key});
   assert.equal(result.soft,0);assert.equal(result.glError,0);assert.deepEqual(errors,[]);if(name==='picnic'){assert.equal(result.state,'idle');assert.equal(result.png.width,1280);assert.ok(result.video.bytes>1000);}
   report.push({...result,errors});await page.close();
  }
  fs.writeFileSync(path.join(out,'other-pages.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
