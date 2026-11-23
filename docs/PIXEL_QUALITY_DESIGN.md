# 実在 4 場面ドット絵 光・水・影の質感調整 詳細設計書（SDD）

作成：2026-11-23。関連方針：[PIXEL_QUALITY_PLAN.md](PIXEL_QUALITY_PLAN.md)。
前提資料：[LIGHTING_DESIGN.md](LIGHTING_DESIGN.md) / [SUNSET_REVIEW.md](SUNSET_REVIEW.md) / [FIXED_TIMESTEP_EXPORT_SPEC.md](FIXED_TIMESTEP_EXPORT_SPEC.md)。

---

## 1. スコープと現状ベースライン

対象は実在 4 場面のドット絵ページとする。`picnic.html` はベンチマーク基準であり変更しない。

### 1.1 現状パラメータ対照表

| 項目 | 基準：`picnic.html` | `edogawa.html` | `nagisa.html` | `myoden.html` | `myoden-far.html` |
|---|---:|---:|---:|---:|---:|
| 水 `clarity` | `1.0` | `0.3` | `0.4` | `0.4` | `0.4` |
| 水 `caustic` | `1.0` | `0.15` | `0.2` | `0.2` | `0.2` |
| 水 `wave` | `1.0` | `0.8` | `0.85` | `0.85` | `0.85` |
| 水 `waveFade` (m) | `[1e4, 2e4]` | `[4, 20]` | `[4, 20]` | `[4, 20]` | `[4, 20]` |
| 水 `depthRes` (px) | `256` (21×64 m) | `256` (266×192 m) | `256` (360×370 m) | `256` (360×450 m) | `256` (380×460 m) |
| 水 `maxDepth` (m) | `1.0` | `3.0` | `3.0` | `3.0` | `3.0` |
| 水 `tints.day` (浅/深) | `#47bdb3` / `#1a5c8f` | `#7a9478` / `#41605e` | `#6f9a92` / `#2f5670` | `#6f9a92` / `#2f5670` | `#6f9a92` / `#2f5670` |
| 木漏れ日 `createLeafKit` | `softDapple: true` | **未導入** | `softDapple: true` | `softDapple: false` | `softDapple: false` |
| 影範囲 `extent` (m) | `26` (2.5 cm/px) | `60` (5.9 cm/px) | `60` (5.9 cm/px) | `60` (5.9 cm/px) | `60` (5.9 cm/px) |
| ブルーム `setBloom` | `1.0` | `0.9` | `0.9` | `0.9` | `0.9` |
| 空中光 `vol` (昼/夕/夜) | `0.30 / 1.10 / 0.35` | `0.12 / 0.75 / 0.25` | `0.12 / 0.75 / 0.25` | `0.12 / 0.75 / 0.25` | `0.12 / 0.75 / 0.25` |
| 空中光距離 `volMax` (m) | `28` | `60` | `60` | `60` | `60` |
| 光芒 `setSunRays` | `warm * 0.90` | `warm * 0.85` | `warm * 0.85` | `warm * 0.85` | `warm * 0.85` |
| `RAMP.shadow` (昼) | `[0.24, 0.30, 0.36]` | `[0.26, 0.30, 0.36]` | `[0.26, 0.30, 0.36]` | `[0.26, 0.30, 0.36]` | `[0.26, 0.30, 0.36]` |
| `RAMP.mid` (昼) | `[0.74, 0.77, 0.78]` | `[0.76, 0.77, 0.76]` | `[0.76, 0.77, 0.76]` | `[0.76, 0.77, 0.76]` | `[0.76, 0.77, 0.76]` |

---

## 2. 詳細仕様

### 2.1 Stage A：水面表現の調整

#### A-1. 各ページの `createPixelWater` 設定仕様

実在 4 場面の河川・河口・干潟の文脈を保ちつつ、水際の透け感・コースティクス・中距離の反射揺らぎを改善する。

