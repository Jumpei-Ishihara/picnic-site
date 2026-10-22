const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createExportServer } = require('../tools/export-bridge.cjs');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picnic-test-'));
  const server = await createExportServer({ directory: dir, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, origin = 'http://localhost:8790';
  const token = (await (await fetch(base + '/session', { headers: { Origin: origin } })).json()).token;
  const headers = { Origin: origin, 'X-Picnic-Token': token, 'Content-Type': 'image/png' };
  const post = (name, body = PNG, extra = {}) => fetch(base + name, { method: 'POST', headers, body, ...extra });
  return { dir, base, token, headers, post, server };
}
test('rejects unauthorized origins, hosts, sessions and GET writes', async t => {
  const { base, headers, dir } = await setup(t);
  for (const h of [{}, { Origin: 'null' }, { Origin: 'https://untrusted.example' }]) assert.equal((await fetch(base + '/session', { headers: h })).status, 403);
  const badHost = await new Promise(resolve => { require('node:http').get(base + '/session', { headers: { Origin: headers.Origin, Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }); });
  assert.equal(badHost, 403);
  assert.equal((await fetch(base + '/save-png', { headers })).status, 405);
  assert.equal((await fetch(base + '/save-blob?filename=x.png', { method: 'POST', headers: { ...headers, 'X-Picnic-Token': 'bad' }, body: PNG })).status, 403);
  assert.deepEqual(await fs.readdir(dir), []);
});
test('checks names, modes, media type and JSON', async t => {
  const { post, headers, dir } = await setup(t);
  for (const name of ['../x.png', 'a\\b.png', '/x.png', 'x.txt', 'x\0.png']) assert.equal((await post('/save-blob?filename=' + encodeURIComponent(name))).status, 400);
  assert.equal((await post('/save-blob?filename=x.png', Buffer.from('not png'))).status, 400);
  for (const body of ['null', '{', '{"mode":"x/../../outside"}', '{"duration":"Infinity"}']) assert.equal((await post('/save-video', body, { headers: { ...headers, 'Content-Type': 'application/json' } })).status, 400);
  assert.deepEqual(await fs.readdir(dir), []);
});
test('publishes unique names and never overwrites existing files or symlinks', async t => {
  const { post, dir } = await setup(t);
  await fs.writeFile(path.join(dir, 'same.png'), 'keep');
  await fs.symlink(path.join(dir, 'same.png'), path.join(dir, 'link.png'));
  for (const name of ['same.png', 'same.png', 'link.png']) {
    const r = await post('/save-blob?filename=' + name); assert.equal(r.status, 200);
    const j = await r.json(); assert.equal(j.mime, 'image/png'); assert.notEqual(j.filename, name);
    assert.deepEqual(await fs.readFile(path.join(dir, j.filename)), PNG);
    assert.equal(j.path, undefined);
  }
  assert.equal(await fs.readFile(path.join(dir, 'same.png'), 'utf8'), 'keep');
  assert.ok((await fs.lstat(path.join(dir, 'link.png'))).isSymbolicLink());
});
test('limits declared and chunked uploads and cleans up', async t => {
  const { post, dir } = await setup(t, { maxUploadBytes: 16 });
  assert.equal((await post('/save-blob?filename=x.png', Buffer.alloc(17))).status, 413);
  const stream = new ReadableStream({ start(c) { c.enqueue(PNG); c.enqueue(PNG); c.close(); } });
  assert.equal((await post('/save-blob?filename=x.png', stream, { duplex: 'half' })).status, 413);
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(await fs.readdir(dir), []);
});
test('encoder failure does not publish an mp4', async t => {
  const { post, headers, dir } = await setup(t, { ffmpegBin: '/does-not-exist' });
  const webm = Buffer.from('1a45dfa30000000000000000', 'hex');
  const r = await post('/save-blob?filename=test.webm&convert=mp4', webm, { headers: { ...headers, 'Content-Type': 'video/webm' } });
  assert.equal(r.status, 422); assert.equal((await r.json()).ok, false);
  await new Promise(r => setTimeout(r, 30)); assert.deepEqual(await fs.readdir(dir), []);
});
test('busy jobs preserve health responsiveness and time out cleanly', async t => {
  const scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picnic-job-'));
  const jobScript = path.join(scriptDir, 'hang.cjs'); await fs.writeFile(jobScript, 'process.on("message",()=>{});setInterval(()=>{},1000);');
  t.after(() => fs.rm(scriptDir, { recursive: true, force: true }));
  const { post, base, headers, dir } = await setup(t, { jobScript, jobTimeoutMs: 300 });
  const pending = post('/save-blob?filename=x.webm&convert=mp4', Buffer.from('1a45dfa30000000000000000', 'hex'), { headers: { ...headers, 'Content-Type': 'video/webm' } });
  await new Promise(r => setTimeout(r, 70));
  assert.equal((await fetch(base + '/health', { headers })).status, 200);
  assert.equal((await post('/save-blob?filename=x.png')).status, 429);
  assert.equal((await pending).status, 504);
  await new Promise(r => setTimeout(r, 100)); assert.deepEqual(await fs.readdir(dir), []);
});
test('real ffmpeg conversion produces a playable H.264 MP4', async t => {
  const { spawnSync } = require('node:child_process');
  const bin = '/opt/homebrew/bin/ffmpeg', probe = '/opt/homebrew/bin/ffprobe';
  try { await fs.access(bin); await fs.access(probe); } catch { t.skip('ffmpeg/ffprobe unavailable'); return; }
  const { post, headers, dir } = await setup(t, { ffmpegBin: bin });
  const input = path.join(dir, 'test-source.webm');
  const generated = spawnSync(bin, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=10', '-t', '0.2', '-c:v', 'libvpx-vp9', input]);
  assert.equal(generated.status, 0, generated.stderr.toString());
  const r = await post('/save-blob?filename=test.webm&convert=mp4', await fs.readFile(input), { headers: { ...headers, 'Content-Type': 'video/webm' } });
  assert.equal(r.status, 200); const j = await r.json();
  const info = spawnSync(probe, ['-v', 'error', '-show_streams', '-of', 'json', path.join(dir, j.filename)]);
  assert.equal(info.status, 0); const stream = JSON.parse(info.stdout).streams[0];
  assert.equal(stream.codec_name, 'h264'); assert.equal(stream.width, 1280); assert.equal(stream.height, 720);
  assert.equal(j.mime, 'video/mp4'); assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('.picnic-export-')));
});
test('abandoned and stalled uploads release the lock and temporary files', async t => {
  const { base, headers, dir, post } = await setup(t, { receiveTimeoutMs: 80, jobTimeoutMs: 300 });
  const http = require('node:http');
  const stalled = await new Promise((resolve, reject) => {
    const req = http.request(base + '/save-blob?filename=x.png', { method: 'POST', headers: { ...headers, 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write(PNG);
  });
  assert.equal(stalled, 408);
  const aborted = http.request(base + '/save-blob?filename=x.png', { method: 'POST', headers: { ...headers, 'Transfer-Encoding': 'chunked' } });
  aborted.on('error', () => {}); aborted.write(PNG);
  await new Promise(r => setTimeout(r, 30)); aborted.destroy();
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(await fs.readdir(dir), []); assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});
test('rejects stale sessions and failed media parsing without publishing', async t => {
  const first = await setup(t); const second = await setup(t, { ffmpegBin: '/opt/homebrew/bin/ffmpeg' });
  assert.equal((await second.post('/save-blob?filename=x.png', PNG, { headers: { ...second.headers, 'X-Picnic-Token': first.token } })).status, 403);
  const res = await second.post('/save-blob?filename=x.webm&convert=mp4', Buffer.from('1a45dfa300000000', 'hex'), { headers: { ...second.headers, 'Content-Type': 'video/webm' } });
  assert.equal(res.status, 422); assert.deepEqual(await fs.readdir(second.dir), []);
});

test('timeout during publication rolls back the late final file and releases the lock', { timeout: 3000 }, async t => {
  let release, entered, mock;
  t.after(() => { release?.(); mock?.mock.restore(); });
  const { post, dir } = await setup(t, { jobTimeoutMs: 80 });
  const link = fs.link;
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  mock = t.mock.method(fs, 'link', async (...args) => { entered(); await gate; return link(...args); });
  const pending = post('/save-blob?filename=slow.png');
  await started;
  assert.equal((await pending).status, 504);
  release(); mock.mock.restore();
  await waitForEmpty(dir);
  assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});

async function waitForEmpty(dir) {
  for (let i = 0; i < 100; i++) {
    if (!(await fs.readdir(dir)).length) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.deepEqual(await fs.readdir(dir), []);
}

for (const phase of ['publication', 'cleanup']) test(`disconnect during ${phase} removes the published file`, { timeout: 3000 }, async t => {
  let release, entered, mock;
  t.after(() => { release?.(); mock?.mock.restore(); });
  const { dir, base, headers, post, server } = await setup(t);
  const method = phase === 'publication' ? 'link' : 'rm', original = fs[method];
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  mock = t.mock.method(fs, method, async (...args) => { entered(); await gate; return original(...args); });
  const disconnected = new Promise(r => server.once('request', (req, res) => res.once('close', r)));
  const req = require('node:http').request(base + '/save-blob?filename=disconnect.png', { method: 'POST', headers });
  req.on('error', () => {}); req.end(PNG);
  await started;
  const closed = new Promise(r => req.once('close', r));
  req.destroy(); await closed;
  await disconnected;
  release(); mock.mock.restore();
  await waitForEmpty(dir);
  assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});

for (const [method, code] of [['mkdtemp', 'EACCES'], ['link', 'ENOTSUP'], ['link', 'EIO']]) test(`${code} during ${method} returns failure without publishing and permits retry`, async t => {
  const { post, dir } = await setup(t);
  const mock = t.mock.method(fs, method, async () => { throw Object.assign(Error('injected filesystem fault'), { code }); });
  const response = await post('/save-blob?filename=fault.png');
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { ok: false, error: 'export_failed' });
  assert.deepEqual(await fs.readdir(dir), []);
  mock.mock.restore();
  assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});

test('ENOSPC after a partial write closes the file, removes temporary content and permits retry', async t => {
  const { post, dir } = await setup(t);
  const open = fs.open;
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args), write = handle.writeFile.bind(handle);
    t.mock.method(handle, 'writeFile', async chunk => { await write(chunk.subarray(0, 4)); throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); });
    return handle;
  });
  assert.equal((await post('/save-blob?filename=full.png')).status, 500);
  assert.deepEqual(await fs.readdir(dir), []);
  mock.mock.restore();
  assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});

