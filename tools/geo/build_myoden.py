"""江戸川 妙典の岸（市川市 妙典）の場面データを作る（docs/MYODEN_DESIGN.md）。

  python3 tools/geo/fetch_data.py --site myoden
  python3 tools/geo/build_myoden.py           # scenes/myoden/ を作る

江戸川（市川南）の場面の「川の逆側」：行徳可動堰より下流の江戸川（旧 江戸川放水路）の南西岸、
妙典公園の東の堤防。Google マップの 360° 写真（2025 年 6 月、堤防の上の道）の位置を原点にする。
地形・木・見通しの作り方は なぎさ公園（build_nagisa.py）の部品をそのまま使う（近景は標高データをそのまま 1 m 間隔に）。
"""
import math
import os
import sys

os.environ['GEO_SITE'] = 'myoden'

from PIL import Image

import build_scene as B
import build_nagisa as N
from geo_common import (CACHE, OUT, SITE, SITE_NAME, bearing_dist, ll2local, load_json, local_from_bearing, save_json, tp2y)

NEAR = {'x0': -220, 'z0': -230, 'step': 1, 'w': 361, 'h': 451}     # x -220..140, z -230..220（堤防・妙典公園・水際）
MID = {'x0': -3000, 'z0': -2800, 'step': 8, 'w': 751, 'h': 701}    # 6 km × 5.6 km（河口の湾岸道路・京葉線の橋まで）
# なぎさ公園の部品は、モジュールの NEAR・MID を見て動くので、この場所の範囲に差し替える
B.NEAR, B.MID = NEAR, MID
N.NEAR, N.MID = NEAR, MID
G, GROUND = B.G, B.GROUND
MID_CLASSES = N.MID_CLASSES + ['industrial']   # 対岸の原木・高谷・二俣、河口の塩浜は工場・倉庫（OSM の landuse=industrial）
PIPE_ID = 454774418          # OSM：妙典給水場からの水管橋（川をまたぐ水道管。空中写真でも明るい橋として写る）
PHOTO_POINT = (0.0, 0.0)     # 360° 写真の位置（原点）。向き 104°、見下ろし 2.6°
log = B.log
BRIDGE_IDS = {'東京メトロ東西線': 'tozai-line', '船橋行徳線': 'myoden-bridge', '東京湾岸道路': 'route-357', 'JR京葉線': 'jr-keiyo',
              '首都高速湾岸線': 'wangan-expressway', '東関東自動車道': 'higashi-kanto-expressway', '東京外環自動車道': 'gaikan-expressway',
              '行徳バイパス': 'gyotoku-bypass', '国道298号': 'route-298'}


