"""妙典の対岸（市川市 田尻・高谷）の場面データを作る（docs/MYODEN_FAR_DESIGN.md）。

  python3 tools/geo/fetch_data.py --site myoden-far
  python3 tools/geo/build_myoden_far.py        # scenes/myoden-far/ を作る

妙典の岸（build_myoden.py）の「川の向こう側」：江戸川の北東の岸の堤防の上。Google マップの 360° 写真（2020 年 10 月、「田尻」）の
位置を原点にする。妙典の場面の部品（なぎさ公園の地形の作り方、橋・水管橋・貸しボート屋・小舟の拾い方）をそのまま使い、
この岸のもの（コンクリートの堤防の上、干潟と杭、水管橋のこちら側の端、外環道の遮音シェルター、潮の高さ）を足す。
"""
import math
import os
import sys

os.environ['GEO_SITE'] = 'myoden-far'
if '--site' not in sys.argv:
    sys.argv += ['--site', 'myoden-far']

from PIL import Image

import build_scene as B
import build_nagisa as N
import build_myoden as M
import rails
from geo_common import (CACHE, OUT, SITE, SITE_NAME, bearing_dist, ll2local, load_json, local2ll, local_from_bearing, save_json, tp2y)

NEAR = {'x0': -200, 'z0': -240, 'step': 1, 'w': 381, 'h': 461}     # x -200..180, z -240..220（堤防・河川敷・干潟・堤防の下の町）
MID = {'x0': -3350, 'z0': -2550, 'step': 8, 'w': 751, 'h': 701}    # 妙典の場面と同じ範囲（6 km × 5.6 km）
for mod in (B, N, M):
    mod.NEAR, mod.MID = NEAR, MID
G, GROUND = B.G, B.GROUND
log = B.log

UP = 325.0                     # 川の上流の方位
CREST_ID = 903500800           # 堤防の上の道（OSM の footway。360° 写真ではコンクリートの舗装）
CREST_TP = 8.4                 # 堤防の上の高さ（標高データの前後の値。原点のまわりは 7.8〜8.0 に下がっているので上げる）
MYODEN_LEVEE_IDS = (210577374, 1126425114, 1126425115)   # 対岸（妙典）の堤防の上の道（妙典の場面で TP 8.4 m に上げた所）
TIDES = {'low': -0.3, 'high': 1.0}   # 潮の高さ（TP m）。360° 写真（2020 年 10 月）は干潮で干潟が出ている
GAIKAN_IDS = (592898797, 595710562)  # 外環道のトンネルの出口から南東の、掘割の区間（上下線）。ストリートビューでは銀色のかまぼこ形の遮音シェルター


def way_pts(byid, i):
    e = byid.get(i)
    return [ll2local(p['lat'], p['lon']) for p in e['geometry']] if e and e.get('geometry') else []


def resample(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b) / step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out


