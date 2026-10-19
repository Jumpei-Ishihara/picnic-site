# 出典（scenes/nagisa）

このフォルダのデータは、次のデータを加工して作成しています。

| ファイル | もとにしたデータ | 出典の書き方 |
|---|---|---|
| `mid_height.png`・`near_height.png` | 国土地理院 標高タイル（基盤地図情報 数値標高モデル DEM5A） | 「国土地理院 基盤地図情報 数値標高モデル（DEM5A）を加工して作成」 |
| `ground.png`・`scene.json` の木・水際の植え込み（`banks`） | 国土地理院 シームレス空中写真（地面の種類・植え込みの帯を読み取る） | 「国土地理院 シームレス空中写真を加工して作成」 |
| `ground_color.png`・`mid_color.png` | 国土地理院 シームレス空中写真（1 m・2 m ごとの色に縮めたもの。地面の色に混ぜる） | 「国土地理院 シームレス空中写真を加工して作成」 |
| `scene.json` のランドマーク・野球場・送電線 | OpenStreetMap | 「© OpenStreetMap contributors」 |

- 国土地理院コンテンツ利用規約：https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
- OpenStreetMap のデータは ODbL（Open Database License）で提供されています：https://www.openstreetmap.org/copyright
  `scene.json` は OpenStreetMap のデータから作った派生データベースで、ODbL で提供します（出典の表示、同じ条件での再配布）。
- 場面の画面と書き出した画像には、上の 3 つの出典を表示します。

作り直し方：`python3 tools/geo/fetch_data.py --site nagisa` → `python3 tools/geo/build_nagisa.py`
