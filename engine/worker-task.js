// The catch is outside the Promise executor: constructor/postMessage errors become rejections.
export async function runWorkerTask({ url, job, fallback, apply = value => value, timeoutMs = 30000 }) {
  let worker, timer;
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = e => { try { resolve(apply(e.data)); } catch (error) { reject(error); } };
      worker.onerror = e => { e.preventDefault?.(); reject(Error('worker failed')); };
      worker.onmessageerror = () => reject(Error('worker message failed'));
      timer = setTimeout(() => reject(Error('worker timeout')), timeoutMs);
      worker.postMessage(job);
    });
  } catch { worker?.terminate(); worker = null; clearTimeout(timer); return apply(await fallback(job)); }
  finally { clearTimeout(timer); worker?.terminate(); }
}
