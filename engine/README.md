# ドット絵ワールド共通エンジン

`town_3d.html`（ドット街さんぽ）から切り出した、場面に依存しない仕組みです。
`town_3d.html` と `picnic.html`（川辺のピクニック）がこれを使っています。

ES モジュールなので、ファイルを直接開くのではなくローカルサーバー経由で開いてください。

```bash
cd ~/picnic-site && python3 -m http.server 8790
```

`three` は各 HTML の importmap で読み込みます（現在 `three@0.160.0`）。

## モジュール

| ファイル | 役割 | 主な関数 |
|---|---|---|
| `pixel-kit.js` | 共通パレット、乱数、ドット絵テクスチャ、トゥーンマテリアル、素材ごとの3色塗り | `MASTER_PALETTE` `PPM` `mulberry32` `makePicker` `makeCanvas` `shade` `pixelTex` `createToon` `rampify` `RAMP` `glsl` |
| `pixel-renderer.js` | 低解像度描画 → 輪郭線・ディザ・減色（43色パレット または 各色N段階）→ 拡大。空気中の光の筋、明るい点のにじみ、縦長画面の視野補正も行う | `createPixelRenderer`（`setQuantize` `setVolumetric` `setBloom` `setGrade` `setSunRays`） |
| `sky.js` | 空（グラデーション・太陽・月・星）、遠景の山、雲、高い空のうろこ雲（`cirrus`）。広い場面では `radius`（空の球）と `cloudScale` を大きく、`mountains: 0` | `createSky` |
| `time-of-day.js` | 太陽と環境光、時刻キーフレームの連続補間。`sunPath` を渡すと実際の太陽・月を使い、`setShadowCenter` で影の範囲をカメラに追従させる | `createLights` `createTimeOfDay` `DEFAULT_TOD_KEYS` |
| `sun.js` | 実際の太陽・月の位置（日付・緯度経度・時刻から）、方位と場面の向きの変換 | `createSunPath` `solarPosition` `lunarPosition` `bearingToDir` |
| `terrain.js` | 高さの画像から作る地形（近景 1 m＋中景 4 m）。地面の種類からドット絵のテクスチャを焼く | `createHeightTerrain` `loadHeightField` `GROUND_LOOKS` |
| `trees.js` | 木と木漏れ日（影に葉のすき間）。近くの木は 1 本ずつ揺らし、遠くの木はまとめて描く | `createLeafKit` `createForest` |
| `grass.js` | 風で揺れる草のまとめ描き（芝の房・ススキやオギの株・穂）。ループ周期で揺れる | `createSwayingGrass` |
| `structures.js` | 数値から組み立てる構造物：トラス橋・桁橋・橋脚、送電鉄塔と電線（たるみつき）、家並み（まとめ描き）、窓の模様と夜の窓明かり、大観覧車（遠くでも消えないよう 1 ドットの線と点でも描く） | `createBridge` `createPowerLines` `pylonGeometry` `createHouses` `windowTextures` `createFerrisWheel` `GeoBuilder` |
| `backdrop.js` | 遠景の影絵（塔・鉄骨の塔・山・台地・家並み）を方位と見かけの大きさを合わせて立てる。時間帯と逆光で色を変える | `createBackdrop` |
| `collision.js` | 円（プレイヤー）と四角・円の当たり判定、障害物を避ける経路探索（A*） | `createCollider` `circleRect` `findPath` |
| `water.js` | ドット絵の水面（旧版の作り方：細かく強い波、波で歪む反射、屈折で見せる川底、深さで変わる水の色、川底の光、岸の泡、きらめきの筋、波紋）。広い川向けに `shape`（水際の形）・`depthBounds`・`clarity`（濁り）・`waveFade`（遠くの波で反射を乱さない） | `createPixelWater` |
| `player.js` | 歩行操作（キーボード、ドラッグ見回し、スマホのスティック、タップした場所へ経路を探して歩く、おまかせ散策、歩行の揺れ、起伏・座る目線） | `createPlayerController` |
| `audio.js` | 合成音（足音・水音・風・遠くの電車の響き・鳥・トビ・秋の虫・猫・チャイム） | `createAudio`（`setBed('wind' / 'rumble')` `cricket` `kite`） |
| `capture.js` | PNG とループ動画の書き出し（320×180 を 4 倍して 1280×720）。~/Downloads へはブリッジ経由、無ければブラウザのダウンロード | `createCapture` |
| `ui.js` + `ui.css` | 下部バー、通知、時刻スライダー、パネル、スタート画面、スティックの見た目 | `bindButton` `createToast` `bindTimeControls` `fmtTime` |

