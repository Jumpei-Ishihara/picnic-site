# 実在 4 場面ドット絵 光・水・影の質感調整 改修計画

作成：2026-11-23。状態：**Stage 0〜D 完了（ローカル実装・全 77 件回帰テスト・実ブラウザ比較・ビルド・書き出し確認済み）**。
対象：実在 4 場面のドット絵ページ（`edogawa.html`・`nagisa.html`・`myoden.html`・`myoden-far.html`）および共通モジュール（`realsite/look.js`・`engine/water.js`）。
詳細仕様と検証結果は [PIXEL_QUALITY_DESIGN.md](PIXEL_QUALITY_DESIGN.md) を参照。

---

## 1. 背景と目的

同じドット絵描画エンジン（`engine/pixel-renderer.js`・`engine/water.js`・`engine/trees.js`）を使用しているにもかかわらず、架空の箱庭場面である「川辺のピクニック（`picnic.html`）」と比べて、実在 4 場面では光・水・影の質感が控えめに見える。

主な要因は以下の 4 点に集約される。

1. **水面設定の保守性**：実在 4 ページは透明度 `clarity`（0.3〜0.4）・川底の光模様 `caustic`（0.15〜0.2）・水色の彩度が抑えられており、さらに `waveFade: [4, 20]` により 20 m 以遠の水面反射の揺らぎが完全に平坦化される。深さマップも広域を 256×256 で焼いているため水際の境界が粗い。
2. **影解像度（シャドウマップ密度）の低下**：`picnic.html` の `extent: 26`（約 2.5 cm/texel）に対し、実在 4 ページは `extent: 60`（約 5.9 cm/texel、面積比 5 倍以上粗い）で、シートや足元の影・木漏れ日がぼやけやすい。
3. **木漏れ日実装の不統一**：`nagisa.html` は `softDapple: true` 適用済みだが、`myoden.html`・`myoden-far.html` は旧方式（`softDapple: false`）、`edogawa.html` は `createLeafKit` 自体が未導入で木漏れ日・葉の色斑がない。
4. **空気中の光・ブルームの抑制**：`realsite/look.js` の昼の空中光（`0.12`・距離 60 m）とブルーム（`0.9`）が、`picnic.html`（昼 `0.3`・距離 28 m・ブルーム `1.0`）より弱く、サンプル密度も粗い。

**目的**：実在の江戸川・旧江戸川・干潟の地理的リアリティと [SUNSET_REVIEW.md](SUNSET_REVIEW.md) で確立した夕景品質、さらに 6 秒ループ・固定タイムステップ書き出し・モバイル動作を維持したまま、実在 4 場面の水・光・影の質感を `picnic.html` の水準へ近づける。

---

## 2. 調整項目の採否方針

