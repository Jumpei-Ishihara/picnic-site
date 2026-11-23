// Zero-dependency CDP visual, sunset-ring, 6s-loop, GPU-timer, and export validator
// for the 4 real-site pixel-art picnic pages (edogawa, nagisa, myoden, myoden-far).
// Usage: node tools/validate-pixel-quality.cjs <stage> [--export]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'docs', 'pixel-quality-validation');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THREE_PATH = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');

const args = process.argv.slice(2);
const stage = args.find(a => !a.startsWith('-')) || 'after';
const runExport = args.includes('--export');
const pagesFilter = process.env.PAGES ? process.env.PAGES.split(',') : ['edogawa', 'nagisa', 'myoden', 'myoden-far'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const DEBUG_GLOBAL = {
  edogawa: '__edo',
  nagisa: '__nagisa',
  myoden: '__myoden',
  'myoden-far': '__myodenfar'
};

const ELEVATED_VIEW = {
  edogawa: 'bridge',
  nagisa: 'river',
  myoden: 'photo',
  'myoden-far': 'photo'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const threeSrc = fs.readFileSync(THREE_PATH, 'utf8');
    const server = http.createServer((req, res) => {
      const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
      if (urlPath === '/__local_three.module.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(threeSrc);
        return;
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('Not Found'); return;
      }
      const ext = path.extname(file);
      const mime = MIME[ext] || 'application/octet-stream';
      if (ext === '.html') {
        const html = fs.readFileSync(file, 'utf8').replace(
          'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
          '/__local_three.module.js'
        );
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function launchChrome() {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'picnic-pq-'));
    const proc = spawn(CHROME, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-angle=metal',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--remote-debugging-port=0',
      '--window-size=1280,720',
      `--user-data-dir=${profile}`,
      'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Chrome launch timeout: ' + stderr)); }, 20000);
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, profile, wsUrl: m[1] });
      }
    });
    proc.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (${code}): ${stderr}`));
    });
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) fn(msg.params, msg.sessionId);
      }
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() { this.ws.close(); }
}

async function runOnPage(cdp, port, name, outDir) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (m, p = {}) => cdp.send(m, p, sessionId);
  const errors = [];
  const onConsole = (params, sid) => {
    if (sid !== sessionId) return;
    if (params.type === 'error') {
      const txt = params.args.map(a => a.value ?? a.description ?? '').join(' ');
      if (/shader|WebGL|GLSL|ReferenceError|TypeError|SyntaxError/i.test(txt)) errors.push(txt);
    }
  };
  const onException = (params, sid) => {
    if (sid !== sessionId) return;
    errors.push(params.exceptionDetails.text + ': ' + (params.exceptionDetails.exception?.description || ''));
  };
  cdp.on('Runtime.consoleAPICalled', onConsole);
  cdp.on('Runtime.exceptionThrown', onException);

  const evalJS = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  try {
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });

    const gName = DEBUG_GLOBAL[name];
    const elevView = ELEVATED_VIEW[name];

    const loadSeason = async (season) => {
      const url = `http://127.0.0.1:${port}/${name}.html?season=${season}#debug`;
      await call('Page.navigate', { url });
      for (let i = 0; i < 600; i++) {
        const ready = await evalJS(`Boolean(window[${JSON.stringify(gName)}] && !document.getElementById('loading'))`);
        if (ready) break;
        await new Promise(r => setTimeout(r, 100));
        if (i === 599) throw new Error(`Timeout waiting for ${name} (${season})`);
      }
      await evalJS(`(() => {
        const a = window[${JSON.stringify(gName)}];
        if (!a.started) a.begin('lunch');
        a.tod.auto = false;
        a.life.traffic.enabled = false;
        for (const el of document.querySelectorAll('#bar, #loc, #help, #toast, #prompt')) el.style.display = 'none';
        a.pixel.setFixedSize({ width: 320, height: 180 });
      })()`);
    };

    const shot = async (filename) => {
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, filename), Buffer.from(data, 'base64'));
    };

    // 1. Default season (autumn)
    await loadSeason('autumn');
    const autumnReport = await evalJS(`(async () => {
      const a = window[${JSON.stringify(gName)}];
      const gl = a.pixel.renderer.getContext();
      const read = () => { const p = new Uint8Array(320 * 180 * 4); gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      const diff = (x, y) => {
        let changed = 0, max = 0, sum = 0;
        for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d) changed++; if (d > max) max = d; sum += d; }
        return { changed, max, mean: sum / x.length };
      };
      const measureGPU = async () => {
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const cpu = [], gpu = [];
        for (let b = 0; b < 8; b++) {
          gl.finish();
          const q = ext ? gl.createQuery() : null;
          if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          const t0 = performance.now();
          for (let i = 0; i < 12; i++) a.step(0);
          if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
          gl.finish();
          cpu.push((performance.now() - t0) / 12);
          if (q) {
            for (let k = 0; k < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => setTimeout(r, 5));
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
              gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 12);
            }
            gl.deleteQuery(q);
          }
        }
        const med = arr => arr.length ? [...arr].sort((x, y) => x - y)[Math.floor(arr.length / 2)] : null;
        return { medianGpuMs: med(gpu), medianCpuWaitMs: med(cpu), samples: gpu.length };
      };
      const sunsetRing = () => {
        const sd = a.tod.state.sunDir;
        const p = a.camera.position.clone().addScaledVector(sd, 100).project(a.camera);
        const sx = (p.x * 0.5 + 0.5) * 320, sy = (p.y * 0.5 + 0.5) * 180;
        const px = read();
        let n = 0, sum = 0, bright = 0;
        for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
          const r = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
          if (r >= 12 && r <= 48) {
            const o = (y * 320 + x) * 4;
            const lum = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
            sum += lum; if (lum > 0.7) bright++; n++;
          }
        }
        return { count: n, mean: n ? sum / n : 0, brightRatio: n ? bright / n : 0, rays: a.pixel.uniforms.uRays.value, vol: a.pixel.uniforms.uVol.value, bloom: a.pixel.uniforms.uBloom.value, soft: a.pixel.uniforms.uSoftLighting.value };
      };

      // Noon lunch
      a.setView('lunch'); a.setHour(12); a.controls.settle();
      a.setElapsed(0); for (let i = 0; i < 10; i++) a.step(0);
      const p0 = read();
      const gpuNoon = await measureGPU();
      a.setElapsed(6); a.step(0);
      const loopCheck = diff(p0, read());
      a.setElapsed(0); a.step(0);

      const u = a.pixel.uniforms;
      const wu = a.water.uniforms;
      const meta = {
        shadowExtent: a.sun.shadow.camera.right,
        shadowSize: a.sun.shadow.mapSize.x,
        bloom: u.uBloom.value,
        softLighting: u.uSoftLighting.value,
        volNoon: u.uVol.value,
        volMax: u.uVolMax.value,
        waterClarity: wu.uClarity.value,
        waterCaustic: wu.uCaustic.value,
        waterWave: wu.uWave.value,
        waterWaveFade: [wu.uWaveFade.value.x, wu.uWaveFade.value.y],
        waterDepthRes: wu.tDepth.value.image.width,
        hasLeafKit: Boolean(a.leafKit),
        leafSoft: a.leafKit ? a.leafKit.uniforms.soft.value : null,
        glError: gl.getError()
      };
      return { meta, gpuNoon, loopCheck };
    })()`);
    await shot(`${name}-autumn-lunch.png`);

    // Elevated / water view + multi-frame water stability
    const waterStability = await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      const gl = a.pixel.renderer.getContext();
      const read = () => { const p = new Uint8Array(320 * 180 * 4); gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      a.setView(${JSON.stringify(elevView)}); a.setHour(12); a.controls.settle();
      const frames = [];
      for (const t of [0, 1.5, 3.0, 4.5, 6.0]) {
        a.setElapsed(t); for (let i = 0; i < 3; i++) a.step(0);
        frames.push(read());
      }
      const diff = (x, y) => {
        let changed = 0, max = 0, sum = 0;
        for (let i = 0; i < x.length; i += 4) {
          const d = Math.max(Math.abs(x[i]-y[i]), Math.abs(x[i+1]-y[i+1]), Math.abs(x[i+2]-y[i+2]));
          if (d) changed++; if (d > max) max = d; sum += d;
        }
        return { changedPixels: changed, maxChannelDiff: max, meanDiff: sum / (x.length / 4) };
      };
      const loopElev = diff(frames[0], frames[4]);
      const midDelta = diff(frames[0], frames[1]);
      a.setElapsed(0); a.step(0);
      return { view: ${JSON.stringify(elevView)}, loopElev, midDelta };
    })()`);
    await shot(`${name}-autumn-${elevView}.png`);

    // Autumn sunset
    const sunsetAutumn = await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      const gl = a.pixel.renderer.getContext();
      const read = () => { const p = new Uint8Array(320 * 180 * 4); gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      a.setView('sunset'); a.controls.settle();
      a.setElapsed(0); for (let i = 0; i < 12; i++) a.step(0);
      const sd = a.tod.state.sunDir;
      const p = a.camera.position.clone().addScaledVector(sd, 100).project(a.camera);
      const sx = (p.x * 0.5 + 0.5) * 320, sy = (p.y * 0.5 + 0.5) * 180;
      const px = read();
      let n = 0, sum = 0, bright = 0;
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
        const r = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (r >= 12 && r <= 48) {
          const o = (y * 320 + x) * 4;
          const lum = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
          sum += lum; if (lum > 0.7) bright++; n++;
        }
      }
      return { hour: a.tod.hour, count: n, mean: n ? sum / n : 0, brightRatio: n ? bright / n : 0, rays: a.pixel.uniforms.uRays.value, vol: a.pixel.uniforms.uVol.value, glError: gl.getError() };
    })()`);
    await shot(`${name}-autumn-sunset.png`);

    // Autumn night
    await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      a.setView('lunch'); a.setHour(21); a.controls.settle();
      a.setElapsed(0); for (let i = 0; i < 10; i++) a.step(0);
    })()`);
    await shot(`${name}-autumn-night.png`);

    // Tree shade view (autumn 14:00, positioned on shadow side looking at trunk + canopy + dappled ground)
    await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      const trees = a.data.trees || [];
      if (trees.length) {
        const t = [...trees].sort((x, y) => Math.hypot(x.x - a.data.sheet.x, x.z - a.data.sheet.z) - Math.hypot(y.x - a.data.sheet.x, y.z - a.data.sheet.z))[0];
        a.setHour(14);
        a.tod.update(0);
        const sd = a.tod.state.sunDir;
        const hx = Math.hypot(sd.x, sd.z) || 1;
        const sx = -sd.x / hx, sz = -sd.z / hx;
        // Stand 8 m away perpendicular+shadow side so both canopy and dappled ground shadow fill the frame
        a.player.x = t.x + sx * 6.5 - sz * 3.5;
        a.player.z = t.z + sz * 6.5 + sx * 3.5;
        const tx = t.x + sx * 2.5, tz = t.z + sz * 2.5;
        a.player.yaw = Math.atan2(a.player.x - tx, a.player.z - tz);
        a.player.pitch = -0.18;
        a.controls.setEye(2.0, true);
        a.controls.settle();
        a.setElapsed(0); for (let i = 0; i < 10; i++) a.step(0);
      }
    })()`);
    await shot(`${name}-autumn-shade.png`);

    // 2. Summer season (lunch 15:00 + sunset)
    await loadSeason('summer');
    await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      a.setView('lunch'); a.setHour(15); a.controls.settle();
      a.setElapsed(0); for (let i = 0; i < 10; i++) a.step(0);
    })()`);
    await shot(`${name}-summer-lunch.png`);

    const sunsetSummer = await evalJS(`(() => {
      const a = window[${JSON.stringify(gName)}];
      const gl = a.pixel.renderer.getContext();
      const read = () => { const p = new Uint8Array(320 * 180 * 4); gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      a.setView('sunset'); a.controls.settle();
      a.setElapsed(0); for (let i = 0; i < 12; i++) a.step(0);
      const sd = a.tod.state.sunDir;
      const p = a.camera.position.clone().addScaledVector(sd, 100).project(a.camera);
      const sx = (p.x * 0.5 + 0.5) * 320, sy = (p.y * 0.5 + 0.5) * 180;
      const px = read();
      let n = 0, sum = 0, bright = 0;
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
        const r = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (r >= 12 && r <= 48) {
          const o = (y * 320 + x) * 4;
          const lum = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
          sum += lum; if (lum > 0.7) bright++; n++;
        }
      }
      return { hour: a.tod.hour, count: n, mean: n ? sum / n : 0, brightRatio: n ? bright / n : 0, rays: a.pixel.uniforms.uRays.value, vol: a.pixel.uniforms.uVol.value };
    })()`);
    await shot(`${name}-summer-sunset.png`);

    // 3. Optional export test (PNG + 6s video)
    let exportCheck = null;
    if (runExport && ['edogawa', 'nagisa'].includes(name)) {
      exportCheck = await evalJS(`(async () => {
        const a = window[${JSON.stringify(gName)}];
        a.setView('lunch'); a.setHour(12); a.controls.settle();
        a.pixel.setFixedSize(null); a.step(0);
        const normalSize = { ...a.pixel.size };
        const png = await a.capture.png('pq-validation');
        const pngBlob = await fetch(png.url).then(r => r.blob());
        const bmp = await createImageBitmap(pngBlob);
        const pngInfo = { mime: pngBlob.type, bytes: pngBlob.size, width: bmp.width, height: bmp.height, stateAfter: a.capture.state, restoredSize: { ...a.pixel.size } };
        bmp.close(); png.dispose();

        let timer;
        let videoInfo;
        try {
          const p = a.capture.startVideo({ duration: 6, filename: 'pq-validation', onProgress: () => {} });
          timer = setInterval(() => a.step(1 / 60), 16);
          const v = await p;
          const vBlob = await fetch(v.url).then(r => r.blob());
          const b64 = await new Promise(resolve => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result.split(',')[1]);
            rd.readAsDataURL(vBlob);
          });
          videoInfo = { mime: vBlob.type, bytes: vBlob.size, filename: v.filename, stateAfter: a.capture.state, restoredSize: { ...a.pixel.size }, b64 };
          v.dispose();
        } finally { clearInterval(timer); }
        return { normalSize, pngInfo, videoInfo };
      })()`);
      const ext = exportCheck.videoInfo.mime.includes('mp4') ? 'mp4' : 'webm';
      fs.writeFileSync(path.join(outDir, `${name}-6s.${ext}`), Buffer.from(exportCheck.videoInfo.b64, 'base64'));
      delete exportCheck.videoInfo.b64;
    }

    assert.equal(errors.length, 0, `${name} JS/WebGL errors: ${errors.join('; ')}`);
    assert.equal(autumnReport.meta.glError, 0, `${name} GL error`);
    assert.equal(autumnReport.loopCheck.changed, 0, `${name} 6s loop mismatch`);
    assert.equal(waterStability.loopElev.changedPixels, 0, `${name} elevated 6s loop mismatch`);

    return {
      name,
      ...autumnReport,
      waterStability,
      sunsetAutumn,
      sunsetSummer,
      exportCheck,
      errors
    };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

function buildComparisonHtml() {
  const stages = ['before', 'stage-a', 'stage-b', 'after'].filter(s => fs.existsSync(path.join(OUT_ROOT, s)));
  const rows = [];
  for (const name of ['edogawa', 'nagisa', 'myoden', 'myoden-far']) {
    const elev = ELEVATED_VIEW[name];
    for (const view of ['autumn-lunch', `autumn-${elev}`, 'autumn-sunset', 'autumn-night', 'autumn-shade', 'summer-lunch', 'summer-sunset']) {
      const cells = stages.map(s => {
        const f = `${s}/${name}-${view}.png`;
        return fs.existsSync(path.join(OUT_ROOT, f))
          ? `<td><div>${s}</div><img src="${f}" width="320"></td>`
          : '<td>-</td>';
      }).join('');
      rows.push(`<tr><th>${name}<br>${view}</th>${cells}</tr>`);
    }
  }
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>Pixel Quality Validation</title>
  <style>body{font-family:sans-serif;background:#111;color:#eee;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #333;padding:6px;text-align:center;vertical-align:top}img{display:block;image-rendering:pixelated}</style>
  </head><body><h1>実在 4 場面ドット絵 質感調整 比較</h1><table>${rows.join('\n')}</table></body></html>\n`;
  fs.writeFileSync(path.join(OUT_ROOT, 'index.html'), html);
}

