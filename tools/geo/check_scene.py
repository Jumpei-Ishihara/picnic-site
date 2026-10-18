"""scenes/edogawa/ の出力を確かめる（docs/EDOGAWA_DESIGN.md 8 章 P0 の確認）。

  python3 tools/geo/check_scene.py

  1. 水際：近景の水際（DEM から）と、空中写真で見える水際のずれ
  2. 断面：断面の型（near_height.png）と DEM の差
  3. 図：tools/geo/cache/check/ に確認用の画像を出す
     near_compare.png  左：空中写真（場面の座標に合わせて回したもの）、中：ground.png、右：near_height の陰影
     sections.png      断面の比較（灰：DEM、赤：断面の型）
     mid_preview.png   中景の陰影と地面の種類、橋・鉄塔・送電線・視点
"""
import colorsys
import math
import os

from PIL import Image, ImageDraw

import build_scene as B
from geo_common import CACHE, OUT, load_json, tp2y

CHECK = os.path.join(CACHE, 'check')


def dec(png):
    im = Image.open(png).convert('RGB')
    px = im.load()
    w, h = im.size
    return [[(px[i, j][0] * 256 + px[i, j][1]) / 100 - 10 for i in range(w)] for j in range(h)], \
        [[px[i, j][2] for i in range(w)] for j in range(h)]


def shade(hs, step, exag=2.0):
    h, w = len(hs), len(hs[0])
    out = Image.new('L', (w, h))
    px = out.load()
    for j in range(h):
        for i in range(w):
            dx = (hs[j][min(i + 1, w - 1)] - hs[j][max(i - 1, 0)]) / (2 * step) * exag
            dz = (hs[min(j + 1, h - 1)][i] - hs[max(j - 1, 0)][i]) / (2 * step) * exag
            n = (-dx, 1, -dz)
            ln = math.sqrt(sum(c * c for c in n))
            l = (-0.5, 0.7, -0.5)
            ll = math.sqrt(sum(c * c for c in l))
            px[i, j] = int(max(0, sum(a * b for a, b in zip(n, l)) / ln / ll) * 255)
    return out


def is_photo_green(rgb):
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return 60 <= h * 360 <= 180 and s >= 0.12


