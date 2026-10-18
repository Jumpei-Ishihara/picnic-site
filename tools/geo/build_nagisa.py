"""なぎさ公園（江戸川区 南葛西）の場面データを作る（docs/NAGISA_DESIGN.md）。

  python3 tools/geo/fetch_data.py --site nagisa
  python3 tools/geo/build_nagisa.py           # scenes/nagisa/ を作る

江戸川（build_scene.py）との違い
  - 近景の高さは、標高データをそのまま 1 m 間隔に（堤防の断面の型は使わない。丘と護岸は標高データで十分に表せる）
  - 木が多い公園なので、木の塊を 6 m 間隔の木に分ける
  - 中景の地面の種類は、水・公園・グラウンド・町（OSM の公園の範囲で決める）
  - 遠景：スカイツリー、東京タワー、富士山。大観覧車（葛西臨海公園）は形を作って立てる
出力の形式（scene.json・*_height.png・ground.png）は江戸川と同じ。
"""
import math
import os
import sys

if '--site' not in sys.argv:
    os.environ.setdefault('GEO_SITE', 'nagisa')

from PIL import Image

import build_scene as B
from geo_common import (CACHE, OUT, SITE, SITE_NAME, bearing_dist, ll2local, load_json, save_json, tp2y)

assert SITE_NAME == 'nagisa', 'run with --site nagisa (or GEO_SITE=nagisa)'

NEAR = {'x0': -220, 'z0': -190, 'step': 1, 'w': 361, 'h': 371}     # x -220..140, z -190..180
MID = {'x0': -1800, 'z0': -1800, 'step': 6, 'w': 601, 'h': 601}    # 3.6 km 四方
B.NEAR, B.MID = NEAR, MID
G, GROUND = B.G, B.GROUND
MID_CLASSES = ['town', 'grass', 'pitch', 'water']
PARK_ID = 154151032   # OSM：総合レクリエーション公園（なぎさ公園）
log = B.log


def near_heights(dem):
    """標高データを 1 m 間隔で。陸だけ 3×3 でならす（5 m の格子の段差を消す）。"""
    w, h = NEAR['w'], NEAR['h']
    raw = [[dem.height(NEAR['x0'] + i, NEAR['z0'] + j) for i in range(w)] for j in range(h)]
    wet = [[dem.is_water(NEAR['x0'] + i, NEAR['z0'] + j) for i in range(w)] for j in range(h)]
    out = []
    for j in range(h):
        for i in range(w):
            if wet[j][i]:
                out.append(raw[j][i])
                continue
            acc = n = 0
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    jj, ii = j + dj, i + di
                    if 0 <= jj < h and 0 <= ii < w and not wet[jj][ii]:
                        acc += raw[jj][ii]
                        n += 1
            out.append(acc / n)
    return out, wet


