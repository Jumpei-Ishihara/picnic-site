// Live GitHub Pages verification: real UI clicks and actual Chromium downloads.
// RELEASE_SHA=<deployed commit> node tools/verify-pages-lighting.cjs
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/lighting-validation/pages-release');
const base='https://jumpei-ishihara.github.io/picnic-site/';
const release=process.env.RELEASE_SHA;assert.match(release||'',/^[a-f0-9]{40}$/,'RELEASE_SHA required');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 const report={release,date:new Date().toISOString(),browser:await browser.version(),base,scenes:[],files:[]};
 const session=await browser.target().createCDPSession();
 await session.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:out,eventsEnabled:true});
 const downloads=new Map();let waiting=null;
 session.on('Browser.downloadWillBegin',v=>downloads.set(v.guid,v));
 session.on('Browser.downloadProgress',v=>{
  if(!waiting)return;
  if(v.state==='completed'){const w=waiting;waiting=null;clearTimeout(w.timer);w.resolve({...downloads.get(v.guid),bytes:v.receivedBytes});}
  if(v.state==='canceled'){const w=waiting;waiting=null;clearTimeout(w.timer);w.reject(Error('Download canceled'));}
 });
 try{
  for(const name of ['nagisa','picnic']){
   const page=await browser.newPage();await page.setViewport({width:1280,height:720,deviceScaleFactor:1});await page.setCacheEnabled(false);
   const errors=[],consoleErrors=[],pending=[],seen=new Set();
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
   page.on('response',response=>{
    const url=response.url();if(!url.startsWith(base)||seen.has(url))return;seen.add(url);
    const relative=decodeURIComponent(new URL(url).pathname.slice(new URL(base).pathname.length));
    if(!relative||!fs.existsSync(path.join(root,relative)))return;
    pending.push((async()=>{
     let data=await response.buffer();const local=fs.readFileSync(path.join(root,relative));
     let method='browser-response',status=response.status();const browserBodyBytes=data.length;
     // Chrome can expose an empty DevTools body for fetched ImageBitmap inputs.
     // Independently fetch that same public URL; never substitute a local asset.
     if(!data.length&&local.length){const fresh=await fetch(url,{headers:{'Cache-Control':'no-cache'}});data=Buffer.from(await fresh.arrayBuffer());status=fresh.status;method='independent-http';}
     report.files.push({scene:name,path:relative,status,method,browserBodyBytes,bytes:data.length,sha256:sha(data),matchesLocal:sha(data)===sha(local)});
    })());
   });
   await page.goto(`${base}${name}.html?season=summer&release=${release}#debug`,{waitUntil:'networkidle0',timeout:120000});
   await page.waitForFunction(n=>!!window['__'+n],{polling:100,timeout:60000},name);
   await page.click('#s-sunset');
   await page.evaluate(n=>{const a=window['__'+n];a.tod.auto=false;a.controls.settle();},name);
   await new Promise(r=>setTimeout(r,1000));
   const scene=await page.evaluate(n=>{const a=window['__'+n];return {name:n,hour:a.tod.hour,soft:a.pixel.uniforms.uSoftLighting.value,rays:a.pixel.uniforms.uRays.value,volumetric:a.pixel.uniforms.uVol.value,camera:a.camera.position.toArray(),size:a.pixel.size,glError:a.pixel.renderer.getContext().getError()};},name);
   assert.equal(scene.soft,0);assert.equal(scene.glError,0);
   assert.ok(Math.abs(scene.rays-(name==='nagisa'?.835178956251694:.6490384615384629))<1e-7,'restored sunset glow');
   await page.screenshot({path:path.join(out,`${name}-sunset.png`)});
   await page.click('#a-export');
   async function save(selector,label){
    const next=new Promise((resolve,reject)=>{waiting={resolve,reject,timer:setTimeout(()=>{waiting=null;reject(Error('Download timeout'));},45000)};});
    await page.click(selector);const download=await next;
    const ext=path.extname(download.suggestedFilename);assert.ok(['.png','.mp4','.webm'].includes(ext));
    const filename=`${name}-${label}${ext}`;fs.renameSync(path.join(out,download.guid),path.join(out,filename));
    const data=fs.readFileSync(path.join(out,filename));
    const probe=JSON.parse(cp.execFileSync(process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json',path.join(out,filename)],{encoding:'utf8'}));
    assert.equal(probe.streams[0].width,1280);assert.equal(probe.streams[0].height,720);
    if(label==='6s')assert.ok(Math.abs(Number(probe.format.duration)-6)<.25,'video duration');
    return {filename,suggestedFilename:download.suggestedFilename,bytes:data.length,sha256:sha(data),probe};
   }
   scene.png=await save('#x-png','export');
   await page.waitForFunction(n=>window['__'+n].capture.state==='idle'&&!document.getElementById('x-png').disabled,{polling:100},name);
   // Exercise automatic-time restoration through the actual recording UI.
   await page.click('#o-more');
   await page.click('#t-auto');
   await page.click('#o-more');
   await page.click('#a-export');
   scene.autoBeforeVideo=await page.evaluate(n=>window['__'+n].tod.auto,name);assert.equal(scene.autoBeforeVideo,true);
   scene.video=await save('#x-v1','6s');
   await page.waitForFunction(n=>window['__'+n].capture.state==='idle'&&!document.getElementById('x-v1').disabled&&document.getElementById('rec').classList.contains('hidden'),{polling:100},name);
   scene.restored=await page.evaluate(n=>({state:window['__'+n].capture.state,auto:window['__'+n].tod.auto,size:window['__'+n].pixel.size,note:document.getElementById('x-note').textContent,blobLink:document.querySelector('#x-note a')?.href.startsWith('blob:'),buttons:['x-png','x-v1','x-v2'].map(id=>({id,disabled:document.getElementById(id).disabled}))}),name);
   assert.equal(scene.restored.auto,true);assert.equal(scene.restored.blobLink,true);assert.ok(scene.restored.buttons.every(b=>!b.disabled));
   assert.deepEqual(scene.restored.size,scene.size);
   await page.screenshot({path:path.join(out,`${name}-export-ui.png`)});
   await Promise.all(pending);scene.errors=errors;scene.consoleErrors=consoleErrors;
   scene.expectedLocalBridgeErrors=consoleErrors.filter(s=>/18923|ERR_CONNECTION_REFUSED|address space|local network|CORS/i.test(s));
   assert.equal(errors.length,0);assert.ok(!consoleErrors.some(s=>/GLSL|THREE.WebGLProgram|VALIDATE_STATUS/i.test(s)));
   report.scenes.push(scene);console.log(JSON.stringify({name,rays:scene.rays,png:scene.png.filename,video:scene.video.filename,restored:scene.restored}));
   await page.close();
  }
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');
  const mismatches=report.files.filter(f=>f.status!==200||!f.matchesLocal);console.log(JSON.stringify({files:report.files.length,mismatches}));
  assert.ok(report.files.length>10);assert.equal(mismatches.length,0,'published files must match local commit');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