def main():
    assert SITE_NAME == 'myoden-far'
    os.makedirs(OUT, exist_ok=True)
    osm = load_json(os.path.join(CACHE, 'osm.json'))['elements']
    byid = {e['id']: e for e in osm if e.get('type') == 'way'}
    log('loading dem ...')
    dem = B.Dem()
    photo = B.Photo()
    nw, nh = NEAR['w'], NEAR['h']
    ux, uz = local_from_bearing(UP, 1.0)            # 上流へ
    ax, az = local_from_bearing(UP - 90, 1.0)       # 川を横切る向き（南西、川の方へ）
    side = lambda x, z: x * ax + z * az             # 川側ほど大きい（堤防の上の道 ≒ 0）

    log('near heights ...')
    near, wet = N.near_heights(dem)
    # 堤防の上：OSM の道のうち標高データで TP 7 m 以上の区間を TP 8.4 m に（東西線の鉄橋の下で道が TP 5.8 m に下がる所はそのまま）
    crest = way_pts(byid, CREST_ID)
    runs, cur = [], []
    for p in resample(crest, 4):
        if dem.height(*p) >= 7.0:
            cur.append(p)
        elif cur:
            runs.append(cur); cur = []
    if cur:
        runs.append(cur)
    fake = [{'type': 'way', 'id': f'crest{k}', 'geometry': [dict(zip(('lat', 'lon'), local2ll(*p))) for p in r]} for k, r in enumerate(runs) if len(r) > 2]
    M.LEVEE_TOP_IDS, M.RAMP_ID, M.LEVEE_TP = tuple(f['id'] for f in fake), None, CREST_TP
    M.raise_levee(near, wet, fake, half=3.0)
    tp_at = lambda x, z: near[(min(max(round(z), NEAR['z0']), NEAR['z0'] + nh - 1) - NEAR['z0']) * nw + (min(max(round(x), NEAR['x0']), NEAR['x0'] + nw - 1) - NEAR['x0'])]
    inside = lambda x, z: NEAR['x0'] <= x < NEAR['x0'] + nw and NEAR['z0'] <= z < NEAR['z0'] + nh

    log('ground classes ...')
    cls = N.build_ground(dem, photo, wet)
    log('landmarks ...')
    lm = M.landmarks(osm, dem, photo)
    lm['railways'] = rails.rail_routes(lm['bridges'], load_json(os.path.join(CACHE, 'osm_rail.json'))['elements'], dem, rails.TRAIN_IDS, log=log)
    # 遠景：妙典・行徳の町は川の向こう（南西）
    for b in lm['backdrop']:
        if b['id'] == 'gyotoku':
            b.update({'span': [195, 270], 'dist': 1300, 'height': 20, 'note': '妙典・行徳の町（川の向こう）'})

    def paint(pts, half, g, cond=lambda x, z: True):
        for x, z in resample(pts, 0.5):
            r = int(math.ceil(half))
            for dz in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    X, Z = round(x + dx), round(z + dz)
                    if math.hypot(dx, dz) <= half and inside(X, Z) and not wet[Z - NEAR['z0']][X - NEAR['x0']] and cond(X, Z):
                        cls[(Z - NEAR['z0']) * nw + (X - NEAR['x0'])] = G[g]

    # 建物の下は舗装
    for b in lm['nearBuildings']:
        xs = [p[0] for p in b['footprint']]; zs = [p[1] for p in b['footprint']]
        for z in range(max(NEAR['z0'], int(min(zs))), min(NEAR['z0'] + nh, int(max(zs)) + 1)):
            for x in range(max(NEAR['x0'], int(min(xs))), min(NEAR['x0'] + nw, int(max(xs)) + 1)):
                if B.point_in_poly(x + 0.5, z + 0.5, b['footprint']):
                    cls[(z - NEAR['z0']) * nw + (x - NEAR['x0'])] = G['paved']
    # 干潟（干潮の水面と満ち潮の水面のあいだの陸）は泥（dirt を泥の色で描く）。水際の「護岸」もこの岸では泥
    for j in range(nh):
        for i in range(nw):
            k = j * nw + i
            if not wet[j][i] and side(NEAR['x0'] + i, NEAR['z0'] + j) > 20 and (near[k] < TIDES['high'] - 0.1 or cls[k] == G['revetment']):
                cls[k] = G['dirt']
    # 町の側の明るい広い所（駐車場・資材置き場・屋根）は土のグラウンドではなく舗装
    for j in range(nh):
        for i in range(nw):
            if cls[j * nw + i] == G['dirt'] and side(NEAR['x0'] + i, NEAR['z0'] + j) < 0:
                cls[j * nw + i] = G['paved']
    # 水際のヨシ・草の帯（満ち潮の水際から TP 1.9 m まで。写真：干潟の上に草とヨシ）
    for j in range(nh):
        for i in range(nw):
            k = j * nw + i
            x, z = NEAR['x0'] + i, NEAR['z0'] + j
            if not wet[j][i] and TIDES['high'] - 0.1 <= near[k] < 1.9 and side(x, z) > 30 and cls[k] in (G['lawn'], G['lawnWorn'], G['leveeGrass'], G['other'], G['dirt'], G['revetment']):
                cls[k] = G['reeds']
    # 河川敷・ふもとの道（OSM の歩道・小道で TP 5 m より低い所）：灰色の舗装
    lower = []
    for e in osm:
        t = e.get('tags', {})
        if t.get('highway') in ('footway', 'path', 'cycleway', 'service', 'residential', 'unclassified', 'track') and e.get('geometry') and e['id'] != CREST_ID:
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            if any(inside(x, z) for x, z in pts):
                lower.append((pts, t.get('highway')))
    for pts, hw in lower:
        half = 1.6 if hw in ('footway', 'path', 'cycleway', 'track') else 2.8
        paint(pts, half, 'road', lambda x, z: tp_at(x, z) < 5.0)
    # 堤防の上：コンクリートの舗装（幅 6 m）と、川側の斜面の上の端のコンクリートの板（幅 3 m）
    for r in runs:
        paint(r, 3.0, 'paved')
        paint(r, 6.5, 'revetment', lambda x, z: 2.8 < side(x, z) - side(*min(r, key=lambda p: math.dist(p, (x, z)))) and tp_at(x, z) > CREST_TP - 1.6)
    trees = N.split_trees(cls)
    # 堤防（斜面と上）と、川側には木を置かない（写真：堤防の陸側のふもとに低木と金網の柵）。
    # 堤防のふもとから 60 m（ふもとの道・アパート・外環道と国道 298 号）も、ストリートビューでは低木と植え込みだけ
    trees = [t for t in trees if side(t['x'], t['z']) < -60 and tp_at(t['x'], t['z']) < 4.0]

    gim = Image.new('RGB', (nw, nh)); gp = gim.load()
    for j in range(nh):
        for i in range(nw):
            gp[i, j] = GROUND[cls[j * nw + i]][1]
    gim.save(os.path.join(OUT, 'ground.png'), optimize=True)
    B.write_height_png(os.path.join(OUT, 'near_height.png'), near, None, nw, nh)
    cim = Image.new('RGB', (nw, nh)); cp = cim.load()
    for j in range(nh):
        for i in range(nw):
            cp[i, j] = tuple(int(c) for c in photo.rgb(NEAR['x0'] + i, NEAR['z0'] + j))
    cim.save(os.path.join(OUT, 'ground_color.png'), optimize=True)

    log('mid ...')
    mh, mc = N.build_mid(dem, osm)
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
    # 対岸（妙典）の堤防の上：妙典の場面と同じく TP 8.4 m に（標高データは道の開通より前の測量で低い）
    for i_ in MYODEN_LEVEE_IDS:
        for x, z in resample(way_pts(byid, i_), 4):
            for dz in range(-1, 2):
                for dx in range(-1, 2):
                    I = round((x - MID['x0']) / MID['step']) + dx; J = round((z - MID['z0']) / MID['step']) + dz
                    if 0 <= I < MID['w'] and 0 <= J < MID['h'] and mc[J * MID['w'] + I] != 3:
                        mh[J * MID['w'] + I] = max(mh[J * MID['w'] + I], 8.4 - 2.0 * max(abs(dx), abs(dz)))
    B.write_height_png(os.path.join(OUT, 'mid_height.png'), mh, mc, MID['w'], MID['h'])
    mim, mid_color = B.mid_photo_colors(photo)
    mim.quantize(64, method=Image.Quantize.FASTOCTREE).save(os.path.join(OUT, 'mid_color.png'), optimize=True)

    # 川の中ほどの線（船の通り道）
    river = []
    for s in range(-2200, 2201, 50):
        cx0, cz0 = ux * s, uz * s
        wet_t = [t for t in range(-200, 1200, 10) if dem.is_water(cx0 + ax * t, cz0 + az * t)]
        if len(wet_t) * 10 > 150:
            tm = (wet_t[0] + wet_t[-1]) / 2
            river.append([round(cx0 + ax * tm, 1), round(cz0 + az * tm, 1)])
    shore_t = next(t for t in range(0, 400) if dem.is_water(ax * t, az * t))

    # 小舟（空中写真の白い塊。川の上）と貸しボート屋
    br_paths = [b['path'] for b in lm['bridges']] + ([lm['specials']['pipeBridge']['path']] if lm['specials'].get('pipeBridge') else [])
    lm['boats'] = M.find_boats(dem, photo, br_paths, box=(-750, 350, -650, 650))
    lm['boathouses'] = []
    for e in osm:
        t = e.get('tags', {})
        if e['type'] == 'node' and t.get('amenity') == 'boat_rental':
            x, z = ll2local(e['lat'], e['lon'])
            if math.hypot(x, z) < 1500:
                lm['boathouses'].append({'name': t.get('name'), 'x': round(x, 1), 'z': round(z, 1), 'groundY': round(tp2y(dem.height(x, z)), 2)})

    # 干潟の杭（写真：干潟に木の杭がたくさん立ち、小舟をつなぐ）。この岸の貸しボート屋の前に、川へ向かう列。ほかは水際に散らす
    import random
    rng = random.Random(7)
    stakes = []
    for h in lm['boathouses']:
        if side(h['x'], h['z']) < 0 or math.hypot(h['x'], h['z']) > 400:
            continue
        for row in range(-2, 3):
            off = row * 9 + rng.uniform(-2, 2)
            for d in range(4, 70, 3):
                x = h['x'] + ax * d - ux * off + rng.uniform(-0.6, 0.6)
                z = h['z'] + az * d - uz * off + rng.uniform(-0.6, 0.6)
                tp = dem.height(x, z) if not inside(x, z) else tp_at(x, z)
                if -2.0 < tp < 1.2 and rng.random() < 0.8:
                    stakes.append([round(x, 1), round(z, 1), round(rng.uniform(1.6, 3.2), 1)])
    for s in range(-260, 261, 6):
        for t in range(int(shore_t) - 25, int(shore_t) + 25, 4):
            x, z = ux * s + ax * t + rng.uniform(-2, 2), uz * s + az * t + rng.uniform(-2, 2)
            tp = tp_at(x, z) if inside(x, z) else dem.height(x, z)
            if -1.6 < tp < 0.9 and rng.random() < 0.18:
                stakes.append([round(x, 1), round(z, 1), round(rng.uniform(1.2, 2.6), 1)])
    lm['stakes'] = stakes

    # 水管橋のこちら側の端（淡い水色のトラス・堤防の上の四角い橋脚・陸側の塔）は build_myoden.py の spec（farTruss・farPiers・tower）
    PB = lm['specials'].get('pipeBridge')
    if PB:
        P = PB['path']
        L = math.dist(P[0], P[-1])
        at = lambda s: (P[0][0] + (P[-1][0] - P[0][0]) * s / L, P[0][1] + (P[-1][1] - P[0][1]) * s / L)

    # 外環道の遮音シェルター（トンネルの出口から南東の掘割。上下線の真ん中の線、幅 34 m・高さ 12 m は写真の見え方からの推定）
    a_ = way_pts(byid, GAIKAN_IDS[0]); b_ = way_pts(byid, GAIKAN_IDS[1])
    shelter = None
    if a_ and b_:
        A = resample(a_, 10)
        Bp = resample(b_, 10)
        mid = [((x + min(Bp, key=lambda q: math.dist(q, (x, z)))[0]) / 2, (z + min(Bp, key=lambda q: math.dist(q, (x, z)))[1]) / 2) for x, z in A]
        shelter = {'path': [[round(x, 1), round(z, 1)] for x, z in mid], 'width': 34, 'height': 12,
                   'groundY': round(tp2y(min(dem.height(x, z) for x, z in mid)), 2),
                   'note': '東京外環自動車道の掘割（半地下）を覆う銀色の波板のかまぼこ形のシェルター。範囲はトンネルの出口から高架の始まりまで（OSM）。幅・高さは推定'}
    lm['gaikanShelter'] = shelter
    lm['myodenOrigin'] = [round(v, 1) for v in ll2local(35.694519, 139.931955)]   # 妙典の場面の原点（川の向こう）
    lm['crestLine'] = [[[round(x, 1), round(z, 1)] for x, z in r] for r in runs]

    # ---------------------------------------------------------------- 視点
    sight = N.Sight(near, trees, lm['nearBuildings'], dem)
    # シート：河川敷の草（満ち潮でも濡れない TP 2 m 以上、傾き 1:6 より緩い）で、川を見渡せる所
    best = None
    for z in range(-140, 141, 2):
        for x in range(-140, 120, 2):
            if not inside(x, z):
                continue
            k = (z - NEAR['z0']) * nw + (x - NEAR['x0'])
            if cls[k] not in (G['lawn'], G['lawnWorn'], G['leveeGrass']) or side(x, z) < 8 or tp_at(x, z) < 2.0:
                continue
            slope = max(abs(tp_at(x + 2, z) - tp_at(x - 2, z)), abs(tp_at(x, z + 2) - tp_at(x, z - 2))) / 4
            if slope > 0.16:
                continue
            if any(cls[(z + dz - NEAR['z0']) * nw + (x + dx - NEAR['x0'])] not in (G['lawn'], G['lawnWorn'], G['leveeGrass']) for dz in (-2, 0, 2) for dx in (-2, 0, 2)):
                continue
            view = sight.clear(x, z, tp_at(x, z) + 0.75, 235, maxd=900)
            score = min(view, 600) - math.hypot(x, z) * 0.8 - slope * 400
            if best is None or score > best[0]:
                best = (score, x, z, slope)
    if not best:
        raise SystemExit('no sheet spot found')
    _, sx, sz, sslope = best
    LUNCH = max(range(190, 286, 5), key=lambda b: (min(sight.clear(sx, sz, tp_at(sx, sz) + 0.75, b, maxd=900), 600), -abs(b - 235)))
    lunch_clear = sight.clear(sx, sz, tp_at(sx, sz) + 0.75, LUNCH, maxd=900)
    fx, fz = local_from_bearing(LUNCH, 1.0)
    # 夕日：日の入りは方位 258° 前後で、川の向こうの妙典の町に沈む。堤防の上で、その方位がいちばん開けている所
    cand = [(x, z) for r in runs for x, z in resample(r, 4) if inside(x, z) and math.hypot(x, z) < 200]
    sunset_pt = max(cand, key=lambda p: (min(sight.clear(p[0], p[1], tp_at(*p) + 1.6, 258, maxd=1500), 900), -math.hypot(*p)))
    sunset_pt = (round(sunset_pt[0], 1), round(sunset_pt[1], 1))
    sunset_clear = sight.clear(sunset_pt[0], sunset_pt[1], tp_at(*sunset_pt) + 1.6, 258, maxd=1500)
    view = {
        'lunch': {'x': round(sx - fx * 0.9, 2), 'z': round(sz - fz * 0.9, 2), 'eye': 0.75, 'bearing': LUNCH, 'pitch': -3, 'hour': 12.0},
        'nap': {'x': round(sx - fx * 0.3, 2), 'z': round(sz - fz * 0.3, 2), 'eye': 0.25, 'bearing': (LUNCH + 180) % 360, 'pitch': 60, 'hour': 13.5},
        # 360° 写真の視点：堤防の上に立って、妙典（方位 235°）を見る。正面に水管橋のアーチ、右に東西線の鉄橋
        'photo': {'x': 0.0, 'z': 0.0, 'eye': 1.6, 'bearing': 235, 'pitch': -2, 'hour': 14.0},
        'sunset': {'x': sunset_pt[0], 'z': sunset_pt[1], 'eye': 1.6, 'bearing': 258, 'pitch': 1, 'hour': 16.85},
    }
    # 水管橋：河川敷の低い所（TP 1.9〜3.5 m）から、3 つのアーチの真ん中（s = 300 m）を 200 m ほど先に、上流に東西線
    if PB:
        target = at(300)
        cand_b = [(x, z) for z in range(-60, NEAR['z0'] + nh - 4, 3) for x in range(NEAR['x0'] + 4, 150, 3)
                  if 1.9 <= tp_at(x, z) <= 3.5 and side(x, z) > 10 and not wet[z - NEAR['z0']][x - NEAR['x0']]]
        bx_, bz_ = min(cand_b, key=lambda p: abs(math.dist(p, target) - 200) + (p[0] * ux + p[1] * uz) * 0.3)  # 下流側ほどよい（奥に東西線）
        view['bridge'] = {'x': bx_, 'z': bz_, 'eye': 1.6, 'bearing': round(bearing_dist(target[0] - bx_, target[1] - bz_)[0] + 12, 1), 'pitch': 5, 'hour': 10.0}
    # 振り返る：堤防の上から町の側（方位 55°）。家並みの向こうに外環道のシェルター、午後の日が当たる
    view['town'] = {'x': 0.0, 'z': 0.0, 'eye': 1.6, 'bearing': 55, 'pitch': -4, 'hour': 15.5}
    for v in view.values():
        v['y'] = round(tp2y(tp_at(v['x'], v['z'])), 2)

    scene = {
        'version': 1,
        'name': SITE['name'],
        'frame': {'origin': SITE['origin'], 'upstreamBearing': SITE['upstreamBearing'],
                  'axes': f'-z = 北、+x = 東、y = 0 が TP {SITE["origin"]["tp"]} m、1 単位 = 1 m。川の上流は方位 {UP:.0f}°。妙典の場面の原点は方位 235°・425 m'},
        'files': {
            'near': {'height': 'near_height.png', 'ground': 'ground.png', 'groundColor': 'ground_color.png', **NEAR, 'encoding': 'TP = (R*256+G)/100 - 10、y = TP - origin.tp'},
            'mid': {'height': 'mid_height.png', **MID, 'classes': M.MID_CLASSES, 'encoding': 'TP = (R*256+G)/100 - 10、B = classes の番号',
                    'color': {'file': 'mid_color.png', **mid_color, 'note': '空中写真の色（2 m ごと、写真の外は透明）'}},
        },
        'ground': [{'id': i, 'name': n, 'color': '#%02x%02x%02x' % c} for i, (n, c) in enumerate(GROUND)],
        'water': {'levelY': round(tp2y(TIDES['low']), 2), 'tides': {k: round(tp2y(v), 2) for k, v in TIDES.items()},
                  'levelNote': '潮の高さ：干潮 TP −0.3 m（360° 写真のように干潟が出る）、満ち潮 TP 1.0 m。⚙️ で選ぶ', 'river': river, 'upstreamBearing': UP},
        'levee': {'crestTP': CREST_TP, 'shoreDist': shore_t, 'across': round((UP - 90) % 360, 1),
                  'note': '原点の断面：堤防の上（コンクリート）から川（南西）へ。標高データで水になるまでの距離 shoreDist m'},
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
        f.write(open(os.path.join(os.path.dirname(OUT), 'myoden', 'ATTRIBUTION.md'), encoding='utf-8').read()
                .replace('（scenes/myoden）', '（scenes/myoden-far）')
                .replace('--site myoden` → `python3 tools/geo/build_myoden.py', '--site myoden-far` → `python3 tools/geo/build_myoden_far.py'))
    log(f'done: {OUT}')
    log(f'  shore {shore_t} m, crest runs {[len(r) for r in runs]}, sheet ({sx},{sz}) slope {sslope:.2f}, lunch {LUNCH}° clear {lunch_clear} m, '
        f'sunset {sunset_pt} clear {sunset_clear} m, views {list(view)}, trees {len(trees)}, boats {len(lm["boats"])}, stakes {len(stakes)}, '
        f'boathouses {[h["name"] for h in lm["boathouses"]]}, near buildings {len(lm["nearBuildings"])}, shelter {len(shelter["path"]) if shelter else None}')


if __name__ == '__main__':
    main()
