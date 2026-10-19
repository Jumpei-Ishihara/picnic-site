"""地理データの共通処理：場所の設定（江戸川・なぎさ公園）、タイル座標、場面の座標、キャッシュ付きダウンロード。

場面の座標（docs/EDOGAWA_DESIGN.md 4.1）
  原点 = シートの位置、y = 0 が TP 2.5 m、1 単位 = 1 m
  -z = 上流（方位 338°）、+x = 町側（方位 68°）、-x = 川の向こう（東京側）
"""
import io
import json
import math
import os
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# 場所の設定。GEO_SITE 環境変数か、コマンドの --site 名前 で選ぶ（既定は edogawa）
SITES = {
    'edogawa': {
        'name': '江戸川河川敷緑地（市川）',
        'origin': {'lat': 35.72707, 'lon': 139.89870, 'tp': 2.5},
        'upstreamBearing': 338.0,
        # 標高・OSM を取る範囲（緯度経度）
        'bbox': {'s': 35.712, 'w': 139.880, 'n': 35.740, 'e': 139.912},
        # 空中写真を取る範囲（近景の下絵用）
        'photoBbox': {'s': 35.7180, 'w': 139.8870, 'n': 35.7335, 'e': 139.9060},  # 両岸の水際の植え込みまで
        'waterTP': 1.0,  # 水面の高さ（仮定、設計書 7 章）
    },
    'nagisa': {
        'name': 'なぎさ公園（江戸川区 南葛西）',
        'origin': {'lat': 35.64922, 'lon': 139.88316, 'tp': 3.0},
        'upstreamBearing': 0.0,  # -z = 北
        'bbox': {'s': 35.626, 'w': 139.845, 'n': 35.672, 'e': 139.915},
        'photoBbox': {'s': 35.6440, 'w': 139.8770, 'n': 35.6545, 'e': 139.8900},
        'waterTP': 0.0,  # 東京湾・旧江戸川の河口：平均海面（干満は ±1 m）
        # 範囲の外や、ふつうの条件で拾えないものを id で足す（クリスタルビュー、東京ゲートブリッジ）
        'osmExtra': ['way(161731857);', 'way(150870020);', 'way(150870021);', 'node(859682628);', 'way(536919774);', 'way(796894975);'],
    },
    'myoden': {
        'name': '江戸川 妙典の岸（市川市 妙典）',
        # Google マップの 360° 写真（2025 年 6 月、堤防の上の道）の位置。妙典公園の東、東西線の鉄橋の下流
        'origin': {'lat': 35.694519, 'lon': 139.931955, 'tp': 7.0},
        'upstreamBearing': 0.0,  # -z = 北
        'bbox': {'s': 35.668, 'w': 139.895, 'n': 35.722, 'e': 139.970},
        'photoBbox': {'s': 35.6895, 'w': 139.9255, 'n': 35.7000, 'e': 139.9405},
        # 妙典給水場の水管橋（3 つのアーチ）、工場地区（対岸を倉庫にする）、東西線の車両基地（範囲と線路）
        'osmExtra': ['way(454774418);', 'way(35.668,139.895,35.722,139.970)["landuse"="industrial"];',
                     'way(35.686,139.925,35.700,139.940)["railway"];', 'way(35.686,139.925,35.700,139.940)["landuse"="railway"];',
                     'node(35.680,139.915,35.710,139.950)["amenity"="boat_rental"];'],
        'waterTP': 1.0,  # 行徳可動堰より下流で潮が入る（干満 ±1 m）。360° 写真（2025 年 6 月）は水が芝の縁まで来ていたので、満ち潮に近い TP 1.0 m
    },
}


def _site_name():
    import sys
    if '--site' in sys.argv:
        return sys.argv[sys.argv.index('--site') + 1]
    return os.environ.get('GEO_SITE', 'edogawa')


SITE_NAME = _site_name()
SITE = SITES[SITE_NAME]
CACHE = os.path.join(HERE, 'cache', SITE_NAME)
OUT = os.path.join(ROOT, 'scenes', SITE_NAME)

USER_AGENT = 'picnic-site-edogawa/1.0 (personal pixel-art project)'
R_EARTH = 6371008.8


# ---- タイル座標（Web メルカトル） ----

def ll2tile(lat, lon, z):
    n = 2 ** z
    lr = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n


def tile2ll(tx, ty, z):
    n = 2 ** z
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return lat, tx / n * 360 - 180


def tile_range(bbox, z):
    x0, y0 = ll2tile(bbox['n'], bbox['w'], z)
    x1, y1 = ll2tile(bbox['s'], bbox['e'], z)
    return range(int(x0), int(x1) + 1), range(int(y0), int(y1) + 1)


# ---- 場面の座標 ----

_LAT0 = SITE['origin']['lat']
_LON0 = SITE['origin']['lon']
_COS0 = math.cos(math.radians(_LAT0))
_UB = math.radians(SITE['upstreamBearing'])
_XB = math.radians(SITE['upstreamBearing'] + 90)  # +x の方位（68°）


def ll2en(lat, lon):
    """原点からの東・北方向の距離（m）。数 km までなら平面とみなして十分。"""
    return math.radians(lon - _LON0) * _COS0 * R_EARTH, math.radians(lat - _LAT0) * R_EARTH


def en2ll(e, n):
    return _LAT0 + math.degrees(n / R_EARTH), _LON0 + math.degrees(e / (_COS0 * R_EARTH))


def en2local(e, n):
    x = e * math.sin(_XB) + n * math.cos(_XB)
    z = -(e * math.sin(_UB) + n * math.cos(_UB))
    return x, z


def local2en(x, z):
    e = x * math.sin(_XB) - z * math.sin(_UB)
    n = x * math.cos(_XB) - z * math.cos(_UB)
    return e, n


def ll2local(lat, lon):
    return en2local(*ll2en(lat, lon))


def local2ll(x, z):
    return en2ll(*local2en(x, z))


def tp2y(tp):
    return tp - SITE['origin']['tp']


def bearing_dist(x, z):
    """場面の座標の点について、原点からの方位（度）と距離（m）。"""
    e, n = local2en(x, z)
    return math.degrees(math.atan2(e, n)) % 360, math.hypot(e, n)


def local_from_bearing(bearing, dist):
    r = math.radians(bearing)
    return en2local(math.sin(r) * dist, math.cos(r) * dist)


# ---- キャッシュ付きダウンロード ----

def cache_path(*parts):
    p = os.path.join(CACHE, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def fetch(url, path, data=None, refresh=False):
    """url を path に保存（あれば使い回す）。中身のバイト列を返す。"""
    if os.path.exists(path) and not refresh:
        with open(path, 'rb') as f:
            return f.read()
    req = urllib.request.Request(url, data=data, headers={'User-Agent': USER_AGENT})
    for attempt in range(3):
        try:
            body = urllib.request.urlopen(req, timeout=60).read()
            break
        except Exception as e:  # 404 は「タイルなし」として None を返す
            if getattr(e, 'code', None) == 404:
                return None
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    with open(path, 'wb') as f:
        f.write(body)
    time.sleep(0.15)  # 配信元への負荷を抑える
    return body


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, obj, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)


def open_image(data):
    from PIL import Image
    return Image.open(io.BytesIO(data))
