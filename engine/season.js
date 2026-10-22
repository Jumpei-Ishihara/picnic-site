// 季節（春・夏・秋・冬）：日付、草木の色、空の霞み、生き物
//   選んだ季節はブラウザに覚え、URL の ?season= でも指定できる。季節を変えるとページを読み直す（形と色を作り直すため）。
//   日付は東京のその季節らしい日：春 4/5（桜の満開）、夏 7/25、秋 10/18、冬 1/15。
//   草木の色は関東の平地の様子から（芝はコウライシバ・ノシバのように冬は枯れ色、落葉樹は冬に葉を落とす、桜は 4 月上旬に満開）。
import { createSunPath } from './sun.js';

export const SEASONS = {
  spring: { key: 'spring', icon: '🌸', label: '春', date: '2026-04-05', when: '4 月上旬' },
  summer: { key: 'summer', icon: '🌻', label: '夏', date: '2026-07-25', when: '7 月下旬' },
  autumn: { key: 'autumn', icon: '🍁', label: '秋', date: '2026-10-18', when: '10 月中旬' },
  winter: { key: 'winter', icon: '❄️', label: '冬', date: '2026-01-15', when: '1 月中旬' }
};
const STORAGE_KEY = 'picnic-site:season';

/** URL の ?season=、なければ覚えた季節、なければ場面の既定 */
export function getSeason(defaultKey = 'autumn') {
  let key = null;
  try { key = new URLSearchParams(location.search).get('season'); } catch { key = null; }
  if (!Object.hasOwn(SEASONS, key)) { try { key = localStorage.getItem(STORAGE_KEY); } catch { key = null; } }
  return Object.hasOwn(SEASONS, key) ? SEASONS[key] : (Object.hasOwn(SEASONS, defaultKey) ? SEASONS[defaultKey] : SEASONS.autumn);
}

