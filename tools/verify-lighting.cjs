// Browser regression checks and export evidence for the opt-in pixel lighting.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const out = path.resolve(__dirname, '../docs/lighting-validation');
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const name of (process.env.LIGHTING_PAGES || 'nagisa,picnic,edogawa,myoden,myoden-far').split(',')) {
      const page = await browser.newPage(); await page.setViewport({width:1280,height:720});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error' && /shader|WebGL|GLSL/i.test(m.text())) errors.push(m.text());});
      // Optional exact-version local copy makes CDN availability independent of rendering checks.
      if (process.env.THREE_LOCAL) {
        const source=fs.readFileSync(process.env.THREE_LOCAL,'utf8');
        await page.setRequestInterception(true);
        page.on('request',r=>r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
          ? r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:source}) : r.continue());
      }
      await page.evaluateOnNewDocument(()=>{ window.requestAnimationFrame=()=>0; });
      await page.goto(`http://127.0.0.1:8790/${name}.html?season=summer#debug`,{waitUntil:'networkidle0',timeout:120000});
      await page.waitForFunction(n=>!!window[n==='edogawa'?'__edo':'__'+n.replaceAll('-','')],{timeout:120000,polling:100},name);
      const target=['nagisa','picnic'].includes(name);
      const state=await page.evaluate(async ({name,target})=>{
        const a=window[name==='edogawa'?'__edo':'__'+name.replaceAll('-','')];
        if(!target) { a.step(0); return {soft:a.pixel.uniforms.uSoftLighting.value}; }
        if(name==='nagisa') a.begin('lunch'); else document.querySelector('#s-sit').click();
        if(name==='nagisa') a.setView('lunch'); else a.sitOnBlanket();
        a.controls.settle(); a.tod.auto=false; a.setHour(12); a.pixel.setFixedSize({width:320,height:180});
        const gl=a.pixel.renderer.getContext();
        const read=()=>{const p=new Uint8Array(320*180*4);gl.readPixels(0,0,320,180,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
        const difference=(x,y)=>{let changed=0,max=0,sum=0;for(let i=0;i<x.length;i++){let d=Math.abs(x[i]-y[i]);if(d)changed++;max=Math.max(max,d);sum+=d;}return {changed,max,mean:sum/x.length};};
        a.setElapsed(0); for(let i=0;i<10;i++) a.step(0); const p0=read();
        a.setElapsed(6); a.step(0); const loop=difference(p0,read());
        a.setElapsed(0); a.step(0);
        // Outside the shadow frustum must contribute no volumetric light.
        const u=a.pixel.uniforms, saved=u.uShadowMat.value, strength=u.uVol.value;
        u.uShadowMat.value=saved.clone().makeTranslation(10000,10000,10000);
        a.pixel.render(); const outside=read(); u.uVol.value=0; a.pixel.render();
        const outsideDifference=difference(outside,read()); u.uShadowMat.value=saved;u.uVol.value=strength;
        a.step(0);
        // Exercise the real GLSL with controlled HDR inputs, not a CPU copy of the shader.
        const THREE=await import('three');
        const original=Object.fromEntries(Object.entries(u).map(([key,item])=>[key,item.value]));
        let shaderCases;
        try {
          for(const key of ['uOutline','uRays','uVol','uPaletteOn','uDither'])u[key].value=0;
          u.uLevels.value=255;u.uShadowShift.value=new THREE.Vector3();u.uHighShift.value=new THREE.Vector3();
          const sample=(rgb,bloom)=>{
            const tex=new THREE.DataTexture(new Float32Array([...rgb,1]),1,1,THREE.RGBAFormat,THREE.FloatType);tex.needsUpdate=true;
            u.tColor.value=tex;u.uBloom.value=bloom;a.pixel.render();const pixels=read();tex.dispose();return [...pixels.slice(0,3)];
          };
          const dimOff=sample([.65,.4,.2],0),dimOn=sample([.65,.4,.2],1);
          const hdr=sample([2,1,.5],1);
          const linear=hdr.map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
          shaderCases={dimOff,dimOn,black:sample([0,0,0],1),hdr,linearRatios:linear.map(x=>x/linear[0])};
        } finally {for(const [key,value] of Object.entries(original))u[key].value=value;}
        a.step(0);
        // A sequence through a tree's shadow, including the periodic endpoint.
        let tree;
        if(name==='nagisa') {
          tree=[...a.data.trees].sort((x,y)=>Math.hypot(x.x-a.player.x,x.z-a.player.z)-Math.hypot(y.x-a.player.x,y.z-a.player.z))[0];
          a.player.x=tree.x+Math.max(1.8,tree.r*.65);a.player.z=tree.z+Math.max(1.8,tree.r*.65);
          a.player.yaw=Math.PI/4;a.player.pitch=.45;
        } else { a.player.pitch=.4; }
        a.controls.setEye(1.55,true);a.controls.settle();a.step(0);
        return {soft:u.uSoftLighting.value,loop,outsideDifference,shaderCases,tree,camera:a.camera.position.toArray(),glError:gl.getError()};
      },{name,target});
      assert.equal(state.soft,0,`${name} restored profile`);
      if(target) {
        if(state.soft) assert.equal(state.outsideDifference.changed,0,`${name} outside shadow`);
        assert.deepEqual(state.shaderCases.dimOff,state.shaderCases.dimOn,`${name} ordinary surfaces must not bloom`);
        assert.deepEqual(state.shaderCases.black,[0,0,0],`${name} finite black output`);
        if(state.soft) assert.ok(Math.abs(state.shaderCases.linearRatios[1]-.5)<.02 && Math.abs(state.shaderCases.linearRatios[2]-.25)<.02,`${name} HDR hue preservation`);
        assert.equal(state.loop.changed,0,`${name} loop endpoint mismatch`);
        for(const t of [0,1.5,3,6]){
          await page.evaluate(({name,t})=>{const a=window['__'+name];a.setElapsed(t);a.step(0);},{name,t});
          await page.screenshot({path:`${out}/motion-${name}-${t}.png`});
        }
        if(name==='nagisa') {
          state.sunset=await page.evaluate(()=>{const a=window.__nagisa;a.setView('sunset');a.controls.settle();for(let i=0;i<10;i++)a.step(0);return {soft:a.pixel.uniforms.uSoftLighting.value,rays:a.pixel.uniforms.uRays.value,warm:a.look.state.warm};});
          assert.equal(state.sunset.soft,0);assert.ok(Math.abs(state.sunset.rays-state.sunset.warm*.85)<1e-8,'preserve sunset ray strength');
        }
        if(name==='picnic') {
          state.sunset=await page.evaluate(()=>{const a=window.__picnic;a.sunsetView();a.controls.settle();for(let i=0;i<10;i++)a.step(0);return {soft:a.pixel.uniforms.uSoftLighting.value,rays:a.pixel.uniforms.uRays.value,volumetric:a.pixel.uniforms.uVol.value};});
          assert.equal(state.sunset.soft,0);
          assert.ok(Math.abs(state.sunset.rays-.6490384615384629)<1e-7,'preserve picnic sunset rays');
          assert.ok(Math.abs(state.sunset.volumetric-.9391025641025659)<1e-7,'preserve picnic sunset atmosphere');
        }
        // Move and turn, then exercise portrait/touch pixel count on the same GPU.
        state.movement=await page.evaluate(name=>{const a=window['__'+name];a.controls.setEye(1.55,true);for(let i=0;i<60;i++){a.player.yaw+=.035;a.player.x+=.01;a.step(1/60);}return {camera:a.camera.position.toArray(),rays:a.pixel.uniforms.uRays.value};},name);
        await page.setViewport({width:390,height:844});
        state.portrait=await page.evaluate(name=>{const a=window['__'+name];a.pixel.setFixedSize(null);a.step(0);return {size:a.pixel.size,aspect:a.camera.aspect,soft:a.pixel.uniforms.uSoftLighting.value};},name);
        await page.screenshot({path:`${out}/portrait-${name}.png`});
        await page.setViewport({width:1280,height:720});
        const media=await page.evaluate(async name=>{
          const a=window['__'+name];a.pixel.setFixedSize(null);
          const png=await a.capture.png('lighting-validation');
          const blob=await fetch(png.url).then(r=>r.blob());const bitmap=await createImageBitmap(blob);
          const result={png:{mime:blob.type,bytes:blob.size,width:bitmap.width,height:bitmap.height},restoredSize:a.pixel.size};bitmap.close();png.dispose();
          let timer;
          try {
            const promise=a.capture.startVideo({duration:6,filename:'lighting-validation',onProgress:()=>{}});
            timer=setInterval(()=>a.step(1/60),16);
            const video=await promise;const data=await fetch(video.url).then(r=>r.blob());
            const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(data);});
            result.video={mime:data.type,bytes:data.size,filename:video.filename,base64};video.dispose();
          } finally {clearInterval(timer);}
          result.state=a.capture.state;result.restoredAfterVideo=a.pixel.size;return result;
        },name);
        assert.equal(media.png.width,1280);assert.equal(media.png.height,720);assert.equal(media.state,'idle');
        const videoPath=`${out}/${name}-6s.${media.video.mime==='video/mp4'?'mp4':'webm'}`;
        fs.writeFileSync(videoPath,Buffer.from(media.video.base64,'base64'));delete media.video.base64;
        state.media=media;
      }
      state.errors=errors; assert.equal(errors.length,0,`${name} errors`);
      results.push({name,...state});fs.writeFileSync(`${out}/${process.env.LIGHTING_PAGES ? 'regressions-' + process.env.LIGHTING_PAGES.replaceAll(',', '-') : 'regressions'}.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({name,...state}));await page.close();
    }
    fs.writeFileSync(`${out}/${process.env.LIGHTING_PAGES ? 'regressions-' + process.env.LIGHTING_PAGES.replaceAll(',', '-') : 'regressions'}.json`,JSON.stringify(results,null,2)+'\n');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
