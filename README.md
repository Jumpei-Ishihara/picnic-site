# picnic-site

歩けるドット絵の Web サイトの試作です。Three.js で描いた3Dの場面を、低解像度で描いてドット絵に仕上げています。

- **川辺のピクニック**（`picnic.html`）：木陰でピクニックをする川辺。光・水面・木漏れ日の表現が主役。PNG とループ動画を書き出せる。
- **江戸川のピクニック**（`edogawa.html`）：市川の江戸川河川敷を、国土地理院の標高・空中写真と OpenStreetMap から再現した場面。PNG とループ動画を書き出せる。設計と記録は [docs/EDOGAWA_DESIGN.md](docs/EDOGAWA_DESIGN.md)。
- **なぎさ公園のピクニック**（`nagisa.html`）：江戸川区 南葛西の なぎさ公園を同じ作り方で再現。展望の丘・木漏れ日・旧江戸川の河口・葛西臨海公園の大観覧車・魔法の文学館のカフェ・柵の中を周回するポニー・ツツジ山と遊具広場。舞浜のシンデレラ城・火山、葛西臨海水族園のドーム、東京ゲートブリッジも実際の位置に。記録は [docs/NAGISA_DESIGN.md](docs/NAGISA_DESIGN.md)。
- **妙典の岸のピクニック**（`myoden.html`）：江戸川の逆側、市川市 妙典の堤防。360° 写真の位置から作った場面。記録は [docs/MYODEN_DESIGN.md](docs/MYODEN_DESIGN.md)。
- **妙典の対岸のピクニック**（`myoden-far.html`）：妙典の真向かい、市川市 田尻の堤防。干潮・満ち潮を選べる。調査と記録は [docs/MYODEN_FAR_DESIGN.md](docs/MYODEN_FAR_DESIGN.md)。
- すべての場面で季節（🌸 春・🌻 夏・🍁 秋・❄️ 冬）を選べる（⚙️ の「季節」）。草木の色、日の出・日の入りと太陽の高さ、空の霞、生き物が変わる。
- すべてのピクニックの場面で、レジャーシートと持ち物は同じ（`engine/picnic-set.js`。季節で飲み物と小物が変わる）。レジャーシートと持ち物（拠点）は好きな場所へ移せる（⚙️ の「拠点」か B キー。場所はブラウザに覚える）。
- **写実版（試作）**（`real/index.html`）：江戸川・なぎさ公園・妙典の岸を、ドット絵ではなく写実的な 3DCG で歩ける別サイト。場面データ（`scenes/`）とドット絵版の部品の一部を共有する。設計と記録は [docs/real/REAL_DESIGN.md](docs/real/REAL_DESIGN.md)。
- **ドット街さんぽ**（`town_3d.html`）：運河と広場のある小さな街。建物に入るとサイトの各ページ（About・Works など）が開く。

詳しい仕様は [docs/SPEC.md](docs/SPEC.md)、共通エンジンの使い方は [engine/README.md](engine/README.md) を見てください。

ソースレビューに基づく改善箇所・修正理由・実装方針・検証方法は [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) にまとめています。詳細設計と実装・検証結果は [docs/REFACTOR_DESIGN.md](docs/REFACTOR_DESIGN.md) を参照してください（2026-10-22）。

Web で見る（GitHub Pages）：https://jumpei-ishihara.github.io/picnic-site/ （公開後）

## 起動

ES モジュールを使うので、ローカルサーバー経由で開きます。

```bash
cd ~/picnic-site && python3 -m http.server 8790
```

ブラウザで http://localhost:8790/ を開きます（入口ページから4つの場面へ）。

書き出したファイルを ~/Downloads に直接保存したいときは、別のターミナルで次を起動しておきます（起動していなければブラウザのダウンロードとして保存されます）。

```bash
cd ~/picnic-site && node tools/export_server.js
```

保存ブリッジはローカルの `http://localhost:8790` と `http://127.0.0.1:8790` からだけ利用できます。別のローカルポート等を許可する場合は、`EXPORT_ALLOWED_ORIGINS` に完全なOriginをカンマ区切りで設定してください。公開サイトは既定ではブラウザのダウンロードを使います。