| 項目 | 現状の差（`picnic` vs 実在 4 場面） | 採否 | 方針・理由 |
|---|---|---|---|
| **A1. 水面の透明度・コースティクス・色・波** | `clarity` 1.0 vs 0.3〜0.4、`caustic` 1.0 vs 0.15〜0.2、彩度差 | **採用** | 実在感を壊さない中間域（`clarity` 0.55〜0.62、`caustic` 0.45〜0.50、青緑寄りの澄んだ昼水色）へ引き上げる |
| **A2. 深さマップ解像度と遠距離波減衰** | `depthRes` 256（狭域 vs 広域）、`waveFade` なし vs `[4, 20]` | **採用** | `depthRes: 512`（初期化 1 回のみ、256 KB）で水際を精細化し、`waveFade` を `[10, 45]` へ延長。遠景ちらつきが出る場合は A2b（緩やかな遠景うねり）で補完 |
| **B. 木漏れ日・葉の色斑の統一** | `nagisa` のみ `softDapple: true`、`myoden` 系は `false`、`edogawa` は未導入 | **採用** | 全 4 場面を `createLeafKit({ loop: LOOP, softDapple: true })` に統一し、`edogawa.html` の樹木へ木漏れ日・色斑・6 秒揺れを導入 |
| **C1. シャドウ範囲の引き締め** | `extent: 26` vs `extent: 60` | **採用** | カメラ追従影を活かし `extent: 40`（面積密度 2.25 倍）へ引き締め。影境界の不自然さを代表構図で確認 |
| **C2. 空中光・ブルーム・3 色塗り微調整** | `vol` 昼 0.3/28m vs 0.12/60m、`bloom` 1.0 vs 0.9 | **採用** | `realsite/look.js` にオプションを追加し、木立（`nagisa`）と河川敷（他 3 場面）で適正な `volDay`/`volWarm`/`volMax` を設定。`setBloom(1.0)` 統一。夕景光芒は絶対に弱めない |
| **D1. `softLighting` 新プロファイル有効化** | 全ページ `false` | **見送り** | [SUNSET_REVIEW.md](SUNSET_REVIEW.md) で夕景の劣化要因と確認済みのため不採用を維持 |
| **D2. 太陽軌道の架空逆光化（`sunZ: -0.45`）** | 架空軌道 vs 実在天体計算 | **見送り** | スカイツリー・観覧車に沈む実在の夕日方位が企画の核であるため変更しない |
| **D3. 既定の季節・時刻変更（秋 12 時 → 夏 15:30）** | 夏 15:30 vs 秋 12:00 | **見送り** | 企画提案書・出典表記の 10 月中旬を既定として維持（UI の季節切替で夏も体験可能） |
| **D4. 地面解像度（8→16 ppm）・メッシュ細分化** | 16 ppm / 0.32 m vs 8 ppm / 1 m | **見送り** | 実在 4 場面は近景が 360〜460 m 四方あり、16 ppm 化はテクスチャ 6000 px 超・VRAM 増大でモバイル動作を損なうため不採用 |
| **D5. フォグ距離短縮（1500〜5000 m → 60 m）** | 20〜60 m vs 150〜5000 m | **見送り** | 遠景の富士山・スカイツリー・橋・街並みを視認させるため維持 |

---

## 3. 実施段階と順序

[SUNSET_REVIEW.md](SUNSET_REVIEW.md) の教訓に従い、**効果を一括変更して原因を見失うことを防ぐため、A → B → C の順に段階実装・単独検証**を行う。

| 段階 | 内容 | 対象ファイル | 検証ゲート |
|---|---|---|---|
| **Stage 0** | 現状ベースラインの撮影と自動テスト実行（変更前） | 検証ツール・テストのみ | 現行全テスト成功、4 ページ×代表構図の Before 画像と GPU 時間を記録 |
| **Stage A** | 水面調整（`depthRes: 512`、`clarity`・`caustic`・`wave`・`waveFade`・`tints`） | `edogawa.html`, `nagisa.html`, `myoden.html`, `myoden-far.html`（必要時のみ `engine/water.js`） | 水際の透明感・コースティクス・中距離反射の揺らぎ向上、かつ遠景のちらつき・対岸の黒抜け無し |
| **Stage B** | 木漏れ日統一（`myoden`/`myoden-far` の `softDapple: true`、`edogawa` への `createLeafKit` 導入、全 4 ページの `renderOnly()` 影同期） | `edogawa.html`, `nagisa.html`, `myoden.html`, `myoden-far.html` | 木陰のまとまり・6 秒ループ完全一致・`renderOnly()` 影同期を確認 |
| **Stage C** | 光・影・空気感（`extent: 40`、`realsite/look.js` オプション拡張、`setBloom(1.0)`、昼 `RAMP` 微調整） | `realsite/look.js`, `edogawa.html`, `nagisa.html`, `myoden.html`, `myoden-far.html` | 昼の白飛びなし・夕景の光の裾と芯が維持または向上・40 m 影境界の破綻なし |
| **Stage D** | 統合回帰検証・性能比較・PNG/固定タイムステップ MP4 書き出し確認・SDD 結果追記 | `tests/lighting.test.mjs`, `docs/PIXEL_QUALITY_DESIGN.md` | 全自動テスト通過、4 ページ視覚比較 OK、GPU 負荷許容内、書き出し＆UI 復帰確認 |

---

## 4. 非対象・変更禁止範囲

