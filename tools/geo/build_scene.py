"""cache/ の元データから scenes/edogawa/ の場面データを作る（docs/EDOGAWA_DESIGN.md 5.1）。

  python3 tools/geo/build_scene.py

出力
  scenes/edogawa/mid_height.png  中景の高さ（4 m 間隔）。R*256+G = (TP+10)*100、B = 地面の種類（MID_CLASSES）
  scenes/edogawa/near_height.png 近景の高さ（1 m 間隔）。同じ符号化。断面の型から作る
  scenes/edogawa/ground.png      近景の地面の種類（1 m 間隔）。GROUND の色で塗る。手で直してよい
  scenes/edogawa/scene.json      座標の決め方・ファイルの説明・水際・断面・木・ランドマーク・視点・太陽
  scenes/edogawa/ATTRIBUTION.md  出典

ground.png を手で直したときは --keep-ground を付けると上書きしない（高さと scene.json だけ作り直す）。
"""
import math
import os
import sys
from collections import deque

from PIL import Image

import rails
from geo_common import (CACHE, OUT, SITE, bearing_dist, ll2local, ll2tile, load_json,
                        local2ll, local_from_bearing, save_json, tp2y)

DEM_Z, PHOTO_Z = 15, 17
WATER_TP = SITE['waterTP']
SHEET_FROM_WATER = 15  # シートと水際の距離（m）
LUNCH_BEARING = 315    # シートとランチの視点の向き（方位）

# 近景と中景の範囲（場面の座標、m）
NEAR = {'x0': -64, 'z0': -112, 'step': 1, 'w': 177, 'h': 193}    # x -64..112, z -112..80
MID = {'x0': -768, 'z0': -1280, 'step': 4, 'w': 385, 'h': 449}   # x -768..768, z -1280..512

# 近景の地面の種類（ground.png の色）
GROUND = [
    ('water',     (60, 90, 110)),
    ('lawn',      (110, 160, 70)),
    ('lawnWorn',  (160, 175, 100)),
    ('dirt',      (215, 190, 140)),
    ('paved',     (200, 200, 195)),
    ('revetment', (150, 150, 140)),
    ('leveeGrass', (90, 140, 60)),
    ('road',      (110, 110, 115)),
    ('tree',      (40, 80, 40)),
    ('reeds',     (150, 140, 70)),
    ('other',     (170, 120, 110)),
]
G = {name: i for i, (name, _) in enumerate(GROUND)}
MID_CLASSES = ['town', 'grass', 'pitch', 'water']


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 標高

class Dem:
    """DEM5A のタイルをつないだ格子。水面（値なし）は川とつながったものだけを水とし、ほかの穴は周りから埋める。"""

    def __init__(self):
        from geo_common import tile_range
        xs, ys = tile_range(SITE['bbox'], DEM_Z)
        self.tx0, self.ty0 = xs.start, ys.start
        self.W, self.H = len(xs) * 256, len(ys) * 256
        W = self.W
        h = [None] * (W * self.H)
        for i, tx in enumerate(xs):
            for j, ty in enumerate(ys):
                p = os.path.join(CACHE, 'dem5a_png', str(DEM_Z), str(tx), f'{ty}.png')
                if not os.path.exists(p):
                    continue
                px = Image.open(p).convert('RGB').load()
                for yy in range(256):
                    row = (j * 256 + yy) * W + i * 256
                    for xx in range(256):
                        r, g, b = px[xx, yy]
                        v = (r << 16) | (g << 8) | b
                        if v != 1 << 23:
                            h[row + xx] = v * 0.01 if v < 1 << 23 else (v - (1 << 24)) * 0.01
        self.h = h
        self._water_and_fill()

    def pix(self, lat, lon):
        x, y = ll2tile(lat, lon, DEM_Z)
        return (x - self.tx0) * 256 - 0.5, (y - self.ty0) * 256 - 0.5

    def _water_and_fill(self):
        W, H, h = self.W, self.H, self.h
        # 値なしの画素の大きな塊（橋で分かれた川の各部分）を水とする。小さな塊は建物などの穴
        water = bytearray(W * H)
        seen = bytearray(W * H)
        for start in range(W * H):
            if seen[start] or h[start] is not None:
                continue
            comp = [start]
            seen[start] = 1
            q = deque([start])
            while q:
                k = q.popleft()
                x, y = k % W, k // W
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H:
                        n = ny * W + nx
                        if not seen[n] and h[n] is None:
                            seen[n] = 1
                            comp.append(n)
                            q.append(n)
            if len(comp) >= 1500:
                for k in comp:
                    water[k] = 1
        self.water = water
        # 水際からの距離（画素）→ 川底の高さ
        dist = [-1] * (W * H)
        q = deque()
        for k in range(W * H):
            if water[k]:
                x, y = k % W, k // W
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H and not water[ny * W + nx]:
                        dist[k] = 1
                        q.append(k)
                        break
        while q:
            k = q.popleft()
            x, y = k % W, k // W
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H:
                    n = ny * W + nx
                    if water[n] and dist[n] < 0:
                        dist[n] = dist[k] + 1
                        q.append(n)
        mpp = 40075016.686 * math.cos(math.radians(SITE['origin']['lat'])) / 2 ** DEM_Z / 256
        for k in range(W * H):
            if water[k]:
                h[k] = WATER_TP - min(3.5, 0.6 + max(dist[k], 1) * mpp * 0.06)
        # 川以外の穴（建物の影など）は周りの平均で埋める
        holes = [k for k in range(W * H) if h[k] is None]
        log(f'dem: {W}x{H}, water px {sum(water)}, other holes {len(holes)}')
        for _ in range(64):
            if not holes:
                break
            rest = []
            for k in holes:
                x, y = k % W, k // W
                vs = [h[ny * W + nx] for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
                      if 0 <= nx < W and 0 <= ny < H and h[ny * W + nx] is not None]
                if vs:
                    h[k] = sum(vs) / len(vs)
                else:
                    rest.append(k)
            holes = rest
        for k in holes:
            h[k] = SITE['origin']['tp']

    def _at(self, arr, x, y):
        x = min(max(x, 0), self.W - 1.001)
        y = min(max(y, 0), self.H - 1.001)
        ix, iy = int(x), int(y)
        fx, fy = x - ix, y - iy
        W = self.W
        a, b = arr[iy * W + ix], arr[iy * W + ix + 1]
        c, d = arr[(iy + 1) * W + ix], arr[(iy + 1) * W + ix + 1]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

    def height(self, x, z):
        return self._at(self.h, *self.pix(*local2ll(x, z)))

    def is_water(self, x, z):
        return self._at(self.water, *self.pix(*local2ll(x, z))) > 0.5


