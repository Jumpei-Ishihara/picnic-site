// Local export protocol 2. Importable without listening or writing to Downloads.
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { fork, spawn } = require('node:child_process');

class BridgeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new BridgeError(status, code); };
const MIME = { '.png': 'image/png', '.webm': 'video/webm', '.mp4': 'video/mp4' };
function validateName(name) {
  if (typeof name !== 'string' || Buffer.byteLength(name, 'utf8') > 160 || !name || /[\\/:<>"|?*\x00-\x1f\x7f]/u.test(name) || name === '.' || name === '..' || !MIME[path.extname(name)]) fail(400, 'invalid_filename');
  return name;
}
function mediaType(head) {
  if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (head.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) return 'video/webm';
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  fail(400, 'invalid_media');
}
function renderOptions(body) {
  const mode = body.mode ?? 'day';
  if (!['day', 'sunset', 'night'].includes(mode)) fail(400, 'invalid_mode');
  const num = (key, initial, min, max) => {
    const raw = body[key] ?? initial;
    if (typeof raw !== 'number' && typeof raw !== 'string') fail(400, 'invalid_number');
    if ((typeof raw === 'string' && !raw.trim()) || !Number.isFinite(Number(raw)) || Number(raw) < min || Number(raw) > max) fail(400, 'invalid_number');
    return Number(raw);
  };
  return { mode, t: num('t', 1.2, 0, 3600), duration: num('duration', 6, 0.5, 60), light: num('light', 1, 0, 4), wave: num('wave', 1, 0, 4), caustics: num('caustics', 1, 0, 4) };
}
function runJob(job, signal, { jobScript = path.join(__dirname, 'export-job.cjs'), maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    const child = fork(jobScript, [], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false, message = null;
    const stop = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); } } catch { /* already exited */ }
    };
    const onAbort = () => { stop(); finish(signal.reason || new BridgeError(504, 'job_timeout')); };
    const monitor = setInterval(async () => {
      try { const info = await fsp.stat(job.output); if (!settled && info.size > maxOutputBytes) { stop(); finish(new BridgeError(413, 'output_too_large')); } } catch { /* output not created yet */ }
    }, 100);
    function finish(error) {
      if (settled) return;
      settled = true; clearInterval(monitor); signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    }
    child.on('message', value => { message = value; });
    child.on('error', () => finish(new BridgeError(422, 'encoder_unavailable')));
    child.on('exit', (code, sig) => {
      if (process.env.EXPORT_DEBUG === '1' && message?.diagnostic) console.error(message.diagnostic);
      finish(code === 0 && !sig && message?.ok ? null : new BridgeError(422, 'conversion_failed'));
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else child.send(job, error => { if (error) { stop(); finish(new BridgeError(422, 'job_failed')); } });
  });
}
async function publish(source, directory, name, signal) {
  validateName(name);
  for (let n = 0; n < 5; n++) {
    const ext = path.extname(name), stem = name.slice(0, -ext.length);
    const filename = `${stem}-${crypto.randomUUID()}${ext}`;
    const dest = path.resolve(directory, filename), rel = path.relative(directory, dest);
    if (rel.startsWith('..') || path.isAbsolute(rel) || path.dirname(dest) !== directory) fail(400, 'invalid_filename');
    if (signal?.aborted) throw signal.reason;
    try { await fsp.link(source, dest); }
    catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    // Work files live on the destination filesystem. A link publishes atomically
    // without overwriting; cancellation while the syscall was pending rolls it back.
    if (signal?.aborted) { await fsp.unlink(dest); throw signal.reason; }
    return filename;
  }
  fail(500, 'filename_conflict');
}
async function createExportServer({ directory, port = 18923, origins = ['http://localhost:8790', 'http://127.0.0.1:8790'], maxUploadBytes = 64 * 1024 ** 2, maxOutputBytes = 128 * 1024 ** 2, jobTimeoutMs = 120000, receiveTimeoutMs = 30000, ffmpegBin = 'ffmpeg', jobScript } = {}) {
  await fsp.mkdir(directory, { recursive: true });
  directory = await fsp.realpath(directory);
  const allowed = new Set(origins.map(o => { const u = new URL(o); if (!['http:', 'https:'].includes(u.protocol) || u.origin !== o) throw Error('Invalid allowed origin'); return u.origin; }));
  const token = crypto.randomBytes(32).toString('hex');
  let busy = false;
  const active = new Set();
  const server = http.createServer(async (req, res) => {
    let reply = null;
    const json = (status, data, flush = false) => { if (locked && !flush && !controller?.signal.aborted) { reply = [status, data]; return; } if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json', ...(status >= 400 ? { Connection: 'close' } : {}) }); res.end(JSON.stringify(data)); } };
    let work, controller, receiveTimer, jobTimer, published, locked = false;
    try {
      const actualPort = server.address()?.port ?? port;
      if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(req.headers.host) || !allowed.has(req.headers.origin)) fail(403, 'forbidden_origin');
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (!['/health', '/session', '/save-blob', '/save-png', '/save-video'].includes(url.pathname)) fail(404, 'not_found');
      if (req.method === 'OPTIONS') {
        if (req.headers['access-control-request-method'] && req.headers['access-control-request-method'] !== 'POST') fail(405, 'method_not_allowed');
        const headers = (req.headers['access-control-request-headers'] || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
        if (headers.some(h => !['content-type', 'x-picnic-token'].includes(h))) fail(403, 'forbidden_header');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Picnic-Token' }); res.end(); return;
      }
      if (url.pathname === '/health' || url.pathname === '/session') {
        if (req.method !== 'GET') fail(405, 'method_not_allowed');
        json(200, { ok: true, protocol: 2, ...(url.pathname === '/session' ? { token } : {}) }); return;
      }
      if (req.method !== 'POST') fail(405, 'method_not_allowed');
      const supplied = req.headers['x-picnic-token'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) fail(403, 'invalid_session');
      if (busy) fail(429, 'busy');
      const isBlob = url.pathname === '/save-blob', limit = isBlob ? maxUploadBytes : 4096;
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, 'upload_too_large');
      const name = isBlob ? validateName(url.searchParams.get('filename')) : null;
      const convert = url.searchParams.get('convert');
      if (convert && convert !== 'mp4') fail(400, 'invalid_conversion');
      if (convert && path.extname(name || '') === '.png') fail(400, 'invalid_conversion');
      if (!isBlob && (req.headers['content-type'] || '').split(';')[0] !== 'application/json') fail(400, 'invalid_content_type');
      busy = locked = true;
      controller = new AbortController(); active.add(controller);
      const abort = reason => { if (!controller.signal.aborted) controller.abort(reason); };
      res.on('close', () => { if (!res.writableFinished) { abort(new BridgeError(499, 'client_disconnected')); req.destroy(); } });
      jobTimer = setTimeout(() => { abort(new BridgeError(504, 'job_timeout')); json(504, { ok: false, error: 'job_timeout' }); if (!req.complete) res.once('finish', () => req.destroy()); }, jobTimeoutMs);
      receiveTimer = setTimeout(() => { abort(new BridgeError(408, 'receive_timeout')); json(408, { ok: false, error: 'receive_timeout' }); res.once('finish', () => req.destroy()); }, receiveTimeoutMs);
      work = await fsp.mkdtemp(path.join(directory, '.picnic-export-'));
      const input = path.join(work, 'input'), output = path.join(work, 'output.mp4');
      const file = await fsp.open(input, 'wx'); let bytes = 0, head = Buffer.alloc(0);
      try {
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          if (controller.signal.aborted) throw controller.signal.reason;
          bytes += chunk.length;
          if (bytes > limit) fail(413, 'upload_too_large');
          if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
          await file.writeFile(chunk);
        }
      } finally { await file.close(); clearTimeout(receiveTimer); }
      if (controller.signal.aborted) throw controller.signal.reason;
      let resultName, mime, source = input;
      if (isBlob) {
        mime = mediaType(head);
        if (mime !== MIME[path.extname(name)] || (req.headers['content-type'] || '').split(';')[0] !== mime) fail(400, 'media_type_mismatch');
        resultName = name;
        if (convert === 'mp4') {
          await runJob({ kind: 'convert', input, output, ffmpegBin, maxOutputBytes }, controller.signal, { maxOutputBytes, jobScript });
          source = output; mime = 'video/mp4'; resultName = name.replace(/\.(webm|mp4)$/, '.mp4');
        }
      } else {
        let body; try { body = JSON.parse(await fsp.readFile(input, 'utf8')); } catch { fail(400, 'invalid_json'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'invalid_json');
        const options = renderOptions(body), video = url.pathname === '/save-video';
        mime = video ? 'video/mp4' : 'image/png';
        resultName = `riverside-picnic-${options.mode}${video ? `-${options.duration}s.mp4` : '.png'}`;
        await runJob({ kind: video ? 'video' : 'png', options, output, ffmpegBin, maxOutputBytes }, controller.signal, { maxOutputBytes, jobScript }); source = output;
      }
      const info = await fsp.stat(source);
      if (!info.size) fail(422, 'empty_output');
      if (info.size > maxOutputBytes) fail(413, 'output_too_large');
      if (controller.signal.aborted) throw controller.signal.reason;
      const filename = published = await publish(source, directory, resultName, controller.signal);
      json(200, { ok: true, filename, mime });
    } catch (e) { json(e.status || 500, { ok: false, error: e.code && e instanceof BridgeError ? e.code : 'export_failed' }); }
    finally {
      clearTimeout(receiveTimer); clearTimeout(jobTimer);
      if (controller) active.delete(controller);
      if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      // A disconnect during temporary-file cleanup must not leave a saved file.
      if (published && controller.signal.aborted) await fsp.unlink(path.join(directory, published)).catch(() => {});
      if (locked) busy = false;
      if (reply) json(...reply, true);
    }
  });
  server.requestTimeout = receiveTimeoutMs;
  server.on('close', () => { for (const c of active) c.abort(new BridgeError(503, 'server_closed')); });
  return server;
}
async function generateLegacy(directory, ffmpegBin = 'ffmpeg') {
  await fsp.mkdir(directory, { recursive: true }); directory = await fsp.realpath(directory);
  const work = await fsp.mkdtemp(path.join(directory, '.picnic-export-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new BridgeError(504, 'job_timeout')), 120000);
  try {
    for (const kind of ['png', 'video']) {
      const output = path.join(work, kind === 'png' ? 'output.png' : 'output.mp4');
      await runJob({ kind, options: renderOptions({}), output, ffmpegBin, maxOutputBytes: 128 * 1024 ** 2 }, controller.signal, { maxOutputBytes: 128 * 1024 ** 2 });
      console.log(await publish(output, directory, `riverside-picnic-day.${kind === 'png' ? 'png' : 'mp4'}`, controller.signal));
    }
  } finally { clearTimeout(timer); await fsp.rm(work, { recursive: true, force: true }); }
}
module.exports = { createExportServer, generateLegacy, validateName, mediaType, renderOptions };
