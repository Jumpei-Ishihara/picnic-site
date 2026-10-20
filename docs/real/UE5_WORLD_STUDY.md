# UE5 でハイクオリティな川辺のワールドを作れるか — 調査・検討

- 作成日：2026-10-20
- 対象（MVP）：川辺のピクニックエリア。実データがそろっている **江戸川 市川南の河川敷**（`edogawa.html`、[EDOGAWA_DESIGN.md](../EDOGAWA_DESIGN.md)）を想定。架空の `picnic.html` の川辺を対象にする場合も、地形の取り込み以外は同じ。
- サイト（Three.js のドット絵）とは別の制作物として考える。

## 1. 結論

**作れる。ただし「Web サイトの中で動かす」のではなく、映像・静止画・デスクトップアプリとして出すのが現実的。**

- UE5 は 5.8（2026-06 公開、UE5 系の最後の大型版）で、草地・樹木・水・時間帯の光を写真に近い質で出せる。Nanite（大量の高密度メッシュ）・Lumen（動的な間接光）・PCG（手続き的な配置、5.7 で製品版）・Sun Position（緯度経度と日時から太陽）がそろい、川辺のピクニックに必要な要素は標準機能でまかなえる。
- この Mac（M4 Pro・メモリ 24 GB・Metal 4）は、Nanite/Lumen が動く条件（M2 以降・macOS 15 以降の SM6）を満たす。MVP 規模（数百 m 四方）なら編集・実行できる見込み。
- 一番の壁は **配信方法** と **空き容量**。UE5 には Web 書き出しが無く、ブラウザで動かすには Pixel Streaming（サーバーの GPU で動かして映像を送る。同時接続数ぶん費用がかかる）しかない。空き容量は現在 約 65 GB で、エンジン本体と派生データだけで足りなくなる。
- 既存の `tools/geo` で作っている標高・地面の種類・OSM のデータは、そのまま UE の地形と配置の元にできる。現地調査の成果（[EDOGAWA_DESIGN.md](../EDOGAWA_DESIGN.md) など）が無駄にならない。

## 2. 前提の確認

| 項目 | 状況 | 判断 |
|---|---|---|
| エンジンの版 | UE 5.8（2026-06-17 公開）。UE6 の早期アクセスは 2027 年後半の見込み | 5.8 で始める。UE6 への移行は MVP の後で考える |
| Mac 対応 | Nanite は SM6（M2 以降・macOS 15+）。Lumen は Metal でソフト／ハード両方のレイトレース。5.7 の Mac では Lightmass が x86 のみ（Rosetta）など細かい不具合あり | Lumen を使い、焼き込みのライト（Lightmass）は使わない |
| マシン | Apple M4 Pro（20 コア GPU）・24 GB・Xcode と Blender は入っている | MVP には足りる。メモリ 24 GB は大きな地形や高密度の草で厳しくなるので、範囲と密度を絞る |
| 空き容量 | 926 GB 中 約 65 GB | **外付け SSD（1 TB 以上・USB4/Thunderbolt）を用意する**。エンジン本体・派生データキャッシュ・素材で 100〜200 GB は見ておく |
| ライセンス | 個人・年商 100 万ドル未満は無料。ゲーム等は累計 100 万ドルを超えた分に 5% | 個人の制作・公開では費用なし |
| AI での作業 | 5.8 に Unreal MCP サーバーのプラグインがあり、Python のエディタスクリプトも使える | 地形の取り込み・配置・書き出しは Claude Code からスクリプトで回せる。見た目の調整は人がエディタで行う |

## 3. 配信方法の比較

