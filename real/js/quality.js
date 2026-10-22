// 写実版の画質の段階（高・中・低）。?quality= か覚えた値、なければ端末から選ぶ
//   描く解像度・影・地形の細かさ・地面の素材の大きさ・水の反射（0 で空の色だけ）・木の葉の数・草の段
export const QUALITY = {
  high:   { key: 'high',   label: '高', pixelRatio: 2,    shadowSize: 2048, shadowExtent: 70, nearStep: 0.25, texColor: 1024, texNormal: 1024, reflScale: 0.5,  leafScale: 0.85, treeNear: 110, treeMax: 35, shadowEvery: 4,  grass: { rings: [{ tile: 2, perM2: 500, to: 12, width: 1 }, { tile: 4, perM2: 120, to: 30, width: 1.7 }, { tile: 8, perM2: 14, to: 80, width: 2.8 }] } },
  medium: { key: 'medium', label: '中', pixelRatio: 1.5,  shadowSize: 1024, shadowExtent: 60, nearStep: 0.5,  texColor: 1024, texNormal: 512,  reflScale: 0.35, leafScale: 0.75, treeNear: 80,  treeMax: 22, shadowEvery: 6,  grass: { rings: [{ tile: 2, perM2: 250, to: 10, width: 1.2 }, { tile: 4, perM2: 60, to: 25, width: 2 }, { tile: 8, perM2: 8, to: 50, width: 3 }] } },
  low:    { key: 'low',    label: '低', pixelRatio: 1,    shadowSize: 1024, shadowExtent: 45, nearStep: 1,    texColor: 512,  texNormal: 512,  reflScale: 0,    leafScale: 0.45, treeNear: 55,  treeMax: 12, shadowEvery: 10, grass: { rings: [{ tile: 2, perM2: 120, to: 8, width: 1.5 }, { tile: 4, perM2: 25, to: 20, width: 2.5 }] } }
};
const STORAGE_KEY = 'picnic-site:real-quality';

export function getQuality() {
  let key = null;
  try { key = new URLSearchParams(location.search).get('quality'); } catch { key = null; }
  if (!Object.hasOwn(QUALITY, key)) { try { key = localStorage.getItem(STORAGE_KEY); } catch { key = null; } }
  if (Object.hasOwn(QUALITY, key)) return QUALITY[key];
  if (matchMedia('(pointer: coarse)').matches) return QUALITY.low;
  return devicePixelRatio >= 2 ? QUALITY.high : QUALITY.medium;
}

/** ⚙️ の「画質」の行。押すと覚えて読み直す */
export function bindQualityUI(row, current) {
  for (const q of Object.values(QUALITY)) {
    const b = document.createElement('button');
    b.textContent = q.label;
    b.title = `画質を「${q.label}」にする（読み直します）`;
    b.classList.toggle('on', q.key === current.key);
    b.addEventListener('click', () => {
      if (q.key === current.key) return;
      try { localStorage.setItem(STORAGE_KEY, q.key); } catch { /* URL で渡す */ }
      const u = new URL(location.href);
      u.searchParams.set('quality', q.key);
      location.replace(u.toString());
    });
    row.append(b);
  }
}

/** ?debug のときの表示：fps・描画命令の数・三角形の数 */
export function createDebugHud(renderer, extra = null) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:50;font:11px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);padding:6px 8px;border-radius:6px;white-space:pre;pointer-events:none';
  document.body.append(el);
  let frames = 0, t0 = performance.now(), fps = 0;
  return {
    update() {
      frames++;
      const now = performance.now();
      if (now - t0 > 500) { fps = frames * 1000 / (now - t0); frames = 0; t0 = now; }
      const r = renderer.info.render;
      el.textContent = `${fps.toFixed(0)} fps\ncalls ${r.calls}\ntris ${(r.triangles / 1e3).toFixed(0)}k\n${renderer.domElement.width}×${renderer.domElement.height}` + (extra ? '\n' + extra() : '');
    },
    get fps() { return fps; }
  };
}
