import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCapture } from '../engine/capture.js';
import { runWorkerTask } from '../engine/worker-task.js';
import { getQuality } from '../real/js/quality.js';
import { getSeason } from '../engine/season.js';
import { createBridgeClient } from '../engine/bridge-client.js';

test('Worker constructor/postMessage/runtime/timeout failures each fall back once', async () => {
  const original = globalThis.Worker;
  for (const kind of ['constructor', 'send', 'error', 'timeout', 'apply', 'success']) {
    let fallbacks = 0, terminated = 0;
    globalThis.Worker = class {
      constructor() { if (kind === 'constructor') throw Error('blocked'); }
      postMessage() {
        if (kind === 'send') throw Error('clone');
        queueMicrotask(() => {
          if (kind === 'error') this.onerror({ preventDefault() {} });
          if (kind === 'apply') this.onmessage({ data: 'bad' });
          if (kind === 'success') this.onmessage({ data: 'ok' });
        });
      }
      terminate() { terminated++; }
    };
    const result = await runWorkerTask({ url: 'test', job: {}, timeoutMs: 5, fallback: () => { fallbacks++; return 'ok'; }, apply: v => { if (v === 'bad') throw Error('bad pixels'); return v; } });
    assert.equal(result, 'ok', kind); assert.equal(fallbacks, kind === 'success' ? 0 : 1, kind);
    assert.equal(terminated, kind === 'constructor' ? 0 : 1, kind);
  }
  globalThis.Worker = class { constructor() { throw Error(); } };
  await assert.rejects(runWorkerTask({ fallback: () => { throw Error('fallback failed'); } }), /fallback failed/);
  globalThis.Worker = original;
});

test('inherited URL and storage keys never become quality/season settings', () => {
  globalThis.matchMedia = () => ({ matches: false }); globalThis.devicePixelRatio = 2;
  for (const value of ['constructor', '__proto__', 'toString', '', 'unknown']) {
    globalThis.location = { search: `?quality=${value}&season=${value}` };
    globalThis.localStorage = { getItem: () => value };
    assert.equal(getQuality().key, 'high'); assert.equal(getSeason().key, 'autumn');
  }
  globalThis.location = { search: '?quality=bad&season=bad' };
  globalThis.localStorage = { getItem: k => k.includes('quality') ? 'low' : 'winter' };
  assert.equal(getQuality().key, 'low'); assert.equal(getSeason().key, 'winter');
  globalThis.localStorage = { getItem() { throw Error('blocked'); } };
  assert.equal(getQuality().key, 'high'); assert.equal(getSeason('constructor').key, 'autumn');
});

