# 写実版の素材の出典

素材の画像は `tools/real/build_textures.py` が元の画像から作る（大きさを変えて WebP に）。元の画像はリポジトリに入れない。

## 地面（`ground/`）

すべて CC0（パブリックドメイン）。出典の表示は必須ではないが、記録のために書く。

| ファイル | 元の素材 | 取得元 | ライセンス | 取得日 |
|---|---|---|---|---|
| `grass_*` | Grass 004（1K-JPG） | [ambientCG](https://ambientcg.com/view?id=Grass004) | CC0 | 2026-10-20 |
| `worn_*` | Ground 037（1K-JPG） | [ambientCG](https://ambientcg.com/view?id=Ground037) | CC0 | 2026-10-20 |
| `gravel_*` | Gravel 022（1K-JPG） | [ambientCG](https://ambientcg.com/view?id=Gravel022) | CC0 | 2026-10-20 |
| `asphalt_*` | Asphalt 026 C（1K-JPG） | [ambientCG](https://ambientcg.com/view?id=Asphalt026C) | CC0 | 2026-10-20 |
| `concrete_*` | Concrete 034（1K-JPG） | [ambientCG](https://ambientcg.com/view?id=Concrete034) | CC0 | 2026-10-20 |

`*_color_{1024,512}.webp`：色（sRGB）、`*_normal_{1024,512}.webp`：凹凸（OpenGL 形式の法線）、`*_rough_512.webp`：粗さ、`means.json`：色の平均（線形）。

## 木（`trees/`）

| ファイル | 元の素材 | 取得元 | ライセンス | 取得日 |
|---|---|---|---|---|
| `oak_bark_{color,normal,ao,rough}.webp` | ez-tree 1.1.0 の `src/lib/assets/bark/oak_*_1k.jpg` | [ez-tree](https://github.com/dgreenheck/ez-tree)（jsDelivr の npm パッケージ） | MIT（© 2024 Daniel Greenheck） | 2026-10-21 |
| `oak_leaves.webp` | ez-tree 1.1.0 の `src/lib/assets/leaves/oak_color.png` | 同上 | MIT | 2026-10-21 |

木の形を作るコードも ez-tree 1.1.0 から取り込んでいる（`real/js/vendor/ez-tree/`、ライセンスは同じフォルダの `LICENSE`）。
