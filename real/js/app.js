// 写実版の場面に共通の組み立て：描画・空と太陽・地形・水面・草・木・遠景と構造物・ピクニック・歩行・視点・季節・画質・音・毎フレーム
//   場面ごとの違い（データの場所・水の流れ・並木・橋の色・その場面だけの施設）は site で渡す。
//   ページ（real/edogawa.html など）は HTML の部品（下部バー・メニュー・スタート画面）と site を用意して startRealScene を呼ぶ
import * as THREE from 'three';
import { createCollider } from '../../engine/collision.js';
import { createPlayerController } from '../../engine/player.js';
import { SEASONS, seasonalSunPath, dateText, FAUNA } from '../../engine/season.js';
import { createPicnicSet } from '../../engine/picnic-set.js';
import { createBaseCamp, bindBaseCampUI } from '../../engine/basecamp.js';
import { createAudio } from '../../engine/audio.js';
import { bindButton as btn, createToast, bindTimeControls, createAutoHide } from '../../engine/ui.js';
import { createRealTerrain } from './terrain.js';
import { createRealSky } from './sky.js';
import { createRealWater } from './water.js';
import { createRealGrass } from './grass.js';
import { createRealTrees } from './trees.js';
import { createRealStructures, pbr } from './structures.js';
import { getQuality, bindQualityUI, createDebugHud } from './quality.js';
import { createResolutionScaler, createShadowScheduler } from './perf.js';
import { mergeStatic, findMoving } from './merge.js';
import { mulberry32 } from '../../engine/pixel-kit.js';

// 季節：秋（10 月中旬）と初夏（6 月上旬）。初夏の草木の色は engine/season.js の「夏」を使う
export const REAL_SEASONS = {
  autumn: SEASONS.autumn,
  summer: { ...SEASONS.summer, icon: '🌿', label: '初夏', date: '2026-06-01', when: '6 月上旬' }
};
const SEASON_KEY = 'picnic-site:real-season';
function getRealSeason() {
  let k = null;
  try { k = new URLSearchParams(location.search).get('season'); } catch { k = null; }
  if (!REAL_SEASONS[k]) { try { k = localStorage.getItem(SEASON_KEY); } catch { k = null; } }
  return REAL_SEASONS[k] ?? REAL_SEASONS.autumn;
}

