"""場面データの画像（scenes/<場所>/*.png）から、劣化なしの WebP を作り、scene.json の files をそちらに向ける。

PNG は編集用の元データとして残す（ground.png は手で直すことがある。--keep-ground や check_scene.py も PNG を読む）。
ページ（ドット絵版・写実版）が読むのは WebP だけ。劣化なし（lossless）なので画素は PNG と 1 つも変わらない
（書き出したあと、読み直して PNG と画素を比べ、違えば止まる）。PNG より 3〜4 割小さい。

  python3 tools/geo/to_webp.py edogawa nagisa myoden myoden-far   # 場所を指定（省略するとすべて）

build_*.py の最後でも呼んでいる（作り直したら WebP も作り直す）。
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SCENES = os.path.join(ROOT, 'scenes')


def pixels(path):
    im = Image.open(path)
    im.load()
    # P（色の表）や透明度つきは RGBA に、ほかは RGB にして比べる
    mode = 'RGBA' if (im.mode in ('RGBA', 'LA', 'P') or 'transparency' in im.info) else 'RGB'
    return im.convert(mode)


def convert(scene_dir):
    """scene_dir の scene.json が指す PNG を WebP にして、scene.json を書き換える。書き換えた数を返す"""
    path = os.path.join(scene_dir, 'scene.json')
    with open(path, encoding='utf-8') as f:
        scene = json.load(f)
    refs = []  # (dict, key) — scene.json の中で画像の名前が入っている所
    for part in scene['files'].values():
        for k in ('height', 'ground', 'groundColor'):
            if isinstance(part.get(k), str):
                refs.append((part, k))
        if isinstance(part.get('color'), dict):
            refs.append((part['color'], 'file'))
    n = 0
    for d, k in refs:
        name = d[k]
        png = name if name.endswith('.png') else name[:-5] + '.png'  # 2 回目は .webp → .png の元から作り直す
        src = os.path.join(scene_dir, png)
        if not os.path.exists(src):
            continue
        dst = src[:-4] + '.webp'
        im = pixels(src)
        im.save(dst, 'WEBP', lossless=True, quality=100, method=6, exact=True)
        back = Image.open(dst).convert(im.mode)
        if back.tobytes() != im.tobytes():
            raise SystemExit(f'{dst}: 画素が PNG と一致しない')
        d[k] = os.path.basename(dst)
        n += 1
        print(f'  {os.path.relpath(dst, ROOT)}  {os.path.getsize(src) // 1024} KB → {os.path.getsize(dst) // 1024} KB')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(scene, f, ensure_ascii=False, indent=1)
    return n


if __name__ == '__main__':
    sites = sys.argv[1:] or sorted(d for d in os.listdir(SCENES) if os.path.exists(os.path.join(SCENES, d, 'scene.json')))
    for s in sites:
        print(s)
        convert(os.path.join(SCENES, s))