# ---------------------------------------------------------------- 空中写真

class Photo:
    def __init__(self):
        from geo_common import tile_range
        xs, ys = tile_range(SITE['photoBbox'], PHOTO_Z)
        self.tx0, self.ty0 = xs.start, ys.start
        im = Image.new('RGB', (len(xs) * 256, len(ys) * 256))
        for i, tx in enumerate(xs):
            for j, ty in enumerate(ys):
                p = os.path.join(CACHE, 'seamlessphoto', str(PHOTO_Z), str(tx), f'{ty}.jpg')
                im.paste(Image.open(p).convert('RGB'), (i * 256, j * 256))
        self.im = im
        self.px = im.load()

    def pix(self, x, z):
        tx, ty = ll2tile(*local2ll(x, z), PHOTO_Z)
        return (tx - self.tx0) * 256, (ty - self.ty0) * 256

    def rgb(self, x, z):
        """1 m 四方の平均色（写真は 1 画素 約 0.97 m なので 3x3 の 0.5 m 間隔で平均）。"""
        acc = [0, 0, 0]
        for dx in (-0.33, 0, 0.33):
            for dz in (-0.33, 0, 0.33):
                u, v = self.pix(x + dx, z + dz)
                c = self.px[int(min(max(u, 0), self.im.width - 1)), int(min(max(v, 0), self.im.height - 1))]
                for i in range(3):
                    acc[i] += c[i]
        return [a / 9 for a in acc]


BRIGHT = -1  # 明るい灰色：土の内野か舗装か、形で決める（build_ground）


def classify(rgb):
    """写真の色から地面の種類の候補。この写真は全体に彩度が低く、土の内野も舗装も明るい灰色に写る。"""
    import colorsys
    r, g, b = (c / 255 for c in rgb)
    hh, s, v = colorsys.rgb_to_hsv(r, g, b)
    hue = hh * 360
    if s < 0.12 and v >= 0.6:
        return BRIGHT
    if s < 0.08 and v >= 0.38:
        return G['road']
    if 60 <= hue <= 180 and s >= 0.1:
        if v < 0.42 and s >= 0.2:
            return G['tree']
        return G['lawnWorn'] if s < 0.14 and v >= 0.53 else G['lawn']
    if 30 <= hue < 60 and s >= 0.1:
        return G['reeds']
    return G['lawn']


# ---------------------------------------------------------------- 小さな道具

