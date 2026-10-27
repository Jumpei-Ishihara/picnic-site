// Real PNG and 6/12 second downloads through the existing export UI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),puppeteer=require('puppeteer');
const out=path.resolve(__dirname,'..',process.env.PONY_OUT||'docs/pony-validation');fs.mkdirSync(out,{recursive:true});
const base=process.env.PONY_BASE||'http://127.0.0.1:8790/',published=new URL(base).protocol==='https:';
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:1280,height:720});
  await page.setCacheEnabled(false);
  const proof=published?require('./pages-proof.cjs').createPagesProof(page,{base,release:process.env.RELEASE_SHA}):null;
  await page.evaluateOnNewDocument(()=>{
   const native=HTMLCanvasElement.prototype.captureStream;
   window.__ponySeeds=[];
   HTMLCanvasElement.prototype.captureStream=function(...args){const a=window.__nagisa;window.__ponySeeds.push({png:this.toDataURL('image/png'),positions:a?.ride.units.map(u=>u.pony.group.position.toArray())});return native.apply(this,args);};
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!published){await page.setRequestInterception(true);page.on('request',r=>r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'?r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync('/private/tmp/picnic-three-r160.js','utf8')}):r.continue());}
  const session=await browser.target().createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:out,eventsEnabled:true});
  let waiting=null;const names=new Map();session.on('Browser.downloadWillBegin',e=>names.set(e.guid,e.suggestedFilename));
  session.on('Browser.downloadProgress',e=>{if(waiting&&e.state==='completed'){const w=waiting;waiting=null;clearTimeout(w.timer);w.resolve({guid:e.guid,name:names.get(e.guid)});}});
  await page.goto(`${base}nagisa.html?release=${process.env.RELEASE_SHA||'local'}#debug`,{waitUntil:'networkidle0',timeout:120000});await page.waitForFunction(()=>!!window.__nagisa,{polling:100});
  await page.click('#s-lunch');await page.evaluate(()=>{const a=window.__nagisa;a.setView('pony');a.controls.settle();a.tod.auto=false;});
  await page.click('#a-export');
  const report={base,release:process.env.RELEASE_SHA||null,date:new Date().toISOString(),browser:await browser.version(),downloads:[]};
  for(const [selector,label,seconds] of [['#x-png','pony-export',0],['#x-v1','pony-6s',6],['#x-v2','pony-12s',12]]){
   const next=new Promise((resolve,reject)=>{waiting={resolve,reject,timer:setTimeout(()=>{waiting=null;reject(Error('download timeout'));},45000)};});
   await page.click(selector);const d=await next,filename=label+path.extname(d.name);fs.renameSync(path.join(out,d.guid),path.join(out,filename));
   const probe=JSON.parse(cp.execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','stream=codec_name,width,height,r_frame_rate:format=duration','-of','json',path.join(out,filename)],{encoding:'utf8'}));
   assert.equal(probe.streams[0].width,1280);assert.equal(probe.streams[0].height,720);if(seconds)assert.ok(Math.abs(+probe.format.duration-seconds)<.25);
   await page.waitForFunction(()=>window.__nagisa.capture.state==='idle'&&!document.querySelector('#x-png').disabled&&!document.querySelector('#x-v1').disabled&&!document.querySelector('#x-v2').disabled&&document.querySelector('#rec').classList.contains('hidden'),{polling:100});
   report.downloads.push({filename,bytes:fs.statSync(path.join(out,filename)).size,probe});
  }
  report.restored=await page.evaluate(()=>({state:window.__nagisa.capture.state,auto:window.__nagisa.tod.auto,size:window.__nagisa.pixel.size}));
  const seeds=await page.evaluate(()=>window.__ponySeeds);assert.equal(seeds.length,2);
  for(const [i,s]of seeds.entries()){
   assert.ok(Math.abs(s.positions[0][0]-(-144.2))<1e-8);assert.ok(Math.abs(s.positions[0][2]-(-48.5))<1e-8);
   fs.writeFileSync(path.join(out,`seed-${i?12:6}s.png`),Buffer.from(s.png.split(',')[1],'base64'));delete s.png;
  }
  report.firstPoseSeeds=seeds;
  assert.equal(report.restored.state,'idle');assert.equal(report.restored.auto,false);assert.deepEqual(errors,[]);report.errors=errors;
  if(proof)report.publishedFiles=await proof(path.join(out,'published-export-source.json'));
  await page.screenshot({path:path.join(out,'export-ui.png')});fs.writeFileSync(path.join(out,'exports.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