通常起動ではファイルを生成しません。旧版の画像・6秒動画を明示的に生成する場合は `node tools/export_server.js --generate-legacy` を使います。`--bridge-only` は通常起動と同じ互換オプションです。保存は同名ファイルを上書きせず、末尾にUUIDを付けます。書き出し失敗時はブラウザ保存へ切り替わり、通信後の結果が不明な場合は保存先の確認を案内します。

検証：`node --test tests/bridge.test.cjs tests/engine.test.mjs tests/scene.test.mjs tests/legacy.test.mjs`（ローカルHTTP待ち受けを使います。実動画の検証にはffmpeg・ffprobeが必要です）。

## フォルダ

| パス | 内容 |
|---|---|
| `index.html` | 入口ページ |
| `edogawa.html` | 江戸川のピクニック |
| `picnic.html` | 川辺のピクニック |
| `town_3d.html` | ドット街さんぽ |
| `engine/` | 共通エンジン（描画・空と時間帯・実際の太陽・高さ画像の地形・遠景の影絵・歩行操作・当たり判定・水面・音・UI・書き出し） |
| `tools/export_server.js` | ~/Downloads への保存ブリッジ（Node.js、ffmpeg で mp4 に変換） |
| `docs/SPEC.md` | 仕様書 |
| `docs/EDOGAWA_DESIGN.md` | 江戸川河川敷（市川）を再現する場面の地形分析・設計・実装計画（図は `docs/edogawa/`） |
| `tools/geo/` | 地形データ（国土地理院の標高・空中写真、OpenStreetMap）を取得して場面データに変換するスクリプト（[使い方](tools/geo/README.md)） |
| `nagisa.html` | なぎさ公園のピクニック |
| `realsite/` | 実在の場所の場面（江戸川・なぎさ公園・妙典）で共有するもの（生き物と交通、10 月の色と時刻ごとの仕上げ）、江戸川の両岸の水際（船着場・護岸・ヨシの帯）と、なぎさ公園の施設（魔法の文学館・ポニーランド・遊具・胸壁）と周りの目立つもの |
| `dev/edogawa_p1.html` | 江戸川の場面を作る途中の確認用ページ（地形・水面・実際の太陽・遠景） |
| `scenes/nagisa/` | なぎさ公園の場面データ（`tools/geo/build_nagisa.py` で作る）と出典 |
| `scenes/edogawa/` | 江戸川（市川）の場面データ（高さ・地面の種類・ランドマーク。`tools/geo/build_scene.py` で作る）と出典 |
| `real/` | 写実版（試作）：入口・3 つの場面のページ、`real/js/`（写実の描画）、`real/assets/`（地面の素材と出典）。資料は `docs/real/` |
| `legacy/` | 旧版（レイマーチング版のピクニック、最初期の 2D 版、旧版の書き出し） |
| `.claude/launch.json` | プレビュー用サーバーの設定 |

## 必要なもの

- 新しめのブラウザ（WebGL2 対応。Chrome で動作確認）
- Python 3（ローカルサーバー用）
- 書き出しを ~/Downloads に保存する場合のみ：Node.js と ffmpeg
- `three@0.160.0` は CDN（jsdelivr）から読み込むので、初回はネット接続が必要

## ライセンスと出典

- **コード**：MIT License（[LICENSE](LICENSE)）。
- **地図から作ったデータ**（`scenes/edogawa/`・`scenes/nagisa/`）と**図**（`docs/edogawa/`）は MIT の対象外です。
  - 地形・地面の種類（江戸川・なぎさ公園）：国土地理院 基盤地図情報 数値標高モデル（DEM5A）・シームレス空中写真を加工して作成（[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)）。
  - ランドマーク・野球場・送電線など：© OpenStreetMap contributors。`scenes/*/scene.json` は OpenStreetMap から作った派生データベースで、[ODbL](https://opendatacommons.org/licenses/odbl/) で提供します。
  - 詳しくは [scenes/edogawa/ATTRIBUTION.md](scenes/edogawa/ATTRIBUTION.md)。
- `three@0.160.0`（MIT）は CDN から読み込んでいます（同梱していません）。
- 地理データの元データ（`tools/geo/cache/`）はリポジトリに含めていません。`python3 tools/geo/fetch_data.py` で取り直せます。
