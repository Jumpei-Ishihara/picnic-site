"""江戸川（市川）場面の元データを取得して tools/geo/cache/ に保存する。

  python3 tools/geo/fetch_data.py            # 標高・OSM・空中写真をすべて（キャッシュがあれば使い回す）
  python3 tools/geo/fetch_data.py osm --refresh   # OSM だけ取り直す

取得するもの
  dem    国土地理院 標高タイル DEM5A（z15）            cache/dem5a_png/15/x/y.png
  osm    OpenStreetMap（Overpass API）                 cache/osm.json
  photo  国土地理院 シームレス空中写真（z17、下絵用）   cache/seamlessphoto/17/x/y.jpg
"""
import sys
import urllib.parse

from geo_common import SITE, cache_path, fetch, tile_range

DEM_Z = 15
PHOTO_Z = 17
GSI = 'https://cyberjapandata.gsi.go.jp/xyz'
OVERPASS = 'https://overpass-api.de/api/interpreter'


def fetch_tiles(layer, z, bbox, ext, refresh):
    xs, ys = tile_range(bbox, z)
    n = miss = 0
    for x in xs:
        for y in ys:
            body = fetch(f'{GSI}/{layer}/{z}/{x}/{y}.{ext}', cache_path(layer, str(z), str(x), f'{y}.{ext}'), refresh=refresh)
            n += 1
            miss += body is None
    print(f'{layer} z{z}: {n} tiles ({miss} missing)  x {xs.start}-{xs.stop - 1}  y {ys.start}-{ys.stop - 1}')


def overpass_query():
    b = SITE['bbox']
    bb = f"({b['s']},{b['w']},{b['n']},{b['e']})"
    parts = [
        f'nwr{bb}["leisure"~"park|pitch|playground|garden|recreation_ground"];',
        f'nwr{bb}["landuse"~"grass|recreation_ground|meadow"];',
        f'way{bb}["bridge"]["railway"];',
        f'way{bb}["bridge"]["highway"~"trunk|primary|secondary|tertiary"];',
        f'node{bb}["power"="tower"];',
        f'way{bb}["power"="line"];',
        f'way{bb}["highway"~"cycleway|footway|path|service|track|steps"];',
        f'nwr{bb}["natural"~"wood|scrub|tree_row|wetland|tree"];',
        f'node{bb}["amenity"~"toilets|parking"];',
        f'way{bb}["man_made"~"dyke|pier|embankment"];',
        f'way{bb}["embankment"="yes"];',
        f'way{bb}["building"]["building:levels"~"^([1-9][0-9]|[8-9])$"];',
    ]
    return '[out:json][timeout:120];(' + ''.join(parts) + ');out tags geom;'


def fetch_osm(refresh):
    data = urllib.parse.urlencode({'data': overpass_query()}).encode()
    body = fetch(OVERPASS, cache_path('osm.json'), data=data, refresh=refresh)
    import json
    print('osm:', len(json.loads(body)['elements']), 'elements')


def main(argv):
    refresh = '--refresh' in argv
    what = [a for a in argv if not a.startswith('-')] or ['dem', 'osm', 'photo']
    if 'dem' in what:
        fetch_tiles('dem5a_png', DEM_Z, SITE['bbox'], 'png', refresh)
    if 'osm' in what:
        fetch_osm(refresh)
    if 'photo' in what:
        fetch_tiles('seamlessphoto', PHOTO_Z, SITE['photoBbox'], 'jpg', refresh)


if __name__ == '__main__':
    main(sys.argv[1:])