(async () => {
  const outDir = path.join(OUT_ROOT, stage);
  fs.mkdirSync(outDir, { recursive: true });
  const { server, port } = await startServer();
  const { proc, profile, wsUrl } = await launchChrome();
  let cdp = null;
  try {
    cdp = new CDP(wsUrl);
    await cdp.ready;
    const scenes = [];
    for (const name of pagesFilter) {
      const res = await runOnPage(cdp, port, name, outDir);
      scenes.push(res);
      console.log(JSON.stringify({
        stage, name,
        gpuMs: res.gpuNoon.medianGpuMs,
        loopChanged: res.loopCheck.changed,
        sunsetAutumnMean: Number(res.sunsetAutumn.mean.toFixed(4)),
        sunsetAutumnBright: Number((res.sunsetAutumn.brightRatio * 100).toFixed(2)),
        sunsetSummerMean: Number(res.sunsetSummer.mean.toFixed(4)),
        sunsetSummerBright: Number((res.sunsetSummer.brightRatio * 100).toFixed(2)),
        errors: res.errors.length
      }));
    }
    const summary = { stage, date: new Date().toISOString(), scenes };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    buildComparisonHtml();
  } finally {
    if (cdp) cdp.close();
    const exited = new Promise(resolve => proc.once('exit', resolve));
    proc.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