def smooth(vals, radius, median=True):
    n = len(vals)
    out = []
    for i in range(n):
        win = sorted(vals[max(0, i - radius):i + radius + 1]) if median else vals[max(0, i - radius):i + radius + 1]
        out.append(win[len(win) // 2] if median else sum(win) / len(win))
    return out


def blur(vals, radius):
    return smooth(vals, radius, median=False)


def enc_height(tp):
    v = max(0, min(65535, round((tp + 10) * 100)))
    return v >> 8, v & 255


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- 断面の読み取り

def photo_lawn_edge(photo, shore, z):
    """写真で、水際から陸側へ見て芝（緑）が 2 m 続けて始まる位置と、そこまでに明るい舗装が占める割合。"""
    import colorsys
    xs = [shore + k * 0.5 for k in range(-6, 30)]
    green, bright = [], []
    for x in xs:
        r, g, b = (c / 255 for c in photo.rgb(x, z))
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        green.append(60 <= h * 360 <= 180 and s >= 0.12)
        bright.append(s < 0.12 and v >= 0.6)
    k = next((k for k in range(len(xs) - 3) if all(green[k:k + 4])), None)
    if k is None:
        return None, 0
    between = bright[6:k] if k > 6 else []
    return xs[k], (sum(between) / len(between) if between else 0)


def read_sections(dem, photo=None):
    """近景の各行（z、1 m おき）について、水際・河川敷・堤防の位置と高さを DEM から読む。
    護岸の上の端（芝の始まり）は空中写真から読む（DEM の 5 m の格子では護岸の幅がわからない）。"""
    rows = []
    for j in range(NEAR['h']):
        z = NEAR['z0'] + j
        xs = list(range(-200, 201))
        hs = [dem.height(x, z) for x in xs]
        wet = [dem.is_water(x, z) for x in xs]
        # 水際：x = -200 から陸側へ、最後の水
        shore = max(x for x, w in zip(xs, wet) if w and x < 60) + 0.5
        i0 = xs.index(int(math.ceil(shore)))
        # 河川敷の高さの目安：水際から 6〜30 m の中央値
        fp = sorted(hs[i0 + 6:i0 + 30])[12]
        # 堤防の上：水際から 40〜160 m の最大
        seg = range(i0 + 40, min(i0 + 160, len(xs)))
        top = max(seg, key=lambda i: hs[i])
        crest = hs[top]
        # 堤防の上の端：最大値から 0.5 m 以内
        cs = top
        while hs[cs - 1] > crest - 0.5:
            cs -= 1
        ce = top
        while ce + 1 < len(xs) and hs[ce + 1] > crest - 0.5:
            ce += 1
        # 堤防の下（川側）：上の端から下っていき、河川敷 + 0.3 m を下回る所
        toe = cs
        while toe > i0 and hs[toe] > fp + 0.3:
            toe -= 1
        rows.append({'z': z, 'shore': shore, 'fpTP': fp, 'toe': xs[toe], 'crestStart': xs[cs], 'crestEnd': xs[ce],
                     'crestTP': crest})
    # z 方向にならす（DEM の 4 m の階段を消す）
    for key, r in (('shore', 6), ('fpTP', 10), ('toe', 8), ('crestStart', 8), ('crestEnd', 8), ('crestTP', 10)):
        v = blur(smooth([row[key] for row in rows], r), r)
        for row, s in zip(rows, v):
            row[key] = s
    # 護岸の上の端：写真の芝の始まり。水際から 2.2〜10 m に収める。水際の広場がある行は広場の縁（水際 + 3 m）、z 方向にならす
    tops = []
    for row in rows:
        e, paved = photo_lawn_edge(photo, row['shore'], row['z']) if photo else (None, 0)
        row['plaza'] = paved > 0.5  # 水際の広場（舗装）：護岸は広場の縁まで
        if e is None or row['plaza']:
            e = row['shore'] + (3.0 if row['plaza'] else 2.2)
        tops.append(min(max(e, row['shore'] + 2.2), row['shore'] + 10) - row['shore'])
    for row, t in zip(rows, blur(smooth(tops, 6), 4)):
        row['bankTop'] = row['shore'] + t
    # 河川敷の傾き：行ごとに 水際→堤防の下 を最小二乗で
    for row in rows:
        z = row['z']
        pts = [(x, dem.height(x, z)) for x in range(int(row['bankTop']) + 2, int(row['toe']) - 2)]
        n = len(pts)
        mx = sum(p[0] for p in pts) / n
        my = sum(p[1] for p in pts) / n
        sxx = sum((p[0] - mx) ** 2 for p in pts) or 1
        row['fpSlope'] = max(-0.01, min(0.01, sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx))
        row['fpMid'] = (mx, my)
    v = blur([row['fpSlope'] for row in rows], 12)
    for row, s in zip(rows, v):
        row['fpSlope'] = s
    return rows


def section_tp(row, x, dem):
    """断面の型による高さ（TP）。"""
    s, toe, cs, ce = row['shore'], row['toe'], row['crestStart'], row['crestEnd']
    mx, my = row['fpMid']
    fp = lambda xx: my + (xx - mx) * row['fpSlope']
    bank_top = row['bankTop']
    if x <= s:  # 川底：水際から 1:3 で下がり、DEM の川底へ
        return max(WATER_TP - (s - x) / 3, WATER_TP - 3.0)
    if x < bank_top:  # 護岸：水面から河川敷の縁へ
        return WATER_TP + (fp(bank_top) - WATER_TP) * smoothstep(s, bank_top, x)
    if x < toe:
        return fp(x)
    if x < cs:  # 堤防の斜面：途中の小段も残すため DEM を x 方向に 5 m でならして使い、上下の端はなめらかにつなぐ
        lin = fp(toe) + (row['crestTP'] - fp(toe)) * (x - toe) / (cs - toe)
        d = sum(dem.height(x + dx, row['z']) for dx in (-2, -1, 0, 1, 2)) / 5
        d = min(max(d, fp(toe)), row['crestTP'])
        w = smoothstep(toe, toe + 3, x) * (1 - smoothstep(cs - 3, cs, x))
        return lin + (d - lin) * w
    if x <= ce:
        mid = (cs + ce) / 2
        return row['crestTP'] + 0.08 * (1 - ((x - mid) / max(1, (ce - cs) / 2)) ** 2)
    # 町側：DEM をならして、上の端からなめらかにつなぐ
    d = sum(dem.height(x + dx, row['z']) for dx in (-2, -1, 0, 1, 2)) / 5
    return row['crestTP'] + (d - row['crestTP']) * smoothstep(ce, ce + 3, x)


def round_corners(hs, xs, row):
    """堤防の斜面の上下の角を少し丸める（ドット絵の輪郭がギザギザにならないように）。"""
    out = hs[:]
    for i in range(2, len(hs) - 2):
        if row['toe'] - 3 < xs[i] < row['crestStart'] + 3 or row['crestEnd'] - 2 < xs[i] < row['crestEnd'] + 4:
            out[i] = (hs[i - 2] + 2 * hs[i - 1] + 3 * hs[i] + 2 * hs[i + 1] + hs[i + 2]) / 9
    return out


# ---------------------------------------------------------------- 地面の種類

def mode_filter(cls, w, h, keep=()):
    out = cls[:]
    for j in range(h):
        for i in range(w):
            c = cls[j * w + i]
            if c in keep:
                continue
            cnt = {}
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    ii, jj = i + di, j + dj
                    if 0 <= ii < w and 0 <= jj < h:
                        k = cls[jj * w + ii]
                        cnt[k] = cnt.get(k, 0) + 1
            best = max(cnt, key=cnt.get)
            if cnt[best] >= 5:
                out[j * w + i] = best
    return out


def build_ground(rows, photo):
    w, h = NEAR['w'], NEAR['h']
    cls = [0] * (w * h)
    for j, row in enumerate(rows):
        for i in range(w):
            x = NEAR['x0'] + i
            cls[j * w + i] = classify(photo.rgb(x, row['z']))
    # 明るい灰色の塊：幅 7 m 以上の芯がある塊は土の内野、細いもの（道）は舗装
    bright = [c == BRIGHT for c in cls]
    core = [False] * (w * h)
    R = 3
    for j in range(R, h - R):
        for i in range(R, w - R):
            core[j * w + i] = all(bright[(j + dj) * w + i + di] for dj in range(-R, R + 1) for di in range(-R, R + 1))
    blob = [False] * (w * h)
    for j in range(h):
        for i in range(w):
            if core[j * w + i]:
                for dj in range(-R - 1, R + 2):
                    for di in range(-R - 1, R + 2):
                        if 0 <= i + di < w and 0 <= j + dj < h:
                            blob[(j + dj) * w + i + di] = True
    for k in range(w * h):
        if bright[k]:
            cls[k] = G['dirt'] if blob[k] else G['paved']
    cls = mode_filter(cls, w, h)
    # 水際の広場（舗装）は幅があっても土ではない
    for j, row in enumerate(rows):
        for i in range(w):
            x = NEAR['x0'] + i
            if x < row['shore'] + 15 and cls[j * w + i] == G['dirt']:
                cls[j * w + i] = G['paved']
    # 形からの上書き：水、護岸、堤防の斜面の芝、堤防の上の道路
    for j, row in enumerate(rows):
        for i in range(w):
            x = NEAR['x0'] + i
            k = j * w + i
            c = cls[k]
            if x < row['shore']:
                cls[k] = G['water']
            elif x < row['bankTop'] and c != G['paved']:
                cls[k] = G['revetment']
            elif c == G['water'] or c == G['other']:
                cls[k] = G['lawn']
            if row['toe'] <= x < row['crestStart'] or row['crestEnd'] < x < row['crestEnd'] + 14:
                if cls[k] in (G['lawn'], G['lawnWorn'], G['dirt'], G['reeds']):
                    cls[k] = G['leveeGrass']
            if row['crestStart'] <= x <= row['crestEnd'] and cls[k] in (G['lawn'], G['lawnWorn'], G['leveeGrass'], G['dirt'], G['other']):
                cls[k] = G['road']
    return cls


def find_trees(cls):
    """'tree' の塊を木として拾う（中心と半径）。"""
    w, h = NEAR['w'], NEAR['h']
    seen = bytearray(w * h)
    trees = []
    for k in range(w * h):
        if cls[k] != G['tree'] or seen[k]:
            continue
        comp = []
        q = deque([k])
        seen[k] = 1
        while q:
            c = q.popleft()
            comp.append(c)
            x, y = c % w, c // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                n = ny * w + nx
                if 0 <= nx < w and 0 <= ny < h and not seen[n] and cls[n] == G['tree']:
                    seen[n] = 1
                    q.append(n)
        if len(comp) < 4:
            continue
        cx = sum(c % w for c in comp) / len(comp) + NEAR['x0']
        cz = sum(c // w for c in comp) / len(comp) + NEAR['z0']
        trees.append({'x': cx, 'z': cz, 'n': len(comp)})
    # 近い塊（8 m 以内）は 1 本の木にまとめる
    merged = []
    for t in trees:
        for m in merged:
            if math.dist((t['x'], t['z']), (m['x'], m['z'])) < 8:
                n = m['n'] + t['n']
                m['x'] = (m['x'] * m['n'] + t['x'] * t['n']) / n
                m['z'] = (m['z'] * m['n'] + t['z'] * t['n']) / n
                m['n'] = n
                break
        else:
            merged.append(dict(t))
    return [{'x': round(m['x'], 1), 'z': round(m['z'], 1), 'r': round(max(1.5, math.sqrt(m['n'] / math.pi) * 1.3), 1)}
            for m in merged]


# ---------------------------------------------------------------- 中景

def build_mid(dem, osm):
    w, h, st = MID['w'], MID['h'], MID['step']
    hs = []
    cls = []
    pitches = [[ll2local(p['lat'], p['lon']) for p in e['geometry']] for e in osm
               if e.get('tags', {}).get('leisure') == 'pitch' and e.get('geometry')]
    for j in range(h):
        z = MID['z0'] + j * st
        row_h = [dem.height(MID['x0'] + i * st, z) for i in range(w)]
        row_w = [dem.is_water(MID['x0'] + i * st, z) for i in range(w)]
        # 両岸の堤防の上の位置：川から外へ 300 m 以内の最大
        wi = [i for i, v in enumerate(row_w) if v]
        if wi:
            a, b = min(wi), max(wi)
            west = max(range(max(0, a - 75), a + 1), key=lambda i: row_h[i])
            east = max(range(b, min(w, b + 76)), key=lambda i: row_h[i])
        else:
            west, east = -1, w
        for i in range(w):
            hs.append(row_h[i])
            if row_w[i]:
                c = 3
            elif west <= i <= east:
                c = 1
            else:
                c = 0
            cls.append(c)
    # 野球場（OSM）を塗る
    for poly in pitches:
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        for j in range(max(0, int((min(zs) - MID['z0']) / st)), min(h, int((max(zs) - MID['z0']) / st) + 2)):
            z = MID['z0'] + j * st
            for i in range(max(0, int((min(xs) - MID['x0']) / st)), min(w, int((max(xs) - MID['x0']) / st) + 2)):
                x = MID['x0'] + i * st
                if cls[j * w + i] == 1 and point_in_poly(x, z, poly):
                    cls[j * w + i] = 2
    return hs, cls


def point_in_poly(x, z, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            inside = not inside
    return inside


def shorelines(dem):
    """中景の両岸の水際（z 8 m おき）。"""
    west, east = [], []
    for z in range(MID['z0'], MID['z0'] + (MID['h'] - 1) * MID['step'] + 1, 8):
        wet = [x for x in range(-700, 400, 2) if dem.is_water(x, z)]
        if wet:
            west.append([min(wet) - 1, z])
            east.append([max(wet) + 1, z])
    return west, east


# ---------------------------------------------------------------- 両岸の水際（植え込み・コンクリートの縁）

def _lum(c):
    return (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255


def resample(line, step):
    """折れ線を step m ごとの点に。"""
    out, carry = [list(line[0])], 0.0
    for (x0, z0), (x1, z1) in zip(line, line[1:]):
        L = math.hypot(x1 - x0, z1 - z0)
        s = step - carry
        while s <= L:
            out.append([x0 + (x1 - x0) * s / L, z0 + (z1 - z0) * s / L])
            s += step
        carry = (carry + L) % step
    return out


def shore_banks(photo, line, side, z_range=(-640, 500), step=4, veg_ratio=0.78):
    """
    水際から陸へ、空中写真の明るさの断面を取り、水際の植え込み（ヨシ・低木・柳）の帯と、
    コンクリートの縁（明るく、緑でない）を読む。芝より暗い緑が続く幅を帯の幅とする。
    side: 陸の向き（+1 = +x 側、-1 = -x 側）。
    返す点：[x, z, 陸向きの nx, nz, 帯の始まり（m）, 帯の幅（m）, 濃さ 0〜1（暗い所の割合 = 木の多さ）, 縁（0 = 土・草、1 = コンクリート）]
    """
    pts = [p for p in resample(sorted(line, key=lambda p: p[1]), step) if z_range[0] <= p[1] <= z_range[1]]
    out = []
    for i, (x, z) in enumerate(pts):
        a, b = pts[max(0, i - 2)], pts[min(len(pts) - 1, i + 2)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, tz) or 1
        nx, nz = -tz / L, tx / L
        if nx * side < 0:
            nx, nz = -nx, -nz
        cs = [photo.rgb(x + nx * t, z + nz * t) for t in range(-4, 32)]
        lawn = sorted(_lum(c) for c in cs[24:])[6] or 0.5
        veg, bright = [], 0
        for k, c in enumerate(cs):
            t = k - 4
            green = c[1] - max(c[0], c[2]) >= 2
            r = _lum(c) / lawn
            veg.append(green and r < veg_ratio)
            if -2 <= t <= 2 and not green and r > 1.25:
                bright += 1
        # 水際（-4〜+4 m）から始まり、1 m の切れ目まで許して続く暗い緑
        start = next((k for k in range(0, 9) if veg[k]), None)
        width, dark = 0, 0.0
        if start is not None:
            k, gap, last = start, 0, start
            while k < len(veg) and gap <= 1:
                if veg[k]:
                    last, gap = k, 0
                else:
                    gap += 1
                k += 1
            width = last - start + 1
            band = cs[start:last + 1]
            dark = sum(1 for c in band if _lum(c) / lawn < 0.55) / len(band)
        out.append([x, z, nx, nz, (start if start is not None else 4) - 4, width, dark, 1 if bright >= 2 else 0])
    # 幅と濃さを水際に沿ってならす（写真の 1 点のむらを消す）
    for col in (5, 6):
        vals = smooth([p[col] for p in out], 2)
        for p, v in zip(out, vals):
            p[col] = v
    return [[round(p[0], 1), round(p[1], 1), round(p[2], 3), round(p[3], 3), p[4], round(p[5], 1), round(p[6], 2), p[7]] for p in out]


def find_landing(ground, rows):
    """市川緊急用船着場：近景の水際に接する舗装の塊（空中写真）。向きのある長方形にする。"""
    nw, nh = NEAR['w'], NEAR['h']
    best = None
    seen = set()
    for j in range(nh):
        for i in range(nw):
            k = j * nw + i
            if k in seen or ground[k] != G['paved']:
                continue
            cells, q = [], [k]
            seen.add(k)
            while q:
                c = q.pop()
                cells.append(c)
                ci, cj = c % nw, c // nw
                for ni, nj in ((ci + 1, cj), (ci - 1, cj), (ci, cj + 1), (ci, cj - 1)):
                    n = nj * nw + ni
                    if 0 <= ni < nw and 0 <= nj < nh and n not in seen and ground[n] == G['paved']:
                        seen.add(n)
                        q.append(n)
            xs = [NEAR['x0'] + c % nw for c in cells]
            zs = [NEAR['z0'] + c // nw for c in cells]
            # 水際から 6 m 以内に寄っている塊
            near_water = sum(1 for x, z in zip(xs, zs) if x - rows[z - NEAR['z0']]['shore'] < 6)
            if near_water > 20 and (best is None or len(cells) > len(best[0])):
                best = (cells, xs, zs)
    if not best:
        return None
    _, xs, zs = best
    n = len(xs)
    mx, mz = sum(xs) / n, sum(zs) / n
    sxx = sum((x - mx) ** 2 for x in xs) / n
    szz = sum((z - mz) ** 2 for z in zs) / n
    sxz = sum((x - mx) * (z - mz) for x, z in zip(xs, zs)) / n
    ang = 0.5 * math.atan2(2 * sxz, sxx - szz)       # 長い向き（x 軸から）
    ux, uz = math.cos(ang), math.sin(ang)
    us = [(x - mx) * ux + (z - mz) * uz for x, z in zip(xs, zs)]
    vs = [-(x - mx) * uz + (z - mz) * ux for x, z in zip(xs, zs)]
    us.sort(); vs.sort()
    lo, hi = us[int(n * 0.02)], us[int(n * 0.98) - 1]
    vlo, vhi = vs[int(n * 0.02)], vs[int(n * 0.98) - 1]
    cu, cv = (lo + hi) / 2, (vlo + vhi) / 2
    cx, cz = mx + cu * ux - cv * uz, mz + cu * uz + cv * ux
    return {'x': round(cx, 1), 'z': round(cz, 1), 'length': round(hi - lo + 1, 1), 'width': round(vhi - vlo + 1, 1),
            'angle': round(ang, 4), 'cells': n,
            'note': '市川緊急用船着場（Google マップの名前）。形は空中写真の舗装の塊から。床は砂をかぶったコンクリート、水側に鋼の手すり（360° 写真 2019 年 11 月で確認）'}


def mid_photo_colors(photo, step=2):
    """中景の範囲を 2 m ごとに空中写真の色で塗った画像（写真の外は透明）。"""
    x0, z0 = MID['x0'], MID['z0']
    x1, z1 = x0 + (MID['w'] - 1) * MID['step'], z0 + (MID['h'] - 1) * MID['step']
    w, h = (x1 - x0) // step + 1, (z1 - z0) // step + 1
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = im.load()
    W, H = photo.im.width, photo.im.height
    b = SITE['photoBbox']
    corners = [ll2local(la, lo) for la in (b['s'], b['n']) for lo in (b['w'], b['e'])]
    i0 = max(0, int((min(c[0] for c in corners) - x0) // step)); i1 = min(w, int((max(c[0] for c in corners) - x0) // step) + 1)
    j0 = max(0, int((min(c[1] for c in corners) - z0) // step)); j1 = min(h, int((max(c[1] for c in corners) - z0) // step) + 1)
    for j in range(j0, j1):
        z = z0 + j * step
        for i in range(i0, i1):
            x = x0 + i * step
            u, v = photo.pix(x, z)
            if 2 <= u < W - 2 and 2 <= v < H - 2:
                # 2 m 四方 ≒ 写真の 2×2 画素の平均
                acc = [0, 0, 0]
                for du in (-0.5, 0.5):
                    for dv in (-0.5, 0.5):
                        c = photo.px[int(u + du), int(v + dv)]
                        for k in range(3):
                            acc[k] += c[k]
                px[i, j] = (acc[0] // 4, acc[1] // 4, acc[2] // 4, 255)
    return im, {'x0': x0, 'z0': z0, 'step': step, 'w': w, 'h': h}


# ---------------------------------------------------------------- ランドマーク

def chain_ways(lst):
    """端点を共有する線をつないで 1 本の線にする。"""
    items = [list(p) for p, _ in lst]
    road = {id(it): r for it, (_, r) in zip(items, lst)}
    out = []
    while items:
        cur = items.pop()
        is_road = road[id(cur)]
        grown = True
        while grown:
            grown = False
            for it in items:
                if math.dist(cur[-1], it[0]) < 1:
                    cur += it[1:]
                elif math.dist(cur[-1], it[-1]) < 1:
                    cur += it[-2::-1]
                elif math.dist(cur[0], it[-1]) < 1:
                    cur = it[:-1] + cur
                elif math.dist(cur[0], it[0]) < 1:
                    cur = it[:0:-1] + cur
                else:
                    continue
                items.remove(it)
                grown = True
                break
        out.append((cur, is_road))
    return out


def landmarks(osm, rows, dem):
    out = {'bridges': [], 'towers': [], 'powerLines': [], 'buildings': [], 'backdrop': [], 'amenities': []}
    crest_y = tp2y(max(r['crestTP'] for r in rows))
    # 橋：同じ名前の線をつないで 1 本にし、川をまたぐものだけを残す。上下線（数 m 離れた 2 本）は 1 つの橋にまとめる
    names = {'総武本線': 'jr-sobu-rapid', '総武緩行線': 'jr-sobu-local', '京成本線': 'keisei', '千葉街道': 'ichikawa-bridge'}
    ways = {}
    for e in osm:
        t = e.get('tags', {})
        if t.get('bridge') and e.get('geometry') and t.get('name') in names:
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            if math.hypot(*pts[len(pts) // 2]) < 1600:
                ways.setdefault(t['name'], []).append((pts, bool(t.get('highway'))))
    for name, lst in ways.items():
        for pts, is_road in chain_ways(lst):
            wet = []
            for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
                n = max(1, int(math.dist((x1, z1), (x2, z2)) / 5))
                wet += [dem.is_water(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n) for k in range(n)]
            if sum(wet) < 10:
                continue
            mid = ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
            if any(b_['name'] == name and math.dist(b_['_mid'], mid) < 25 for b_ in out['bridges']):
                continue
            out['bridges'].append({
                'id': names[name], 'name': name, 'kind': 'girder' if is_road else 'truss',
                'path': [[round(x, 1), round(z, 1)] for x, z in pts], '_mid': mid,
                'deckY': round(crest_y + 2.5, 1), 'width': 14 if is_road else 7,
            })
    for b_ in out['bridges']:
        del b_['_mid']
    # 鉄塔と送電線（原点から 1.6 km 以内）
    towers = {}
    for e in osm:
        t = e.get('tags', {})
        if e['type'] == 'node' and t.get('power') == 'tower':
            x, z = ll2local(e['lat'], e['lon'])
            if math.hypot(x, z) < 1600:
                towers[e['id']] = (x, z)
    for e in osm:
        t = e.get('tags', {})
        if t.get('power') != 'line' or not e.get('geometry'):
            continue
        pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
        near = [p for p in pts if math.hypot(*p) < 1600]
        if len(near) < 2:
            continue
        kv = max(int(v) for v in str(t.get('voltage', '22000')).split(';') if v.isdigit()) // 1000
        out['powerLines'].append({'name': t.get('name'), 'kv': kv, 'path': [[round(x, 1), round(z, 1)] for x, z in near],
                                  'towerHeight': 55 if kv >= 154 else (38 if kv >= 66 else 24)})
    out['towers'] = [[round(x, 1), round(z, 1)] for x, z in towers.values()]
    # 高い建物（8 階以上）
    for e in osm:
        t = e.get('tags', {})
        if t.get('building') and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            if math.hypot(cx, cz) < 1600:
                lv = int(t.get('building:levels', '8'))
                out['buildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'levels': lv, 'height': round(lv * 3.1, 1),
                                         'footprint': [[round(x, 1), round(z, 1)] for x, z in pts]})
    # 野球場・グラウンド（OSM の範囲。土の内野は場面側で描く）
    out['pitches'] = []
    for e in osm:
        t = e.get('tags', {})
        if t.get('leisure') == 'pitch' and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            if MID['x0'] < cx < MID['x0'] + (MID['w'] - 1) * MID['step'] and MID['z0'] < cz < MID['z0'] + (MID['h'] - 1) * MID['step']:
                area = 0.5 * abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts))))
                out['pitches'].append({'x': round(cx, 1), 'z': round(cz, 1), 'area': round(area), 'sport': t.get('sport', ''),
                                       'polygon': [[round(x, 1), round(z, 1)] for x, z in pts]})
    for e in osm:
        t = e.get('tags', {})
        if e['type'] == 'node' and t.get('amenity') == 'toilets':
            x, z = ll2local(e['lat'], e['lon'])
            if abs(x) < 200 and abs(z) < 400:
                out['amenities'].append({'kind': 'toilets', 'x': round(x, 1), 'z': round(z, 1)})
    # 遠景（影絵）：方位・距離・高さ
    sky = ll2local(35.71006, 139.81070)
    b, d = bearing_dist(*sky)
    out['backdrop'].append({'id': 'skytree', 'kind': 'tower', 'bearing': round(b, 1), 'dist': round(d), 'height': 634,
                            'note': '東京スカイツリー（35.71006, 139.81070）'})
    kd = ll2local(35.7405, 139.9030)
    b, d = bearing_dist(*kd)
    out['backdrop'].append({'id': 'konodai', 'kind': 'hill', 'bearing': round(b, 1), 'dist': round(d), 'height': 20,
                            'span': [0, 40], 'note': '国府台の台地（里見公園）。標高 約 20 m、木が多い'})
    out['backdrop'].append({'id': 'tokyo-skyline', 'kind': 'skyline', 'span': [200, 320], 'dist': 2500, 'height': 30,
                            'note': '対岸の家並みとビル（江戸川区・葛飾区）'})
    out['backdrop'].append({'id': 'ichikawa-town', 'kind': 'skyline', 'span': [20, 160], 'dist': 400, 'height': 12,
                            'note': '堤防越しの市川の家並み'})
    return out


# ---------------------------------------------------------------- 出力

def write_height_png(path, hs, cls, w, h):
    im = Image.new('RGB', (w, h))
    px = im.load()
    for j in range(h):
        for i in range(w):
            r, g = enc_height(hs[j * w + i])
            px[i, j] = (r, g, cls[j * w + i] if cls else 0)
    im.save(path, optimize=True)


def main():
    keep_ground = '--keep-ground' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    osm = load_json(os.path.join(CACHE, 'osm.json'))['elements']
    log('loading dem ...')
    dem = Dem()

    photo = Photo()
    log('reading sections ...')
    rows = read_sections(dem, photo)

    log('near heights ...')
    nw, nh = NEAR['w'], NEAR['h']
    near = []
    xs = [NEAR['x0'] + i for i in range(nw)]
    for row in rows:
        line = [section_tp(row, x, dem) for x in xs]
        near.extend(round_corners(line, xs, row))

    ground_path = os.path.join(OUT, 'ground.png')
    if keep_ground and os.path.exists(ground_path):
        log('ground.png: kept (--keep-ground)')
        gim = Image.open(ground_path).convert('RGB')
        lut = {c: i for i, (_, c) in enumerate(GROUND)}
        gp = gim.load()
        ground = [lut.get(gp[i, j], G['other']) for j in range(nh) for i in range(nw)]
    else:
        log('ground classes from photo ...')
        ground = build_ground(rows, photo)
        gim = Image.new('RGB', (nw, nh))
        gp = gim.load()
        for j in range(nh):
            for i in range(nw):
                gp[i, j] = GROUND[ground[j * nw + i]][1]
        gim.save(ground_path, optimize=True)
    write_height_png(os.path.join(OUT, 'near_height.png'), near, None, nw, nh)

    log('mid heights ...')
    mid_h, mid_c = build_mid(dem, osm)
    write_height_png(os.path.join(OUT, 'mid_height.png'), mid_h, mid_c, MID['w'], MID['h'])

    log('landmarks ...')
    lm = landmarks(osm, rows, dem)
    # 電車の走る線路（橋から OSM の本線をたどった道と高さ。cache/<場面>/osm_rail.json）
    lm['railways'] = rails.rail_routes(lm['bridges'], load_json(os.path.join(CACHE, 'osm_rail.json'))['elements'], dem, rails.TRAIN_IDS, log=log)
    west, east = shorelines(dem)
    # 木：護岸より陸側のものだけ（水面の暗い波を木と間違えないように）
    by_z = {r['z']: r for r in rows}
    trees = [t for t in find_trees(ground)
             if t['x'] > by_z[min(max(round(t['z']), NEAR['z0']), NEAR['z0'] + NEAR['h'] - 1)]['bankTop'] + 1]
    for e in osm:
        t = e.get('tags', {})
        if t.get('natural') == 'tree_row' and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            if any(abs(x) < 300 and abs(z) < 600 for x, z in pts):
                lm.setdefault('treeRows', []).append([[round(x, 1), round(z, 1)] for x, z in pts])

    log('banks (shore vegetation, landing, photo colors) ...')
    east_line = [p for p in east if p[1] < NEAR['z0'] or p[1] > NEAR['z0'] + NEAR['h'] - 1] + [[r['shore'], r['z']] for r in rows]
    banks = {
        'west': shore_banks(photo, west, -1),
        # 市川側の水際の低木は夏の写真では芝との差が小さい（Google マップの秋の写真ではっきり見える）ので、しきい値をゆるめる
        'east': shore_banks(photo, east_line, 1, veg_ratio=0.86),
        'format': '[x, z, 陸向き nx, nz, 帯の始まり m, 帯の幅 m, 濃さ（木の多さ）0〜1, 縁 1 = コンクリート]',
        'note': '水際の植え込み（ヨシ・低木・柳）の帯は空中写真の芝より暗い緑から読む。何の植物かは Google マップの空中写真・360° 写真で見た様子',
        'landing': find_landing(ground, rows),
    }
    # 市川側の岸の種類（場所は写真・標高から、何があるかは Google マップの空中写真と 360° 写真で見た様子）
    #   船着場より上流：まっすぐなコンクリートの護岸（写真に直線の縁）／船着場：コンクリートの床と鋼の手すり／
    #   船着場より下流：水際にまばらな低木とヨシ（夏の写真では芝との差が小さいので、幅は決め打ち）
    L = banks['landing']
    if L:
        half = abs(math.sin(L['angle'])) * L['length'] / 2
        lz0, lz1 = L['z'] - half, L['z'] + half
        banks['eastRules'] = {
            'wall': [-260, round(lz0, 1)],
            'fringe': {'z0': round(lz1 + 3, 1), 'z1': 500, 'width': 2.5, 'cover': 0.55},
            'note': '市川側：船着場より上流はコンクリートの護岸、下流は水際にまばらな低木とヨシ（幅 2.5 m は決め打ち）',
        }
    for p in banks['east']:
        if p[5] < 3:      # 3 m より細い帯は写真のむら
            p[5] = 0
    cim = Image.new('RGB', (nw, nh))
    cp = cim.load()
    for j in range(nh):
        for i in range(nw):
            c = photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j)
            cp[i, j] = tuple(int(v) for v in c)
    cim.save(os.path.join(OUT, 'ground_color.png'), optimize=True)
    mim, mid_color = mid_photo_colors(photo)
    # 64 色に減らす（1.4 MB → 0.3 MB。地面の色に混ぜるだけなので十分）
    mim.quantize(64, method=Image.Quantize.FASTOCTREE).save(os.path.join(OUT, 'mid_color.png'), optimize=True)

    r0 = min(rows, key=lambda r: abs(r['z']))
    # 鉄橋の視点：近景の北の端に近い堤防の上から、JR 総武線の鉄橋の中ほどを向く
    zn = NEAR['z0'] + 12
    rn = min(rows, key=lambda r: abs(r['z'] - zn))
    crest_n = (rn['crestStart'] + rn['crestEnd']) / 2
    jr = next(b for b in lm['bridges'] if b['id'].startswith('jr-'))
    bx = (jr['path'][0][0] + jr['path'][-1][0]) / 2
    bz = (jr['path'][0][1] + jr['path'][-1][1]) / 2
    bridge_brg = (SITE['upstreamBearing'] + math.degrees(math.atan2(bx - crest_n, -(bz - zn)))) % 360
    # 夕日の視点：水際の上の端。市川緊急用船着場（シートの北）が画面の右端に入らないよう、8 m 下流に
    SUNSET_Z = 8
    r8 = min(rows, key=lambda r: abs(r['z'] - SUNSET_Z))
    sunset_x = r8['bankTop'] + 1.5
    # シート：水際から 15 m（座った目の高さでも川面が見えるように。設計書 10 章の申し送り）。長い辺を川に向ける
    # 向きは方位 315°：左に川、右の遠くに鉄橋（企画提案書の写真 1 に近い構図。16:9 で鉄橋が右端に入る）
    sheet = {'x': round(r0['shore'] + SHEET_FROM_WATER, 1), 'z': 0, 'bearing': LUNCH_BEARING, 'size': [2.0, 1.4]}
    sx, sz = sheet['x'], sheet['z']
    # 座る位置：シートの中心から、見る向きの反対へ 0.9 m（シートの手前の端）
    fx, fz = local_from_bearing(LUNCH_BEARING, 1.0)
    view = {
        'lunch':  {'x': round(sx - fx * 0.9, 2), 'z': round(sz - fz * 0.9, 2), 'eye': 0.75, 'bearing': LUNCH_BEARING, 'pitch': -4, 'hour': 12.0},
        'nap':    {'x': round(sx - fx * 0.3, 2), 'z': round(sz - fz * 0.3, 2), 'eye': 0.25, 'bearing': 250, 'pitch': 60, 'hour': 13.0},
        'sunset': {'x': round(sunset_x, 1), 'z': SUNSET_Z, 'eye': 1.5, 'bearing': 257, 'pitch': 1, 'hour': 16.83},
        'bridge': {'x': round(crest_n, 1), 'z': zn, 'eye': 1.6, 'bearing': round(bridge_brg, 1), 'pitch': 1, 'hour': 15.0},
    }
    for v in view.values():
        v['y'] = round(tp2y(sample_near(near, v['x'], v['z'])), 2)

    scene = {
        'version': 1,
        'name': SITE['name'],
        'frame': {
            'origin': SITE['origin'],
            'upstreamBearing': SITE['upstreamBearing'],
            'axes': '-z = 上流（方位 338°）、+x = 町側（方位 68°）、y = 0 が TP 2.5 m、1 単位 = 1 m',
        },
        'files': {
            'near': {'height': 'near_height.png', 'ground': 'ground.png', 'groundColor': 'ground_color.png', **NEAR,
                     'encoding': 'TP = (R*256+G)/100 - 10、y = TP - origin.tp'},
            'mid': {'height': 'mid_height.png', **MID, 'classes': MID_CLASSES,
                    'color': {'file': 'mid_color.png', **mid_color, 'note': '空中写真の色（2 m ごと、写真の外は透明）'},
                    'encoding': 'TP = (R*256+G)/100 - 10、B = classes の番号'},
        },
        'ground': [{'id': i, 'name': n, 'color': '#%02x%02x%02x' % c} for i, (n, c) in enumerate(GROUND)],
        'water': {
            'levelY': round(tp2y(WATER_TP), 2),
            'levelNote': '水面 TP +1.0 m は仮定（設計書 7 章）',
            'westShore': west, 'eastShore': east,
        },
        'section': [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items() if k not in ('fpMid', 'plaza')}
                    for r in rows[::4]],
        'trees': trees,
        'banks': banks,
        'landmarks': lm,
        'sheet': sheet,
        'viewpoints': view,
        'sun': {'lat': SITE['origin']['lat'], 'lon': SITE['origin']['lon'], 'date': '2026-10-18', 'tz': 9},
        'attribution': [
            '地形：国土地理院 基盤地図情報 数値標高モデル（DEM5A）を加工して作成',
            '地面の種類・水際の植え込み：国土地理院 シームレス空中写真をもとに作成（地面の色は加工して作成）',
            '地図データ：© OpenStreetMap contributors',
        ],
    }
    save_json(os.path.join(OUT, 'scene.json'), scene)
    write_attribution()
    log(f'done: {OUT}')
    log(f'  near {nw}x{nh}, mid {MID["w"]}x{MID["h"]}, trees {len(trees)}, bridges {len(lm["bridges"])}, '
        f'towers {len(lm["towers"])}, lines {len(lm["powerLines"])}, buildings {len(lm["buildings"])}')


def sample_near(near, x, z):
    i = min(max(round(x - NEAR['x0']), 0), NEAR['w'] - 1)
    j = min(max(round(z - NEAR['z0']), 0), NEAR['h'] - 1)
    return near[j * NEAR['w'] + i]


def write_attribution():
    text = """# 出典（scenes/edogawa）

このフォルダのデータは、次のデータを加工して作成しています。

| ファイル | もとにしたデータ | 出典の書き方 |
|---|---|---|
| `mid_height.png`・`near_height.png` | 国土地理院 標高タイル（基盤地図情報 数値標高モデル DEM5A） | 「国土地理院 基盤地図情報 数値標高モデル（DEM5A）を加工して作成」 |
| `ground.png`・`scene.json` の木・水際の植え込み（`banks`） | 国土地理院 シームレス空中写真（地面の種類・植え込みの帯を読み取る） | 「国土地理院 シームレス空中写真をもとに作成」 |
| `ground_color.png`・`mid_color.png` | 国土地理院 シームレス空中写真（1 m・2 m ごとの色に縮めたもの。地面の色に混ぜる） | 「国土地理院 シームレス空中写真を加工して作成」 |
| `scene.json` のランドマーク・野球場・送電線 | OpenStreetMap | 「© OpenStreetMap contributors」 |

- 国土地理院コンテンツ利用規約：https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
- OpenStreetMap のデータは ODbL（Open Database License）で提供されています：https://www.openstreetmap.org/copyright
  `scene.json` は OpenStreetMap のデータから作った派生データベースで、ODbL で提供します（出典の表示、同じ条件での再配布）。
- 場面の画面と書き出した画像には、上の 3 つの出典を表示します。

作り直し方：`python3 tools/geo/fetch_data.py` → `python3 tools/geo/build_scene.py`
"""
    with open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8') as f:
        f.write(text)


if __name__ == '__main__':
    main()
    # ページが読む劣化なしの WebP を作り、scene.json をそちらに向ける（PNG は編集用に残す）
    import to_webp
    to_webp.convert(OUT)