def build_ground(dem, photo, wet):
    w, h = NEAR['w'], NEAR['h']
    cls = [B.classify(photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j)) for j in range(h) for i in range(w)]
    # 明るい灰色：幅 7 m 以上の芯があれば土（グラウンド）、細ければ舗装の道（build_scene と同じ考え方）
    bright = [c == B.BRIGHT for c in cls]
    R = 3
    core = [False] * (w * h)
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
    cls = B.mode_filter(cls, w, h)
    # 木：この写真では芝と木の色が近いので、明暗の細かさ（5×5 m の明るさのばらつき）でも見る。
    # 緑の所で、ばらつきが大きいか暗い所を木とし、細い線（屋根や道の縁）は開く処理（縮めて戻す）で消す
    import colorsys
    V = [0.0] * (w * h)
    green = bytearray(w * h)
    for j in range(h):
        for i in range(w):
            r, g, b = (c / 255 for c in photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j))
            hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
            V[j * w + i] = vv
            green[j * w + i] = 60 <= hh * 360 <= 185 and ss >= 0.07 and vv < 0.62
    raw = bytearray(w * h)
    for j in range(2, h - 2):
        for i in range(2, w - 2):
            k = j * w + i
            if not green[k] or wet[j][i]:
                continue
            win = [V[k + a * w + b] for a in range(-2, 3) for b in range(-2, 3)]
            m = sum(win) / 25
            sd = (sum((x - m) ** 2 for x in win) / 25) ** 0.5
            raw[k] = sd > 0.055 or m < 0.37
    def morph(src, keep_if_all):
        dst = bytearray(w * h)
        for j in range(1, h - 1):
            for i in range(1, w - 1):
                k = j * w + i
                nb = [src[k + a * w + b] for a in (-1, 0, 1) for b in (-1, 0, 1)]
                dst[k] = all(nb) if keep_if_all else any(nb)
        return dst
    treeMask = morph(morph(raw, True), False)
    for k in range(w * h):
        if treeMask[k] and cls[k] in (G['lawn'], G['lawnWorn'], G['tree'], G['reeds'], G['other'], G['road']):
            cls[k] = G['tree']
        elif cls[k] == G['tree'] and not treeMask[k]:
            cls[k] = G['lawn']
    # 水と、水際の護岸（水から 2 m 以内の陸）
    for j in range(h):
        for i in range(w):
            k = j * w + i
            if wet[j][i]:
                cls[k] = G['water']
            elif any(0 <= j + dj < h and 0 <= i + di < w and wet[j + dj][i + di] for dj in (-2, 0, 2) for di in (-2, 0, 2)):
                cls[k] = G['revetment']
            elif cls[k] == G['water']:
                cls[k] = G['road']
    return cls


