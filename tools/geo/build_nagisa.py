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


NEAR = {'x0': -220, 'z0': -190, 'step': 1, 'w': 361, 'h': 371}     # x -220..140, z -190..180
MID = {'x0': -2700, 'z0': -2500, 'step': 8, 'w': 676, 'h': 632}    # 5.4 × 5.05 km（南は舞浜のディズニーリゾートまで）
B.NEAR, B.MID = NEAR, MID
G, GROUND = B.G, B.GROUND
MID_CLASSES = ['town', 'grass', 'pitch', 'water']
PARK_ID = 154151032   # OSM：総合レクリエーション公園（なぎさ公園）
MUSEUM_ID = 1220677132  # OSM：角野栄子児童文学館（魔法の文学館）。2023 年開館で、空中写真より新しい
STABLE_ID = None        # 前は公園の北東の建物（OSM 536919766）を「ポニーの家」としていたが、なぎさポニーランドは OSM・Google マップでは丘の北西（下の PONY_LAND）
PONY_LAND_ID = 536919774  # OSM：leisure=horse_riding「なぎさポニーランド」の範囲
RIVER_ROAD_ID = 796894975 # OSM：旧 新荒川葛西堤防線（遊歩道と公園のあいだの 2 車線の道。電柱と電線が並ぶ）
# 馬場（空中写真の明るい輪から：中心、走路の内側・外側の半径）。docs/NAGISA_DESIGN.md 7 章
# なぎさポニーランド（docs/NAGISA_DESIGN.md 1.1 節）：Google マップの空中写真（2026）で測った配置。大きさは画素からの読み取り
#   白い丸い馬場（乗馬はここを周回）、北に大きな土の馬場、その南に厩舎、東に草の放牧場、入口の門
PONY_RING = {'x': -165.6, 'z': -46.0, 'rIn': 1.6, 'rOut': 6.0, 'fenceR': 6.7, 'centerR': 0.0}
PONY_LAND = {
    'arena': [-170.0, -91.0, -133.0, -66.0],
    'yard': [-172.0, -62.0, -141.0, -37.0],
    'paddock': [-140.0, -56.0, -121.0, -24.0], 'paddockGate': [-140.0, -40.0],
    'stables': [{'rect': [-171.0, -65.0, -161.0, -56.0], 'roof': '#2e3034'}, {'rect': [-152.0, -65.5, -136.0, -60.0], 'roof': '#8fc4d6'}],
    'gate': [-146.0, -35.0, 0.0],
    'grazing': [[-133.0, -48.0, 0.6], [-127.0, -40.0, 2.2], [-131.0, -31.0, 4.0], [-125.0, -50.0, 1.2]],
}
GOAT_PEN = {'x': -147, 'z': -52, 'w': 7, 'd': 5}   # ヤギのふれあいコーナー（来園者の話ではポニーランドの中。位置は推定）
SHUTTLE_STOP = {'x': -19, 'z': 8, 'r': 7, 'note': 'パノラマシャトル停留所 なぎさ公園（Google マップ）。丸い広場。前は ここをポニーの馬場と読み違えていた'}
HILL_PERGOLA = {'x': -59.4, 'z': 32.9, 'yaw': 0.4}   # 展望の丘の 360° 写真（2020 年 10 月）：頂上の北北東に藤棚
HILL_TABLES = [[-64.5, 43.5, 0.3]]                  # 同じ写真：南南西に木のピクニックテーブル
# 周りの目立つ建物（OSM の id）。形を作って立てるので、ふつうの「高い建物」からは除く
CASTLE_ID = 217727348      # シンデレラ城（高さ 51 m）
VOLCANO_ID = 859682628     # プロメテウス火山（高さ 51 m、node）
CRYSTAL_ID = 161731857     # 葛西臨海公園 クリスタルビュー
AQUA_BLD_ID = 190858879    # 葛西臨海水族園の本館（高さ 9.7 m）。この上にガラスドーム（高さ 30.7 m）
GATE_IDS = (150870020, 150870021)  # 東京ゲートブリッジ（上下線）
SPECIAL_IDS = {CASTLE_ID, CRYSTAL_ID, AQUA_BLD_ID}
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
        # テーマパーク（ディズニーリゾート）も公園と同じ扱い（家並みを散らさない）
        kind = 'pitch' if t.get('leisure') == 'pitch' else 'grass' if (t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'recreation_ground') or t.get('tourism') == 'theme_park') else None
        if kind:
            pts = [ll2local(p['lat'], p['lon']) for p in g]
            if min(abs(p[0]) for p in pts) < 2800 and min(abs(p[1]) for p in pts) < 2700:
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


