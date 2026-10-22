export { bridgeClient } from './bridge-client.js';

// Browser downloads are requested separately by the legacy pages. A successful
// bridge response alone proves direct saving; keep the native Blob link intact.
export async function updateLegacyExportStatus({ title, hint, filename, result, isCurrent }) {
  if (!isCurrent()) return;
  title.textContent = `${filename} — 保存結果を確認中…`;
  let saved;
  try { saved = await result; } catch { saved = { ok: false, uncertain: true }; }
  if (!isCurrent()) return;
  if (saved?.ok) {
    title.textContent = `✅ ~/Downloads/${saved.filename} に保存しました`;
    hint.textContent = '下の保存リンクはブラウザで作成した元形式のファイルです。';
  } else if (saved?.uncertain) {
    title.textContent = '⚠️ 直接保存の結果を確認できません';
    hint.textContent = 'ダウンロードフォルダを確認してください。ブラウザにも保存を要求しました。下のリンクから元形式を保存できます。';
  } else {
    title.textContent = `${filename} — ブラウザに保存を要求しました`;
    hint.textContent = 'ブラウザのダウンロード状況を確認してください。下のリンクから元形式を保存できます。';
  }
}