| ページ | `depthRes` | `clarity` | `caustic` | `wave` | `waveFade`（最終確定 A-2） | `tints.day` `[浅, 深, 泡, 川底光]` |
|---|---:|---:|---:|---:|---|---|
| `edogawa.html` | `512` | `0.55` | `0.45` | `0.95` | `[6, 28]` | `['#5f968e', '#2c586b', '#e8f4ee', '#7fc4b8']` |
| `nagisa.html` | `512` | `0.62` | `0.50` | `0.95` | `[6, 28]` | `['#5aa29c', '#245474', '#eaf6f4', '#7cc8be']` |
| `myoden.html` | `512` | `0.62` | `0.50` | `0.95` | `[6, 28]` | `['#5aa29c', '#245474', '#eaf6f4', '#7cc8be']` |
| `myoden-far.html` | `512` | `0.62` | `0.50` | `0.95` | `[6, 28]` | `['#5aa29c', '#245474', '#eaf6f4', '#7cc8be']` |

- `tints.dusk`・`tints.night`：既存の夕景・夜景の配色（`dusk: ['#b8806b', '#46345a', '#ffdbb8', '#d98c40']`, `night: ['#1f4a5a', '#0d1f33', '#7f99bf', '#3c6a8a']`）を維持する。
- `maxDepth`：`3` を維持する（河川・河口の実際深度表現を崩さないため）。
- **深さマップ解像度 `depthRes: 512` の根拠**：
  - 既存の `depthRes: 256` では近景 360〜460 m に対して 1 texel が 1.4〜1.8 m となり、水深 `0.05 m` の岸辺の泡や `0.75 m` 未満のコースティクスが段階的に途切れる。
  - `512` にすることで 1 texel あたり約 0.5〜0.9 m と 2 倍精細化する。`RedFormat` 8-bit テクスチャのメモリ増分は `64 KB → 256 KB`（+192 KB）のみで、初期化時に 1 度だけ生成するため毎フレームの描画負荷は増加しない。
- **`waveFade: [10, 45]` の根拠と検証ポイント**：
  - 従来の `[4, 20]` では、シート視点や堤防視点から 20 m 以上離れた川面で法線 `nR` が完全に平坦化され、反射の揺らぎが消失していた。
  - `[10, 45]` に延長することで、水際（10 m 以内）の強い波と河川中ほど（10〜45 m）の揺らぐ反射を両立し、45〜180 m（`uWaveFade.y`〜`uWaveFade.y * 4.0`）にかけて遠景グリッター表現（`water.js` L98–109）へ滑らかに遷移させる。
  - **フォールバック条件（A-2 予備設計）**：Stage A のブラウザ検証で 25〜45 m 付近の反射に「対岸の暗い帯が波で引っ張られる／ちらつく」現象が確認された場合は、`engine/water.js` に反射 UV 歪み距離減衰（`reflDistort = 0.6 * mix(1.0, 0.35, smoothstep(uWaveFade.x, uWaveFade.y, camDist))`）または `waveFade: [8, 36]` への再調整を適用する。問題がなければ `engine/water.js` のシェーダーは無変更とする。

---

### 2.2 Stage B：木漏れ日・樹木の統一

#### B-1. `nagisa.html` / `myoden.html` / `myoden-far.html`

- `myoden.html`・`myoden-far.html`：`createLeafKit({ loop: LOOP })` を `createLeafKit({ loop: LOOP, softDapple: true })` に変更する（`nagisa.html` は適用済み）。
- 3 ページ共通：PNG 書き出し用の `renderOnly()` でも `pixel.prepareShadows()` の直前に `leafKit.update(elapsed % LOOP, sun);` を呼ぶように揃え、`picnic.html` と同じく静止画書き出し時の影の向きを確実に同期させる。

#### B-2. `edogawa.html`

現状 `edogawa.html`（L210–262）は独自 `makeTree()` で単純な `IcosahedronGeometry(s, 0)` と通常の `toon()` を生成しており、`createLeafKit` の木漏れ日（`depthMat`）・葉の色斑（`leafify`）・風揺れがない。

以下の方針で共通 `createLeafKit` へ統合する。