## 最小の組み立て方

```js
import * as THREE from 'three';
import { mulberry32, createToon } from './engine/pixel-kit.js';
import { createPixelRenderer } from './engine/pixel-renderer.js';
import { createSky } from './engine/sky.js';
import { createLights, createTimeOfDay } from './engine/time-of-day.js';
import { createCollider } from './engine/collision.js';
import { createPlayerController } from './engine/player.js';

const rnd = mulberry32(1);
const toon = createToon();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb6dcf6, 22, 72);
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 320);
camera.rotation.order = 'YXZ';
const canvas = document.getElementById('view');

const pixel = createPixelRenderer({ canvas, scene, camera });
const { sun, hemi } = createLights(scene);
const sky = createSky(scene, { rnd });
pixel.hideInNormalPass.add(sky.mesh);
const tod = createTimeOfDay({ scene, sky, sun, hemi, onApply: ({ night }) => { /* 明かりなど */ } });

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), toon({ color: '#5fa04a' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const collider = createCollider();
collider.setBounds(-20, -20, 20, 20);
const controls = createPlayerController({ canvas, camera, scene, collider, start: { x: 0, z: 5 }, tapTargets: [ground] });

let last = performance.now(), elapsed = 0;
requestAnimationFrame(function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; elapsed += dt;
  tod.update(dt);
  controls.update(dt);
  sky.update(dt, elapsed, camera.position);
  pixel.render();
  requestAnimationFrame(frame);
});
```

## 画面UI（`ui.css`）が前提とする要素

`ui.css` を読み込み、使う部品だけ置けば動きます。省いた部品は単に表示されません。

- `#view`：描画先の canvas
- `#hud-tl`（`.title` と `#loc`）：左上の場所表示
- `#bar`：下部バー。`.group` で区切り、スマホでは `.opts` を ⚙️（`#o-more`）の中にしまう
  - `#m-walk` `#m-stroll` `#s-pause`：モード切替と一時停止（`#s-pause.show` で表示）
  - `#time-label` `#time` `#t-auto`：時刻（`bindTimeControls` で結びつける）
- `#prompt`：近づいたときの「E: 入る」ボタン
- `#toast`：通知（`createToast`）
- `#help`：PC向けの操作説明（スマホでは非表示）
- `#joy` > `#joy-knob` + `#joy-label`：スマホのスティック（`createPlayerController` に要素を渡す）
- `#panel` > `.card`（`.tag` `h2` `#p-close`）：入ったときの内容パネル
- `#start` > `.card`（`.btns`）：スタート画面

## 旧版（legacy/picnic_3d.html）の光と水の作り方

`picnic.html` は旧版の美しさの要素を移植しています。

- **色**：`pixel.setPaletteOn(false)` と `pixel.setQuantize(32, 0.032)` で各色32段階に。43色パレットより光のグラデーションが残る。
- **素材ごとの3色**：`rampify(material)` を全トゥーン素材にかけ、光の当たり方を影・中間・光の3段階に分けて `RAMP` の色ずらしを掛ける（影は青紫、光は黄みへ）。時間帯の光の色・暗さは保ち、ランタンなどの灯りは上に足す。
- **空気中の光の筋**：`pixel.setVolumetric(sun, 強さ, 色)` を毎フレーム。視線に沿って影マップを調べるので、葉のすき間を通る光が筋になる。
- **逆光の構図**：`createTimeOfDay({ sunZ: -0.45 })` で太陽を北側に通すと、北を眺める視点で水面のきらめき・光の筋・葉の縁の光が見える（旧版の美しさの大きな要因）。

## 起伏のある地面と水面