def landmarks(osm, dem, photo):
    out = {'bridges': [], 'buildings': [], 'backdrop': [], 'towers': [], 'powerLines': [], 'nearBuildings': [], 'specials': {}}
    # 水をまたぐ橋（名前ごとにつなぐ）
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
            high = kind in ('rail', 'motorway', 'trunk', 'subway')
            out['bridges'].append({
                'id': BRIDGE_IDS.get(name, f'bridge-{len(out["bridges"])}'),
                'name': name, 'kind': 'truss' if name == '東京メトロ東西線' else 'girder', 'rail': kind in ('rail', 'subway'),
                'path': [[round(x, 1), round(z, 1)] for x, z in pts], '_mid': mid, 'overWater': wet * 5,
                # 妙典橋は船を通すため中ほどが高い（TP 12 m とした。推定）
                'deckY': round(tp2y(12 if name == '船橋行徳線' else 14 if high else 10), 1),
                'width': {'motorway': 22, 'trunk': 18, 'primary': 16, 'rail': 9, 'subway': 9}.get(kind, 12),
            })
    for b in out['bridges']:
        del b['_mid']
    # 水管橋（妙典給水場から対岸へ）：細い 2 本の管とトラス。高さは堤防の上 + 3 m ほど（推定）
    # 市川市クリーンセンター（田尻）の煙突：送電線（市川クリーンセンター線）の終わりの位置に。高さ 100 m は推定（公表値は見つからなかった）
    for e in osm:
        if e.get('tags', {}).get('name') == '市川クリーンセンター線' and e.get('geometry'):
            g = e['geometry'][-1]
            cx, cz = ll2local(g['lat'], g['lon'])
            out['specials']['chimney'] = {'x': round(cx, 1), 'z': round(cz, 1), 'height': 100, 'radius': 3.2, 'groundY': round(tp2y(dem.height(cx, cz)), 1),
                                          'name': '市川市クリーンセンター', 'note': '位置は送電線の終わり（清掃工場の受電の所）。紅白の煙突。高さは推定'}
            break
    pipe = next((e for e in osm if e.get('id') == PIPE_ID and e.get('geometry')), None)
    if pipe:
        pts = [ll2local(p['lat'], p['lon']) for p in pipe['geometry']]
        # 写真（妙典の堤防から上流を見たもの）：妙典の岸の側が白いトラス、川の上に大・中・小の 3 つのアーチ（タイドアーチ）、その先は桁で対岸へ。
        # 線に沿った標高：水（TP 1 m 以下）は始まりから 110〜425 m、堤防は 55 m と 480 m
        out['specials']['pipeBridge'] = {'path': [[round(x, 1), round(z, 1)] for x, z in pts], 'deckY': round(tp2y(10.5), 1), 'width': 4.0,
                                         'truss': [-80, 130], 'trussPiers': [-80, -40, 0, 45, 90], 'arches': [[130, 270], [270, 370], [370, 450]], 'girder': [490, 531], 'rise': 0.19, 'pipeR': 0.8,
                                         'note': '妙典給水場（千葉県企業局）の水管橋。OSM の線（man_made=pipeline、overhead）。形（トラス＋3 つのアーチ、白い円柱の橋脚、太い水道管 2 本）は写真から。'
                                                 'トラスは堤防の陸側へも続き、東西線の車両基地の上を渡る（360° 写真）。陸側の長さ 80 m は推定。'
                                                 'アーチの区切り・高さ（スパンの 0.19 倍）・床の高さ TP 10.5 m は写真の見え方からの推定'}
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
                                  'towerHeight': 55 if kv >= 154 else (50 if kv >= 66 else 24)})  # 写真では紅白の高い鉄塔（66 kV でも 50 m ほどに見える）
    out['towers'] = [[round(x, 1), round(z, 1)] for x, z in towers.values()]
    # 高さ 25 m 以上の建物（3 km 以内）と、近景のまわりの建物（なぎさ公園と同じ）
    DEFAULT_H = {'warehouse': 11, 'industrial': 11, 'factory': 11, 'house': 7, 'detached': 7, 'apartments': 14, 'residential': 9,
                 'school': 14, 'public': 9, 'commercial': 9, 'garage': 3, 'shed': 3, 'roof': 4, 'train_station': 12}
    for e in osm:
        t = e.get('tags', {})
        g = e.get('geometry')
        if not (g and t.get('building')) or e['type'] != 'way':
            continue
        try:
            H = float(t['height']) if t.get('height') else float(t['building:levels']) * 3.1 if t.get('building:levels') else None
        except ValueError:
            H = None
        pts = [ll2local(p['lat'], p['lon']) for p in g]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        fp = [[round(x, 1), round(z, 1)] for x, z in pts]
        if H and H >= 25:
            if math.hypot(cx, cz) < 3000:
                out['buildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'height': round(H, 1), 'footprint': fp})
            continue
        if not (NEAR['x0'] - 40 < cx < NEAR['x0'] + NEAR['w'] + 40 and NEAR['z0'] - 40 < cz < NEAR['z0'] + NEAR['h'] + 40):
            continue
        xs_ = [p[0] for p in pts]; zs_ = [p[1] for p in pts]
        cols = [photo.rgb(x_, z_) for z_ in range(int(min(zs_)), int(max(zs_)) + 1, 2) for x_ in range(int(min(xs_)), int(max(xs_)) + 1, 2)
                if B.point_in_poly(x_ + 0.5, z_ + 0.5, pts)]
        roof = '#%02x%02x%02x' % tuple(int(sorted(c[k] for c in cols)[len(cols) // 2]) for k in range(3)) if cols else None
        out['nearBuildings'].append({'x': round(cx, 1), 'z': round(cz, 1), 'height': round(H or DEFAULT_H.get(t['building'], 8), 1), 'roof': roof,
                                     'kind': t['building'], 'osm': e['id'], 'footprint': fp})
    # 遠景（影絵）
    for id_, kind, ll, height, note in [
        ('skytree', 'tower', (35.71006, 139.81070), 634, '東京スカイツリー'),
        ('tokyo-tower', 'lattice', (35.65858, 139.74543), 333, '東京タワー'),
        ('fuji', 'mountain', (35.36063, 138.72741), 3776, '富士山（地球の丸みで隠れる高さを引く）'),
    ]:
        b, d = bearing_dist(*ll2local(*ll))
        item = {'id': id_, 'kind': kind, 'bearing': round(b, 1), 'dist': round(d), 'height': height, 'note': note}
        if kind == 'mountain':
            hidden = d * d / (2 * 6371000 / (1 - 0.13))
            item['visibleHeight'] = round(height - hidden)
            item['baseWidth'] = 35000
        out['backdrop'].append(item)
    out['backdrop'] += [
        {'id': 'tokyo-skyline', 'kind': 'skyline', 'span': [250, 300], 'dist': 9000, 'height': 70, 'note': '都心・江東区のビル群'},
        {'id': 'gyotoku', 'kind': 'skyline', 'span': [180, 250], 'dist': 900, 'height': 18, 'note': '妙典・行徳の町'},
    ]
    return out


def main():
    assert SITE_NAME == 'myoden'
    os.makedirs(OUT, exist_ok=True)
    osm = load_json(os.path.join(CACHE, 'osm.json'))['elements']
    log('loading dem ...')
    dem = B.Dem()
    photo = B.Photo()
    log('near heights ...')
    near, wet = N.near_heights(dem)
    log('ground classes ...')
    cls = N.build_ground(dem, photo, wet)
    log('landmarks ...')
    lm = landmarks(osm, dem, photo)
    nw, nh = NEAR['w'], NEAR['h']
    ax, az = local_from_bearing(325.0 + 90, 1.0)       # 川を横切る向き（北東へ）
    tp_at = lambda x, z: near[(min(max(round(z), NEAR['z0']), NEAR['z0'] + nh - 1) - NEAR['z0']) * nw + (min(max(round(x), NEAR['x0']), NEAR['x0'] + nw - 1) - NEAR['x0'])]
    # 建物の下は舗装に
    for b in lm['nearBuildings']:
        xs = [p[0] for p in b['footprint']]
        zs = [p[1] for p in b['footprint']]
        for z in range(max(NEAR['z0'], int(min(zs))), min(NEAR['z0'] + nh, int(max(zs)) + 1)):
            for x in range(max(NEAR['x0'], int(min(xs))), min(NEAR['x0'] + nw, int(max(xs)) + 1)):
                if B.point_in_poly(x + 0.5, z + 0.5, b['footprint']):
                    cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] = G['paved']
    # 堤防の上の道（自転車・歩行者道、舗装）：OSM の線を幅 4 m で舗装に
    paths = []
    for e in osm:
        t = e.get('tags', {})
        if t.get('highway') in ('footway', 'cycleway', 'path') and t.get('bicycle') in ('designated', 'yes') and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            if any(NEAR['x0'] < x < NEAR['x0'] + nw and NEAR['z0'] < z < NEAR['z0'] + nh for x, z in pts):
                paths.append(pts)
    for pts in paths:
        for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
            L = math.dist((x1, z1), (x2, z2))
            for s in range(int(L * 2) + 1):
                x = x1 + (x2 - x1) * s / max(1, L * 2)
                z = z1 + (z2 - z1) * s / max(1, L * 2)
                for dx in range(-2, 3):
                    for dz in range(-2, 3):
                        i, j = round(x + dx) - NEAR['x0'], round(z + dz) - NEAR['z0']
                        if 0 <= i < nw and 0 <= j < nh and not wet[j][i] and math.hypot(dx, dz) <= 2.1:
                            cls[j * nw + i] = G['road']
    # 水際の護岸（コンクリートのブロック）：水面 TP 1.0 m の線に沿って、川側の TP 0.5〜2.2 m の所（写真では暗い灰色の帯）
    for j in range(nh):
        for i in range(nw):
            x, z = NEAR['x0'] + i, NEAR['z0'] + j
            if 0.5 <= near[j * nw + i] <= 2.2 and x * ax + z * az > 20 and not wet[j][i]:
                cls[j * nw + i] = G['revetment']
    trees = N.split_trees(cls)
    lm['leveePaths'] = [[[round(x, 1), round(z, 1)] for x, z in pts] for pts in paths]
    # 堤防の川側の斜面には木を植えない（河川の管理で堤防に木は置かない）。写真の暗いまだらを木と読んだものを除く
    UPB = math.radians(325.0 + 90)
    AXn, AZn = math.sin(UPB), -math.cos(UPB)
    trees = [t for t in trees if t['x'] * AXn + t['z'] * AZn < -6 or near[(round(t['z']) - NEAR['z0']) * nw + (round(t['x']) - NEAR['x0'])] < 3.0]
    # 堤防の町側のすぐ下（40 m）は東西線の車両基地（360° 写真：柵と線路。木は無い）。妙典公園（北西）の木は残す
    trees = [t for t in trees if not (-45 < t['x'] * AXn + t['z'] * AZn < -6)]
    gim = Image.new('RGB', (nw, nh))
    gp = gim.load()
    for j in range(nh):
        for i in range(nw):
            gp[i, j] = GROUND[cls[j * nw + i]][1]
    gim.save(os.path.join(OUT, 'ground.png'), optimize=True)
    B.write_height_png(os.path.join(OUT, 'near_height.png'), near, None, nw, nh)
    cim = Image.new('RGB', (nw, nh))
    cp = cim.load()
    for j in range(nh):
        for i in range(nw):
            cp[i, j] = tuple(int(c) for c in photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j))
    cim.save(os.path.join(OUT, 'ground_color.png'), optimize=True)
    log('mid ...')
    mh, mc = N.build_mid(dem, osm)
    # 町のうち、工場・倉庫の地区（OSM の landuse=industrial）
    inds = []
    for e in osm:
        if e.get('tags', {}).get('landuse') == 'industrial' and e.get('geometry'):
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            inds.append((pts, min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)))
    for j in range(MID['h']):
        z = MID['z0'] + j * MID['step']
        for i in range(MID['w']):
            k = j * MID['w'] + i
            if mc[k] != 0:
                continue
            x = MID['x0'] + i * MID['step']
            if any(a <= x <= b and c0 <= z <= d and B.point_in_poly(x, z, pts) for pts, a, b, c0, d in inds):
                mc[k] = 4
    B.write_height_png(os.path.join(OUT, 'mid_height.png'), mh, mc, MID['w'], MID['h'])
    mim, mid_color = B.mid_photo_colors(photo)
    mim.quantize(64, method=Image.Quantize.FASTOCTREE).save(os.path.join(OUT, 'mid_color.png'), optimize=True)

    # 川の中ほどの線（船の通り道）：川の向き（上流 方位 325°）に直角な断面ごとに、水の帯の真ん中
    UP = 325.0
    ux, uz = local_from_bearing(UP, 1.0)
    ax, az = local_from_bearing(UP + 90, 1.0)       # 川を横切る向き（北東へ）
    river = []
    for s in range(-2200, 2201, 50):
        cx0, cz0 = ux * s, uz * s
        wet_t = [t for t in range(-200, 1200, 10) if dem.is_water(cx0 + ax * t, cz0 + az * t)]
        if len(wet_t) * 10 > 150:
            tm = (wet_t[0] + wet_t[-1]) / 2
            river.append([round(cx0 + ax * tm, 1), round(cz0 + az * tm, 1)])
    # 水際（原点の断面）：岸から川へ、標高データで水になる所
    shore_t = next(t for t in range(0, 400) if dem.is_water(ax * t, az * t))
    crest_tp = max(tp_at(ax * t, az * t) for t in range(-10, 15))

    # シート：原点のまわり 120 m の、堤防の川側の芝（傾き 1:6 より緩い）で、川を見渡せる所。木陰は求めない（堤防に木は少ない）
    sight = N.Sight(near, trees, lm['nearBuildings'], dem)
    best = None
    for z in range(-120, 121, 2):
        for x in range(-60, 121, 2):
            k = (z - NEAR['z0']) * nw + (x - NEAR['x0'])
            if cls[k] not in (G['lawn'], G['lawnWorn']) or wet[z - NEAR['z0']][x - NEAR['x0']]:
                continue
            # 川側（原点の断面より川寄り）
            if (x * ax + z * az) < 6:
                continue
            slope = max(abs(tp_at(x + 2, z) - tp_at(x - 2, z)), abs(tp_at(x, z + 2) - tp_at(x, z - 2))) / 4
            if slope > 0.16:
                continue
            if any(cls[(z + dz - NEAR['z0']) * nw + (x + dx - NEAR['x0'])] not in (G['lawn'], G['lawnWorn']) for dz in (-2, 0, 2) for dx in (-2, 0, 2)):
                continue
            view = sight.clear(x, z, tp_at(x, z) + 0.75, 104, maxd=900)
            score = min(view, 600) - math.hypot(x, z) * 0.8 - slope * 400
            if best is None or score > best[0]:
                best = (score, x, z, slope, view)
    if not best:
        raise SystemExit('no sheet spot found')
    _, sx, sz, sslope, _ = best
    # ランチ：座った目の高さで、川（方位 30〜150°）のうち遠くまで見通せる向き。360° 写真の向き（104°）に近いほうを選ぶ
    LUNCH = max(range(30, 151, 5), key=lambda b: (min(sight.clear(sx, sz, tp_at(sx, sz) + 0.75, b, maxd=900), 600), -abs(b - 104)))
    lunch_clear = sight.clear(sx, sz, tp_at(sx, sz) + 0.75, LUNCH, maxd=900)
    fx, fz = local_from_bearing(LUNCH, 1.0)
    # 夕日：日の入りは方位 258° 前後で、町の側（陸）に沈む。堤防の上で、その方位がいちばん開けている所（立った目の高さ）
    cand = [(x, z) for z in range(-200, 201, 4) for x in range(-80, 60, 2)
            if abs(tp_at(x, z) - crest_tp) < 0.8 and cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] in (G['road'], G['paved'], G['lawn'], G['lawnWorn'])]
    sunset_pt = max(cand, key=lambda p: (min(sight.clear(p[0], p[1], tp_at(*p) + 1.6, 258, maxd=1500), 900), -math.hypot(*p)))
    sunset_clear = sight.clear(sunset_pt[0], sunset_pt[1], tp_at(*sunset_pt) + 1.6, 258, maxd=1500)
    # 東西線の鉄橋：水際の近くから、鉄橋の川の上の中ほどを見る
    tozai = max((b for b in lm['bridges'] if b['id'] == 'tozai-line'), key=lambda b: b['overWater'], default=None)
    bview = None
    if tozai:
        # 鉄橋の川の上の部分（線を 5 m おきにたどって、水の上の点）の真ん中
        dense = []
        for (x1, z1), (x2, z2) in zip(tozai['path'], tozai['path'][1:]):
            n = max(1, int(math.dist((x1, z1), (x2, z2)) / 5))
            dense += [(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n) for k in range(n)]
        wp = [p for p in dense if dem.is_water(*p)]
        bx, bz = wp[len(wp) // 2]
        # 立つ所：川側の低い所（水際の道のあたり、TP 1.5〜3.5 m。潮の引いた干潟には立たない）
        cand_b = [(x, z) for z in range(-200, 60, 3) for x in range(-40, 140, 2)
                  if 1.5 <= tp_at(x, z) <= 3.5 and not wet[z - NEAR['z0']][x - NEAR['x0']] and x * ax + z * az > 20]
        bx_, bz_ = min(cand_b, key=lambda p: abs(math.dist(p, (bx, bz)) - 260) + abs(p[1]) * 0.2)
        bview = {'x': bx_, 'z': bz_, 'eye': 1.6, 'bearing': round(bearing_dist(bx - bx_, bz - bz_)[0], 1), 'pitch': 3, 'hour': 15.0}
    view = {
        'lunch': {'x': round(sx - fx * 0.9, 2), 'z': round(sz - fz * 0.9, 2), 'eye': 0.75, 'bearing': LUNCH, 'pitch': -4, 'hour': 12.0},
        'nap': {'x': round(sx - fx * 0.3, 2), 'z': round(sz - fz * 0.3, 2), 'eye': 0.25, 'bearing': (LUNCH + 180) % 360, 'pitch': 60, 'hour': 13.5},
        # 360° 写真の視点：堤防の上の道に立って、下流（方位 104°）を見る
        'photo': {'x': PHOTO_POINT[0], 'z': PHOTO_POINT[1], 'eye': 1.6, 'bearing': 104, 'pitch': -2.6, 'hour': 10.5},
        'sunset': {'x': sunset_pt[0], 'z': sunset_pt[1], 'eye': 1.6, 'bearing': 258, 'pitch': 1, 'hour': 16.85},
    }
    # 鉄橋の視点は、写真（妙典の堤防の川側の斜面から上流を見たもの）に合わせる：
    # 左端に水管橋の手前のトラス、真ん中に大きなアーチ、右に 2 つのアーチ、その奥に東西線のトラス
    PBs = lm['specials'].get('pipeBridge')
    if PBs:
        (px0, pz0), (px1, pz1) = PBs['path'][0], PBs['path'][-1]
        PL = math.dist((px0, pz0), (px1, pz1))
        at_s = lambda s_: (px0 + (px1 - px0) * s_ / PL, pz0 + (pz1 - pz0) * s_ / PL)
        def off(a, b):
            return (a - b + 540) % 360 - 180
        best_a = None
        for z in range(-60, NEAR['z0'] + nh - 4, 4):
            for x in range(-20, NEAR['x0'] + nw - 4, 4):
                tp_ = tp_at(x, z)
                if not (2.6 <= tp_ <= 6.5) or x * ax + z * az < 8 or wet[z - NEAR['z0']][x - NEAR['x0']]:
                    continue
                b_truss = bearing_dist(at_s(60)[0] - x, at_s(60)[1] - z)[0]
                b_mid = bearing_dist(at_s(300)[0] - x, at_s(300)[1] - z)[0]
                d_arch = math.dist((x, z), at_s(200))
                err = abs(off(b_truss, b_mid) + 34) + abs(d_arch - 200) * 0.3
                if best_a is None or err < best_a[0]:
                    best_a = (err, x, z, b_mid)
        if best_a:
            _, vx_, vz_, vb_ = best_a
            bview = {'x': vx_, 'z': vz_, 'eye': 1.6, 'bearing': round(vb_ - 8, 1), 'pitch': 5, 'hour': 15.6}
    if bview:
        view['bridge'] = bview
    for v in view.values():
        v['y'] = round(tp2y(tp_at(v['x'], v['z'])), 2)
    scene = {
        'version': 1,
        'name': SITE['name'],
        'frame': {'origin': SITE['origin'], 'upstreamBearing': SITE['upstreamBearing'],
                  'axes': f'-z = 北、+x = 東、y = 0 が TP {SITE["origin"]["tp"]} m、1 単位 = 1 m。川の上流は方位 {UP:.0f}°'},
        'files': {
            'near': {'height': 'near_height.png', 'ground': 'ground.png', 'groundColor': 'ground_color.png', **NEAR, 'encoding': 'TP = (R*256+G)/100 - 10、y = TP - origin.tp'},
            'mid': {'height': 'mid_height.png', **MID, 'classes': MID_CLASSES, 'encoding': 'TP = (R*256+G)/100 - 10、B = classes の番号',
                    'color': {'file': 'mid_color.png', **mid_color, 'note': '空中写真の色（2 m ごと、写真の外は透明）'}},
        },
        'ground': [{'id': i, 'name': n, 'color': '#%02x%02x%02x' % c} for i, (n, c) in enumerate(GROUND)],
        'water': {'levelY': round(tp2y(SITE['waterTP']), 2), 'levelNote': '満ち潮に近い TP 1.0 m（360° 写真に合わせる）。行徳可動堰より下流で、東京湾の干満（±1 m）が入る', 'river': river,
                  'upstreamBearing': UP},
        'levee': {'crestTP': round(crest_tp, 2), 'shoreDist': shore_t, 'across': round((UP + 90) % 360, 1),
                  'note': '原点の断面：堤防の上（自転車・歩行者道）から川へ。標高データで水になるまでの距離 shoreDist m'},
        'trees': trees,
        'sheet': {'x': sx, 'z': sz, 'bearing': LUNCH, 'size': [2.0, 1.4]},
        'sightlines': {'lunch': lunch_clear, 'sunset': sunset_clear},
        'landmarks': lm,
        'viewpoints': view,
        'sun': {'lat': SITE['origin']['lat'], 'lon': SITE['origin']['lon'], 'date': '2026-10-18', 'tz': 9},
        'attribution': [
            '地形：国土地理院 基盤地図情報 数値標高モデル（DEM5A）を加工して作成',
            '地面の種類：国土地理院 シームレス空中写真をもとに作成（地面の色は加工して作成）',
            '地図データ：© OpenStreetMap contributors',
        ],
    }
    save_json(os.path.join(OUT, 'scene.json'), scene)
    with open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8') as f:
        f.write(open(os.path.join(os.path.dirname(OUT), 'nagisa', 'ATTRIBUTION.md'), encoding='utf-8').read()
                .replace('（scenes/nagisa）', '（scenes/myoden）')
                .replace('--site nagisa` → `python3 tools/geo/build_nagisa.py', '--site myoden` → `python3 tools/geo/build_myoden.py'))
    log(f'done: {OUT}')
    log(f'  crest TP {crest_tp:.1f}, shore {shore_t} m, sheet ({sx},{sz}) slope {sslope:.2f}, lunch {LUNCH}° clear {lunch_clear} m, '
        f'sunset {sunset_pt} clear {sunset_clear} m, bridge view {bview}, trees {len(trees)}, bridges {[b["id"] for b in lm["bridges"]]}, '
        f'near buildings {len(lm["nearBuildings"])}, tall {len(lm["buildings"])}, towers {len(lm["towers"])}, lines {len(lm["powerLines"])}, river pts {len(river)}')


if __name__ == '__main__':
    main()
