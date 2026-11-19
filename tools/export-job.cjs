// Isolated CPU rendering and encoding. One frame at a time; never a full video buffer.
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
let encoder, stderrTail = '';
function cancel() { encoder?.kill('SIGKILL'); process.exit(1); }
process.on('SIGTERM', cancel); process.on('disconnect', cancel);
process.on('message', async job => {
  if (job.cancel) { cancel(); return; }
  try {
    const { renderFrame, getUpscaledRGB24, encodePNG, OUT_W, OUT_H } = require('./export_server.js');
    const o = job.options;
    if (job.kind === 'png') {
      renderFrame(o.t, o.mode, o.light, o.wave, o.caustics);
      await fs.writeFile(job.output, encodePNG(OUT_W, OUT_H, getUpscaledRGB24()));
    } else {
      const piped = job.kind === 'video' || job.kind === 'frames';
      const input = job.kind === 'video'
        ? ['-f', 'rawvideo', '-vcodec', 'rawvideo', '-s', `${OUT_W}x${OUT_H}`, '-pix_fmt', 'rgb24', '-r', '60', '-i', '-']
        : job.kind === 'frames'
          ? ['-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(job.fps || 30), '-i', '-']
          : ['-i', job.input];
      encoder = spawn(job.ffmpegBin, ['-y', ...input, '-t', '60', '-vf', 'scale=1280:720:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '16', '-movflags', '+faststart', job.output], { stdio: [piped ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
      encoder.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-32768); });
      // Attach rejection handling before producing frames; an early encoder exit must not be unhandled.
      const exited = new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('close', code => code === 0 ? resolve() : reject(Error('encoding failed'))); });
      exited.catch(() => {});
      if (job.kind === 'video') {
        encoder.stdin.on('error', () => {});
        for (let frame = 0; frame < Math.round(o.duration * 60); frame++) {
          renderFrame(frame / 60, o.mode, o.light, o.wave, o.caustics);
          if (encoder.stdin.destroyed) throw Error('encoder closed');
          if (!encoder.stdin.write(getUpscaledRGB24())) await once(encoder.stdin, 'drain');
        }
        encoder.stdin.end();
      } else if (job.kind === 'frames') {
        encoder.stdin.on('error', () => {});
        const fh = await fs.open(job.input, 'r');
        try {
          const size = (await fh.stat()).size, hdr = Buffer.allocUnsafe(4);
          let offset = 0;
          while (offset < size) {
            await fh.read(hdr, 0, 4, offset);
            const len = hdr.readUInt32BE(0);
            const frame = Buffer.allocUnsafe(len);
            await fh.read(frame, 0, len, offset + 4);
            offset += 4 + len;
            if (encoder.stdin.destroyed) throw Error('encoder closed');
            if (!encoder.stdin.write(frame)) await once(encoder.stdin, 'drain');
          }
        } finally { await fh.close(); }
        encoder.stdin.end();
      }
      await exited;
      if ((await fs.stat(job.output)).size >= job.maxOutputBytes) throw Error('output limit');
    }
    process.send({ ok: true, peakRssKiB: process.resourceUsage().maxRSS }, () => process.exit(0));
  } catch { encoder?.kill('SIGKILL'); process.send({ ok: false, diagnostic: stderrTail }, () => process.exit(1)); }
});
