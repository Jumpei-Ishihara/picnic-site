// Shared ownership of export results and UI restoration; scene logic stays in the caller.
export function createExportUI({ capture, controls, tod, toast, note, bridgeLabel, panel, recordingPanel, recordingTime, fileBase, loop, placePanel, beforeRecord = () => () => {} }) {
  let latest = null, running = false;
  const controlsIds = ['x-png', 'x-v1', 'x-v2'];
  function showResult(result) {
    latest?.dispose(); latest = result;
    const where = result.where === 'downloads' ? '~/Downloads に保存しました' : 'ブラウザのダウンロードに保存しました';
    toast.show(result.warning || `✅ ${where}`, result.warning ? 6 : 3);
    note.textContent = `✅ ${result.filename} — ${where} ${result.warning || ''} `;
    const a = document.createElement('a'); a.href = result.url; a.download = result.downloadFilename || result.filename; a.textContent = result.sourceMime === 'video/webm' && result.mime === 'video/mp4' ? '元のWebMをもう一度保存' : 'もう一度保存'; note.append(a);
  }
  const error = e => toast.show('⚠️ ' + (e?.message || '書き出しに失敗しました'), 5);
  function disable() {
    const saved = controlsIds.map(id => { const el = document.getElementById(id); const was = el?.disabled; if (el) el.disabled = true; return [el, was]; });
    return () => { for (const [el, was] of saved) if (el) el.disabled = was; };
  }
  async function png() {
    if (running || capture.busy) return;
    running = true; const enable = disable();
    try { controls.marker.visible = false; showResult(await capture.png(fileBase())); }
    catch (e) { error(e); }
    finally { enable(); running = false; }
  }
  async function record(cycles) {
    if (capture.recording) { capture.stopVideo(); return; }
    if (running || capture.busy) return;
    running = true; const enable = disable(), wasAuto = tod.auto;
    const hidden = ['bar', 'help', 'hud-tl', 'menu', 'toast'].map(id => document.getElementById(id)).filter(Boolean).map(el => [el, el.classList.contains('rec-hide')]);
    let restore = () => {};
    try {
      if (tod.auto) document.getElementById('t-auto').click();
      restore = beforeRecord();
      panel.classList.add('hidden'); recordingPanel.classList.remove('hidden');
      for (const [el] of hidden) el.classList.add('rec-hide');
      const duration = loop * cycles;
      showResult(await capture.startVideo({ duration, filename: `${fileBase()}_${duration}s`, onProgress: (t, d) => { recordingTime.textContent = `${t.toFixed(1)} / ${d.toFixed(1)} 秒`; } }));
    } catch (e) { error(e); }
    finally {
      try { restore?.(); } catch (e) { error(e); }
      try { if (tod.auto !== wasAuto) document.getElementById('t-auto').click(); } catch (e) { error(e); }
      recordingPanel.classList.add('hidden');
      for (const [el, was] of hidden) el.classList.toggle('rec-hide', was);
      panel.classList.remove('hidden');
      enable(); running = false; placePanel();
    }
  }
  async function refreshBridge() {
    const available = await capture.bridgeAvailable();
    bridgeLabel.textContent = available ? '🟢 ~/Downloads に直接保存' : '⚪ ブラウザのダウンロードに保存';
    bridgeLabel.title = available || 'ローカルで node tools/export_server.js を起動すると直接保存できます';
  }
  return { png, record, refreshBridge, showResult, dispose() { latest?.dispose(); latest = null; note.textContent = ''; }, get busy() { return running || capture.busy; } };
}
