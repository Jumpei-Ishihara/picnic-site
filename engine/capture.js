// PNG / native-format recording, plus deterministic fixed-timestep PNG sequence
// capture when the local export bridge is available and renderAt(t) is provided.
import { bridgeClient } from './bridge-client.js';

export function createCapture({ canvas, pixel, renderOnce, prepareVideo = () => {}, renderAt = null, fps = 30, bridge = bridgeClient, source = { width: 320, height: 180 }, scale = 4, bitrate = 12_000_000 }) {
  const out = document.createElement('canvas');
  out.width = source.width * scale; out.height = source.height * scale;
  const ctx = out.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  const copyFrame = () => ctx.drawImage(canvas, 0, 0, out.width, out.height);
  let state = 'idle', rec = null;

  async function bridgeAvailable() { return await bridge.available() ? '~/Downloads' : null; }
  async function save(blob, filename) {
    if (!(blob instanceof Blob) || !blob.size) throw Error('保存する画像・動画を作れませんでした');
    const url = URL.createObjectURL(blob);
    let disposed = false;
    const dispose = () => { if (!disposed) { URL.revokeObjectURL(url); disposed = true; } };
    try {
      const result = await bridge.upload(blob, filename);
      if (result.ok) return { where: 'downloads', filename: result.filename, downloadFilename: filename, mime: result.mime, sourceMime: blob.type, url, dispose };
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      return { where: 'browser', filename, url, dispose, warning: result.uncertain ? result.error : null };
    } catch (error) { dispose(); throw error; }
  }

  async function png(filename) {
    if (state !== 'idle') throw Error('書き出し処理中です');
    state = 'preparing';
    try {
      let blob;
      try {
        pixel.setFixedSize(source); renderOnce(); copyFrame();
        blob = await new Promise((resolve, reject) => out.toBlob(b => b ? resolve(b) : reject(Error('PNGを作れませんでした')), 'image/png'));
      } finally { pixel.setFixedSize(null); renderOnce(); }
      state = 'saving';
      return await save(blob, `${filename}.png`);
    } finally { state = 'idle'; }
  }

  async function recordFixedTimestep({ duration, filename, onProgress }) {
    const srcOut = document.createElement('canvas');
    srcOut.width = source.width; srcOut.height = source.height;
    const srcCtx = srcOut.getContext('2d', { alpha: false });
    srcCtx.imageSmoothingEnabled = false;
    const total = Math.max(1, Math.round(duration * fps));
    const frames = [];
    let cancelled = false;
    rec = { cancel: () => { cancelled = true; } };
    try {
      pixel.setFixedSize(source);
      state = 'recording';
      for (let k = 0; k < total; k++) {
        if (cancelled) throw Error('録画を中止しました');
        renderAt(k / fps);
        if (cancelled) throw Error('録画を中止しました');
        srcCtx.drawImage(canvas, 0, 0, source.width, source.height);
        const blob = await new Promise((resolve, reject) => srcOut.toBlob(b => b ? resolve(b) : reject(Error('フレームを作成できませんでした')), 'image/png'));
        if (cancelled) throw Error('録画を中止しました');
        frames.push(new Uint8Array(await blob.arrayBuffer()));
        onProgress(Math.min((k + 1) / fps, duration), duration);
      }
      state = 'saving';
      const result = await bridge.uploadFrames(frames, `${filename}.mp4`, fps);
      if (!result.ok) throw Error(result.error || '動画を保存できませんでした');
      return { where: 'downloads', filename: result.filename, downloadFilename: `${filename}.mp4`, mime: result.mime || 'video/mp4', dispose: () => {} };
    } finally {
      rec = null;
      pixel.setFixedSize(null);
      try { renderOnce(); } catch { /* ignore restore render errors */ }
      state = 'idle';
    }
  }

  function startRealtimeVideo({ duration, filename, onProgress }) {
    return new Promise((resolve, reject) => {
      const r = { recorder: null, stream: null, chunks: [], start: 0, duration, onProgress, resolve, reject, finished: false, fixed: false, bytes: 0 };
      function cleanup() {
        rec = null;
        for (const track of r.stream?.getTracks() ?? []) { try { track.stop(); } catch { /* already stopped */ } }
        if (r.fixed) { r.fixed = false; pixel.setFixedSize(null); }
      }
      r.fail = error => {
        if (r.finished) return;
        r.finished = true;
        try { if (r.recorder?.state === 'recording') r.recorder.stop(); } catch { /* failed encoder */ }
        try { cleanup(); } catch { /* still release the busy state */ }
        r.chunks.length = 0; state = 'idle'; reject(error instanceof Error ? error : Error('録画に失敗しました'));
      };
      try {
        if (!globalThis.MediaRecorder || typeof out.captureStream !== 'function') throw Error('このブラウザでは動画を書き出せません');
        const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
        if (!mime) throw Error('対応する動画形式がありません');
        r.fixed = true; pixel.setFixedSize(source);
        // captureStream can emit the existing canvas immediately. Seed it with
        // the prepared first pose rather than a stale PNG or previous recording.
        prepareVideo(); renderOnce(); copyFrame();
        r.stream = out.captureStream(60);
        r.recorder = new MediaRecorder(r.stream, { mimeType: mime, videoBitsPerSecond: bitrate });
        r.recorder.ondataavailable = e => {
          if (r.finished || !e.data?.size) return;
          r.bytes += e.data.size;
          if (r.bytes > 64 * 1024 ** 2) { r.fail(Error('録画サイズが上限を超えました')); return; }
          r.chunks.push(e.data);
        };
        r.recorder.onerror = () => r.fail(Error('録画中にエラーが発生しました'));
        r.recorder.onstop = async () => {
          if (r.finished) return;
          r.finished = true; state = 'saving';
          try {
            cleanup();
            const nativeMime = (r.recorder.mimeType || mime).split(';')[0];
            const blob = new Blob(r.chunks, { type: nativeMime });
            resolve(await save(blob, `${filename}.${nativeMime === 'video/mp4' ? 'mp4' : 'webm'}`));
          } catch (error) { reject(error); }
          finally { r.chunks.length = 0; state = 'idle'; }
        };
        rec = r; r.start = performance.now(); r.recorder.start(100);
        // A synchronous error event may already have completed the operation.
        if (!r.finished) state = 'recording';
      } catch (error) { r.fail(error); }
    });
  }

  function startVideo({ duration, filename, onProgress = () => {} }) {
    if (state !== 'idle') return Promise.reject(Error('書き出し処理中です'));
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) return Promise.reject(Error('録画時間が範囲外です'));
    state = 'preparing';
    if (typeof renderAt === 'function') {
      return Promise.resolve(bridge.available()).then(ok => {
        if (ok) return recordFixedTimestep({ duration, filename, onProgress });
        return startRealtimeVideo({ duration, filename, onProgress });
      }, () => startRealtimeVideo({ duration, filename, onProgress }));
    }
    return startRealtimeVideo({ duration, filename, onProgress });
  }

  return {
    png, startVideo, bridgeAvailable, save,
    get state() { return state; },
    get busy() { return state !== 'idle'; },
    get recording() { return state === 'recording'; },
    elapsed() { return rec && rec.start && state === 'recording' ? (performance.now() - rec.start) / 1000 : null; },
    frame() {
      const r = rec;
      if (!r || !r.recorder || state !== 'recording') return;
      try {
        copyFrame(); const t = (performance.now() - r.start) / 1000;
        r.onProgress(Math.min(t, r.duration), r.duration);
        if (t >= r.duration && r.recorder.state === 'recording') r.recorder.stop();
      } catch (error) { r.fail(error); }
    },
    stopVideo() {
      const r = rec;
      if (r?.cancel) { r.cancel(); return; }
      if (r?.recorder?.state === 'recording') { try { r.recorder.stop(); } catch (e) { r.fail(e); } }
    }
  };
}