export function dateText(season) {
  const [y, m, d] = season.date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/**
 * ⚙️ メニューの「季節」の行（4 つのボタン）。押すと覚えて読み直す
 * @param {HTMLElement} row  ボタンを入れる要素
 */
export function bindSeasonUI(row, current) {
  for (const s of Object.values(SEASONS)) {
    const b = document.createElement('button');
    b.textContent = `${s.icon} ${s.label}`;
    b.title = `${s.label}（${s.when}）にする。草木の色・日の出と日の入りが変わります（読み直します）`;
    b.classList.toggle('on', s.key === current.key);
    b.addEventListener('click', () => {
      if (s.key === current.key) return;
      try { localStorage.setItem(STORAGE_KEY, s.key); } catch { /* 覚えられなくても URL で渡す */ }
      const u = new URL(location.href);
      u.searchParams.set('season', s.key);
      location.replace(u.toString());
    });
    row.append(b);
  }
}

// ---------------------------------------------------------------------------
// 太陽：その季節の日付の太陽の道。色の表（もとの日付で書いた表）は、日の出・南中・日の入りを合わせて読み替える
// ---------------------------------------------------------------------------
export function seasonalSunPath(sunOpts, season) {
  const base = createSunPath(sunOpts);
  const sp = createSunPath({ ...sunOpts, date: season.date });
  const A = [sp.sunrise, sp.noon, sp.sunset], B = [base.sunrise, base.noon, base.sunset];
  sp.keyHour = h => {
    if (h < A[0]) return B[0] - (A[0] - h) * (B[0] / A[0]);
    if (h < A[1]) return B[0] + (h - A[0]) / (A[1] - A[0]) * (B[1] - B[0]);
    if (h < A[2]) return B[1] + (h - A[1]) / (A[2] - A[1]) * (B[2] - B[1]);
    return B[2] + (h - A[2]) / (24 - A[2]) * (24 - B[2]);
  };
  return sp;
}

// 架空の場面（ピクニック・街）の太陽の弧：日の出・南中・日の入りと高さ（東京の値）。既定の季節はもとの弧のまま
const ARCS = {
  spring: { rise: 5.47, noon: 11.70, set: 17.97, height: 0.86 },
  summer: { rise: 4.83, noon: 11.77, set: 18.80, height: 1.0 },
  autumn: { rise: 5.80, noon: 11.42, set: 17.03, height: 0.71 },
  winter: { rise: 6.83, noon: 11.83, set: 16.83, height: 0.54 }
};
export function dayArc(season, defaultKey) {
  if (season.key === defaultKey) return null; // もとの弧（5:30〜19:00）
  return ARCS[season.key];
}

// 空：夏は霞んで地平線が白っぽく、冬は澄んで濃い青（遠くまで見える）、春は霞（かすみ）
export const SKY = {
  spring: { hor: '#e8ece6', mix: 0.25, sun: 0.97, hemi: 1.0, fog: 0.8 },
  summer: { hor: '#eef2f2', mix: 0.3, sun: 1.06, hemi: 1.04, fog: 0.75 },
  autumn: null,
  winter: { hor: '#c8dcf2', mix: 0.2, sun: 0.92, hemi: 0.95, fog: 1.25 }
};

// ---------------------------------------------------------------------------
// 地面の 3 色（暗・中・明）：芝・すり減った芝・堤防の草・ヨシ。秋はもとの表のまま
// ---------------------------------------------------------------------------
const GROUND = {
  spring: {
    lawn: ['#5f8a38', '#7aa646', '#96bc5c'], lawnWorn: ['#8a9450', '#a2aa64', '#bcc07c'],
    leveeGrass: ['#5a8436', '#73a044', '#8eb656'], reeds: ['#5f7e3c', '#789a48', '#93b05a'], tree: ['#4a7430', '#5f8a3a', '#78a048']
  },
  summer: {
    lawn: ['#3a6e28', '#4f8a32', '#68a240'], lawnWorn: ['#6e8640', '#86a050', '#a0b666'],
    leveeGrass: ['#3c6e2a', '#528a34', '#6aa244'], reeds: ['#466e2c', '#5c8836', '#76a044'], tree: ['#2e5a24', '#3f702c', '#548a38']
  },
  autumn: null,
  winter: {
    lawn: ['#8a7c50', '#a29266', '#b8a880'], lawnWorn: ['#988a62', '#ae9e76', '#c2b48e'],
    leveeGrass: ['#86784c', '#9c8e62', '#b2a47a'], reeds: ['#a08e62', '#b6a476', '#cabc90'], tree: ['#6a6040', '#807452', '#968a66']
  }
};
/** 地面の色の表（looks）を季節に合わせる（模様・写真の色の混ぜ方はそのまま） */
export function seasonGroundLooks(looks, season) {
  const g = GROUND[season.key];
  if (!g) return looks;
  const out = { ...looks };
  for (const [k, c] of Object.entries(g)) if (out[k]) out[k] = { ...out[k], c };
  return out;
}
// 中景の芝の色
export function seasonMidLooks(mid, season) {
  const grass = { spring: '#7a9c48', summer: '#4f8030', autumn: null, winter: '#9a8c60' }[season.key];
  return grass ? { ...mid, grass, pitch: { spring: '#9aa462', summer: '#7a9244', winter: '#a89a6c' }[season.key] } : mid;
}

// ---------------------------------------------------------------------------
// 木：桜・落葉樹・常緑樹に分け（位置から決まる乱数。樹種は確かめていない）、季節の葉の色。null は葉が無い（冬の落葉樹）
// ---------------------------------------------------------------------------
const FOLIAGE = {
  spring: {
    cherry: [['#eab8c4', '#f8d8e0'], ['#e4aebe', '#f4ccd8']],
    deciduous: [['#6e9a40', '#9cc25a'], ['#7aa448', '#a8ca66']],
    evergreen: [['#3a6428', '#567e36'], ['#42682c', '#5c843a']]
  },
  summer: {
    cherry: [['#355e26', '#4c7a32'], ['#3a6428', '#527e34']],
    deciduous: [['#2f5c24', '#46762e'], ['#36622a', '#4e7e34']],
    evergreen: [['#284e20', '#3c682a'], ['#2c5424', '#406c2e']]
  },
  autumn: null, // もとの色（10 月中旬：少し黄ばんだ緑）。桜の葉は色づき始め
  winter: {
    cherry: null, deciduous: null,
    evergreen: [['#2e4c26', '#44623a'], ['#324e2a', '#486640']]
  }
};
const AUTUMN_CHERRY = [['#7a6a3a', '#988650'], ['#8a5c3a', '#a8784c']]; // 10 月中旬〜下旬の桜：赤茶・橙に色づき、葉が少なくなる（なぎさ公園の写真）
const GINKGO = { spring: [['#8aae4a', '#aac860']], summer: [['#4a7a2c', '#609038']], autumn: [['#b8aa30', '#d8c848']], winter: null }; // イチョウ（秋は黄色）

export function treeHash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
/** 位置から樹種の種類を決める（cherry・evergreen の割合は場面ごと） */
export function treeKind(x, z, { cherry = 0.25, evergreen = 0.35, ginkgo = 0 } = {}) {
  const p = treeHash(x, z);
  return p < cherry ? 'cherry' : p > 1 - evergreen ? 'evergreen' : p < cherry + ginkgo ? 'ginkgo' : 'deciduous';
}
/**
 * 季節の葉の色 [暗, 明]。undefined はもとの色のまま、null は葉が無い
 * @param {'cherry'|'deciduous'|'evergreen'} kind
 */
export function foliageColors(season, kind, i = 0) {
  if (kind === 'ginkgo') return GINKGO[season.key] && GINKGO[season.key][0];
  if (season.key === 'autumn') return kind === 'cherry' ? AUTUMN_CHERRY[i % 2] : undefined;
  const f = FOLIAGE[season.key];
  const list = f[kind];
  return list === null ? null : list[i % list.length];
}

// ---------------------------------------------------------------------------
// 草むら・ヨシ・生き物
// ---------------------------------------------------------------------------
export function tuftColors(season) {
  return {
    spring: ['#7aae4c', '#8cc05a', '#6a9c40', '#9cc464', '#86b452'],
    summer: ['#4f8a32', '#5f9a3a', '#447e2c', '#6aa444', '#58923a'],
    autumn: null,
    winter: ['#a29266', '#b2a478', '#968860', '#bcae84', '#a89a70']
  }[season.key];
}
export function reedColors(season) {
  return {
    spring: ['#6a8a44', '#7a9a4c', '#5c7c3a', '#86a456'],   // 新しい芽
    summer: ['#4f7a32', '#5c8838', '#46702c', '#68943e'],   // 背の高い緑
    autumn: null,
    winter: ['#b0a074', '#c2b286', '#a69668', '#ccbe94']    // 枯れたヨシ
  }[season.key];
}
/** 穂：秋はもとの色、冬は枯れた白っぽい穂、春・夏は無い */
export function plumeColors(season) {
  return { spring: null, summer: null, autumn: undefined, winter: ['#d8ceb4', '#e4dcc6', '#cec2a6'] }[season.key];
}
export const FAUNA = {
  spring: { dragonflies: false, gulls: 0.8, crickets: false, petals: 'sakura', fireflies: false },
  summer: { dragonflies: false, gulls: 0.3, crickets: true, petals: null, fireflies: true },
  autumn: { dragonflies: true, gulls: 1, crickets: true, petals: 'leaves', fireflies: false },
  winter: { dragonflies: false, gulls: 1.6, crickets: false, petals: null, fireflies: false }
};

/** realsite/life.js に渡す季節の設定 */
export function lifeSeason(season) {
  return { colors: { tufts: tuftColors(season), reeds: reedColors(season), plumes: plumeColors(season) }, fauna: FAUNA[season.key] };
}
