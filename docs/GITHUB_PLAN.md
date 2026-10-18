# GitHub 公開の準備と方針

`~/picnic-site` を GitHub に上げるための整理です（2026-10-18）。

## 1. 今の状態

| 項目 | 状態 |
|---|---|
| Git | まだリポジトリではない（`git init` 前） |
| GitHub | `gh` でログイン済み（アカウント Jumpei-Ishihara）。git の名前・メールは設定済み |
| 大きさ | 全体 8.3 MB。除外するもの（地理データのキャッシュ 3 MB・提案書 0.8 MB）を除くと 約 4.5 MB。100 MB を超えるファイルはない（最大は `legacy/exports/riverside-picnic-day-6s.mp4` の 3.1 MB） |
| ビルド | 不要。HTML と ES モジュールだけで、`three` は CDN から読み込む → **GitHub Pages でそのまま公開できる** |

## 2. 準備済み（このパソコンの中だけで変更。まだどこにも送っていない）

- 個人のパスを消した：`tools/export_server.js` の保存先を、自分のホームのフルパス書きから `~/Downloads`（`os.homedir()`、`EXPORT_DIR` で変更可）に。`legacy/picnic_3d.html` の表示文も同様。
- `.gitignore` を追加：
  - `tools/geo/cache/`（国土地理院のタイル・OSM の取得結果。再配布せず、`fetch_data.py` で取り直す）
  - `docs/*企画提案書*.pdf`（個人の資料）
  - `.claude/`（このパソコンだけの設定。パスが入っている）
  - `__pycache__/`、`node_modules/`、`.DS_Store` など
- パスワード・API キー・トークン・メールアドレスがファイルに入っていないことを確認した。

## 3. 公開してよいか（ライセンスと出典）

| 中身 | 扱い |
|---|---|
| 自分で書いたコード（HTML・`engine/`・`realsite/`・`tools/`） | 好きなライセンスを付けられる。決める必要あり（4 章） |
| three.js | CDN から読むだけ（MIT）。同梱しないので追加の対応は不要 |
| `scenes/edogawa/` の高さ・地面の種類 | 国土地理院のコンテンツ利用規約で、出典を書けば加工・公開してよい。`scenes/edogawa/ATTRIBUTION.md` に記載済み |
| `scenes/edogawa/scene.json`（ランドマーク・野球場・送電線など） | OpenStreetMap から作った派生データベース。**ODbL**：出典「© OpenStreetMap contributors」を書き、このデータは ODbL で提供すると明記する必要がある（ATTRIBUTION.md に記載済み。README にも書く） |
| `docs/edogawa/site_map.jpg` | 国土地理院の空中写真を加工した図。出典を図の中に記載済み → 公開してよい |
| 企画提案書 PDF | 個人の資料で、写真や商品の説明が入っている → **公開しない**（`.gitignore` 済み）。設計書の中の要約・引用は残る |
| 音 | すべてプログラムで合成。音源ファイルなし |
| `legacy/` | 旧版。比較用に残すか、外すか決める（4 章） |

## 4. 決めること

1. **公開範囲**：公開（Public）か非公開（Private）か。GitHub Pages で Web サイトとして見せるなら公開が簡単（無料プランでは Private の Pages は使えない）。
2. **コードのライセンス**：おすすめは MIT（自由に使ってよい・著作権表示だけ残す）。使わせたくなければ「ライセンスなし（All rights reserved）」。データ（`scenes/edogawa/`）は 3 章の条件が別にかかる。
3. **企画提案書 PDF**：入れない（おすすめ）か、入れるか。
4. **`legacy/`（旧版と 3 MB の動画）**：入れる（比較できる）か、外すか。
5. **GitHub Pages**：使う場合、URL は `https://jumpei-ishihara.github.io/picnic-site/` になる。書き出しの ~/Downloads 直接保存（ブリッジ）は Pages では使えず、ブラウザのダウンロードになる（今の作りのまま動く）。

## 4-2. 決まったこと（2026-10-18）

| 項目 | 決定 |
|---|---|
| 公開範囲 | **Public＋GitHub Pages**（`https://jumpei-ishihara.github.io/picnic-site/`） |
| コードのライセンス | **MIT**（`LICENSE`。地図由来のデータと図は対象外と明記） |
| `legacy/` | **含める** |
| 企画提案書 PDF | **入れない**（`.gitignore`） |

済んだこと：`LICENSE` を追加、README に「ライセンスと出典」と Pages の URL を追記、ATTRIBUTION.md に ODbL で提供すると明記。

## 5. 進め方

1. README に「ライセンス」「出典」「GitHub Pages の URL」を追記し、`LICENSE` を置く。
2. `git init -b main` → 最初のコミット（`.gitignore` で除外したものが入っていないことを `git status` で確認）。
3. `gh repo create picnic-site --public/--private --source . --push`。
4. Pages を使うなら、リポジトリの Settings → Pages で「main ブランチ / ルート」を選ぶ（または `gh api` で設定）。数分後に URL で開けることを確認。
5. 公開後の確認：入口ページ・3 つの場面が開くか、`scenes/edogawa/` が読めるか、出典が表示されるか。
