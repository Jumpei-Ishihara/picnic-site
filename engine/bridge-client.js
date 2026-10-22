// Protocol 2. Tokens are scoped to this page's memory and obtained only through an allowed Origin.
export function createBridgeClient({ base = 'http://127.0.0.1:18923', fetcher = (...args) => fetch(...args), timeoutMs = 125000 } = {}) {
  let session = null;
  async function connect() {
    if (session) return session;
    try {
      const r = await fetcher(`${base}/session`, { signal: AbortSignal.timeout(700), cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.protocol !== 2 || typeof j.token !== 'string') return null;
      session = j; return session;
    } catch { return null; }
  }
  async function post(endpoint, body, contentType) {
    let s = await connect();
    if (!s) return { ok: false, unavailable: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try { r = await fetcher(base + endpoint, { method: 'POST', headers: { 'Content-Type': contentType, 'X-Picnic-Token': s.token }, body, signal: AbortSignal.timeout(timeoutMs) }); }
      catch { session = null; return { ok: false, uncertain: true, error: '保存先を確認できません。ダウンロードフォルダを確認してください。' }; }
      // A rejected session cannot have written a file, so only this response may be retried.
      if (r.status === 403 && attempt === 0) { session = null; s = await connect(); if (s) continue; }
      try { const j = await r.json(); return r.ok && j.ok ? j : { ok: false, error: j.error || 'export_failed' }; }
      catch { return { ok: false, uncertain: true, error: '保存結果を確認できません。ダウンロードフォルダを確認してください。' }; }
    }
    return { ok: false, unavailable: true };
  }
  return {
    available: async () => {
      try {
        const r = await fetcher(`${base}/health`, { signal: AbortSignal.timeout(700), cache: 'no-store' });
        const j = await r.json();
        if (r.ok && j.ok === true && j.protocol === 2) return true;
      } catch { /* A cached token is not proof that the server is still running. */ }
      session = null;
      return false;
    },
    upload: (blob, filename) => post(`/save-blob?filename=${encodeURIComponent(filename)}${blob.type.startsWith('video/') ? '&convert=mp4' : ''}`, blob, blob.type.split(';')[0]),
    generate: (kind, options) => post(`/save-${kind}`, JSON.stringify(options), 'application/json')
  };
}
export const bridgeClient = createBridgeClient();