| 方法 | 質 | 手間・費用 | サイトとの関係 | 判断 |
|---|---|---|---|---|
| A. 映像・静止画（Movie Render Queue） | 最高（4K、時間をかけて描ける） | 低い。サーバー不要 | サイトに動画・画像として載せられる。季節・時間帯ごとに書き出せる | **MVP の主な出力** |
| B. 360° パノラマ | 高い | 低い | サイトで見回せる（Three.js の球に貼る） | A と一緒に作る |
| C. デスクトップアプリ（Mac / Windows） | 高い。歩ける | 中。配布サイズが数 GB | ダウンロードの案内をサイトに置く | MVP の 2 段目 |
| D. Pixel Streaming | 高い。ブラウザで歩ける | 高い。同時接続 1 人ごとに GPU サーバー。遅延あり | サイトに埋め込める | 試すとしても期間限定のデモ |
| （参考）Web で写実：3D ガウシアンスプラッティング | 写真そのもの（撮った場所だけ） | 現地で撮影が必要。Web の表示ライブラリあり | 今のサイトの技術のまま | UE とは別の案として 7 節に |

## 4. 川辺のピクニックエリアの作り方（MVP）

### 4.1 範囲

近景（歩ける所）：既存の `scenes/edogawa/near_height.png` と同じ範囲（堤防〜河川敷〜水際、数百 m 四方）。中景・遠景：対岸と川の先は低い密度の地形と簡単な建物、その先は空と霞。

### 4.2 材料ごとの作り方

| 要素 | UE での作り方 | 元データ |
|---|---|---|
| 地形 | Landscape に 16 bit の高さ画像を読み込む（1 m 格子。UE の推奨サイズ 1009 / 2017 px に合わせる） | `tools/geo` の DEM5A（国土地理院）。`build_scene.py` に UE 用の 16 bit 書き出しを足す |
| 地面の種類（芝・土・舗装・護岸） | Landscape のマテリアルレイヤー。地面の種類画像をレイヤーの重みとして読み込む | `scenes/edogawa/ground.png` |
| 道・堤防の上の道 | Landscape Spline か PCG の線 | OSM（`scenes/edogawa/scene.json` の線） |
| 草 | PCG で地面の種類に応じて配置。Nanite Foliage（5.7 で実験的）は Mac での動作を試してから使う | 地面の種類 |
| 木 | PCG で位置どおりに置く。木のモデルは Fab の素材か Procedural Vegetation Editor | 空中写真から拾った木の位置 |
| 川の水面 | Water プラグインの River（スプライン）か、平らな水面＋水のマテリアル。潮の高さは水面の高さで切り替え | 水面の高さ（各 DESIGN.md） |
| 空・太陽・季節 | Sky Atmosphere・Volumetric Cloud・Sun Position（市川の緯度経度と日時）。季節は草木のマテリアルの色と配置の切り替え | `engine/sun.js`・`engine/season.js` の考え方をそのまま移す |
| 遠景の建物 | Cesium for Unreal で PLATEAU（Japan 3D Buildings）と Japan Regional Terrain を読む。対象の市が PLATEAU に入っているかは要確認。無ければ OSM の建物を押し出す | PLATEAU / OSM |
| ピクニックの道具 | レジャーシート・バスケット・水筒などを Blender か Fab で用意（`engine/picnic-set.js` と同じ持ち物） | — |
| 操作 | 一人称の歩行・座る・寝ころぶ（今のサイトと同じ動き）、時間帯と季節の切り替え | — |

### 4.3 進め方と目安

| 段階 | 内容 | 目安 | 終わりの条件 |
|---|---|---|---|
| 0. 準備 | 外付け SSD、Epic アカウント、UE 5.8 の導入、空のプロジェクトで Nanite・Lumen が動くか確認 | 1〜2 日 | 標準のサンプルが 30 fps 以上で動く |
| 1. 地形 | `tools/geo` から UE 用の高さ・レイヤー画像を書き出して読み込む。水面を置く | 2〜3 日 | 堤防・河川敷・水際の形が今の場面と一致する |
| 2. 地面と草木 | 芝・土・舗装のマテリアル、PCG で草と木 | 1 週間 | 堤防の上から見た眺めが現地の写真に近い |
| 3. 光と水 | 太陽・空・雲・霞、水の反射と流れ、木漏れ日 | 3〜5 日 | 昼・夕方・朝の 3 つの時間帯で破綻が無い |
| 4. ピクニック | シートと持ち物、歩行・座る操作、季節 2 つ（初夏・秋） | 3〜5 日 | シートに座って川を眺められる |
| 5. 出力 | 4K の映像（30 秒ほど）、静止画、360° パノラマ。余裕があれば Mac アプリ | 2〜3 日 | サイトに載せる素材がそろう |