def split_trees(cls):
    """木の塊（林）を 6 m 間隔の木に分ける。小さな塊は 1 本。"""
    w, h = NEAR['w'], NEAR['h']
    from collections import deque
    seen = bytearray(w * h)
    trees = []
    for k0 in range(w * h):
        if cls[k0] != G['tree'] or seen[k0]:
            continue
        comp = []
        q = deque([k0])
        seen[k0] = 1
        while q:
            c = q.popleft()
            comp.append(c)
            x, y = c % w, c // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                n = ny * w + nx
                if 0 <= nx < w and 0 <= ny < h and not seen[n] and cls[n] == G['tree']:
                    seen[n] = 1
                    q.append(n)
        if len(comp) < 6:
            continue
        if len(comp) < 90:  # 1 本
            cx = sum(c % w for c in comp) / len(comp)
            cz = sum(c // w for c in comp) / len(comp)
            trees.append({'x': round(cx + NEAR['x0'], 1), 'z': round(cz + NEAR['z0'], 1), 'r': round(max(1.8, math.sqrt(len(comp) / math.pi)), 1)})
            continue
        # 林：6 m の格子のマスごとに、塊が半分以上あれば 1 本（少しずらす）
        cells = {}
        for c in comp:
            key = ((c % w) // 6, (c // w) // 6)
            cells.setdefault(key, []).append(c)
        for (gx, gz), cs in cells.items():
            if len(cs) < 14:
                continue
            cx = sum(c % w for c in cs) / len(cs)
            cz = sum(c // w for c in cs) / len(cs)
            trees.append({'x': round(cx + NEAR['x0'], 1), 'z': round(cz + NEAR['z0'], 1), 'r': round(3.2 + (hash((gx, gz)) % 100) / 100 * 1.4, 1)})
    return trees


def build_mid(dem, osm):
    w, h, st = MID['w'], MID['h'], MID['step']
    polys = {'grass': [], 'pitch': []}
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if not g or e['type'] != 'way':
            continue
        kind = 'pitch' if t.get('leisure') == 'pitch' else 'grass' if (t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'recreation_ground')) else None
        if kind:
            pts = [ll2local(p['lat'], p['lon']) for p in g]
            if min(abs(p[0]) for p in pts) < 2000 and min(abs(p[1]) for p in pts) < 2000:
                polys[kind].append((pts, min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)))
    hs, cls = [], []
    for j in range(h):
        z = MID['z0'] + j * st
        for i in range(w):
            x = MID['x0'] + i * st
            hs.append(dem.height(x, z))
            if dem.is_water(x, z):
                cls.append(3)
                continue
            c = 0
            for kind, code in (('pitch', 2), ('grass', 1)):
                if any(a <= x <= b and c0 <= z <= d and B.point_in_poly(x, z, pts) for pts, a, b, c0, d in polys[kind]):
                    c = code
                    break
            cls.append(c)
    return hs, cls


def landmarks(osm, dem):
    out = {'bridges': [], 'buildings': [], 'backdrop': [], 'ferrisWheel': None, 'towers': [], 'powerLines': []}
    # 水をまたぐ橋（名前ごとにつなぐ）。川の河口の湾岸道路・首都高・JR 京葉線、北の葛西橋通り・東西線など
    ways = {}
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if not (g and t.get('bridge')):
            continue
        kind = t.get('railway') or t.get('highway')
        if kind not in ('rail', 'subway', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'):
            continue
        pts = [ll2local(p['lat'], p['lon']) for p in g]
        if min(math.hypot(*p) for p in pts) > 2600:
            continue
        ways.setdefault((t.get('name') or kind, kind), []).append((pts, kind not in ('rail', 'subway')))
    for (name, kind), lst in ways.items():
        for pts, is_road in B.chain_ways(lst):
            wet = 0
            for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
                n = max(1, int(math.dist((x1, z1), (x2, z2)) / 5))
                wet += sum(dem.is_water(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n) for k in range(n))
            if wet < 20:
                continue
            mid = ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
            if any(b['name'] == name and math.dist(b['_mid'], mid) < 40 for b in out['bridges']):
                continue
            high = kind in ('rail', 'motorway', 'trunk')
            out['bridges'].append({
                'id': {'JR京葉線': 'jr-keiyo', '首都高速湾岸線': 'wangan-expressway', '東京湾岸道路': 'route-357',
                       '東京メトロ東西線': 'tozai-line', '葛西橋通り': 'kasaibashi-dori'}.get(name, f'bridge-{len(out["bridges"])}'),
                'name': name, 'kind': 'girder', 'rail': kind in ('rail', 'subway'),
                'path': [[round(x, 1), round(z, 1)] for x, z in pts], '_mid': mid,
                'deckY': round(tp2y(16 if high else 9), 1),
                'width': {'motorway': 22, 'trunk': 18, 'primary': 16, 'rail': 9, 'subway': 9}.get(kind, 12),
            })
    for b in out['bridges']:
        del b['_mid']
    # 高さ 25 m 以上の建物（3 km 以内）
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if not (g and t.get('building')):
            continue
        try:
            H = float(t['height']) if t.get('height') else float(t['building:levels']) * 3.1 if t.get('building:levels') else None
        except ValueError:
            H = None
        if not H or H < 25:
            continue
        pts = [ll2local(p['lat'], p['lon']) for p in g]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        if math.hypot(cx, cz) < 3000:
            out['buildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'height': round(H, 1),
                                     'footprint': [[round(x, 1), round(z, 1)] for x, z in pts]})
    # 近景のまわりの建物（高さ 25 m 未満・高さ不明）。高さは階数か、建物の種類から決める
    out['nearBuildings'] = []
    DEFAULT_H = {'warehouse': 11, 'industrial': 11, 'factory': 11, 'house': 7, 'detached': 7, 'apartments': 14, 'residential': 9,
                 'school': 14, 'public': 9, 'commercial': 9, 'garage': 3, 'shed': 3, 'roof': 4}
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if not (g and t.get('building')) or e['type'] != 'way':
            continue
        pts = [ll2local(p['lat'], p['lon']) for p in g]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        if not (NEAR['x0'] - 40 < cx < NEAR['x0'] + NEAR['w'] + 40 and NEAR['z0'] - 40 < cz < NEAR['z0'] + NEAR['h'] + 40):
            continue
        try:
            H = float(t['height']) if t.get('height') else float(t['building:levels']) * 3.1 if t.get('building:levels') else None
        except ValueError:
            H = None
        if H and H >= 25:
            continue
        out['nearBuildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'height': round(H or DEFAULT_H.get(t['building'], 8), 1),
                                     'kind': t['building'], 'footprint': [[round(x, 1), round(z, 1)] for x, z in pts]})
    # 大観覧車（ダイヤと花の大観覧車：高さ 117 m、直径 111 m、ゴンドラ 68 台）
    for e in osm:
        t = e.get('tags', {})
        if t.get('attraction') == 'big_wheel' and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            b, d = bearing_dist(cx, cz)
            out['ferrisWheel'] = {'name': t.get('name'), 'x': round(cx, 1), 'z': round(cz, 1), 'bearing': round(b, 1), 'dist': round(d),
                                  'height': 117, 'diameter': 111, 'gondolas': 68, 'groundY': round(dem.height(cx, cz) - SITE['origin']['tp'], 1),
                                  'note': '高さ・直径・ゴンドラの数は公表値。車輪の面の向きは不明なので、公園の方を向ける'}
    # 遠景（影絵）
    for id_, kind, ll, height, note in [
        ('skytree', 'tower', (35.71006, 139.81070), 634, '東京スカイツリー'),
        ('tokyo-tower', 'lattice', (35.65858, 139.74543), 333, '東京タワー'),
        ('fuji', 'mountain', (35.36063, 138.72741), 3776, '富士山（地球の丸みで 約 810 m 隠れる）'),
    ]:
        b, d = bearing_dist(*ll2local(*ll))
        item = {'id': id_, 'kind': kind, 'bearing': round(b, 1), 'dist': round(d), 'height': height, 'note': note}
        if kind == 'mountain':
            # 地球の丸み（大気の屈折 k = 0.13）で隠れる高さを引く。裾の広がりは 約 35 km
            hidden = d * d / (2 * 6371000 / (1 - 0.13))
            item['visibleHeight'] = round(height - hidden)
            item['baseWidth'] = 35000
        out['backdrop'].append(item)
    out['backdrop'] += [
        {'id': 'tokyo-skyline', 'kind': 'skyline', 'span': [255, 335], 'dist': 7000, 'height': 70, 'note': '都心・江東区のビル群'},
        {'id': 'urayasu', 'kind': 'skyline', 'span': [60, 150], 'dist': 1600, 'height': 22, 'note': '対岸の浦安の家並み'},
        {'id': 'maihama', 'kind': 'skyline', 'span': [150, 205], 'dist': 2300, 'height': 35, 'note': '舞浜（ディズニーリゾートのホテル・パーク）'},
        {'id': 'kasai', 'kind': 'skyline', 'span': [205, 255], 'dist': 1400, 'height': 18, 'note': '葛西・臨海町の家並み'},
        {'id': 'north-town', 'kind': 'skyline', 'span': [335, 60], 'dist': 1500, 'height': 16, 'note': '葛西・浦安の北側の家並み'},
    ]
    return out