- 地面が平らでない場面では、`createPlayerController` に `heightAt(x, z)` を渡すと目線が地形や橋に沿います。`setEye(h)` で目の高さを変えられます（座る・立つ）。
- 水面は `createPixelWater` で作り、毎フレーム `water.update(dt, elapsed, { sun, hemi, night, fog })` と、`pixel.render()` の直前に `water.renderReflection(pixel.size.width, pixel.size.height)` を呼びます。水深は `groundHeight(x, z)` から起動時に一度だけ計算します。
- 波・川底の光は `loop`（既定6秒）の周期で繰り返すので、ループ動画の継ぎ目が出ません。
- 波紋は `water.addRipple(x, z, 強さ, 大きさ)`。大きさ（既定 1）を上げると輪の幅・広がる速さ・最大の半径がその倍になる（傾きは同じ）。広い川で遠くの水面をタップしたときに、画面での見え方を近くと同じくらいにするのに使う。波紋は `waveFade` で波を弱めた遠くでも消えない。

## 実在の場所を描く広い場面（江戸川）

`tools/geo/build_scene.py` が作る `scenes/edogawa/` を読みます。組み立ての例は `edogawa.html`・`nagisa.html`（場面）と `dev/edogawa_p1.html`（P1 の確認用ページ）。

```js
const data = await (await fetch('scenes/edogawa/scene.json')).json();
const sunPath = createSunPath({ ...data.sun, upstreamBearing: data.frame.upstreamBearing });
const tod = createTimeOfDay({ scene, sky, sun, hemi, sunPath, fogFar: 1500, lightDistance: 150 });
const terrain = await createHeightTerrain({ scene, data, baseUrl: 'scenes/edogawa/', material: toon });
const backdrop = createBackdrop({ scene, items: data.landmarks.backdrop, upstreamBearing: data.frame.upstreamBearing });
// 毎フレーム
tod.setShadowCenter(camera.position);
backdrop.update({ horizon: sky.uniforms.uHor.value, top: sky.uniforms.uTop.value, sunDir: tod.state.sunDir, night: tod.night }, camera.position);
```

- カメラは `near 0.15`・`far 2600`、空は `radius 2400`、遠景は半径 約 1800 m の輪に立つ。中景の地形は原点から最大 約 1.5 km。
- 方位 b を向くカメラの yaw は `sunPath.yawOfBearing(b)`。
- 毎フレームの順番：`controls.update` → `camera.updateMatrixWorld()` → `tod.setShadowCenter` → `tod.update` → …（周期で繰り返すものには `elapsed % LOOP` を渡す）→ `pixel.prepareShadows()` → `water.renderReflection` → `pixel.render()`。この順でないと、視点を移した直後の 1 コマや、ループの継ぎ目で影・光の筋がわずかにずれる。
- 時間帯の色の表（`DEFAULT_TOD_KEYS`）は、`sunPath` があると日の出・南中・日の入りに合わせて読み替える（`sunPath.keyHour(h)`）。その日の実際の時刻で書いた表を使うときは `keyClock: 'real'`（江戸川・なぎさ公園は `realsite/look.js` の `EDO_TOD_KEYS`）。

## 書き出し（PNG・ループ動画）

`picnic.html` の 📷 書き出し（P: PNG / R: 6秒ループ録画）がこれを使っています。

```bash
node tools/export_server.js --bridge-only
```

- ブリッジ（`tools/export_server.js`）が動いていれば、書き出したファイルを ~/Downloads に直接保存します。`.mp4` は ffmpeg で H.264 に変換されます。`--bridge-only` を付けると、起動時に旧版の PNG・動画を作りません。
- ブリッジが無ければ、ブラウザのダウンロードとして保存します（形式はブラウザ次第で mp4 または webm）。
- 録画中は `capture.elapsed()` を場面の時計にしてください（0 秒から始まるので、周期の倍数の長さなら最初と最後がつながります）。描画のたびに `capture.frame()` を呼びます。カメラは `controls.settle()` で静止させます。
- 書き出し中は描画解像度を 320×180 に固定し、画面には比率を保って表示します。

## 注意

- `createPlayerController` は移動キー（WASD・矢印）だけを扱います。E・Esc・Space などの操作は場面側で `keydown` を受けてください（`town_3d.html` を参照）。
- 法線パスに描きたくないもの（空、パーティクル）は `pixel.hideInNormalPass` に追加します。追加しないと、そこにも輪郭線が出ます。
- `createSky` は渡した `rnd` で山と雲を並べます。同じ seed なら同じ見た目になります。
- 深度を書くもの（透明でも）には輪郭線が付きます。パーティクルは `depthWrite: false` にしてください。
- `python3 -m http.server` はキャッシュを抑止しないので、engine を書き換えた後は強制再読み込み（Cmd+Shift+R）してください。