合計で 3〜4 週間ほど（素材を Fab の既存のもので済ませる場合）。

## 5. リスクと対策

| リスク | 対策 |
|---|---|
| UE は Windows が中心で、Mac で動かないプラグインがある（例：ガウシアンスプラッティングの一部は DirectX 12 のみ） | 標準機能だけで作る。必要になったら Windows 機かクラウドの Windows GPU を使う |
| メモリ 24 GB で重くなる | 近景の範囲を絞る。World Partition で読み込みを分ける。草の密度を段階で上げる |
| 空き容量が足りない | 外付け SSD にエンジンとプロジェクトを置く |
| 素材の権利 | 地理院のデータ・OSM は出典を書けば使える（今のサイトと同じ）。Fab の素材は利用条件を素材ごとに確認する。Google の Photorealistic 3D Tiles は保存・書き出しに強い制限があるので、映像の元にしない |
| Claude Code はエディタの画面操作が苦手 | 取り込み・配置・書き出しは Python スクリプトと Unreal MCP で回す。見た目の判断は人が行う |
| サイトとの見た目の差（ドット絵と写実） | 別の制作物として扱う。サイトには「写実版」として映像・パノラマを載せる。ドット絵の後処理を UE で再現するのは任意 |

## 6. 判断が必要なこと

1. MVP の場所：江戸川 市川南（実データあり、推奨）か、架空の川辺（`picnic.html`）か
2. 最終の見せ方：映像・パノラマ（推奨）か、歩けるアプリか、ブラウザで歩ける（Pixel Streaming）か
3. 外付け SSD の用意と、UE 5.8 の導入（Epic アカウントの作成と導入は本人が行う）

## 7. 別の案（参考）

- **Unity 6**：Web 書き出し（WebGL、WebGPU は実験的）があり、ブラウザで動かしやすい。質は UE5 に一段劣るが、サイトに埋め込みたいなら有力
- **3D ガウシアンスプラッティング（Web）**：現地をスマートフォンで撮影して作る。写真そのものの見た目をブラウザで出せるが、撮った範囲しか作れず、時間帯や季節は変えられない。UE に読み込むプラグイン（YaGS など）もあるので、UE の中で「現地の一部」として使う手もある
- **今の Three.js のまま質を上げる**：ドット絵をやめて写実寄りにする道もあるが、ブラウザの制約で UE5 の質には届かない

## 出典

- [Unreal Engine 5.8 is now available](https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available)・[Unreal Engine 5.8 Released (GameFromScratch)](https://gamefromscratch.com/unreal-engine-5-8-released/)
- [Unreal Engine 5.7 is now available](https://www.unrealengine.com/news/unreal-engine-5-7-is-now-available)・[UE 5.7: foliage, PCG and in-Editor AI](https://digitalproduction.com/2025/11/12/unreal-engine-5-7-foliage-pcg-and-in-editor-ai/)
- [Bringing Unreal Engine on macOS up to feature parity with Windows](https://www.unrealengine.com/tech-blog/bringing-unreal-engine-on-macos-up-to-feature-parity-with-windowsprogress-report)・[Lightmass not working in UE 5.7 on Mac](https://forums.unrealengine.com/t/lightmass-not-working-in-unreal-5-7-on-mac/2675230/6)
- [Unreal Engine license](https://www.unrealengine.com/en-US/license)
- [Pixel Streaming in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-in-unreal-engine)・[Pixel Streaming vs WebGL vs WebGPU (Vagon)](https://vagon.io/blog/pixel-streaming-vs-webgl-vs-webgpu-the-best-solution-for-unreal-engine-web-deployment)
- [Cesium: Japan 3D Buildings](https://cesium.com/platform/cesium-ion/content/japan-3d-buildings/)
- [YaGS: 3DGS plugin for UE 5.5–5.7](https://radiancefields.com/yags-yandex-open-sources-a-3dgs-plugin-for-unreal-engine-5.5–5.7)・[SplatRenderer Plugin](https://radiancefields.com/splatrenderer-plugin-for-unreal-engine)