1. `engine/trees.js` から `createLeafKit` を import し、`const leafKit = createLeafKit({ loop: LOOP, softDapple: true });` を生成する。
2. `edogawa.html` 内の `makeTree` の葉マテリアル生成（`leafMats` および `seasonMat`）をすべて `leafKit.leafify(toon({ color, flatShading: true }))` でラップする。
3. 葉メッシュに以下を適用する：
   - ジオメトリ：共有 `const leafGeo = new THREE.IcosahedronGeometry(1, 1);` を `scale.set(s, s * 0.8, s)` で使用（`picnic.html`・`createForest` と同じ面分割・メモリ共有）。
   - 影の穴抜き：`m.customDepthMaterial = leafKit.depthMat;` を設定。
   - 風揺れ：葉の塊を `foliage = new THREE.Group()` にまとめ、6 秒周期 `W0 = Math.PI * 2 / LOOP` で `picnic.html` / `createForest` と同等の微小揺れ（`amp = 0.01` 程度）を付与する。
4. フレーム更新順の厳守（[LIGHTING_DESIGN.md](LIGHTING_DESIGN.md) 準拠）：
   - `step()` 内で `tod.update(dt)` の後、かつ `pixel.prepareShadows()` の前に `leafKit.update(loopT, sun)` と樹木の風揺れ更新を呼ぶ。
   - `renderOnly()`（PNG 書き出し）内でも `pixel.prepareShadows()` の前に `leafKit.update(elapsed % LOOP, sun)` を呼ぶ。
   - テスト・検証のため、`window.__edo` デバッグオブジェクトに `leafKit` を公開する。
5. 既存の配置・当たり判定（`data.trees`・`data.landmarks.treeRows` の桜並木・`treeColliders`）および季節ごとの落葉（冬は枝のみ）仕様は完全に維持する。

---

### 2.3 Stage C：光・影・空気感の調整

#### C-1. シャドウマップ範囲の引き締め（4 ページ共通）

- `createLights(scene, { shadowSize: IS_TOUCH ? 1024 : 2048, extent: 40, far: 320 })` に変更する（`extent: 60 → 40`）。
- 1 シャドウテクセルのサイズ：
  - PC（`2048`）：`120 / 2048 = 5.86 cm` → **`80 / 2048 = 3.91 cm`**（面積密度 **2.25 倍**）
  - モバイル（`1024`）：`120 / 1024 = 11.72 cm` → **`80 / 1024 = 7.81 cm`**（面積密度 **2.25 倍**）
- すでに全 4 ページで毎フレーム `tod.setShadowCenter(camera.position)` とテクセルスナップ（`engine/time-of-day.js` L71–76）が動作しているため、移動時の影のちらつきは増えない。
- **検証時の調整幅**：代表視点（特に高台や堤防上から見下ろす構図）で 40 m 先の影の途切れが目立つページがある場合は、そのページのみ `extent: 46` まで緩和可能とする。

#### C-2. `realsite/look.js` の拡張仕様（後方互換 100% 維持）

既存の `tests/lighting.test.mjs`（L47–64）は、`createLook` を追加オプションなしで呼んだときに `rays = state.warm * 0.85`・`volMax = 60` となることを検証している。後方互換を壊さないため、`createLook` の引数に任意オプション `atmosphere`（または個別数値オプション）を追加する。

```js
export function createLook({
  pixel, RAMP, tod, sun, sunPath, sky, wires, steam,
  nightLights = [], softLighting = false, groundHeight = () => 0,
  volDay = 0.12, volWarm = 0.75, volNight = 0.25, volMax = 60,
  dayShadow = [0.26, 0.30, 0.36], dayMid = [0.76, 0.77, 0.76]
})
```

- 省略時はすべて現行と完全同一の既定値となり、既存呼び出し・既存テストを一切破壊しない。
- `softLighting: false` のパス（`realsite/look.js` L79–80）で以下を適用する：
  ```js
  pixel.setVolumetric(sun, day * volDay + warm * volWarm + night * volNight, sun.color, volMax);
  pixel.setSunRays(sd, sd.y > 0.0 ? warm * 0.85 : 0, sun.color);
  ```
