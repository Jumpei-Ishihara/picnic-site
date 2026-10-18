// 画面の重ね表示（HUD）まわりの小道具。マークアップと見た目は ui.css を参照。

// クリック後にフォーカスを外す（Space キーがボタンを押し直さないように）
export const bindButton = (id, fn) =>
  document.getElementById(id).addEventListener('click', e => { fn(e.currentTarget); e.currentTarget.blur(); });

export const fmtTime = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

// 数秒で消える通知
export function createToast(el) {
  let timer = 0;
  return {
    show(msg, seconds = 2.2) { el.textContent = msg; el.classList.remove('hidden'); timer = seconds; },
    update(dt) { if (timer > 0) { timer -= dt; if (timer <= 0) el.classList.add('hidden'); } }
  };
}

// 時刻スライダー・表示・自動進行ボタンを時間帯と結びつける
export function bindTimeControls({ tod, input, label, autoButton }) {
  input.addEventListener('input', () => { tod.hour = parseFloat(input.value); });
  if (autoButton) autoButton.addEventListener('click', () => {
    tod.auto = !tod.auto;
    autoButton.classList.toggle('on', tod.auto);
    autoButton.blur();
  });
  return {
    // 毎フレーム：自動進行中はスライダーも動かす
    update() {
      if (tod.auto) input.value = tod.hour.toFixed(2);
      label.textContent = fmtTime(tod.hour);
    }
  };
}

/**
 * 操作がしばらくないと UI を消して風景だけにする。body に .ui-idle を付け外しする
 * （消える対象は CSS で .fade を付けた要素）。マウスを動かすと戻り、移動キーやドラッグ中は隠れる。
 * @param {{ idleMs?: number, isPinned?: () => boolean }} [o]  isPinned が true の間（メニューを開いている間など）は消さない
 */
export function createAutoHide({ idleMs = 2500, isPinned = () => false } = {}) {
  const body = document.body;
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (isPinned()) schedule(); else body.classList.add('ui-idle'); }, idleMs);
  };
  const show = () => { body.classList.remove('ui-idle'); schedule(); };
  const hide = () => { if (!isPinned()) { clearTimeout(timer); body.classList.add('ui-idle'); } };
  // ボタンを押していないマウスの動き＝UI を探している。ドラッグ中（見回し）は風景を見ている
  window.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && e.buttons === 0) show(); }, { passive: true });
  window.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('button, input, a, #menu, #export')) show(); }, { passive: true });
  window.addEventListener('keydown', e => { if (/^(Key[WASD]|Arrow)/.test(e.code)) hide(); });
  show();
  return { show, hide };
}
