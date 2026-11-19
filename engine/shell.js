// Shared HUD, menu, export modal, and start card builder for picnic scenes.
// Eliminates copy-pasted HTML boilerplate across nagisa/edogawa/myoden/picnic pages
// while preserving identical element IDs and accessibility attributes.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderButton(btn) {
  if (btn.sep) return '<span class="sep"></span>';
  const { id, label, title = '', ariaLabel = '', cls = '' } = btn;
  const attrs = [
    id ? `id="${esc(id)}"` : '',
    cls ? `class="${esc(cls)}"` : '',
    title ? `title="${esc(title)}"` : '',
    ariaLabel ? `aria-label="${esc(ariaLabel)}"` : ''
  ].filter(Boolean).join(' ');
  return `<button ${attrs}>${label}</button>`;
}

/**
 * Render the shared picnic scene HUD/menu/export/start markup.
 * @param {object} cfg
 * @param {string|null} [cfg.loadingText]      Omit #loading when null/empty
 * @param {string} cfg.locationLabel
 * @param {string} [cfg.extraHudHtml]          Optional HUD element (e.g. #prompt)
 * @param {string} cfg.helpText
 * @param {Array<object>} cfg.dockButtons      View buttons before export/settings ({ sep: true } inserts divider)
 * @param {string} [cfg.settingsTitle]         Tooltip for ⚙️ button
 * @param {object} [cfg.timeSlider]            { min, max, value, label }
 * @param {string} [cfg.extraTimeRow]          Optional row right after time slider
 * @param {Array<object>} [cfg.detourButtons]  Optional buttons in the "寄り道" row
 * @param {string} [cfg.extraMenuRows]         Optional raw HTML rows after season (e.g. tide/walk mode)
 * @param {Array<object>} [cfg.extraSoundButtons] Optional buttons next to #o-snd
 * @param {string|null} [cfg.creditHtml]       Trusted attribution HTML (omitted when null/empty)
 * @param {string} cfg.exportNote
 * @param {object} cfg.startCard               { title, paragraphs: string[], buttons: Array<object>, hint }
 */
export function renderPicnicShellHTML(cfg) {
  const dock = [
    ...(cfg.dockButtons ?? []),
    { id: 'a-export', label: '📷', title: '書き出し：PNG・ループ動画（P / R）', ariaLabel: '書き出し' },
    { id: 'o-more', label: '⚙️', title: cfg.settingsTitle ?? '時刻・表示の設定', ariaLabel: '設定' }
  ].map(renderButton).join('\n    ');

  const ts = { min: 4.5, max: 20, value: 12, label: '12:00', ...(cfg.timeSlider ?? {}) };
  const loadingEl = cfg.loadingText ? `\n  <div id="loading">${esc(cfg.loadingText)}</div>` : '';
  const extraHud = cfg.extraHudHtml ? `\n  ${cfg.extraHudHtml}` : '';
  const extraTime = cfg.extraTimeRow ? `\n    ${cfg.extraTimeRow}` : '';
  const detourRow = cfg.detourButtons?.length
    ? `\n    <div class="row"><span>寄り道</span>${cfg.detourButtons.map(renderButton).join('')}</div>`
    : '';
  const extraRows = cfg.extraMenuRows ? `\n    ${cfg.extraMenuRows}` : '';
  const extraSound = cfg.extraSoundButtons?.length ? cfg.extraSoundButtons.map(renderButton).join('') : '';
  const creditEl = cfg.creditHtml ? `\n    <div id="credit">${cfg.creditHtml}</div>` : '';

  const startParagraphs = (cfg.startCard.paragraphs ?? []).map(p => `      <p>${p}</p>`).join('\n');
  const startButtons = (cfg.startCard.buttons ?? []).map(renderButton).join('\n        ');

  return `<canvas id="view"></canvas>${loadingEl}

  <div id="hud-tl" class="box chip fade"><div id="loc">${esc(cfg.locationLabel)}</div></div>${extraHud}
  <div id="toast" class="box hidden"></div>
  <div id="help" class="box fade hidden">${esc(cfg.helpText)}</div>
  <div id="joy" class="fade hidden"><div id="joy-knob"></div><div id="joy-label">ここをドラッグで移動</div></div>

  <div id="bar" class="box dock fade">
    ${dock}
  </div>

  <div id="menu" class="box hidden">
    <div class="row"><span>時刻</span><label id="time-label">${esc(ts.label)}</label><input id="time" type="range" min="${ts.min}" max="${ts.max}" step="0.05" value="${ts.value}" aria-label="時刻" /><button id="t-auto" title="時間を自動で進める" aria-label="時間を自動で進める">⏩</button></div>${extraTime}${detourRow}
    <div class="row"><span>拠点</span><button id="b-here" title="立っている前に、向いている方を正面にしてシートを敷く（B）">🧺 ここに敷く</button><button id="b-home" title="シートをもとの場所に戻す">↩ もとの場所</button></div>
    <div class="row" id="season-row"><span>季節</span></div>${extraRows}
    <div class="row"><span>表示</span><button id="o-line" class="on" title="深度・法線から輪郭線">✏️ 輪郭</button><button id="o-px" title="ドットの大きさ">🔍 ×3</button><button id="o-help">❔ 操作説明</button></div>
    <div class="row"><span></span><button id="o-snd" class="on">🔊 音</button>${extraSound}</div>${creditEl}
  </div>

  <div id="export" class="box hidden">
    <div class="ex-head"><strong>📷 書き出し</strong><span id="x-bridge"></span><button id="x-close" aria-label="閉じる">✕</button></div>
    <div class="ex-row">
      <button id="x-png">🖼️ PNG</button>
      <button id="x-v1">🎬 6秒ループ</button>
      <button id="x-v2">🎬 12秒（2周）</button>
    </div>
    <div id="x-note" class="ex-note">${esc(cfg.exportNote)}</div>
  </div>
  <div id="rec" class="box hidden"><span class="rec-dot"></span>REC <span id="rec-time">0.0 / 6.0 秒</span><button id="rec-stop">■ 停止</button></div>

  <div id="start">
    <div class="card box">
      <h1>${cfg.startCard.title}</h1>
${startParagraphs}
      <div class="btns">
        ${startButtons}
      </div>
      <small>${esc(cfg.startCard.hint)}</small>
    </div>
  </div>`;
}

/**
 * Mount the shared shell into the target root (defaults to document.body).
 * Inserts at the beginning of root so inline scripts remain intact.
 */
export function mountPicnicShell(cfg, root = document.body) {
  root.insertAdjacentHTML('afterbegin', renderPicnicShellHTML(cfg));
  return root;
}
