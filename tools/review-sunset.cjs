// Controlled ablation of the pixel-lighting trial. No app sources are modified.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
const scene=process.env.SUNSET_SCENE||'nagisa';assert.ok(['nagisa','picnic'].includes(scene),'Invalid scene');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/lighting-validation/'+(scene==='picnic'?'picnic-sunset-review':'sunset-review'));fs.mkdirSync(out,{recursive:true});
const ref='0394ced9cdfd66ce16fc600acdacf211c8f11851';
const variants=['original','trial','restore-rays','restore-highlight','restore-bloom','restore-volume','restore-rays-highlight','restored'];
const paths=[scene+'.html','engine/pixel-renderer.js','realsite/look.js','engine/trees.js'];
const replace=(s,a,b)=>{assert.ok(s.includes(a),'Missing ablation marker: '+a);return s.replace(a,b);};
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 const results={scene,baseline:ref,browser:await browser.version(),date:new Date().toISOString(),cases:[]};
 try{
  for(const variant of variants){
   const source=Object.fromEntries(paths.map(file=>[file,variant==='original'?cp.execFileSync('/usr/bin/git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8')]));
   if(variant!=='original'){
    const oldRays=['restore-rays','restore-rays-highlight','restored'].includes(variant);
    const oldVolume=['restore-volume','restored'].includes(variant);
    if(scene==='nagisa') {
      source['nagisa.html']=source['nagisa.html'].replace(/createPixelRenderer\(\{ canvas, scene, camera(?:, softLighting: (?:true|false))? \}\)/,'createPixelRenderer({ canvas, scene, camera, softLighting: '+(variant==='restored'?'false':'true')+' })');
      source['nagisa.html']=source['nagisa.html'].replace(/createLook\(\{ (?:softLighting: (?:true|false), )?/,'createLook({ softLighting: '+(variant==='restored'?'false':'true')+', groundHeight: () => terrain.heightAt(player.x, player.z), ');
      if(oldRays && variant!=='restored')source['realsite/look.js']=replace(source['realsite/look.js'],'pixel.setSunRays(sd, warm * 0.5 * daylight, sun.color);','pixel.setSunRays(sd, sd.y > 0.0 ? warm * 0.85 : 0, sun.color);');
      if(oldVolume && variant!=='restored')source['realsite/look.js']=replace(source['realsite/look.js'],'pixel.setVolumetric(sun, (day * 0.22 + warm * 0.65) * daylight, sun.color, 28, groundHeight());','pixel.setVolumetric(sun, day * 0.12 + warm * 0.75 + night * 0.25, sun.color, 60);');
    } else {
      let html=source['picnic.html'];
      html=html.replace(/createPixelRenderer\(\{ canvas, scene, camera, palette: MASTER_PALETTE(?:, softLighting: (?:true|false))? \}\)/,'createPixelRenderer({ canvas, scene, camera, palette: MASTER_PALETTE, softLighting: '+(variant==='restored'?'false':'true')+' })');
      const start=html.indexOf('      // 空気中の光の筋：葉のすき間'),end=html.indexOf('      // 木漏れ日：葉のすき間',start);
      assert.ok(start>0&&end>start,'picnic light settings');
      html=html.slice(0,start)+'      // 空気中の光の筋：葉のすき間を通る光\n'
        +'      const daylight = THREE.MathUtils.smoothstep(sd.y, 0, 0.12) * (1 - night);\n'
        +(oldVolume?'      pixel.setVolumetric(sun, day * 0.3 + warm * 1.1 + night * 0.35, sun.color, 28);\n':'      pixel.setVolumetric(sun, (day * 0.28 + warm * 0.7) * daylight, sun.color, 24, terrainHeight(player.x, player.z));\n')
        +(oldRays?'      pixel.setSunRays(sd, sd.y > 0.02 ? warm * 0.9 : 0, sun.color);\n':'      pixel.setSunRays(sd, warm * 0.5 * daylight, sun.color);\n')+html.slice(end);
      source['picnic.html']=html;
    }
    if(oldRays && variant!=='restored')source['engine/pixel-renderer.js']=replace(source['engine/pixel-renderer.js'],'mix(1.0, 0.35, uSoftLighting)','1.0');
    if(['restore-highlight','restore-rays-highlight'].includes(variant))source['engine/pixel-renderer.js']=replace(source['engine/pixel-renderer.js'],'if (uSoftLighting > 0.5) {\n      // Continuous highlight','if (false) {\n      // Continuous highlight');
    if(variant==='restore-bloom'){
      source['engine/pixel-renderer.js']=replace(source['engine/pixel-renderer.js'],'if (uSoftLighting < 0.5) return max(c - 1.25','if (true) return max(c - 1.25');
      source['engine/pixel-renderer.js']=replace(source['engine/pixel-renderer.js'],'if (uSoftLighting > 0.5) {\n        // Wide','if (false) {\n        // Wide');
    }
    if(variant==='restore-volume'){
      let r=source['engine/pixel-renderer.js'],a=r.indexOf('    if (uVol > 0.001) {'),b=r.indexOf('    if (uSoftLighting > 0.5) {\n      // Continuous',a);
      assert.ok(a>0&&b>a);source['engine/pixel-renderer.js']=r.slice(0,a)+r.slice(a,b).replaceAll('uSoftLighting','0.0')+r.slice(b);
    }
   }
   const page=await browser.newPage();await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|shader|WebGL/i.test(m.text()))errors.push(m.text());});
   await page.setRequestInterception(true);
   page.on('request',r=>{
    const u=new URL(r.url()),key=u.pathname.slice(1);
    if(u.origin==='http://127.0.0.1:8790'&&source[key])return r.respond({status:200,contentType:key.endsWith('.html')?'text/html':'application/javascript',body:source[key]});
    if(process.env.THREE_LOCAL&&r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js')return r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.THREE_LOCAL,'utf8')});
    return r.continue();
   });
   await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>0;});
   await page.goto(`http://127.0.0.1:8790/${scene}.html?season=summer#debug`,{waitUntil:'networkidle0',timeout:60000});
   await page.waitForFunction(name=>!!window['__'+name],{polling:100,timeout:30000},scene);
   const metrics=await page.evaluate(name=>{
    const a=window['__'+name];if(name==='nagisa'){a.begin('lunch');a.setView('sunset');}else{document.querySelector('#s-sit').click();a.sunsetView();}a.controls.settle();a.tod.auto=false;a.setElapsed?.(0);a.pixel.setFixedSize({width:320,height:180});
    for(let i=0;i<24;i++)a.step(0);
    // Hide HUD consistently; pixel values below are read from the WebGL drawing buffer.
    for(const el of document.body.children)if(el.tagName!=='CANVAS'&&el.tagName!=='SCRIPT')el.style.visibility='hidden';
    const gl=a.pixel.renderer.getContext(),pixels=new Uint8Array(320*180*4);gl.readPixels(0,0,320,180,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const u=a.pixel.uniforms,center=u.uSunUv.value,lum=[];let bright=0;
    for(let y=0;y<180;y++)for(let x=0;x<320;x++){
      const radius=Math.hypot(x-center.x*320,y-center.y*180);
      if(radius<12||radius>48)continue;
      const i=(y*320+x)*4,l=(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])/255;lum.push(l);if(l>.7)bright++;
    }
    return {hour:a.tod.hour,camera:a.camera.position.toArray(),sunY:a.tod.state.sunDir.y,sunElevation:Math.asin(a.tod.state.sunDir.y)*180/Math.PI,rays:u.uRays.value,volumetric:u.uVol.value,volMax:u.uVolMax.value,soft:u.uSoftLighting?.value??0,halo:{meanDisplayLuma:lum.reduce((a,b)=>a+b,0)/lum.length,brightFraction:bright/lum.length,samples:lum.length},glError:gl.getError()};
   },scene);
   await page.screenshot({path:path.join(out,variant+'.png')});assert.equal(errors.length,0,variant);assert.equal(metrics.glError,0);
   if(variant==='trial'&&scene==='nagisa'){assert.ok(metrics.rays<.1 && metrics.volumetric<.1,'reproduce original trial settings');}
   results.cases.push({variant,...metrics,effectiveRayStrength:metrics.rays*(['original','restored','restore-rays','restore-rays-highlight'].includes(variant)?1:.35),errors});console.log(JSON.stringify({variant,...metrics}));await page.close();
  }
  const original=results.cases.find(x=>x.variant==='original'),trial=results.cases.find(x=>x.variant==='trial'),restored=results.cases.find(x=>x.variant==='restored');
  assert.ok(trial.halo.meanDisplayLuma < original.halo.meanDisplayLuma*.9,'reproduce halo loss');
  assert.ok(Math.abs(restored.halo.meanDisplayLuma/original.halo.meanDisplayLuma-1)<.02,'restore halo within 1% of original');
  assert.ok(Math.abs(restored.rays-original.rays)<1e-8,'restore ray strength');
  fs.writeFileSync(path.join(out,'analysis.json'),JSON.stringify(results,null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
