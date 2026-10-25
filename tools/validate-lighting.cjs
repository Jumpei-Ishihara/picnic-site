// Local visual/GPU comparison. Start a static server on 8790 first.
// Usage: node tools/validate-lighting.cjs before|after
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');
const stage = process.argv[2] || 'after';
if (!['before', 'after'].includes(stage)) throw Error('Expected before or after');
const motion=process.env.LIGHTING_MOTION==='1', touch=process.env.LIGHTING_TOUCH==='1';
const tag=stage+(motion ? '-motion-'+(touch?'touch':'desktop') : '');
const out = path.resolve(__dirname, '../docs/lighting-validation');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'picnic-lighting-'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: profile, args: ['--no-sandbox'] });
  const results = { stage, date: new Date().toISOString(), browser: await browser.version(), viewport: touch ? [390,844] : [1280,720], source: motion ? 'viewport/pixelScale' : [320,180], motion, touch, scenes: [] };
  try {
    for (const name of ['nagisa', 'picnic']) {
      const page = await browser.newPage();
      await page.setViewport(touch ? { width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true } : { width:1280,height:720,deviceScaleFactor:1 });
      const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(name, e.message); });
      page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|GLSL/i.test(m.text())) errors.push(m.text()); });
      // Optional exact-version local copy makes CDN availability independent of rendering checks.
      if (process.env.THREE_LOCAL) {
        const source=fs.readFileSync(process.env.THREE_LOCAL,'utf8');
        await page.setRequestInterception(true);
        page.on('request',r=>r.url()==='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
          ? r.respond({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:source}) : r.continue());
      }
      await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
      await page.goto(`http://127.0.0.1:8790/${name}.html?season=summer#debug`, { waitUntil: 'networkidle0', timeout: 120000 });
      await page.waitForFunction(n => !!window['__' + n], { timeout: 30000, polling: 100 }, name).catch(async e=>{console.error(await page.evaluate(()=>document.body.innerText.slice(-500)));throw e;});
      console.log('ready', name);
      await page.click(name === 'nagisa' ? '#s-lunch' : '#s-sit');
      for (const view of ['noon', 'canopy', 'sunset', 'night']) {
        const record = await page.evaluate(async ({ name, view, motion }) => {
          const a = window['__' + name];
          if (name === 'nagisa') a.setView('lunch'); else a.sitOnBlanket();
          a.controls.settle();
          if (view === 'sunset') { if (name === 'nagisa') a.setView('sunset'); else a.sunsetView(); }
          else { a.setHour(view === 'night' ? 21 : 12); if (view === 'canopy') a.player.pitch = 0.85; }
          a.controls.settle(); a.tod.auto = false;
          a.pixel.setFixedSize(motion ? null : { width: 320, height: 180 });
          for (let i = 0; i < 10; i++) a.step(0);
          const gl = a.pixel.renderer.getContext();
          const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          const cpu = [], gpu = [];
          for (let batch = 0; batch < 8; batch++) {
            gl.finish(); const q = ext ? gl.createQuery() : null;
            if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            const t = performance.now();
            for (let i = 0; i < 12; i++) a.step(motion ? 1/60 : 0);
            if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
            gl.finish(); cpu.push((performance.now() - t) / 12);
            if (q) {
              for (let i = 0; i < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) await new Promise(r => setTimeout(r, 10));
              if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 12);
              gl.deleteQuery(q);
            }
          }
          const median = x => x.length ? [...x].sort((a,b)=>a-b)[Math.floor(x.length/2)] : null;
          const u = a.pixel.uniforms;
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          return { name, view, source: a.pixel.size, shadowSize: a.sun?.shadow.mapSize.x, hour: a.tod.hour, camera: a.camera.position.toArray(), cpuWaitMs: cpu, gpuMs: gpu, medianCpuWaitMs: median(cpu), medianGpuMs: median(gpu), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), draws: a.pixel.renderer.info.render.calls, triangles: a.pixel.renderer.info.render.triangles, rays: u.uRays.value, volumetric: u.uVol.value, glError: gl.getError() };
        }, { name, view, motion });
        await page.screenshot({ path: `${out}/${tag}-${name}-${view}.png` });
        results.scenes.push(record); console.log(JSON.stringify({ name, view, gpu: record.medianGpuMs, cpuWait: record.medianCpuWaitMs, errors: errors.length }));
      }
      results.scenes.filter(r=>r.name===name).forEach(r=>r.errors=[...errors]);
      await page.close();
    }
    fs.writeFileSync(`${out}/${tag}.json`, JSON.stringify(results, null, 2) + '\n');
  } finally { await browser.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