- **夕景保護ルール**：`setSunRays` の `warm * 0.85` および `sd.y > 0.0` 条件は変更しない（[SUNSET_REVIEW.md](SUNSET_REVIEW.md) 準拠）。
- 各ページから渡す値：

| ページ | 分類 | `volDay` | `volWarm` | `volNight` | `volMax` (m) | `dayShadow` | `dayMid` | `setBloom` |
|---|---|---:|---:|---:|---:|---|---|---:|
| `nagisa.html` | 木立の公園 | `0.22` | `0.90` | `0.30` | `42` | `[0.24, 0.30, 0.36]` | `[0.74, 0.77, 0.78]` | `1.0` |
| `edogawa.html` | 開けた河川敷 | `0.18` | `0.90` | `0.30` | `45` | `[0.24, 0.30, 0.36]` | `[0.74, 0.77, 0.78]` | `1.0` |
| `myoden.html` | 開けた河川敷 | `0.18` | `0.90` | `0.30` | `45` | `[0.24, 0.30, 0.36]` | `[0.74, 0.77, 0.78]` | `1.0` |
| `myoden-far.html` | 開けた河川敷 | `0.18` | `0.90` | `0.30` | `45` | `[0.24, 0.30, 0.36]` | `[0.74, 0.77, 0.78]` | `1.0` |

- **設計根拠**：
  - `volMax` を 60 m → 42〜45 m に絞ることで、24 サンプルのレイマーチ間隔が `2.5 m → 1.75〜1.88 m` に高密度化され、かつシャドウ範囲 `extent: 40` の外側（常に `lit = 1.0` となる領域）を積分する割合が減少するため、昼の不要な白霞を抑えながら光の筋のメリハリを高められる。
  - `volWarm` を `0.75 → 0.90`、`setBloom` を `0.9 → 1.0` に上げることで、夕暮れの逆光・水面のきらめき・夜のランタンや窓明かりの暖かさが `picnic.html`（`volWarm: 1.1`, `bloom: 1.0`）に近づく。
  - 昼の `RAMP` を `picnic.html` と揃えることで、日なたの暖色と木陰の青緑影の対比が明瞭になる。

---

## 3. 変更対象ファイル一覧

| ファイル | 変更概要 |
|---|---|
| `realsite/look.js` | `createLook` に `volDay`, `volWarm`, `volNight`, `volMax`, `dayShadow`, `dayMid` オプション追加（既定値は現行維持） |
| `edogawa.html` | 水面パラメータ（A）、`createLeafKit({ softDapple: true })` 導入・葉色斑/風揺れ/更新順整備（B）、`extent: 40`・`setBloom(1.0)`・`createLook` 調整（C） |
| `nagisa.html` | 水面パラメータ（A）、`renderOnly()` への `leafKit.update` 同期追加（B）、`extent: 40`・`setBloom(1.0)`・`createLook` 調整（C） |
| `myoden.html` | 水面パラメータ（A）、`softDapple: true` 化・`renderOnly()` への `leafKit.update` 同期追加（B）、`extent: 40`・`setBloom(1.0)`・`createLook` 調整（C） |
| `myoden-far.html` | 水面パラメータ（A）、`softDapple: true` 化・`renderOnly()` への `leafKit.update` 同期追加（B）、`extent: 40`・`setBloom(1.0)`・`createLook` 調整（C） |
| `engine/water.js` | **A-2 適用**：反射 UV 歪みの距離減衰（`reflDistort = 0.6 * mix(1.0, 0.35, smoothstep(uWaveFade.x, uWaveFade.y, camDist))`）を追加。`picnic.html` は `waveFade: [1e4, 2e4]` のため影響 0 |
| `tests/lighting.test.mjs` | 新規受け入れ基準のユニットテスト 4 件を追加 |
| `tools/validate-pixel-quality.cjs` | ゼロ依存 CDP 視覚比較・夕景環帯・6 秒ループ・GPU 時間・書き出し検証スクリプトを新規追加 |

