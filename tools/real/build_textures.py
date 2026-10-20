"""写実版の素材を作る（地面の PBR 素材と、木の樹皮・葉）。

元の画像はリポジトリに入れない。取得して展開したフォルダを引数で渡す：

  地面：ambientCG の 1K-JPG（Grass004・Ground037・Gravel022・Asphalt026C・Concrete034）を
        https://ambientcg.com/get?file=<名前>_1K-JPG.zip から取得し、<フォルダ>/<名前>/ に展開
  木  ：ez-tree 1.1.0（MIT）の src/lib/assets/ から
        bark/oak_{color,normal,ao,roughness}_1k.jpg と leaves/oak_color.png（oak_leaves.png の名前で）を <フォルダ>/ に

  python3 tools/real/build_textures.py --ground <地面のフォルダ> --trees <木のフォルダ>

書き出すもの：
  real/assets/ground/<層>_color_{1024,512}.webp・<層>_normal_{1024,512}.webp・<層>_rough_512.webp・means.json
  real/assets/trees/oak_bark_{color,normal,ao,rough}.webp・oak_leaves.webp
必要なもの：Python 3 と Pillow（WebP に対応したもの）
"""
import argparse
import json
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
GROUND_OUT = os.path.join(ROOT, 'real', 'assets', 'ground')
TREES_OUT = os.path.join(ROOT, 'real', 'assets', 'trees')
# 層の名前（real/js/ground.js の GROUND_LAYERS と同じ順）と ambientCG の素材
LAYERS = [('grass', 'Grass004'), ('worn', 'Ground037'), ('gravel', 'Gravel022'), ('asphalt', 'Asphalt026C'), ('concrete', 'Concrete034')]
QUALITY = 80


def to_lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def mean_linear(im):
    """色の平均（線形）。real/js/ground.js が模様を平均で割って明暗だけを足すのに使う"""
    small = im.convert('RGB').resize((128, 128), Image.BOX)
    b = small.tobytes()
    n = len(b) // 3
    return [sum(to_lin(b[k * 3 + c]) for k in range(n)) / n for c in range(3)]


def save_webp(im, path, size=None, quality=QUALITY):
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path, 'WEBP', quality=quality, method=6)
    return os.path.getsize(path)


def build_ground(src):
    os.makedirs(GROUND_OUT, exist_ok=True)
    means, total = {}, 0
    for short, name in LAYERS:
        base = os.path.join(src, name, f'{name}_1K-JPG')
        color = Image.open(base + '_Color.jpg').convert('RGB')
        normal = Image.open(base + '_NormalGL.jpg').convert('RGB')
        rough = Image.open(base + '_Roughness.jpg').convert('L')
        for size in (1024, 512):
            total += save_webp(color, os.path.join(GROUND_OUT, f'{short}_color_{size}.webp'), size)
            total += save_webp(normal, os.path.join(GROUND_OUT, f'{short}_normal_{size}.webp'), size)
        total += save_webp(rough, os.path.join(GROUND_OUT, f'{short}_rough_512.webp'), 512)
        means[short] = [round(v, 5) for v in mean_linear(color)]
    with open(os.path.join(GROUND_OUT, 'means.json'), 'w') as f:
        json.dump(means, f, indent=1)
    print(f'ground: {total // 1024} KB')


def build_trees(src):
    os.makedirs(TREES_OUT, exist_ok=True)
    total = 0
    for kind in ('color', 'normal', 'ao', 'roughness'):
        im = Image.open(os.path.join(src, f'oak_{kind}_1k.jpg'))
        im = im.convert('L') if kind in ('ao', 'roughness') else im.convert('RGB')
        short = 'rough' if kind == 'roughness' else kind
        total += save_webp(im, os.path.join(TREES_OUT, f'oak_bark_{short}.webp'), 512 if kind != 'color' else None)
    leaves = Image.open(os.path.join(src, 'oak_leaves.png')).convert('RGBA')
    total += save_webp(leaves, os.path.join(TREES_OUT, 'oak_leaves.webp'), quality=88)
    print(f'trees: {total // 1024} KB')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--ground')
    ap.add_argument('--trees')
    a = ap.parse_args()
    if a.ground:
        build_ground(a.ground)
    if a.trees:
        build_trees(a.trees)