// 水の流れの向き：data.water.river（川の中ほどの線、上流から下流）の始めから終わりへ。無ければ +z
function riverFlow(data) {
  const R = data.water.river;
  if (!R || R.length < 2) return [0, 1];
  const [a, b] = [R[0], R[R.length - 1]], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

/**
 * @param {object} site
 * @param {string} site.id          場面の名前（ブラウザに覚える拠点のキーなど）
 * @param {string} site.base        場面データのフォルダ（'../scenes/edogawa/'）
 * @param {object} [site.data]      すでに読んだ scene.json（ページで読んだときに渡すと、読み直さない）
 * @param {string} site.label       左上の場所の表示（場所の名前が決まらない所）
 * @param {string} site.pixelPage   ドット絵版のページ
 * @param {string[]} site.viewKeys  1〜9 のキーに割り当てる視点（data.viewpoints のキー）
 * @param {number[]} [site.flow]    水の流れ・風の向き（xz）。省略すると data.water.river から
 * @param {object} [site.depthPad]  水深を細かく計算する範囲を近景から広げる量（m）{ x0, z0, x1, z1 }
 * @param {number} [site.nearStepScale] 近景の格子を画質の値の何倍にするか（近景の広い場面は 2）
 * @param {object} [site.treeKinds] treeKind の割合（cherry・evergreen・ginkgo）
 * @param {(data:object, MB:object) => object[]} [site.extraTrees]  データの木のほかの木（並木など）
 * @param {object} [site.structures] real/js/structures.js に渡す場面ごとの設定
 * @param {(ctx:object) => object} [site.build]  その場面だけの施設。{ update(loopT, env), isBlocked(x, z), zoneName(x, z) } を返す
 */
export async function startRealScene(site) {
  const BASE = site.base;
  // 起動の段階ごとの時間（?debug のとき、読み込みが終わったらコンソールに表で出す）
  const T0 = performance.now(), marks = [];
  let tPrev = T0;
  const mark = label => { const t = performance.now(); marks.push({ 段階: label, 'ms': Math.round(t - tPrev), '累計 ms': Math.round(t - T0) }); tPrev = t; };
  // 読み込み画面に、いま何をしているかを出す（待ち時間を短く感じるように）
  const loadingEl = document.getElementById('loading');
  const stage = text => { if (loadingEl) loadingEl.textContent = text; };
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r())); // 読み込み画面の文字を描かせる
  const data = site.data ?? await (await fetch(BASE + 'scene.json')).json();
  mark('scene.json');
  const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
  const UB = data.frame.upstreamBearing;
  const SEASON = getRealSeason();
  const LOOP = 6;
  const Q = getQuality();
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const rnd = mulberry32(11);

  // ============================================================================
  // 描画
  // ============================================================================
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 6000);
  camera.rotation.order = 'YXZ';
  camera.layers.enable(1); // 草（水面の反射には描かない）
  let water = null; // 水面（下で作る）。画面の大きさが変わったら反射の解像度も変える
  // 描く解像度：画質の倍率（端末の画素密度が上限）の 0.5〜1 倍で自動調整（?res=fixed で止める）
  const resScaler = createResolutionScaler({
    renderer, baseRatio: Math.min(devicePixelRatio, Q.pixelRatio), enabled: new URLSearchParams(location.search).get('res') !== 'fixed',
    onChange: (w, h) => water?.resize(w, h)
  });
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    water?.resize(renderer.domElement.width, renderer.domElement.height);
  }
  addEventListener('resize', resize);
  resize();
  // 影は必要なときだけ描き直す（太陽・影の範囲・視点が変わったときと、葉の揺れのため数コマに 1 回）
  const shadows = createShadowScheduler(renderer, Q.shadowEvery);

  // ============================================================================
  // 空・太陽
  // ============================================================================
  const sunPath = seasonalSunPath({ ...data.sun, upstreamBearing: UB }, SEASON);
  const sky = createRealSky({ renderer, scene, sunPath, shadowSize: Q.shadowSize, shadowExtent: Q.shadowExtent, hour: 12 });
  mark('描画の準備・空');
  // engine/ui.js の時刻の操作は tod（hour・auto・update）を使う。それに合わせた小さな時計
  const tod = {
    hour: 12, auto: false, hoursPerSecond: 1 / 15,
    update(dt) { if (this.auto) { this.hour += dt * this.hoursPerSecond; if (this.hour > 20) this.hour = 4.5; } }
  };

  // ============================================================================
  // 地形・水面・草・木
  // ============================================================================
  const nearStep = Math.min(1, Q.nearStep * (site.nearStepScale ?? 1));
  stage('地形を読み込んでいます…');
  const terrain = await createRealTerrain({ scene, data, baseUrl: BASE, nearStep, colorSize: Q.texColor, normalSize: Q.texNormal, season: SEASON.key });
  mark('高さ・地面の種類（形は別スレッドで作り始める）');
  const NB = terrain.bounds.near, MB = terrain.bounds.mid;
  const level = data.water.levelY;
  // 水面：中景の範囲いっぱいに張る（陸の下は地形に隠れる）。水深は近景（とそのまわり）を細かく
  const pad = { x0: 0, z0: 0, x1: 0, z1: 0, ...site.depthPad };
  water = createRealWater({
    scene, level, bounds: MB, heightAt: terrain.heightAt,
    depthBox: { x0: NB.x0 - pad.x0, z0: NB.z0 - pad.z0, x1: NB.x1 + pad.x1, z1: NB.z1 + pad.z1 },
    reflScale: Q.reflScale, flow: site.flow ?? riverFlow(data)
  });
  mark('水面');
  const grass = createRealGrass({ scene, terrain, quality: Q.grass });
  mark('草');
  const treeKinds = site.treeKinds ?? { cherry: 0.2, evergreen: 0.3 };
  const treeList = data.trees.map(t => ({ x: t.x, z: t.z, r: Math.max(2, t.r), kind: t.kind }));
  treeList.push(...(site.extraTrees?.(data, MB) ?? []));
  stage('木を育てています…');
  await nextFrame();
  const trees = await createRealTrees({ scene, trees: treeList, heightAt: terrain.heightAt, season: SEASON, leafScale: Q.leafScale, renderer, nearRadius: Q.treeNear, maxNear: Q.treeMax, kinds: treeKinds });
  mark('木');

  // ============================================================================
  // 歩く範囲と当たり判定・遠景と構造物・その場面だけの施設
  // ============================================================================
  const collider = createCollider({ cell: 2 });
  collider.setBounds(NB.x0 + 2, NB.z0 + 2, NB.x1 - 2, NB.z1 - 2);
  collider.addDynamic((x, z) => terrain.heightAt(x, z) < level + 0.15); // 水には入らない
  for (const t of treeList) if (t.x > NB.x0 && t.x < NB.x1 && t.z > NB.z0 && t.z < NB.z1) collider.addCircle(t.x, t.z, 0.45, 'tree');
  stage('橋と町を建てています…');
  await nextFrame();
  const structures = createRealStructures({ scene, data, terrain, level, collider, season: SEASON, rnd, ...site.structures });
  mark('遠景・構造物');
  const S = data.sheet;
  const ctx = { THREE, scene, data, terrain, level, collider, season: SEASON, sunPath, sky, rnd, NB, MB, LOOP, pbr, structures, tod: () => tod.hour };
  const local = site.build?.(ctx) ?? {};
  mark('場面の施設');
  // 動かない物（橋・建物・施設など）を素材と 200 m の区画ごとにまとめて、描画命令を減らす
  {
    const keep = new Set([terrain.near, terrain.mid, water.mesh, sky.sky, sky.sun, sky.sun.target, sky.hemi, trees.group, structures.backdrop.group, ...grass.layers]);
    // 動く組の中から、動く部品だけを選ぶ：0〜24 時（1 時間ごと）× ループの 6 か所で動かしてくらべる
    let moving = [];
    if (local.dynamic?.length && local.update) {
      const hour0 = tod.hour, hours = 24, steps = 6;
      const env = h => ({ horizon: new THREE.Color(), top: new THREE.Color(), sunDir: new THREE.Vector3(0, 1, 0), night: h < 6 || h >= 18 ? 1 : 0, day: h >= 6 && h < 18 ? 1 : 0, hour: h, elapsed: 0 });
      moving = findMoving(local.dynamic, i => { const h = Math.floor(i / steps); tod.hour = h; local.update((i % steps) * LOOP / steps + 0.37, env(h)); }, hours * steps);
      tod.hour = hour0;
      local.update(0, env(hour0));
    }
    const merged = mergeStatic(scene, { roots: scene.children.filter(o => !keep.has(o)), exclude: moving });
    merged.moving = moving.length;
    if (DEBUG) console.log('まとめた形', merged);
    window.__mergedStatic = merged;
  }
  mark('動かない物をまとめる');

  const toast = createToast(document.getElementById('toast'));
  const audio = createAudio();
  const FOOT = { paved: 'stone', road: 'stone', revetment: 'stone', dirt: 'grass' };
  let started = false;
  // 床の高さを決めた視点（カフェの 3 階など）：3 m 以上歩いたら地面に戻る
  let floorOverride = null;
  const groundForPlayer = (x, z) => floorOverride ? floorOverride.y : terrain.heightAt(x, z);
  const controls = createPlayerController({
    canvas, camera, scene, collider,
    start: { x: S.x, z: S.z, yaw: sunPath.yawOfBearing(S.bearing), pitch: 0 },
    eye: 1.6, isTouch: IS_TOUCH, heightAt: groundForPlayer, walkSpeed: 3.2, runSpeed: 7, maxTapDistance: 140,
    joyEl: document.getElementById('joy'), joyKnobEl: document.getElementById('joy-knob'),
    tapTargets: [terrain.near],
    isInputEnabled: () => started,
    onStuck: () => toast.show('ここから先へは進めないみたい'),
    onPointerDown: () => audio.init(),
    onStep: (x, z) => audio.footstep(FOOT[terrain.groundAt(x, z)] ?? 'grass')
  });
  const player = controls.player;

  // ============================================================================
  // ピクニック：シートと持ち物（すべてのピクニックの場面で共通の engine/picnic-set.js）、拠点の移動
  // ============================================================================
  const picnicSet = createPicnicSet({ scene, toon: pbr, at: S, yaw: sunPath.yawOfBearing(S.bearing), heightAt: terrain.heightAt, loop: LOOP, season: SEASON.key });
  picnicSet.group.traverse(o => o.layers.set(1)); // 水面には映さない（小さく、水際から遠い）
  const base = createBaseCamp({
    root: picnicSet.group, home: { x: S.x, z: S.z, yaw: sunPath.yawOfBearing(S.bearing) }, size: { w: 2.0, d: 1.4 },
    heightAt: terrain.heightAt, isWater: (x, z) => terrain.heightAt(x, z) < level + 0.15,
    isBlocked: (x, z) => collider.solidAt(x, z, 0.05) || !!local.isBlocked?.(x, z),
    storageKey: `picnic-site:base:${site.id}-real`,
    onMove() { picnicSet.relocate(); grass.hideRect(base.pose.x, base.pose.z, 1.05, 0.75, base.pose.yaw); shadows.invalidate(); }
  });
  base.restore();
  grass.hideRect(base.pose.x, base.pose.z, 1.05, 0.75, base.pose.yaw);

  // ============================================================================
  // 視点・UI
  // ============================================================================
  const VIEWS = Object.keys(data.viewpoints).filter(k => document.getElementById('v-' + k));
  const timeUI = bindTimeControls({ tod, input: document.getElementById('time'), label: document.getElementById('time-label'), autoButton: document.getElementById('t-auto') });
  function setHour(h) { tod.hour = h; document.getElementById('time').value = h; }
  const markView = name => { for (const k of VIEWS) document.getElementById('v-' + k).classList.toggle('on', k === name); };
  // 😴 寝っ転がる：その場で寝そべって空を見上げる。もう一度押すと起きる。歩き出しても起きる
  function lieDown() {
    controls.cancelWalk();
    if (controls.mode !== 'walk') controls.setMode('walk');
    const lying = controls.eye < 0.5;
    const v = data.viewpoints.nap;
    player.pitch = lying ? 0 : v.pitch * Math.PI / 180;
    controls.setEye(lying ? 1.6 : v.eye, true);
    controls.settle();
    markView(lying ? null : 'nap');
  }
  function setView(name) {
    if (name === 'nap') { lieDown(); return; }
    let v = data.viewpoints[name];
    // 夕日の視点：季節ごとの日の入りの少し前に、日の沈む方位を向く（秋はもとの構図）
    if (name === 'sunset' && SEASON.key !== 'autumn') { const hh = sunPath.sunset - 0.2; v = { ...v, hour: hh, bearing: sunPath.sunAt(hh).azimuth }; }
    if (name !== 'lunch') setHour(v.hour); // 拠点に戻るだけのときは、時刻はそのまま
    controls.cancelWalk();
    if (controls.mode !== 'walk') controls.setMode('walk');
    // シートの視点は、シートを移した場所に読み替える
    const p = name === 'lunch' ? base.fromHome(v.x, v.z, sunPath.yawOfBearing(v.bearing)) : { x: v.x, z: v.z, yaw: sunPath.yawOfBearing(v.bearing) };
    player.x = p.x; player.z = p.z;
    player.yaw = p.yaw;
    player.pitch = v.pitch * Math.PI / 180;
    floorOverride = v.floorY !== undefined ? { y: v.floorY, x: v.x, z: v.z } : null;
    controls.setEye(v.eye, true);
    controls.settle();
    shadows.invalidate();
    markView(name);
  }
  for (const k of VIEWS) btn('v-' + k, () => setView(k));
  for (const ss of Object.values(REAL_SEASONS)) {
    const b = document.createElement('button');
    b.textContent = `${ss.icon} ${ss.label}`;
    b.title = `${ss.label}（${ss.when}）にする。草木の色・太陽の通り道が変わります（読み直します）`;
    b.classList.toggle('on', ss.key === SEASON.key);
    b.addEventListener('click', () => {
      if (ss.key === SEASON.key) return;
      try { localStorage.setItem(SEASON_KEY, ss.key); } catch { /* URL で渡す */ }
      const u = new URL(location.href); u.searchParams.set('season', ss.key); location.replace(u.toString());
    });
    document.getElementById('season-row').append(b);
  }
  bindBaseCampUI({ base, toast, bind: btn, player: () => ({ x: player.x, z: player.z, yaw: player.yaw }), isEnabled: () => started });
  btn('o-snd', el => { audio.init(); audio.setEnabled(!audio.enabled); el.classList.toggle('on', audio.enabled); el.textContent = audio.enabled ? '🔊 音' : '🔇 音'; });
  addEventListener('keydown', () => audio.init());
  bindQualityUI(document.getElementById('quality-row'), Q);
  for (const el of document.querySelectorAll('#start p, #credit')) el.innerHTML = el.innerHTML.replace('2026年10月18日', `${dateText(SEASON)}（${SEASON.label}）`);

  const menuEl = document.getElementById('menu');
  const autoHide = createAutoHide({ isPinned: () => !started || !menuEl.classList.contains('hidden') });
  const placeAboveDock = el => { el.style.bottom = `${innerHeight - document.getElementById('bar').getBoundingClientRect().top + 8}px`; };
  btn('o-more', el => {
    const open = menuEl.classList.toggle('hidden') === false;
    el.classList.toggle('on', open);
    if (open) { placeAboveDock(menuEl); autoHide.show(); }
  });
  addEventListener('resize', () => { if (!menuEl.classList.contains('hidden')) placeAboveDock(menuEl); });
  btn('o-help', () => document.getElementById('help').classList.toggle('hidden'));
  btn('o-pixel', () => { location.href = site.pixelPage + location.search; });
  addEventListener('keydown', e => {
    if (!started) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && site.viewKeys[m[1] - 1] && data.viewpoints[site.viewKeys[m[1] - 1]]) setView(site.viewKeys[m[1] - 1]);
    if (e.code === 'Escape') { menuEl.classList.add('hidden'); document.getElementById('o-more').classList.remove('on'); }
    if (/^(Key[WASD]|Arrow)/.test(e.code) && controls.eye < 1.5) controls.setEye(1.6);
  });

  function begin(view) {
    started = true;
    document.getElementById('start').remove();
    audio.init();
    if (view) setView(view);
    else { setView('lunch'); controls.setEye(1.6); }
    controls.setMode('walk');
    if (!IS_TOUCH) document.getElementById('help').classList.remove('hidden');
    autoHide.show();
  }
  btn('s-lunch', () => begin('lunch'));
  btn('s-sunset', () => begin('sunset'));
  btn('s-walk', () => begin(null));

  // ---- 場所の名前と水までの距離（8 方向に 2 m おき、60 m まで。0.5 m 以内なら前の答え）
  let dwCache = { x: 1e9, z: 1e9, d: 999 };
  function distToWater(x, z) {
    if (Math.hypot(x - dwCache.x, z - dwCache.z) < 0.5) return dwCache.d;
    let d0 = 999;
    outer: for (let d = 2; d <= 60; d += 2) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (terrain.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) < level - 0.05) { d0 = d; break outer; }
    }
    dwCache = { x, z, d: d0 };
    return d0;
  }
  const locEl = document.getElementById('loc');
  let zoneAt = { x: 1e9, z: 1e9 };
  function zoneName(x, z) {
    if (floorOverride && local.floorName) return local.floorName;
    if (Math.hypot(x - base.pose.x, z - base.pose.z) < 4) return 'シートのそば';
    return local.zoneName?.(x, z, { distToWater }) ?? site.label;
  }

  // ---- 音：水音（水際に近いほど）、風（高い所ほど強く）、トビ、秋の虫（初夏はまだ鳴かない）
  let kiteTimer = 4, bugTimer = 1;
  function updateSound(dt) {
    audio.setWater(0.16 * Math.max(0, 1 - distToWater(player.x, player.z) / 20), dt);
    const high = Math.min(1, Math.max(0, terrain.heightAt(player.x, player.z) / 7));
    audio.setBed('wind', 0.05 + 0.07 * high + 0.02 * Math.sin(elapsed * 2 * Math.PI / LOOP), dt);
    kiteTimer -= dt;
    if (kiteTimer < 0) { kiteTimer = 9 + Math.random() * 14; if (sky.state.elevation > 3) audio.kite(); }
    bugTimer -= dt;
    if (bugTimer < 0) { bugTimer = 0.25 + Math.random() * 0.9; if (SEASON.key === 'autumn' && FAUNA.autumn.crickets && (sky.state.night > 0.15 || sky.state.elevation < 4)) audio.cricket(0.95 + Math.random() * 0.1); }
  }

  // ============================================================================
  // 毎フレーム
  // ============================================================================
  const hud = DEBUG ? createDebugHud(renderer, () => `res ×${resScaler.scale.toFixed(2)}` + (resScaler.gpuMs !== null ? `  gpu ${resScaler.gpuMs.toFixed(1)} ms` : '')) : null;
  let last = performance.now(), elapsed = 0;
  const skyColor = new THREE.Color(), skyTop = new THREE.Color(), skyHor = new THREE.Color();
  function step(dt) {
    if (!started) player.yaw += dt * 0.03;
    tod.update(dt);
    timeUI.update();
    toast.update(dt);
    controls.update(dt);
    if (controls.walking && controls.eye < 1.5) controls.setEye(1.6);
    if (floorOverride && Math.hypot(player.x - floorOverride.x, player.z - floorOverride.z) > 3) floorOverride = null;
    camera.updateMatrixWorld();
    if (tod.hour !== sky.hour) sky.apply(tod.hour);
    sky.follow(camera.position);
    shadows.update(sky.state.sunDir, sky.shadowCenter);
    elapsed += dt;
    const loopT = elapsed % LOOP;
    skyColor.copy(sky.uniforms.uHorizon.value).lerp(sky.uniforms.uZenith.value, 0.4).multiplyScalar(sky.uniforms.uScale.value);
    water.update(elapsed, { sun: sky.sun, skyColor });
    grass.update(elapsed, camera);
    trees.update(elapsed, sky.state.day, camera.position);
    skyHor.copy(sky.uniforms.uHorizon.value).multiplyScalar(sky.uniforms.uScale.value);
    skyTop.copy(sky.uniforms.uZenith.value).multiplyScalar(sky.uniforms.uScale.value);
    const env = { horizon: skyHor, top: skyTop, sunDir: sky.state.sunDir, night: sky.state.night, day: sky.state.day, hour: tod.hour, elapsed };
    structures.update(env, camera.position);
    local.update?.(loopT, env);
    // 持ち物（湯気・本のページ・ランタンは夕方から灯る）
    picnicSet.update(loopT, { night: sky.state.night, dusk: Math.max(0, 1 - Math.abs(sky.state.elevation - 1) / 6) });
    if (started) updateSound(dt);
    if (Math.hypot(player.x - zoneAt.x, player.z - zoneAt.z) > 0.5) { zoneAt = { x: player.x, z: player.z }; locEl.textContent = '📍 ' + zoneName(player.x, player.z); }
    resScaler.begin();
    renderer.render(scene, camera);
    resScaler.end();
    resScaler.update(dt * 1000);
    hud?.update();
  }
  mark('ピクニック・UI');
  setView('lunch');
  controls.setEye(1.6, true);
  // 地形の形（別スレッド）と地面の素材を待つ
  stage('地形の形を仕上げています…');
  await terrain.ready;
  mark('地形の形と地面の素材を待つ');
  if (DEBUG) console.table(Object.fromEntries(Object.entries(terrain.timings).map(([k, v]) => [k, Math.round(v)])));
  // シェーダーを組み立てる。対応していれば並べて組み立て、そのあいだも画面は固まらない（KHR_parallel_shader_compile）
  stage('光と影を準備しています…');
  await nextFrame();
  await renderer.compileAsync(scene, camera);
  mark('シェーダーの組み立て');
  step(0);
  mark('最初の 1 コマ');
  document.getElementById('loading').remove();
  if (DEBUG) { console.table(marks); window.__realMarks = marks; }
  renderer.setAnimationLoop(now => { step(Math.min(0.05, (now - last) / 1000)); last = now; });

  if (DEBUG) window.__real = { resScaler, shadows, THREE, data, renderer, scene, camera, sky, terrain, water, grass, trees, treeList, structures, local, picnicSet, base, audio, controls, player, tod, setView, setHour, begin, sunPath, collider };
}