---

## 4. 受け入れ基準（TDD テスト仕様・ブラウザ検証仕様）

### 4.1 自動ユニットテスト（`tests/lighting.test.mjs`）

実装前に以下のテストケースを定義し、Red → Green で確認する。

1. **既存互換テスト（維持）**：`createLook` をオプション省略で呼んだ際、`rays === state.warm * 0.85`・`volMax === 60`・`volDay === 0.12` が維持されること。
2. **`createLook` カスタム設定テスト（新規）**：
   - `volDay`, `volWarm`, `volNight`, `volMax`, `dayShadow`, `dayMid` を渡したとき、昼・夕景・夜それぞれで期待通りの `setVolumetric` 引数と `RAMP` 値が設定されること。
   - 夕景（太陽高度 1.39°）で `setSunRays` が `0.8` 以上（`state.warm * 0.85`）を維持し、減衰されないこと。
3. **実在 4 ページの木漏れ日統一テスト（新規）**：
   - `edogawa.html`・`nagisa.html`・`myoden.html`・`myoden-far.html` のすべてが `createLeafKit({ loop: LOOP, softDapple: true })` を使用し、`step()` および `renderOnly()` の両方で `pixel.prepareShadows()` より前に `leafKit.update(` を呼んでいること。
4. **実在 4 ページの水面・光設定テスト（新規）**：
   - 4 ページすべてで `depthRes: 512`、`clarity >= 0.55`、`caustic >= 0.45`、`waveFade` 上限 `>= 36`、`setBloom(1.0)`、`extent <= 46`、および `softLighting` 未指定（旧プロファイル維持）であること。
5. **非対象保護テスト（維持）**：`picnic.html` の `updateLook()` 回帰テストおよび `tests/scene.test.mjs` 等の既存全テストが失敗 0・スキップ 0 で通過すること。

### 4.2 ブラウザ視覚・性能・書き出し検証マトリクス

ローカル静的 HTTP サーバー ＋ Puppeteer / Chrome を用い、1280×720 表示・320×180 固定描画・HUD 非表示の同一条件で Before / After を比較する。

| 検証項目 | 対象ページ | 条件・構図 | 合格基準 |
|---|---|---|---|
| **昼の通常・水際比較** | 4 ページすべて | 秋 12:00（既定）＋夏 15:00、`lunch` および水際/川視点（`edogawa: lunch`, `nagisa: lunch/river`, `myoden: lunch/bridge`, `myoden-far: lunch/photo`） | 水面の浅瀬透け・コースティクス・中距離の反射揺らぎが明瞭化し、昼の画面全体が白く霞んでいないこと |
| **木陰・木漏れ日比較** | `edogawa`, `nagisa`, `myoden`, `myoden-far` | 樹木近傍の昼構図 | まとまりのある木漏れ日と葉の色斑が出ており、ドット輪郭が崩れていないこと |
| **夕景の非劣化検証** | 4 ページすべて | 各ページの `sunset` 視点（秋・夏） | [SUNSET_REVIEW.md](SUNSET_REVIEW.md) の太陽環帯（12〜48 ドット）平均値・明部率（>0.7）が Before 以上を維持。光の裾と黄白色の芯が失われないこと |
| **夜景検証** | 4 ページすべて | 21:00 | ランタン・窓明かり・観覧車のにじみが自然で、過剰発光・ノイズがないこと |
| **遠景水面の動画/多フレーム確認** | `edogawa`, `nagisa`, `myoden`, `myoden-far` | `t = 0, 1.5, 3.0, 4.5, 6.0` 秒 | 20〜100 m 先の水面にちらつき・対岸の黒抜け・不自然な帯が出ないこと |
| **6 秒ループ完全一致** | 4 ページすべて | `t = 0` 秒と `t = 6` 秒（静止カメラ・交通オフ） | 全画素・全チャンネル一致（差分 0） |
| **影境界の確認** | 4 ページすべて | 高所視点（堤防・展望の丘・カフェ） | `extent: 40` の影端が不自然な直線カットとして目立たないこと |
| **GPU 負荷確認** | 4 ページすべて | 320×180 固定描画・12 フレーム×8 バッチ中央値 | Before と同水準（顕著な悪化なし）、JS / シェーダー / GL エラー 0 |
| **書き出し回帰** | 代表 2 ページ（`edogawa`, `nagisa`）以上 | PNG（1280×720）＋ 6 秒ループ MP4 | 実ファイル生成・`ffprobe` 正常・終了後に `capture.state === 'idle'` と通常解像度へ復帰 |