function captureEnv({ constructorFails = false, startFails = false, nullPng = false, prepareVideo = () => {} } = {}) {
  let recorder, stopped = 0, revoked = [], fixed = [], clicks = 0, events = [];
  globalThis.fetch = async () => { throw Error('bridge unavailable'); };
  globalThis.URL.createObjectURL = () => 'blob:test'; globalThis.URL.revokeObjectURL = u => revoked.push(u);
  globalThis.document = {
    body: { appendChild() {} },
    createElement: kind => kind === 'canvas' ? { getContext: () => ({ drawImage() { events.push('copy'); } }), captureStream: () => { events.push('stream'); return { getTracks: () => [{ stop() { stopped++; } }] }; }, toBlob: f => f(nullPng ? null : new Blob(['png'], { type: 'image/png' })) } : { click() { clicks++; }, remove() {} }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported(m) { return m === 'video/webm'; }
    constructor() { if (constructorFails) throw Error('constructor failed'); recorder = this; this.state = 'inactive'; this.mimeType = 'video/webm'; }
    start() { if (startFails) throw Error('start failed'); this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['webm']) }); this.onstop?.(); }
  };
  const capture = createCapture({ canvas: {}, pixel: { setFixedSize: s => fixed.push(s) }, prepareVideo: () => { events.push('prepare'); prepareVideo(); }, renderOnce() { events.push('render'); } });
  return { capture, fixed, revoked, events, get stopped() { return stopped; }, get recorder() { return recorder; }, get clicks() { return clicks; } };
}
test('video first frame is prepared and copied before captureStream, even after PNG',async()=>{
  const e=captureEnv();const png=await e.capture.png('previous');png.dispose();e.events.length=0;
  const video=e.capture.startVideo({duration:6,filename:'loop'});
  assert.deepEqual(e.events.slice(0,4),['prepare','render','copy','stream']);e.capture.stopVideo();(await video).dispose();
});
test('failed first-pose preparation releases fixed size without starting a stream',async()=>{
  const e=captureEnv({prepareVideo(){throw Error('pose failed');}});
  await assert.rejects(e.capture.startVideo({duration:6,filename:'loop'}),/pose failed/);
  assert.equal(e.capture.state,'idle');assert.equal(e.fixed.at(-1),null);assert.ok(!e.events.includes('stream'));
});
test('capture releases state/resolution/tracks on constructor and start failures', async () => {
  for (const options of [{ constructorFails: true }, { startFails: true }]) {
    const e = captureEnv(options);
    await assert.rejects(e.capture.startVideo({ duration: 6, filename: 'test' }), /failed/);
    assert.equal(e.capture.busy, false); assert.equal(e.capture.recording, false);
    assert.equal(e.fixed.at(-1), null); assert.equal(e.stopped, 1);
    const result = await e.capture.png('retry'); result.dispose(); assert.equal(e.revoked.length, 1);
  }
});
test('recording errors settle once and recording can be retried', async () => {
  const e = captureEnv(); const p = e.capture.startVideo({ duration: 6, filename: 'test' });
  assert.equal(e.capture.busy, true); assert.equal(e.capture.recording, true);
  await assert.rejects(e.capture.png('busy'), /処理中/);
  e.recorder.onerror(); await assert.rejects(p, /エラー/);
  assert.equal(e.capture.state, 'idle'); assert.equal(e.stopped, 1);
  const next = e.capture.startVideo({ duration: 6, filename: 'retry' }); e.capture.stopVideo();
  const result = await next; assert.equal(result.filename, 'retry.webm'); assert.equal(e.capture.state, 'idle');
  result.dispose(); result.dispose(); assert.equal(e.revoked.length, 1); assert.equal(e.stopped, 2);
});
test('null PNG restores state and resolution', async () => {
  const e = captureEnv({ nullPng: true }); await assert.rejects(e.capture.png('test'), /PNG/);
  assert.equal(e.capture.state, 'idle'); assert.equal(e.fixed.at(-1), null);
});
test('bridge retries only rejected authentication, never an uncertain upload', async () => {
  let posts = 0, sessions = 0;
  const c = createBridgeClient({ fetcher: async (url, opts) => {
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ protocol: 2, token: String(++sessions) }) };
    posts++;
    if (posts === 1) return { status: 403, ok: false, json: async () => ({}) };
    throw Error('connection lost');
  } });
  const result = await c.upload(new Blob(['x'], { type: 'video/webm' }), 'x.webm');
  assert.equal(result.uncertain, true); assert.equal(posts, 2); assert.equal(sessions, 2);
});
test('shared export UI restores pre-recording state after failure and owns only latest result', async () => {
  const { createExportUI } = await import('../engine/export-ui.js');
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) { const classes = new Set(); elements.set(id, { disabled: false, textContent: '', classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle(v, enabled) { if (enabled) classes.add(v); else classes.delete(v); } }, append() {}, click() {} }); }
    return elements.get(id);
  }
  globalThis.document = { getElementById: element, createElement: () => ({}) };
  const tod = { auto: true }; element('t-auto').click = () => { tod.auto = !tod.auto; };
  element('help').classList.add('rec-hide');
  let disposed = 0, restores = 0, placed = 0, fail = false, traffic = false;
  const capture = { busy: false, recording: false, png: async () => { if (fail) throw Error('png'); return { filename: 'test.png', url: 'blob:test', dispose() { disposed++; } }; }, startVideo: async () => { throw Error('encoder'); } };
  const ui = createExportUI({ capture, controls: { marker: {} }, tod, toast: { show() {} }, note: element('note'), bridgeLabel: element('bridge'), panel: element('export'), recordingPanel: element('rec'), recordingTime: element('time'), fileBase: () => 'x', loop: 6, placePanel() { placed++; }, beforeRecord() { const was = traffic; traffic = false; return () => { traffic = was; restores++; }; } });
  await ui.png(); assert.equal(disposed, 0);
  fail = true; await ui.png(); assert.equal(disposed, 0);
  fail = false; await ui.png(); assert.equal(disposed, 1);
  await ui.record(1);
  assert.equal(tod.auto, true); assert.equal(traffic, false); assert.equal(restores, 1); assert.equal(placed, 1);
  assert.equal(element('rec').classList.contains('hidden'), true); assert.equal(element('help').classList.contains('rec-hide'), true);
  assert.equal(element('x-png').disabled, false); assert.equal(ui.busy, false);
  ui.dispose(); ui.dispose(); assert.equal(disposed, 2);
});
test('failed Worker rows produce exactly the same terrain pixels as a full bake', async () => {
  const { bakeGroundPixels } = await import('../engine/terrain-bake.js');
  const job = { N: { w: 5, h: 5, x0: -2, z0: -2 }, ppm: 8, groundCls: new Uint8Array(25), groundNames: ['lawn'], looks: { lawn: { c: ['#4f7a34', '#679142', '#86ad55'], pattern: 'grass' } } };
  const expected = bakeGroundPixels(job).data;
  const previous = globalThis.Worker; globalThis.Worker = class { constructor() { throw Error('blocked'); } };
  try {
    const rows = [[0, 11], [11, 22], [22, 32]];
    const parts = await Promise.all(rows.map(rows => runWorkerTask({ url: 'test', job: { ...job, rows }, fallback: bakeGroundPixels })));
    const actual = new Uint8ClampedArray(expected.length); let offset = 0;
    for (const part of parts) { actual.set(part.data, offset); offset += part.data.length; }
    assert.deepEqual(actual, expected);
  } finally { globalThis.Worker = previous; }
});
test('converted bridge results retain native extension for the Blob retry link', async () => {
  const e = captureEnv();
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => url.endsWith('/session') ? { protocol: 2, token: 'a'.repeat(64) } : { ok: true, filename: 'converted.mp4', mime: 'video/mp4' } });
  const result = await e.capture.save(new Blob(['webm'], { type: 'video/webm' }), 'native.webm');
  assert.equal(result.filename, 'converted.mp4'); assert.equal(result.downloadFilename, 'native.webm'); assert.equal(result.sourceMime, 'video/webm'); result.dispose();
});

