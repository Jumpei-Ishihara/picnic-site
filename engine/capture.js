// 書き出し：PNG とループ動画。~/Downloads への保存は tools/export_server.js（ブリッジ）経由、
// ブリッジが動いていなければブラウザのダウンロードに保存する。
//
// ブリッジの起動（プロジェクトのフォルダで）：node tools/export_server.js --bridge-only

const BRIDGE = 'http://127.0.0.1:18923';

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas  ドット絵レンダラーの描画先
 * @param {ReturnType<import('./pixel-renderer.js').createPixelRenderer>} o.pixel
 * @param {() => void} o.renderOnce     1フレーム描く（時間は進めない）
 * @param {{width:number, height:number}} [o.source]  書き出し時の描画解像度
 * @param {number} [o.scale]            拡大率（整数。320×180 × 4 = 1280×720）
 */
export function createCapture({ canvas, pixel, renderOnce, source = { width: 320, height: 180 }, scale = 4, bitrate = 12_000_000 }) {
  const out = document.createElement('canvas');
  out.width = source.width * scale;
  out.height = source.height * scale;
  const ctx = out.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  // 描画の直後（同じタスク内）に呼ぶ：ニアレストで整数倍に拡大して写す
  const copyFrame = () => ctx.drawImage(canvas, 0, 0, out.width, out.height);

  let rec = null; // { recorder, chunks, mime, start, duration, onProgress, resolve }

  async function bridgeAvailable() {
    try {
      const r = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(700) });
      return r.ok ? (await r.json()).dir || '~/Downloads' : null;
    } catch (e) { return null; }
  }

  // ブリッジがあれば ~/Downloads に直接、なければブラウザのダウンロードとして保存
  async function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    if (await bridgeAvailable()) {
      try {
        const r = await fetch(`${BRIDGE}/save-blob?filename=${encodeURIComponent(filename)}`, { method: 'POST', body: blob });
        const j = await r.json();
        if (j.ok) return { where: 'downloads', path: j.path, filename: j.filename, url };
      } catch (e) { /* ブラウザ保存へ */ }
    }
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    return { where: 'browser', filename, url };
  }

  // 解像度を固定して1フレーム描き、PNG にする
  async function png(filename) {
    pixel.setFixedSize(source);
    renderOnce();
    copyFrame();
    const blob = await new Promise(res => out.toBlob(res, 'image/png'));
    pixel.setFixedSize(null);
    renderOnce();
    return save(blob, `${filename}.png`);
  }

  const pickMime = () => ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';

  /**
   * 録画を始める。場面側は録画中、毎フレームの描画後に frame() を呼び、
   * 経過時間 elapsed() を時計として使う（0 から始まるので、周期の倍数の長さならループがつながる）。
   * @returns {Promise<object>} 保存結果
   */
  function startVideo({ duration, filename, onProgress = () => {} }) {
    if (rec) return Promise.reject(new Error('recording'));
    pixel.setFixedSize(source);
    const mime = pickMime();
    const stream = out.captureStream(60);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    return new Promise(resolve => {
      rec = { recorder, chunks, mime, start: performance.now(), duration, onProgress, resolve, filename };
      recorder.onstop = async () => {
        const r = rec;
        rec = null;
        pixel.setFixedSize(null);
        const blob = new Blob(r.chunks, { type: r.mime });
        // ブリッジは .mp4 を受け取ると ffmpeg で H.264 に変換する。ブラウザ保存では実際の形式の拡張子にする
        const ext = ((await bridgeAvailable()) || r.mime.startsWith('video/mp4')) ? 'mp4' : 'webm';
        r.resolve(await save(blob, `${r.filename}.${ext}`));
      };
      recorder.start(100);
    });
  }

  return {
    png, startVideo, bridgeAvailable, save,
    get recording() { return !!rec; },
    // 録画の時計（秒）。録画していなければ null
    elapsed() { return rec ? (performance.now() - rec.start) / 1000 : null; },
    // 録画中、描画のたびに呼ぶ
    frame() {
      if (!rec) return;
      copyFrame();
      const t = (performance.now() - rec.start) / 1000;
      rec.onProgress(Math.min(t, rec.duration), rec.duration);
      if (t >= rec.duration && rec.recorder.state === 'recording') rec.recorder.stop();
    },
    stopVideo() { if (rec && rec.recorder.state === 'recording') rec.recorder.stop(); }
  };
}