def tree_top(t, ground_tp):
    """engine/trees.js と同じ形：幹の高さ 1.6 + 0.9r、樹冠はその上に 約 0.9r。"""
    r = max(1.6, t['r'])
    return ground_tp + 1.6 + 1.8 * r


class Sight:
    """見通し：方位に沿って 3 m おきに進み、目の高さより高い地面・木・建物に当たるまでの距離。"""

    def __init__(self, near, trees, buildings, dem):
        self.near, self.dem = near, dem
        self.cells = {}
        for t in trees:
            gt = self.tp(t['x'], t['z'])
            self.cells.setdefault((int(t['x'] // 10), int(t['z'] // 10)), []).append((t['x'], t['z'], max(1.6, t['r']) + 0.8, tree_top(t, gt)))
        for b in buildings:
            xs = [p[0] for p in b['footprint']]
            zs = [p[1] for p in b['footprint']]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            rr = max(max(xs) - min(xs), max(zs) - min(zs)) / 2
            self.cells.setdefault((int(cx // 10), int(cz // 10)), []).append((cx, cz, rr, self.tp(cx, cz) + b['height']))

    def tp(self, x, z):
        i, j = round(x - NEAR['x0']), round(z - NEAR['z0'])
        if 0 <= i < NEAR['w'] and 0 <= j < NEAR['h']:
            return self.near[j * NEAR['w'] + i]
        return self.dem.height(x, z)

    def clear(self, x, z, eye_tp, bearing, maxd=600):
        from geo_common import local_from_bearing
        dx, dz = local_from_bearing(bearing, 1.0)
        for d in range(3, maxd, 3):
            px, pz = x + dx * d, z + dz * d
            line = eye_tp - 0.02 * d  # 少し見下ろす線（1° 強）より高いものに当たったら止まる
            if self.tp(px, pz) > line:
                return d
            for ci in (-1, 0, 1):
                for cj in (-1, 0, 1):
                    for (tx, tz, rr, top) in self.cells.get((int(px // 10) + ci, int(pz // 10) + cj), ()):
                        if top > line and math.hypot(tx - px, tz - pz) < rr:
                            return d
        return maxd


def pick_sheet(near, cls, trees):
    """シートの場所：丘の上の芝生で、平ら（傾き 1:8 より緩い）、南西 4〜8 m に木がある所（午後に木陰がかかる）。"""
    w, h = NEAR['w'], NEAR['h']
    top = max(range(w * h), key=lambda k: near[k])
    tx, tz = top % w + NEAR['x0'], top // w + NEAR['z0']
    H = lambda x, z: near[(z - NEAR['z0']) * w + (x - NEAR['x0'])]
    best = None
    for z in range(tz - 40, tz + 41):
        for x in range(tx - 40, tx + 41):
            k = (z - NEAR['z0']) * w + (x - NEAR['x0'])
            if cls[k] not in (G['lawn'], G['lawnWorn']) or H(x, z) < near[top] - 5:
                continue
            slope = max(abs(H(x + 2, z) - H(x - 2, z)), abs(H(x, z + 2) - H(x, z - 2))) / 4
            if slope > 0.12:
                continue
            # 周り 2 m に木・道がない（シートを広げられる）
            if any(cls[(z + dz - NEAR['z0']) * w + (x + dx - NEAR['x0'])] not in (G['lawn'], G['lawnWorn']) for dz in (-2, 0, 2) for dx in (-2, 0, 2)):
                continue
            shade = [t for t in trees if 4 <= math.dist((t['x'], t['z']), (x, z)) <= 8.5
                     and 180 <= bearing_dist(t['x'] - x, t['z'] - z)[0] <= 270]
            if not shade:
                continue
            score = math.dist((x, z), (tx, tz)) + slope * 40
            if best is None or score < best[0]:
                best = (score, x, z, shade[0])
    return (tx, tz, near[top]), best


def main():
    os.makedirs(OUT, exist_ok=True)
    osm = load_json(os.path.join(CACHE, 'osm.json'))['elements']
    log('loading dem ...')
    dem = B.Dem()
    photo = B.Photo()
    log('near heights ...')
    near, wet = near_heights(dem)
    log('ground classes ...')
    cls = build_ground(dem, photo, wet)
    log('landmarks ...')
    lm = landmarks(osm, dem)
    nw, nh = NEAR['w'], NEAR['h']
    # 建物の下は舗装に（空中写真では屋根が土や芝に見える）。木も建物の上には生やさない
    for b in lm['nearBuildings']:
        xs = [p[0] for p in b['footprint']]
        zs = [p[1] for p in b['footprint']]
        for z in range(max(NEAR['z0'], int(min(zs))), min(NEAR['z0'] + nh, int(max(zs)) + 1)):
            for x in range(max(NEAR['x0'], int(min(xs))), min(NEAR['x0'] + nw, int(max(xs)) + 1)):
                if B.point_in_poly(x + 0.5, z + 0.5, b['footprint']):
                    cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] = G['paved']
    trees = split_trees(cls)
    gim = Image.new('RGB', (nw, nh))
    gp = gim.load()
    for j in range(nh):
        for i in range(nw):
            gp[i, j] = GROUND[cls[j * nw + i]][1]
    gim.save(os.path.join(OUT, 'ground.png'), optimize=True)
    B.write_height_png(os.path.join(OUT, 'near_height.png'), near, None, nw, nh)
    log('mid ...')
    mh, mc = build_mid(dem, osm)
    B.write_height_png(os.path.join(OUT, 'mid_height.png'), mh, mc, MID['w'], MID['h'])
    # 旧江戸川の真ん中の線（船の通り道）：50 m おきに、x > 0 側の水の帯の真ん中
    river = []
    for z in range(MID['z0'] + 300, MID['z0'] + (MID['h'] - 1) * MID['step'] - 300, 50):
        xs = [x for x in range(0, 1400, 10) if dem.is_water(x, z)]
        if not xs:
            continue
        run, best_run = [xs[0]], []
        for x in xs[1:]:
            if x - run[-1] <= 10:
                run.append(x)
            else:
                best_run = max(best_run, run, key=len)
                run = [x]
        best_run = max(best_run, run, key=len)
        if len(best_run) * 10 > 150:
            river.append([round((best_run[0] + best_run[-1]) / 2, 1), z])

    (tx, tz, ttp), best = pick_sheet(near, cls, trees)
    if not best:
        raise SystemExit('no sheet spot found')
    _, sx, sz, shade = best
    tp_at = lambda x, z: near[(round(z) - NEAR['z0']) * nw + (round(x) - NEAR['x0'])]
    sight = Sight(near, trees, lm['nearBuildings'], dem)
    # ランチ：シートに座って（目の高さ 0.75 m）、川と舞浜の側（方位 110〜210°）で、いちばん遠くまで見通せる向き
    LUNCH = max(range(110, 211, 5), key=lambda b: (sight.clear(sx, sz, tp_at(sx, sz) + 0.75, b), -abs(b - 160)))
    lunch_clear = sight.clear(sx, sz, tp_at(sx, sz) + 0.75, LUNCH)
    from geo_common import local_from_bearing
    fx, fz = local_from_bearing(LUNCH, 1.0)
    # 夕日：丘の上（頂上から 4 m 以内の高さ）で、大観覧車の方位がいちばん開けている所（立った目の高さ 1.6 m）
    wb = lm['ferrisWheel']['bearing'] if lm['ferrisWheel'] else 256
    cand = [(x, z) for z in range(tz - 45, tz + 46, 2) for x in range(tx - 45, tx + 46, 2)
            if tp_at(x, z) > ttp - 4 and cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] in (G['lawn'], G['lawnWorn'], G['paved'], G['dirt'])]
    sunset_pt = max(cand, key=lambda p: (min(sight.clear(p[0], p[1], tp_at(*p) + 1.6, wb), 400), tp_at(*p)))
    sunset_clear = sight.clear(sunset_pt[0], sunset_pt[1], tp_at(*sunset_pt) + 1.6, wb)
    # 川沿いの遊歩道：護岸から 3 m 陸側で、シートに近い所
    prom = min(((i + NEAR['x0'], j + NEAR['z0']) for j in range(0, nh, 2) for i in range(0, nw, 2)
                if cls[j * nw + i] == G['revetment'] and not wet[j][i]),
               key=lambda p: math.dist(p, (sx, sz)))
    px_, pz_ = prom[0] - 3, prom[1]
    # 川辺：河口の橋（湾岸道路・国道 357 号）の中ほどを向く
    rb = next((b for b in lm['bridges'] if b['id'] == 'route-357'), lm['bridges'][0])
    mx = sum(p[0] for p in rb['path']) / len(rb['path'])
    mz = sum(p[1] for p in rb['path']) / len(rb['path'])
    river_brg = round(bearing_dist(mx - px_, mz - pz_)[0], 1)
    view = {
        'lunch':  {'x': round(sx - fx * 0.9, 2), 'z': round(sz - fz * 0.9, 2), 'eye': 0.75, 'bearing': LUNCH, 'pitch': -3, 'hour': 12.0},
        'nap':    {'x': round(sx - fx * 0.3, 2), 'z': round(sz - fz * 0.3, 2), 'eye': 0.25,
                   'bearing': round(bearing_dist(shade['x'] - sx, shade['z'] - sz)[0], 1), 'pitch': 55, 'hour': 13.5},
        'sunset': {'x': sunset_pt[0], 'z': sunset_pt[1], 'eye': 1.6, 'bearing': round(wb + 1, 1), 'pitch': 1, 'hour': 16.85},
        'river':  {'x': px_, 'z': pz_, 'eye': 1.6, 'bearing': river_brg, 'pitch': 1, 'hour': 15.0},
    }
    for v in view.values():
        v['y'] = round(tp2y(tp_at(v['x'], v['z'])), 2)
    scene = {
        'version': 1,
        'name': SITE['name'],
        'frame': {'origin': SITE['origin'], 'upstreamBearing': SITE['upstreamBearing'],
                  'axes': '-z = 北、+x = 東、y = 0 が TP 3.0 m、1 単位 = 1 m'},
        'files': {
            'near': {'height': 'near_height.png', 'ground': 'ground.png', **NEAR, 'encoding': 'TP = (R*256+G)/100 - 10、y = TP - origin.tp'},
            'mid': {'height': 'mid_height.png', **MID, 'classes': MID_CLASSES, 'encoding': 'TP = (R*256+G)/100 - 10、B = classes の番号'},
        },
        'ground': [{'id': i, 'name': n, 'color': '#%02x%02x%02x' % c} for i, (n, c) in enumerate(GROUND)],
        'water': {'levelY': round(tp2y(SITE['waterTP']), 2), 'levelNote': '平均海面（TP 0 m）。東京湾の干満は ±1 m', 'river': river},
        'hill': {'x': tx, 'z': tz, 'tp': round(ttp, 2)},
        'trees': trees,
        'sheet': {'x': sx, 'z': sz, 'bearing': LUNCH, 'size': [2.0, 1.4], 'shadeTree': shade},
        'sightlines': {'lunch': lunch_clear, 'sunset': sunset_clear},
        'landmarks': lm,
        'viewpoints': view,
        'sun': {'lat': SITE['origin']['lat'], 'lon': SITE['origin']['lon'], 'date': '2026-10-18', 'tz': 9},
        'attribution': [
            '地形：国土地理院 基盤地図情報 数値標高モデル（DEM5A）を加工して作成',
            '地面の種類：国土地理院 シームレス空中写真をもとに作成',
            '地図データ：© OpenStreetMap contributors',
        ],
    }
    save_json(os.path.join(OUT, 'scene.json'), scene)
    with open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8') as f:
        f.write(open(os.path.join(os.path.dirname(OUT), 'edogawa', 'ATTRIBUTION.md'), encoding='utf-8').read()
                .replace('（scenes/edogawa）', '（scenes/nagisa）')
                .replace('python3 tools/geo/fetch_data.py` → `python3 tools/geo/build_scene.py', 'python3 tools/geo/fetch_data.py --site nagisa` → `python3 tools/geo/build_nagisa.py'))
    log(f'done: {OUT}')
    log(f'  hill TP {ttp:.1f} at ({tx},{tz}), sheet ({sx},{sz}) shade tree {shade}, trees {len(trees)}, bridges {len(lm["bridges"])}, '
        f'lunch {LUNCH}° clear {lunch_clear} m, sunset at {sunset_pt} clear {sunset_clear} m, '
        f'buildings {len(lm["buildings"])} + near {len(lm["nearBuildings"])}, wheel {lm["ferrisWheel"] and lm["ferrisWheel"]["bearing"]}')


if __name__ == '__main__':
    main()