test('availability probes health after cached authentication and clears stale tokens', async () => {
  let online = true, sessions = 0, health = 0, protocol = 2;
  const client = createBridgeClient({ fetcher: async (url, options) => {
    if (!online) throw Error('stopped');
    if (url.endsWith('/health')) { health++; assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => ({ ok: true, protocol }) }; }
    if (url.endsWith('/session')) { sessions++; return { ok: true, json: async () => ({ protocol: 2, token: String(sessions) }) }; }
    return { ok: true, json: async () => ({ ok: true, filename: 'saved.png' }) };
  } });
  const blob = new Blob(['png'], { type: 'image/png' });
  assert.equal((await client.upload(blob, 'x.png')).ok, true);
  assert.equal(await client.available(), true);
  online = false; assert.equal(await client.available(), false);
  online = true; assert.equal(await client.available(), true);
  assert.equal((await client.upload(blob, 'x.png')).ok, true);
  assert.equal(sessions, 2); assert.equal(health, 2);
  protocol = 1; assert.equal(await client.available(), false);
});

test('startup error removes the start overlay and provides a visible working retry', async () => {
  const { showStartupError } = await import('../engine/ui.js');
  const classes = () => { const set = new Set(); return { add: s => set.add(s), remove: s => set.delete(s), contains: s => set.has(s) }; };
  let reloads = 0, button;
  const loading = { classList: classes(), style: {}, setAttribute(k, v) { this[k] = v; }, append(el) { button = el; } };
  loading.classList.add('hidden');
  const start = { classList: classes() };
  globalThis.document = { getElementById: id => ({ loading, start })[id], createElement: () => ({ addEventListener(k, f) { this[k] = f; } }) };
  globalThis.location = { reload() { reloads++; } };
  const log = console.error; console.error = () => {};
  try { showStartupError(Error('both worker and fallback failed')); } finally { console.error = log; }
  assert.equal(start.classList.contains('hidden'), true);
  assert.equal(loading.classList.contains('hidden'), false); assert.equal(loading.role, 'alert'); assert.equal(loading.style.zIndex, '1000');
  assert.equal(button.textContent, '再読み込み'); button.click(); assert.equal(reloads, 1);
});

