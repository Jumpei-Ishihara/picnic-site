# picnic-site

歩けるドット絵の Web サイトの試作です。Three.js で描いた3Dの場面を、低解像度で描いてドット絵に仕上げています。

- **川辺のピクニック**（`picnic.html`）：木陰でピクニックをする川辺。光・水面・木漏れ日の表現が主役。PNG とループ動画を書き出せる。
- **江戸川のピクニック**（`edogawa.html`）：市川の江戸川河川敷を、国土地理院の標高・空中写真と OpenStreetMap から再現した場面。PNG とループ動画を書き出せる。設計と記録は [docs/EDOGAWA_DESIGN.md](docs/EDOGAWA_DESIGN.md)。
- **なぎさ公園のピクニック**（`nagisa.html`）：江戸川区 南葛西の なぎさ公園を同じ作り方で再現。展望の丘・木漏れ日・旧江戸川の河口・葛西臨海公園の大観覧車・魔法の文学館のカフェ・柵の中を周回するポニー・ツツジ山と遊具広場。舞浜のシンデレラ城・火山、葛西臨海水族園のドーム、東京ゲートブリッジも実際の位置に。記録は [docs/NAGISA_DESIGN.md](docs/NAGISA_DESIGN.md)。
- 3 つのピクニックの場面では、レジャーシートと持ち物（拠点）を好きな場所へ移せる（⚙️ の「拠点」か B キー。場所はブラウザに覚える）。
- **ドット街さんぽ**（`town_3d.html`）：運河と広場のある小さな街。建物に入るとサイトの各ページ（About・Works など）が開く。

詳しい仕様は [docs/SPEC.md](docs/SPEC.md)、共通エンジンの使い方は [engine/README.md](engine/README.md) を見てください。

Web で見る（GitHub Pages）：https://jumpei-ishihara.github.io/picnic-site/ （公開後）

## 起動

ES モジュールを使うので、ローカルサーバー経由で開きます。

```bash
cd ~/picnic-site && python3 -m http.server 8790
```

ブラウザで http://localhost:8790/ を開きます（入口ページから4つの場面へ）。

書き出したファイルを ~/Downloads に直接保存したいときは、別のターミナルで次を起動しておきます（起動していなければブラウザのダウンロードとして保存されます）。

```bash
cd ~/picnic-site && node tools/export_server.js --bridge-only
```

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
| `realsite/` | 実在の場所の場面（江戸川・なぎさ公園）で共有するもの（ピクニックの持ち物と湯気、生き物と交通、10 月の色と時刻ごとの仕上げ）、江戸川の両岸の水際（船着場・護岸・ヨシの帯）と、なぎさ公園の施設（魔法の文学館・ポニーランド・遊具・胸壁）と周りの目立つもの |
| `dev/edogawa_p1.html` | 江戸川の場面を作る途中の確認用ページ（地形・水面・実際の太陽・遠景） |
| `scenes/nagisa/` | なぎさ公園の場面データ（`tools/geo/build_nagisa.py` で作る）と出典 |
| `scenes/edogawa/` | 江戸川（市川）の場面データ（高さ・地面の種類・ランドマーク。`tools/geo/build_scene.py` で作る）と出典 |
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