test('real directory permission loss fails safely and works after permission restoration', async t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('requires unprivileged POSIX permissions'); return; }
  const { post, dir } = await setup(t);
  try {
    await fs.chmod(dir, 0o500);
    assert.equal((await post('/save-blob?filename=denied.png')).status, 500);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.chmod(dir, 0o700); }
  assert.equal((await post('/save-blob?filename=retry.png')).status, 200);
});

test('output size monitor stops a growing job without publishing', { timeout: 4000 }, async t => {
  const scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picnic-output-job-'));
  t.after(() => fs.rm(scriptDir, { recursive: true, force: true }));
  const jobScript = path.join(scriptDir, 'grow.cjs');
  await fs.writeFile(jobScript, 'process.on("message",j=>{require("node:fs").writeFileSync(j.output,Buffer.alloc(2048));setInterval(()=>{},1000);});');
  const { post, headers, dir } = await setup(t, { jobScript, maxOutputBytes: 1024, jobTimeoutMs: 2000 });
  const response = await post('/save-video', '{"duration":60}', { headers: { ...headers, 'Content-Type': 'application/json' } });
  assert.equal(response.status, 413); assert.equal((await response.json()).error, 'output_too_large');
  assert.deepEqual(await fs.readdir(dir), []);
});

test('POSIX timeout kills both rendering job and its encoder descendant', { timeout: 6000 }, async t => {
  if (process.platform === 'win32') { t.skip('POSIX process groups'); return; }
  const scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picnic-process-job-'));
  t.after(() => fs.rm(scriptDir, { recursive: true, force: true }));
  const marker = path.join(scriptDir, 'pids.json'), jobScript = path.join(scriptDir, 'tree.cjs');
  await fs.writeFile(jobScript, `process.on('message',()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);});`);
  const { post, headers, dir } = await setup(t, { jobScript, jobTimeoutMs: 800 });
  const response = await post('/save-video', '{"duration":60}', { headers: { ...headers, 'Content-Type': 'application/json' } });
  assert.equal(response.status, 504);
  const pids = JSON.parse(await fs.readFile(marker, 'utf8'));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
  for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(pids.every(pid => !alive(pid)), 'no rendering or encoder process remains');
  await waitForEmpty(dir);
});