test('legacy status distinguishes confirmed, failed and uncertain results and rejects stale completion', async () => {
  const { updateLegacyExportStatus } = await import('../engine/legacy-export.js');
  for (const result of [{ ok: true, filename: 'actual-uuid.mp4' }, { ok: false, unavailable: true }, { ok: false, error: 'conversion_failed' }, { ok: false, uncertain: true }]) {
    const title = {}, hint = {};
    await updateLegacyExportStatus({ title, hint, filename: 'native.webm', result, isCurrent: () => true });
    if (result.ok) assert.match(title.textContent, /actual-uuid\.mp4/);
    else { assert.doesNotMatch(title.textContent, /保存しました/); assert.match(hint.textContent, /ブラウザ/); }
    if (result.uncertain) assert.match(title.textContent, /結果を確認できません/);
  }
  let finish, current = true; const title = {}, hint = {};
  const pending = updateLegacyExportStatus({ title, hint, filename: 'old.png', result: new Promise(r => { finish = r; }), isCurrent: () => current });
  current = false; title.textContent = 'new.png'; finish({ ok: true, filename: 'old-uuid.png' }); await pending;
  assert.equal(title.textContent, 'new.png');
});

test('shared picnic shell renders required HUD, menu, export and start IDs with escaping', async () => {
  const { renderPicnicShellHTML, mountPicnicShell } = await import('../engine/shell.js');
  const html = renderPicnicShellHTML({
    loadingText: '読み込み中<test>',
    locationLabel: '📍 テスト公園',
    helpText: 'WASD & ドラッグ',
    dockButtons: [{ id: 'v-lunch', label: '🧺', title: '拠点', ariaLabel: '拠点' }],
    detourButtons: [{ id: 'v-pony', label: '🐴 ポニー' }],
    creditHtml: 'テスト出典',
    exportNote: '1280×720',
    startCard: {
      title: 'テスト',
      paragraphs: ['説明文'],
      buttons: [{ id: 's-lunch', label: '座る' }],
      hint: 'ヒント'
    }
  });
  for (const id of ['view', 'loading', 'loc', 'toast', 'help', 'joy', 'bar', 'v-lunch', 'a-export', 'o-more', 'menu', 'v-pony', 'season-row', 'export', 'rec', 'start', 's-lunch']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /読み込み中&lt;test&gt;/);
  assert.match(html, /WASD &amp; ドラッグ/);
  let inserted = null;
  mountPicnicShell({ loadingText: 'ok', locationLabel: 'loc', helpText: '', dockButtons: [], creditHtml: '', exportNote: '', startCard: { title: '', paragraphs: [], buttons: [], hint: '' } }, {
    insertAdjacentHTML(pos, content) { inserted = { pos, content }; }
  });
  assert.equal(inserted.pos, 'afterbegin');
  assert.match(inserted.content, /id="view"/);
});