def main():
    os.makedirs(CHECK, exist_ok=True)
    scene = load_json(os.path.join(OUT, 'scene.json'))
    N = scene['files']['near']
    near, _ = dec(os.path.join(OUT, 'near_height.png'))
    photo = B.Photo()
    dem = B.Dem()

    # 1. 水際のずれ：写真で芝（緑）が始まる位置と、近景の芝の始まり（護岸の上の端）を比べる
    rows = B.read_sections(dem, photo)
    diffs = []
    plaza = 0
    for row in rows[::2]:
        z = row['z']
        if row['plaza']:
            plaza += 1
            continue
        xs = [row['shore'] - 10 + k * 0.5 for k in range(61)]
        green = [is_photo_green(photo.rgb(x, z)) for x in xs]
        edge = next((xs[k] for k in range(len(xs) - 3) if all(green[k:k + 4])), None)
        if edge is not None:
            diffs.append((z, edge - row['bankTop']))
    if diffs:
        d = sorted(abs(v) for _, v in diffs)
        bias = sorted(v for _, v in diffs)[len(diffs) // 2]
        print(f'水際：{len(diffs)} 行で比較（水際の広場の {plaza} 行は除く）  ずれの中央値 {bias:+.2f} m（+ は写真の芝が陸側）  '
              f'|ずれ| 中央値 {d[len(d) // 2]:.2f} m・最大 {max(d):.2f} m・2 m 以内 {sum(1 for v in d if v <= 2) / len(d) * 100:.0f}%')
        far = [(z, v) for z, v in diffs if abs(v) > 2]
        if far:
            print('  2 m を超える行（z, ずれ）：', ' '.join(f'({z},{v:+.1f})' for z, v in far[:20]))

    # 2. 断面：水際より陸側で、断面の型と DEM の差
    errs = {'floodplain': [], 'levee': [], 'crest': []}
    for j, row in enumerate(rows):
        z = row['z']
        for i in range(N['w']):
            x = N['x0'] + i
            if x < row['shore'] + 4:
                continue
            m = near[j][i]
            dv = dem.height(x, z)
            part = 'floodplain' if x < row['toe'] - 2 else ('levee' if x < row['crestStart'] else ('crest' if x <= row['crestEnd'] else None))
            if part:
                errs[part].append(m - dv)
    for k, v in errs.items():
        rms = math.sqrt(sum(e * e for e in v) / len(v))
        print(f'断面 {k:10s}: 点 {len(v):5d}  平均差 {sum(v) / len(v):+.2f} m  RMS {rms:.2f} m')
    r0 = min(rows, key=lambda r: abs(r['z']))
    print(f"原点の断面：水際 x={r0['shore']:.1f}  河川敷 TP {r0['fpTP']:.2f}  堤防の下 x={r0['toe']:.1f}  "
          f"上 x={r0['crestStart']:.1f}〜{r0['crestEnd']:.1f}（幅 {r0['crestEnd'] - r0['crestStart']:.1f} m） TP {r0['crestTP']:.2f}  "
          f"斜面 1:{(r0['crestStart'] - r0['toe']) / (r0['crestTP'] - r0['fpTP']):.1f}")

    # 3a. 近景の比較図
    w, h, S = N['w'], N['h'], 3
    ph = Image.new('RGB', (w, h))
    pp = ph.load()
    for j in range(h):
        for i in range(w):
            pp[i, j] = tuple(int(c) for c in photo.rgb(N['x0'] + i, N['z0'] + j))
    gr = Image.open(os.path.join(OUT, 'ground.png')).convert('RGB')
    hs = shade(near, 1.0)
    cmp_ = Image.new('RGB', (w * S * 3 + 20, h * S), (255, 255, 255))
    for k, im in enumerate([ph, gr, hs.convert('RGB')]):
        cmp_.paste(im.resize((w * S, h * S), Image.NEAREST), (k * (w * S + 10), 0))
    d = ImageDraw.Draw(cmp_)
    for k in range(3):
        ox = k * (w * S + 10)
        for row in rows[::6]:
            y = (row['z'] - N['z0']) * S
            d.point((ox + (row['shore'] - N['x0']) * S, y), fill=(255, 0, 0))
        cx, cz = (0 - N['x0']) * S + ox, (0 - N['z0']) * S
        d.ellipse([cx - 4, cz - 4, cx + 4, cz + 4], outline=(255, 0, 0), width=2)
        for t in scene['trees']:
            tx, tz = (t['x'] - N['x0']) * S + ox, (t['z'] - N['z0']) * S
            d.ellipse([tx - t['r'] * S, tz - t['r'] * S, tx + t['r'] * S, tz + t['r'] * S], outline=(255, 255, 0))
    cmp_.save(os.path.join(CHECK, 'near_compare.png'))

    # 3b. 断面図
    W2, H2 = 900, 4 * 130
    im = Image.new('RGB', (W2, H2), (250, 250, 245))
    d = ImageDraw.Draw(im)
    for k, zz in enumerate((-100, -50, 0, 50)):
        j = zz - N['z0']
        oy = k * 130 + 115
        X = lambda x: 20 + (x - N['x0']) * (W2 - 40) / N['w']
        Y = lambda tp: oy - (tp + 1) * 9
        d.line([(X(N['x0']), Y(scene['water']['levelY'] + 2.5))] * 1 + [(X(N['x0'] + N['w']), Y(scene['water']['levelY'] + 2.5))],
               fill=(120, 160, 200))
        d.line([(X(x), Y(dem.height(x, zz))) for x in range(N['x0'], N['x0'] + N['w'])], fill=(130, 130, 130), width=3)
        d.line([(X(N['x0'] + i), Y(near[j][i])) for i in range(N['w'])], fill=(220, 40, 40), width=1)
        d.text((24, oy - 108), f'z = {zz} m', fill=(0, 0, 0))
    im.save(os.path.join(CHECK, 'sections.png'))

    # 3c. 中景の図
    M = scene['files']['mid']
    mh, mc = dec(os.path.join(OUT, 'mid_height.png'))
    sh = shade(mh, M['step'], 3.0)
    cols = [(150, 140, 130), (120, 165, 85), (210, 185, 135), (70, 110, 150)]
    im = Image.new('RGB', (M['w'], M['h']))
    px = im.load()
    sp = sh.load()
    for j in range(M['h']):
        for i in range(M['w']):
            c = cols[mc[j][i]]
            s = 0.45 + sp[i, j] / 255 * 0.75
            px[i, j] = tuple(min(255, int(v * s)) for v in c)
    S = 2
    im = im.resize((M['w'] * S, M['h'] * S), Image.NEAREST)
    d = ImageDraw.Draw(im)
    P = lambda x, z: ((x - M['x0']) / M['step'] * S, (z - M['z0']) / M['step'] * S)
    for b in scene['landmarks']['bridges']:
        d.line([P(*p) for p in b['path']], fill=(220, 30, 30) if b['kind'] == 'truss' else (255, 140, 0), width=3)
    for l in scene['landmarks']['powerLines']:
        d.line([P(*p) for p in l['path']], fill=(40, 40, 40), width=1)
    for t in scene['landmarks']['towers']:
        x, y = P(*t)
        d.rectangle([x - 2, y - 2, x + 2, y + 2], fill=(0, 0, 0))
    for bd in scene['landmarks']['buildings']:
        d.polygon([P(*p) for p in bd['footprint']], outline=(90, 0, 140))
    for name, v in scene['viewpoints'].items():
        x, y = P(v['x'], v['z'])
        r = math.radians(v['bearing'])
        from geo_common import local_from_bearing
        ex, ez = local_from_bearing(v['bearing'], 120)
        d.line([(x, y), P(v['x'] + ex, v['z'] + ez)], fill=(255, 230, 0), width=2)
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 0, 0), width=2)
    nx0, nz0 = P(N['x0'], N['z0'])
    nx1, nz1 = P(N['x0'] + N['w'], N['z0'] + N['h'])
    d.rectangle([nx0, nz0, nx1, nz1], outline=(255, 255, 255))
    im.save(os.path.join(CHECK, 'mid_preview.png'))
    print('図：', CHECK)


if __name__ == '__main__':
    main()