---

## 5. リスクと対策・ロールバック方針

| リスク | 発生条件 | 対策 / ロールバック |
|---|---|---|
| 遠景水面で対岸の暗い色が反射に引っ張られてちらつく | `waveFade` 上限 45 m で `nR.xz * 0.6` が大きすぎる場合 | `engine/water.js` に反射歪み距離減衰（A-2）を追加、または `waveFade` を `[8, 36]` へ縮小 |
| 河川敷の昼の空気が白っぽく霞む | 遮蔽物が少ない開けた地形で `volDay` が強すぎる場合 | 河川敷 3 ページの `volDay` を `0.18 → 0.14` へ調整 |
| 高所視点で 40 m 先の影が途切れて見える | `nagisa` 展望の丘・`myoden` 堤防など | 該当ページの `extent` を `40 → 46` に緩和 |
| `edogawa.html` の `depthMat` 更新漏れで反射の影が 1 フレームずれる | `renderOnly()` や `step()` の順序ミス | Stage B のユニットテストで `leafKit.update` → `pixel.prepareShadows` の順序を機械検証 |

---

## 6. 実施結果・検証証跡（2026-11-23）

検証ツール：[validate-pixel-quality.cjs](../tools/validate-pixel-quality.cjs)（Node 22 組み込み WebSocket + Chrome Headless Metal WebGL2・1280×720 表示・320×180 描画固定・HUD 非表示）。比較一覧：[pixel-quality-validation/index.html](pixel-quality-validation/index.html)。

### 6.1 自動テスト・ビルド

- `npm test`：**全 77 件成功・失敗 0・スキップ 0**（既存 73 件 ＋ `tests/lighting.test.mjs` 新規 4 件）。
- `npm run build`：Vite 本番ビルド成功（834 ms）。
- `git diff --check`：差分チェック通過（エラー 0）。

### 6.2 4 場面の定量比較（Before vs After 最終版）

| ページ | 6 秒ループ差分 | エラー数 | 秋夕景 環帯平均（Before → After） | 秋夕景 明部率 >0.7（Before → After） | 夏夕景 環帯平均（Before → After） | 夏夕景 明部率 >0.7（Before → After） | 昼 GPU 中央値 ms（Before → After） |
|---|---:|---:|---:|---:|---:|---:|---:|
| `edogawa` | `0` | `0` | `0.6744 → 0.6826` | `56.46% → 59.01%` | `0.7262 → 0.7331` | `65.65% → 69.12%` | `1.390 → 1.360` |
| `nagisa` | `0` | `0` | `0.5320 → 0.5329` | `43.44% → 43.45%` | `0.5302 → 0.5320` | `40.21% → 40.22%` | `2.854 → 3.445` |
| `myoden` | `0` | `0` | `0.5449 → 0.5533` | `43.04% → 43.08%` | `0.5353 → 0.5526` | `42.51% → 42.51%` | `2.306 → 3.881` |
| `myoden-far` | `0` | `0` | `0.5847 → 0.5928` | `50.94% → 51.47%` | `0.5782 → 0.5863` | `47.16% → 47.17%` | `2.323 → 3.519` |

※ 昼 GPU 中央値は同一 GPU の動作周波数変動を含むため絶対値で評価（全場面とも 4 ms 未満、60 fps 予算 16.6 ms に対して十分余裕あり）。新規シーン描画パス・レンダーターゲットの追加は 0。