- `picnic.html`（比較基準として無変更）
- `real/*.html` および `real/js/*`（写実版は対象外）
- `town_3d.html`・`legacy/*`
- `scenes/*/scene.json` および標高・空中写真アセット（地形データ再生成は行わない）
- `engine/pixel-renderer.js` の基本レンダリングパス構成（新規レンダーターゲットや追加シーン描画パスは増やさない）

---

## 5. 検証方針と採用条件

1. **自動テスト（TDD）**：既存の `npm test`（`tests/lighting.test.mjs` を含む全スイート）が 100% 通過し、新規仕様の回帰テストをすべて追加・通過させること。
2. **同一条件の視覚比較（Before / After）**：1280×720 表示・320×180 描画固定・時刻停止で、全 4 ページの **昼（シート/水際）・夕景・夜・季節（秋＋夏）** を並べて目視確認する。
3. **夕景の非劣化保証**：[SUNSET_REVIEW.md](SUNSET_REVIEW.md) の太陽環帯指標（平均輝度・明部画素率）が改修前を下回らないこと。
4. **遠景水面の非劣化保証**：`waveFade` 延長によって 50 m〜遠景の水面にモアレ・対岸の暗い筋・ちらつきが発生しないこと（6 秒間の動画または多フレーム比較で確認）。
5. **6 秒ループと書き出しの保全**：`t = 0` 秒と `t = 6` 秒の描画が全チャンネル一致し、PNG（1280×720）および 6 秒ループ MP4 の保存と終了後の状態復帰が正常に完了すること。
6. **描画負荷の抑制**：新規シーン描画パス 0、シャドウマップ解像度 2048/1024 据え置き、GPU フレーム時間の大幅な悪化がないこと。

問題（白飛び・遠景のちらつき・影境界の違和感・夕景劣化など）が確認された段階は、その段階だけを独立してパラメータ再調整または切り戻し可能とする。

---

## 6. 実施結果（2026-11-23）

Stage 0 → A → B → C → D を SDD + TDD で順次実施し、全段階の受入基準を満たして完了した。

- **Stage A（水面）＋ A-2 フォールバック発動**：初回設定 `waveFade: [10, 45]` でなぎさ川辺の中距離反射は大きく改善した一方、`edogawa-autumn-sunset.png` の水際夕景で 20〜45 m 帯の同心円モアレと対岸の暗い点の引っ張りを検出した。事前設計の **A-2 フォールバック** を適用し、`engine/water.js` に反射歪みの距離減衰（`picnic.html` への影響 0）を追加して `waveFade: [6, 28]` に調整した結果、江戸川夕景の飛びとモアレが解消し、なぎさ川辺の揺らぎも維持された。
- **Stage B（木漏れ日統一）**：全 4 場面を `createLeafKit({ loop: LOOP, softDapple: true })` に統一し、`edogawa.html` へ木漏れ日・葉の色斑・6 秒風揺れを導入、全 4 場面の `renderOnly()` で `leafKit.update` → `pixel.prepareShadows()` の同期を統一した。
- **Stage C（光・影・空気感）**：`extent: 40`・`setBloom(1.0)`・`realsite/look.js` の後方互換オプション拡張（`nagisa: volDay 0.22 / volMax 42`、河川敷 3 場面：`volDay 0.18 / volMax 45`、`volWarm 0.9 / volNight 0.3`、昼 `RAMP` 微調整）を適用。全 4 場面で夕景の太陽環帯輝度・明部率はベースライン以上を維持した。
- **Stage D（統合回帰・ビルド・書き出し）**：`npm test` 全 77 件（新規 4 件含む）成功、`npm run build`・`git diff --check` 成功、4 場面の 6 秒ループ全画素一致（差分 0）・JS/GL エラー 0、江戸川・なぎさの PNG（1280×720）と 6 秒 H.264 MP4 実保存・状態復帰を確認。詳細数値と比較証跡は [PIXEL_QUALITY_DESIGN.md](PIXEL_QUALITY_DESIGN.md#6-実施結果検証証跡2026-11-23) および [比較ページ](pixel-quality-validation/index.html) を参照。