test('bridge client packs length-prefixed PNG frames and posts to /save-frames', async () => {
  const { createBridgeClient, packFrames } = await import('../engine/bridge-client.js');
  const a = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const b = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 2, 3]);
  const packed = packFrames([a, b]);
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  assert.equal(packed.byteLength, 4 + a.length + 4 + b.length);
  assert.equal(view.getUint32(0, false), a.length);
  assert.equal(view.getUint32(4 + a.length, false), b.length);
  let captured = null;
  const client = createBridgeClient({
    fetcher: async (url, init) => {
      if (url.endsWith('/session')) return { ok: true, status: 200, json: async () => ({ ok: true, protocol: 2, token: 'a'.repeat(64) }) };
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ ok: true, filename: 'clip-1.mp4', mime: 'video/mp4' }) };
    }
  });
  const res = await client.uploadFrames([a, b], 'clip.mp4', 30);
  assert.equal(res.ok, true);
  assert.equal(res.filename, 'clip-1.mp4');
  assert.match(captured.url, /\/save-frames\?filename=clip\.mp4&fps=30$/);
  assert.equal(captured.init.headers['Content-Type'], 'application/x-picnic-frames');
  assert.equal(captured.init.body.byteLength, packed.byteLength);
});

test('capture uses fixed-timestep renderAt over bridge when available and falls back when unavailable', async () => {
  const { createCapture } = await import('../engine/capture.js');
  const origDoc = globalThis.document, origURL = globalThis.URL, origMR = globalThis.MediaRecorder;
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  const makeFakeCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, imageSmoothingEnabled: true }),
    toBlob: (cb) => cb(new Blob([fakePng], { type: 'image/png' })),
    captureStream: () => ({ getTracks: () => [{ stop() {} }] })
  });
  globalThis.document = {
    createElement: tag => tag === 'canvas' ? makeFakeCanvas() : { click() {}, remove() {}, set href(_) {}, set download(_) {} },
    body: { appendChild() {} }
  };
  globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL() {} };
  try {
    const sizes = [], times = [], progress = [];
    let uploaded = null;
    const fakeBridge = {
      available: async () => true,
      upload: async () => ({ ok: false, unavailable: true }),
      uploadFrames: async (frames, filename, fps) => { uploaded = { count: frames.length, filename, fps }; return { ok: true, filename: 'fixed-uuid.mp4', mime: 'video/mp4' }; }
    };
    const cap = createCapture({
      canvas: {},
      pixel: { setFixedSize: s => sizes.push(s) },
      renderOnce: () => {},
      renderAt: t => times.push(t),
      fps: 10,
      bridge: fakeBridge
    });
    const res = await cap.startVideo({ duration: 0.5, filename: 'fixed', onProgress: (t, d) => progress.push([t, d]) });
    assert.equal(res.where, 'downloads');
    assert.equal(res.filename, 'fixed-uuid.mp4');
    assert.equal(cap.state, 'idle');
    assert.deepEqual(times, [0, 0.1, 0.2, 0.3, 0.4]);
    assert.deepEqual(uploaded, { count: 5, filename: 'fixed.mp4', fps: 10 });
    assert.deepEqual(sizes[0], { width: 320, height: 180 });
    assert.equal(sizes[sizes.length - 1], null);
    assert.equal(progress.length, 5);

    // Cancellation mid-loop restores fixed size and idle state.
    let cancelCap;
    cancelCap = createCapture({
      canvas: {},
      pixel: { setFixedSize: s => sizes.push(s) },
      renderOnce: () => {},
      renderAt: t => { if (t >= 0.1) cancelCap.stopVideo(); },
      fps: 10,
      bridge: fakeBridge
    });
    await assert.rejects(() => cancelCap.startVideo({ duration: 0.5, filename: 'cancel' }), /中止/);
    assert.equal(cancelCap.state, 'idle');
    assert.equal(sizes[sizes.length - 1], null);
  } finally {
    globalThis.document = origDoc; globalThis.URL = origURL; globalThis.MediaRecorder = origMR;
  }
});