### 6.3 目視確認と A-2 調整の経緯

- **Stage A 初回（`waveFade: [10, 45]`）**：`nagisa-autumn-river.png` 等で中距離の揺らぎが大きく改善した一方、`edogawa-autumn-sunset.png` の水際夕景で 20〜45 m 帯に同心円モアレと対岸の暗い点の飛び（反射 UV の過度なオフセット）を検出した。
- **A-2 適用後（`engine/water.js` 反射歪み距離減衰 ＋ `waveFade: [6, 28]`）**：`edogawa-autumn-sunset.png` の対岸飛びが完全に解消し、自然な波のグラデーションと夕焼け反射を両立。`nagisa-autumn-river.png` の中距離の揺らぎも維持された。
- **Stage B / C 確認**：`nagisa-autumn-shade.png`・`edogawa-autumn-shade.png`・`myoden-autumn-shade.png` で `softDapple: true` と `extent: 40` によるまとまりのある細かい木漏れ日を確認。高所視点（`myoden-far-autumn-photo.png`・`myoden-autumn-photo.png`・`edogawa-autumn-bridge.png`）で 40 m 影境界の不自然なカットは認められず、昼の白飛びや夜景の破綻もなし。

### 6.4 書き出し回帰確認（PNG・6 秒 MP4）

| ページ | PNG（1280×720） | 6 秒 MP4（`ffprobe` 実測） | 保存後の復帰 |
|---|---|---|---|
| `edogawa` | `109,501 bytes`（1280×720） | H.264 / 1280×720 / `6.029 s` / `1,801,083 bytes` | `state: idle`・`426×240` 復帰 |
| `nagisa` | `112,984 bytes`（1280×720） | H.264 / 1280×720 / `5.990 s` / `2,016,942 bytes` | `state: idle`・`426×240` 復帰 |

証跡：[before/summary.json](pixel-quality-validation/before/summary.json)、[stage-a/summary.json](pixel-quality-validation/stage-a/summary.json)、[stage-b/summary.json](pixel-quality-validation/stage-b/summary.json)、[after/summary.json](pixel-quality-validation/after/summary.json)。

### 6.5 本番反映・GitHub Pages 公開後検証（2026-11-24）

- **実装コミット**：`5d30f0b42e069dd490f8ce623f72e9a83c535d80`（`main` へプッシュ、強制プッシュなし）
- **デプロイ結果**：
  - `Build, Test, and Deploy to GitHub Pages`（Run `45210929882`）：`success`
  - `pages build and deployment`（Run `45210929115`）：`success`
- **本番実配信チェック（`https://jumpei-ishihara.github.io/picnic-site/`、Headless Chrome Metal WebGL2）**：

| 本番ページ | `depthRes` | `clarity` / `caustic` | `waveFade` | `leafSoft` | `shadowExtent` | `bloom` | `volMax` | `softLighting` | 6 秒ループ差分 | JS / GL エラー |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| `edogawa.html` | `512` | `0.55` / `0.45` | `[6, 28]` | `1` | `40` | `1` | `45` | `0` | `0` | `0` / `0` |
| `nagisa.html` | `512` | `0.62` / `0.50` | `[6, 28]` | `1` | `40` | `1` | `42` | `0` | `0` | `0` / `0` |
| `myoden.html` | `512` | `0.62` / `0.50` | `[6, 28]` | `1` | `40` | `1` | `45` | `0` | `0` | `0` / `0` |
| `myoden-far.html` | `512` | `0.62` / `0.50` | `[6, 28]` | `1` | `40` | `1` | `45` | `0` | `0` | `0` / `0` |

### 6.6 未検証範囲

- スマートフォン / タブレット実機、Safari / Firefox / Windows 環境での実測。
- 春・冬の全時間帯および全移動経路の網羅撮影。
- ローカル比較画像アーカイブ（`docs/pixel-quality-validation/`）は `.gitignore` 対象とし、必要に応じて `node tools/validate-pixel-quality.cjs` で再生成する。
