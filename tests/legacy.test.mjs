import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { updateLegacyExportStatus } from '../engine/legacy-export.js';

function pageFunction(src, name) {
  const start = src.indexOf(`    function ${name}(`);
  const end = src.indexOf('\n    function ', start + 1);
  return src.slice(start, end);
}
for (const page of ['pixelart_2d', 'picnic_3d']) test(`${page} reports real bridge outcomes and preserves native WebM download`, async () => {
  const src = await fs.readFile(new URL(`../legacy/${page}.html`, import.meta.url), 'utf8');
  const three = page === 'picnic_3d';
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '6', classList: { add() {}, remove() {} }, pause() {}, play: async () => {} });
    return elements.get(id);
  };
  let recorder, serial = 0, outcome, calls = [], downloads = [];
  const bridgeClient = { generate: async (kind, options) => { calls.push([kind, options]); return outcome; }, upload: async (blob, filename) => { calls.push([blob, filename]); return outcome; } };
  const scope = {
    document: { getElementById: element }, URL: { createObjectURL: () => `blob:${++serial}`, revokeObjectURL() {} }, Blob, performance,
    bridgeModule: Promise.resolve({ bridgeClient, updateLegacyExportStatus }),
    lastExportUrl: null, lastExportBlob: null, W: 320, H: 180, currentMode: 'day', timeOfDay: 0,
    lightIntensity: 1, waveIntensity: 1, causticsIntensity: 1, durationInput: element('input-duration'), LOOP_PERIOD: 6,
    ripples: [], skippingStones: [], jumpingFish: [], time: 0, exportCanvas: { captureStream: () => ({}) },
    syncExportCanvas() {}, sync3DExportCanvas() {}, getSupportedVideoMime: () => ({ mime: 'video/webm', ext: 'webm' }),
    MediaRecorder: class {
      static isTypeSupported(mime) { return mime === 'video/webm'; }
      constructor(stream, options) { recorder = this; this.mimeType = options.mimeType; }
      start() {} stop() { this.ondataavailable({ data: new Blob(['webm']) }); this.onstop(); }
    },
    triggerDirectDownload: (url, filename) => downloads.push(filename)
  };
  scope.window = { MediaRecorder: scope.MediaRecorder };
  const context = vm.createContext(scope);
  const bridgeName = three ? 'sendBlobToDownloadsBridge' : 'callLocalDownloadsBridge';
  const bridgeStart = src.indexOf(`    async function ${bridgeName}(`);
  vm.runInContext(src.slice(bridgeStart, src.indexOf('\n    function triggerDirectDownload', bridgeStart)), context);
  const drawer = three ? 'showExportNotification' : 'showExportDrawer';
  vm.runInContext(pageFunction(src, drawer), context);
  vm.runInContext(pageFunction(src, three ? 'start3DVideoRecording' : 'startVideoRecording'), context);
  for (outcome of [{ ok: true, filename: 'actual-uuid.mp4' }, { ok: false, unavailable: true }, { ok: false, uncertain: true }, { ok: false, error: 'conversion_failed' }]) {
    context[three ? 'start3DVideoRecording' : 'startVideoRecording'](); recorder.stop();
    await new Promise(r => setImmediate(r));
    assert.match(element('export-download-link').download, /\.webm$/);
    assert.match(downloads.at(-1), /\.webm$/);
    if (outcome.ok) assert.match(element('export-title').textContent, /actual-uuid\.mp4/);
    else assert.doesNotMatch(element('export-title').textContent, /保存しました/);
    if (outcome.uncertain) assert.match(element('export-title').textContent, /結果を確認できません/);
  }
  assert.equal(calls.length, 4);
  if (three) { assert.equal(calls[0][0].type, 'video/webm'); assert.match(calls[0][1], /\.webm$/); }
  else assert.equal(calls[0][0], 'video');
});