def landmarks(osm, dem, photo=None):
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
        if not H or H < 25 or e['id'] in SPECIAL_IDS:
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
        if H and H >= 25 or e['id'] == MUSEUM_ID:
            continue
        roof = None
        if photo:  # 屋根の色：平面の中の写真の色の中央値
            xs_ = [p[0] for p in pts]; zs_ = [p[1] for p in pts]
            cols = [photo.rgb(x_, z_) for z_ in range(int(min(zs_)), int(max(zs_)) + 1, 2) for x_ in range(int(min(xs_)), int(max(xs_)) + 1, 2)
                    if B.point_in_poly(x_ + 0.5, z_ + 0.5, pts)]
            if cols:
                roof = '#%02x%02x%02x' % tuple(int(sorted(c[k] for c in cols)[len(cols) // 2]) for k in range(3))
        out['nearBuildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'height': round(H or DEFAULT_H.get(t['building'], 8), 1), 'roof': roof,
                                     'kind': t['building'], 'osm': e['id'], 'footprint': [[round(x, 1), round(z, 1)] for x, z in pts]})
    # 周りの目立つもの：シンデレラ城・プロメテウス火山（ディズニーリゾート）、葛西臨海水族園のガラスドーム・クリスタルビュー、東京ゲートブリッジ
    byid = {e['id']: e for e in osm if e['type'] in ('way', 'node')}
    def fp_of(i):
        e = byid.get(i)
        return [[round(v, 1) for v in ll2local(p['lat'], p['lon'])] for p in e['geometry']] if e and e.get('geometry') else None
    def center(fp):
        return round(sum(p[0] for p in fp) / len(fp), 1), round(sum(p[1] for p in fp) / len(fp), 1)
    sp = {}
    if fp_of(CASTLE_ID):
        cx_, cz_ = center(fp_of(CASTLE_ID))
        sp['castle'] = {'x': cx_, 'z': cz_, 'height': 51, 'groundY': round(tp2y(dem.height(cx_, cz_)), 1), 'size': 36,
                        'note': 'シンデレラ城。高さ 51 m（OSM）。形は簡略（白い壁・青い屋根の塔）'}
    v = byid.get(VOLCANO_ID)
    if v:
        vx, vz = ll2local(v['lat'], v['lon'])
        sp['volcano'] = {'x': round(vx, 1), 'z': round(vz, 1), 'height': 51, 'base': 150, 'groundY': round(tp2y(dem.height(vx, vz)), 1),
                         'note': 'プロメテウス火山。高さ 51 m（OSM）。裾の直径 150 m は推定'}
    if fp_of(AQUA_BLD_ID):
        ax_, az_ = center(fp_of(AQUA_BLD_ID))
        sp['aquaDome'] = {'x': ax_, 'z': az_, 'height': 30.7, 'radius': 38, 'baseHeight': 9.7, 'groundY': round(tp2y(dem.height(ax_, az_)), 1),
                          'note': '葛西臨海水族園のガラスドーム。高さ 30.7 m（紹介記事）。直径 約 76 m は本館の大きさからの推定'}
    if fp_of(CRYSTAL_ID):
        sp['crystalView'] = {'footprint': fp_of(CRYSTAL_ID), 'height': 11, 'groundY': round(tp2y(dem.height(*center(fp_of(CRYSTAL_ID)))), 1),
                             'note': '葛西臨海公園 クリスタルビュー（ガラスの休憩所）。高さ 11 m は推定'}
    gates = [fp_of(i) for i in GATE_IDS if fp_of(i)]
    if gates:
        sp['gateBridge'] = {'path': gates[0], 'deck': 55, 'trussTop': 88, 'mainSpan': 440,
                            'note': '東京ゲートブリッジ。OSM の線。主塔のない トラス（恐竜橋）。トラスの頂部 約 88 m・桁下 約 55 m は公表値に近い推定'}
    out['specials'] = sp

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
    assert SITE_NAME == 'nagisa', 'run with --site nagisa (or GEO_SITE=nagisa)'
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
    lm = landmarks(osm, dem, photo)
    nw, nh = NEAR['w'], NEAR['h']
    # 建物の下は舗装に（空中写真では屋根が土や芝に見える）。木も建物の上には生やさない
    for b in lm['nearBuildings']:
        xs = [p[0] for p in b['footprint']]
        zs = [p[1] for p in b['footprint']]
        for z in range(max(NEAR['z0'], int(min(zs))), min(NEAR['z0'] + nh, int(max(zs)) + 1)):
            for x in range(max(NEAR['x0'], int(min(xs))), min(NEAR['x0'] + nw, int(max(xs)) + 1)):
                if B.point_in_poly(x + 0.5, z + 0.5, b['footprint']):
                    cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] = G['paved']
    # 施設：魔法の文学館（空中写真より新しいので、写真の芝や木の上に建つ）と、ポニーランドの馬場
    mus = next(e for e in osm if e.get('id') == MUSEUM_ID)
    mfp = [list(ll2local(p['lat'], p['lon'])) for p in mus['geometry']]
    mfp = [[round(x, 1), round(z, 1)] for x, z in mfp]
    in_museum = lambda x, z, pad=0: B.point_in_poly(x, z, mfp) or (pad and min(math.dist((x, z), p) for p in mfp) < pad)
    R = PONY_RING
    L_ = PONY_LAND
    inrect = lambda x, z, r: r[0] <= x <= r[2] and r[1] <= z <= r[3]
    for j in range(nh):
        for i in range(nw):
            x, z = NEAR['x0'] + i, NEAR['z0'] + j
            k = j * nw + i
            r = math.hypot(x - R['x'], z - R['z'])
            if in_museum(x + 0.5, z + 0.5):
                cls[k] = G['paved']
            elif r <= R['fenceR'] + 1.5:
                cls[k] = G['dirt'] if R['rIn'] <= r <= R['rOut'] else (G['paved'] if r > R['rOut'] else G['lawnWorn'])
            elif abs(x - GOAT_PEN['x']) < GOAT_PEN['w'] / 2 and abs(z - GOAT_PEN['z']) < GOAT_PEN['d'] / 2:
                cls[k] = G['dirt']
            elif inrect(x, z, L_['arena']) or inrect(x, z, L_['yard']):
                cls[k] = G['dirt']
            elif inrect(x, z, L_['paddock']):
                cls[k] = G['lawnWorn']
            elif math.hypot(x - SHUTTLE_STOP['x'], z - SHUTTLE_STOP['z']) < SHUTTLE_STOP['r']:
                cls[k] = G['paved']
    trees = split_trees(cls)
    # 文学館・馬場・ヤギの囲いの上には木を立てない（写真が古く、そこに木が写っていることがある）
    trees = [t for t in trees if not in_museum(t['x'], t['z'], 3 + t['r'])
             and math.hypot(t['x'] - R['x'], t['z'] - R['z']) > R['fenceR'] + 1 + t['r'] * 0.6
             and not (abs(t['x'] - GOAT_PEN['x']) < GOAT_PEN['w'] / 2 + t['r'] and abs(t['z'] - GOAT_PEN['z']) < GOAT_PEN['d'] / 2 + t['r'])
             and not any(inrect(t['x'], t['z'], [r_[0] - 1, r_[1] - 1, r_[2] + 1, r_[3] + 1]) for r_ in (L_['arena'], L_['yard'], L_['paddock']))]
    gim = Image.new('RGB', (nw, nh))
    gp = gim.load()
    for j in range(nh):
        for i in range(nw):
            gp[i, j] = GROUND[cls[j * nw + i]][1]
    gim.save(os.path.join(OUT, 'ground.png'), optimize=True)
    B.write_height_png(os.path.join(OUT, 'near_height.png'), near, None, nw, nh)
    # 地面の色（1 m ごとの空中写真の色）。道・砂利・駐車場・グラウンドの色合いを写真に合わせるのに使う（芝や木の所は使わない）
    cim = Image.new('RGB', (nw, nh))
    cp = cim.load()
    for j in range(nh):
        for i in range(nw):
            cp[i, j] = tuple(int(c) for c in photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j))
    cim.save(os.path.join(OUT, 'ground_color.png'), optimize=True)

    # 旧江戸川の護岸の線（陸の東の端。1 m ごとの行で、東どなりが水になる所）。胸の高さの壁を立てる
    edge = []
    for j in range(nh):
        xs_ = [i for i in range(nw - 1) if not wet[j][i] and wet[j][i + 1] and NEAR['x0'] + i > -20]
        if xs_:
            edge.append((NEAR['x0'] + max(xs_) + 0.5, NEAR['z0'] + j))
    # 1 m の行ごとの水際は階段状なので、中央値（前後 5 行）→ 平均（前後 6 行）でならし、4 m おきに間引く
    med = [sorted(e_[0] for e_ in edge[max(0, k - 5):k + 6])[len(edge[max(0, k - 5):k + 6]) // 2] for k in range(len(edge))]
    avg = [sum(med[max(0, k - 6):k + 7]) / len(med[max(0, k - 6):k + 7]) for k in range(len(med))]
    seawall = [[round(avg[k] - 1.0, 1), edge[k][1]] for k in range(0, len(edge), 4)]  # 水際から 1 m 陸側
    seawall_line = seawall

    # ツツジ山：丘の斜面（TP 5.5〜12.8 m）の芝の中で、まわり（7 m 四方）より暗いまだらの所を、ツツジの株の群れとする（約 130 品種 17,000 株）
    import colorsys
    Vv = [[colorsys.rgb_to_hsv(*(c / 255 for c in photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j)))[2] for i in range(nw)] for j in range(nh)]
    cand = {}
    for j in range(3, nh - 3):
        for i in range(3, nw - 3):
            if cls[j * nw + i] not in (G['lawn'], G['lawnWorn']):
                continue
            tp = near[j * nw + i]
            if not 5.5 < tp < 12.8:
                continue
            m7 = sum(Vv[j + a][i + b] for a in range(-3, 4) for b in range(-3, 4)) / 49
            if m7 - Vv[j][i] > 0.035:
                key = (i // 3, j // 3)
                cand[key] = cand.get(key, 0) + 1
    shrubs = []
    for (gi, gj), n in cand.items():
        if n < 3:
            continue
        x_ = NEAR['x0'] + gi * 3 + 1.5 + (hash((gi, gj, 1)) % 100) / 100 - 0.5
        z_ = NEAR['z0'] + gj * 3 + 1.5 + (hash((gi, gj, 2)) % 100) / 100 - 0.5
        shrubs.append([round(x_, 1), round(z_, 1), round(0.9 + n / 9 * 0.6, 2)])

    # 遊具広場：空中写真で (-105, -50) あたりの土（砂）の塊
    from collections import deque
    seed = min(((i, j) for j in range(nh) for i in range(nw) if cls[j * nw + i] == G['dirt']),
               key=lambda p_: math.dist((p_[0] + NEAR['x0'], p_[1] + NEAR['z0']), (-105, -50)))
    comp, q, seen_ = [], deque([seed]), {seed}
    while q:
        i, j = q.popleft()
        comp.append((i, j))
        for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= ni < nw and 0 <= nj < nh and (ni, nj) not in seen_ and cls[nj * nw + ni] == G['dirt']:
                seen_.add((ni, nj))
                q.append((ni, nj))
    px_s = [c[0] + NEAR['x0'] for c in comp]
    pz_s = [c[1] + NEAR['z0'] for c in comp]
    playground = {'x': round(sum(px_s) / len(px_s), 1), 'z': round(sum(pz_s) / len(pz_s), 1),
                  'w': max(px_s) - min(px_s) + 1, 'd': max(pz_s) - min(pz_s) + 1, 'area': len(comp),
                  'note': '空中写真の砂の広場の位置と大きさ。遊具の種類と配置は推定（公式の案内は名前だけ）'}
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
    shrubs = [b for b in shrubs if math.dist(b[:2], (sx, sz)) > 5]  # シートのまわりは空ける
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
    # 川辺：護岸の壁の内側（水際から 2 m）から、旧江戸川の下流（舞浜・河口の方）を見る。
    # 河口の橋は川の曲がりの先（西岸の陸の向こう）なので、川の真ん中の線の下流の点（z = 550 付近）を向き、見通しがいちばん長い所を選ぶ。
    # 立つ人の目（1.6 m）は、胸の高さの壁（1.1 m）の上から川を見る
    down = min(river, key=lambda p_: abs(p_[1] - 550))
    mx, mz = down
    sight_r = Sight(near, trees, lm['nearBuildings'], dem)
    best_r = None
    for wx, wz in seawall_line[::3]:
        x_, z_ = wx - 0.6, wz   # 胸壁（高さ 1.4 m）のすぐ内側に立つ
        if not (NEAR['z0'] + 5 < z_ < NEAR['z0'] + nh - 5):
            continue
        b_ = bearing_dist(mx - x_, mz - z_)[0]
        c_ = sight_r.clear(x_, z_, tp_at(x_, z_) + 1.6, b_, maxd=1500)
        if best_r is None or c_ > best_r[0]:
            best_r = (c_, x_, z_, b_)
    river_clear, px_, pz_, river_brg = best_r
    river_brg = round(river_brg, 1)
    # 魔法の文学館：3 階（カフェ・キキ）。床の高さ 1 階 4.5 m・2 階 4 m とし、カフェの床は 1 階の床 + 8.5 m
    m_base = min(tp_at(x, z) for x, z in mfp)
    mx_ = sum(p[0] for p in mfp) / len(mfp)
    mz_ = sum(p[1] for p in mfp) / len(mfp)
    # 建物は丘の北の斜面に建つ（足もと TP 5〜11 m）。床の基準は平面の中の地面の平均とする（丘の側から入る作りと考える）
    m_mean = sum(tp_at(x, z) for x, z in mfp) / len(mfp)
    cafe_tp = m_mean + 8.5
    # カフェのテラス：建物の縁で、旧江戸川の側（方位 60〜150°）がいちばん遠くまで見通せる所と向き
    sight_m = Sight(near, trees, lm['nearBuildings'], dem)
    rn = min(river, key=lambda p: math.dist(p, (mx_, mz_)))
    river_b = bearing_dist(rn[0] - mx_, rn[1] - mz_)[0]
    best_c = None
    for k in range(len(mfp)):
        x, z = mfp[k]
        for b in range(60, 151, 5):
            c = sight_m.clear(x, z, cafe_tp + 1.5, b)
            # 川（旧江戸川の真ん中の線）の方を向き、300 m 以上見通せる所のうち、いちばん川に近い（東の）縁
            key = (c >= 300, x, -abs(b - river_b))
            if best_c is None or key > best_c[0]:
                best_c = (key, x, z, b)
    (_, cafe_x, cafe_z, cafe_b) = best_c
    # カフェの正面（左右 35°・40 m 以内）で、テラスの目の高さより高くなる木は除く。
    # 文学館は 2023 年開館で空中写真より新しく、公式の案内では「旧江戸川を一望できる」カフェなので、眺めに合わせた（設計書 7 章）
    removed = 0
    eye_c = cafe_tp + 1.5
    keep = []
    for t in trees:
        b_, d_ = bearing_dist(t['x'] - cafe_x, t['z'] - cafe_z)
        off = abs((b_ - cafe_b + 180) % 360 - 180)
        if d_ < 40 and off < 35 and tree_top(t, sight_m.tp(t['x'], t['z'])) > eye_c - 0.02 * d_ - 1:
            removed += 1
            continue
        keep.append(t)
    trees[:] = keep
    # 遊歩道と公園のあいだの道（OSM）：電柱を並べるのに使う
    rr = next((e for e in osm if e.get('id') == RIVER_ROAD_ID and e.get('geometry')), None)
    river_road = [[round(v, 1) for v in ll2local(p['lat'], p['lon'])] for p in rr['geometry']] if rr else []
    facilities = {
        'museum': {'name': '角野栄子児童文学館（魔法の文学館）', 'osm': MUSEUM_ID, 'footprint': mfp, 'x': round(mx_, 1), 'z': round(mz_, 1),
                   'baseY': round(tp2y(m_base), 2), 'floors': 3, 'height': 13.0, 'cafeFloorY': round(tp2y(cafe_tp), 2),
                   'terrace': {'x': cafe_x, 'z': cafe_z, 'bearing': cafe_b}, 'treesClearedForView': removed,
                   'note': '設計 隈研吾建築都市設計事務所。白い外観と花びらのように広がる「フラワールーフ」。3 階がカフェ・キキ（旧江戸川を見渡す）。延床 1,613.95 m²。高さ・屋根の枚数は公表値が見つからないので推定'},
        'ponyRing': {**PONY_RING, 'y': round(tp2y(tp_at(PONY_RING['x'], PONY_RING['z'])), 2), 'ponies': 5,
                     'hours': [[10.0, 11.5], [13.5, 15.0]],
                     'note': '馬場の位置と大きさは空中写真の明るい輪から。走路の形（円）と柵は、来園者の話（ポニーは柵の中を周回）にもとづく'},
        'goatPen': {**GOAT_PEN, 'y': round(tp2y(tp_at(GOAT_PEN['x'], GOAT_PEN['z'])), 2), 'note': '位置は推定'},
        'ponyLand': {**PONY_LAND, 'osm': PONY_LAND_ID,
                     'note': 'なぎさポニーランド。範囲は OSM、配置（白い丸い馬場・土の馬場・厩舎・放牧場・門）は Google マップの空中写真と来園者の写真から。大きさは推定'},
        'shuttleStop': SHUTTLE_STOP,
        'hill': {'pergola': HILL_PERGOLA, 'tables': HILL_TABLES, 'note': '展望の丘の 360° 写真（2020 年 10 月）'},
        'riverRoad': river_road,
    }
    view = {
        'lunch':  {'x': round(sx - fx * 0.9, 2), 'z': round(sz - fz * 0.9, 2), 'eye': 0.75, 'bearing': LUNCH, 'pitch': -3, 'hour': 12.0},
        'nap':    {'x': round(sx - fx * 0.3, 2), 'z': round(sz - fz * 0.3, 2), 'eye': 0.25,
                   'bearing': round(bearing_dist(shade['x'] - sx, shade['z'] - sz)[0], 1), 'pitch': 55, 'hour': 13.5},
        'sunset': {'x': sunset_pt[0], 'z': sunset_pt[1], 'eye': 1.6, 'bearing': round(wb + 1, 1), 'pitch': 1, 'hour': 16.85},
        'river':  {'x': px_, 'z': pz_, 'eye': 1.65, 'bearing': river_brg, 'pitch': 0, 'hour': 15.0},
        # カフェ・キキ（3 階のテラス）：床の上に立った目の高さ。y は床の高さ（地形ではない）
        'cafe':   {'x': round(cafe_x + local_from_bearing(cafe_b, 1.6)[0], 2), 'z': round(cafe_z + local_from_bearing(cafe_b, 1.6)[1], 2),
                   'eye': 1.5, 'bearing': cafe_b, 'pitch': -4, 'hour': 14.0, 'floorY': round(tp2y(cafe_tp), 2)},  # テラスの上（壁から 1.6 m）
        # ポニーランド：馬場の柵の南西の外から、周回するポニーを見る（乗馬の時間）
        # ポニーランド：丸い馬場の南東の外（門のそば）から、周回するポニーと奥の土の馬場・厩舎を見る（乗馬の時間）
        'pony':   {'x': round(PONY_RING['x'] + 9.5, 1), 'z': round(PONY_RING['z'] + 8.5, 1), 'eye': 1.5, 'bearing': 312, 'pitch': -10, 'hour': 10.75},
    }
    for v in view.values():
        v['y'] = round(tp2y(tp_at(v['x'], v['z'])), 2)
    scene = {
        'version': 1,
        'name': SITE['name'],
        'frame': {'origin': SITE['origin'], 'upstreamBearing': SITE['upstreamBearing'],
                  'axes': '-z = 北、+x = 東、y = 0 が TP 3.0 m、1 単位 = 1 m'},
        'files': {
            'near': {'height': 'near_height.png', 'ground': 'ground.png', 'groundColor': 'ground_color.png', **NEAR, 'encoding': 'TP = (R*256+G)/100 - 10、y = TP - origin.tp'},
            'mid': {'height': 'mid_height.png', **MID, 'classes': MID_CLASSES, 'encoding': 'TP = (R*256+G)/100 - 10、B = classes の番号'},
        },
        'ground': [{'id': i, 'name': n, 'color': '#%02x%02x%02x' % c} for i, (n, c) in enumerate(GROUND)],
        'water': {'levelY': round(tp2y(SITE['waterTP']), 2), 'levelNote': '平均海面（TP 0 m）。東京湾の干満は ±1 m', 'river': river},
        'hill': {'x': tx, 'z': tz, 'tp': round(ttp, 2)},
        'trees': trees,
        'sheet': {'x': sx, 'z': sz, 'bearing': LUNCH, 'size': [2.0, 1.4], 'shadeTree': shade},
        'sightlines': {'lunch': lunch_clear, 'sunset': sunset_clear},
        'facilities': {**facilities, 'playground': playground, 'seawall': seawall,
                       'azaleas': {'shrubs': shrubs, 'note': 'ツツジ山（約 130 品種 17,000 株）。丘の斜面の芝で、空中写真の暗いまだらの所に株の群れを置いた（10 月なので花はない）'}},
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
                .replace('| `ground.png`・`scene.json` の木 | 国土地理院 シームレス空中写真（地面の種類を読み取るためだけに使用。写真そのものは含めていません） |',
                         '| `ground.png`・`ground_color.png`・`scene.json` の木 | 国土地理院 シームレス空中写真（地面の種類を読み取り、1 m ごとの色に縮めたもの） |')
                .replace('「国土地理院 シームレス空中写真をもとに作成」', '「国土地理院 シームレス空中写真を加工して作成」')
                .replace('python3 tools/geo/fetch_data.py` → `python3 tools/geo/build_scene.py', 'python3 tools/geo/fetch_data.py --site nagisa` → `python3 tools/geo/build_nagisa.py'))
    log(f'done: {OUT}')
    log(f'  hill TP {ttp:.1f} at ({tx},{tz}), sheet ({sx},{sz}) shade tree {shade}, trees {len(trees)}, bridges {len(lm["bridges"])}, '
        f'azalea clumps {len(shrubs)}, river view {river_clear} m at ({px_},{pz_}) {river_brg}°, '
        f'cafe view cleared {removed} trees, cafe terrace ({cafe_x},{cafe_z}) {cafe_b}° floor TP {cafe_tp:.1f} (river {river_b:.0f}°), museum base TP {m_base:.1f}, '
        f'lunch {LUNCH}° clear {lunch_clear} m, sunset at {sunset_pt} clear {sunset_clear} m, '
        f'buildings {len(lm["buildings"])} + near {len(lm["nearBuildings"])}, wheel {lm["ferrisWheel"] and lm["ferrisWheel"]["bearing"]}')


if __name__ == '__main__':
    main()
