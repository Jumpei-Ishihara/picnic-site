"""電車の走る線路：川をまたぐ鉄道橋から、OSM の線路を両側へたどった道と高さ。

橋の先を同じ高さのまっすぐな線で延ばすと、線路が曲がる所や築堤・地上へ下りる所で電車が宙に浮く。
そこで OSM の線路（railway=rail|subway|light_rail）を橋の両端からつながる向きにたどり、各点の高さを決める。

  bridge=* （橋・高架橋）  … 橋の床の高さ（その場面の鉄道橋の deckY）
  embankment=yes（築堤）、地上 … 地面の高さ（DEM5A は築堤の上の面を含む）
  tunnel=*                    … 地下（電車を見せない）

そのあと勾配を 3 % までにならし（橋から地上へ下りる坂・高架橋の下の道でへこんだ所を埋める）、
地面より 1.2 m 以上高い所で、場面の橋の形が無い所を「高架」として返す（ページで桁と橋脚を作る）。
線路データは cache/<場面>/osm_rail.json（fetch_data.py rail）。
"""
import math

from geo_common import ll2local, tp2y

STEP = 8          # 線路の点の間隔（m）
GRADE = 0.03      # ならす勾配
RAIL_UP = 0.6     # 地上の線路：地面からレールの面までの高さ（道床）
VIADUCT_MIN = 1.2  # 地面からこれ以上高い所は高架の構造を作る
TRAIN_IDS = {'jr-sobu-local', 'jr-sobu-rapid', 'keisei', 'jr-keiyo', 'tozai-line'}  # realsite/life.js の TRAIN_LOOKS


def _resample(pts, step=STEP):
    out = [pts[0]]
    for (x1, z1), (x2, z2) in zip(pts, pts[1:]):
        d = math.dist((x1, z1), (x2, z2))
        n = max(1, int(round(d / step)))
        out += [(x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n) for k in range(1, n + 1)]
    return out


def _kind(tags):
    if tags.get('tunnel') and tags.get('tunnel') != 'no':
        return 'tunnel'
    if tags.get('bridge') and tags.get('bridge') != 'no':
        return 'bridge'
    return 'ground'


class RailNet:
    """OSM の線路を、端点（ノード）でつながる線の集まりにする"""

    def __init__(self, elements):
        self.ways = []
        for e in elements:
            t = e.get('tags', {})
            if e.get('type') != 'way' or not e.get('geometry'):
                continue
            if t.get('railway') not in ('rail', 'subway', 'light_rail'):
                continue
            pts = [ll2local(p['lat'], p['lon']) for p in e['geometry']]
            self.ways.append({'id': e['id'], 'pts': pts, 'tags': t, 'kind': _kind(t),
                              'yard': t.get('service') in ('yard', 'siding', 'spur') or t.get('usage') in ('industrial',)})

    def near(self, p, tol=3.0):
        """点 p に端がある線（向きをそろえて p から出る形）"""
        out = []
        for w in self.ways:
            if math.dist(w['pts'][0], p) < tol:
                out.append((w, w['pts']))
            elif math.dist(w['pts'][-1], p) < tol:
                out.append((w, w['pts'][::-1]))
        return out

    def containing(self, p, tol=4.0):
        """点 p を通る線（橋の線の上に乗っている OSM の線）"""
        for w in self.ways:
            for a, b in zip(w['pts'], w['pts'][1:]):
                if _seg_dist(p, a, b) < tol:
                    return w
        return None

    def walk(self, start, heading, name, reach, used):
        """start から heading の向きへ、同じ名前の本線をたどって reach m の点列（[(x, z, kind)]）"""
        out, got, p, h = [], 0.0, start, heading
        while got < reach:
            best = None
            for w, pts in self.near(p):
                if w['id'] in used or w['yard']:
                    continue
                if name and w['tags'].get('name') not in (name, None):
                    continue
                d = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
                L = math.hypot(*d) or 1
                c = (d[0] * h[0] + d[1] * h[1]) / L
                if c < 0.8:  # 折り返し・分かれる線は取らない
                    continue
                if not best or c > best[0]:
                    best = (c, w, pts)
            if not best:
                break
            _, w, pts = best
            used.add(w['id'])
            for a, b in zip(pts, pts[1:]):
                seg = math.dist(a, b)
                out.append((b[0], b[1], w['kind']))
                got += seg
                if got >= reach:
                    break
            p = pts[-1]
            h = _unit(pts[-2], pts[-1])
        return out


def _unit(a, b):
    d = math.dist(a, b) or 1
    return ((b[0] - a[0]) / d, (b[1] - a[1]) / d)


def _seg_dist(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]
    L2 = ax * ax + az * az or 1
    t = max(0, min(1, ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / L2))
    return math.hypot(p[0] - a[0] - ax * t, p[1] - a[1] - az * t)


def rail_routes(bridges, elements, dem, train_ids, reach=2400, radius=2200, log=print):
    """
    鉄道橋（id が train_ids にあるもの）ごとの線路。返す形：
      {'id', 'name', 'path': [[x, z]...], 'y': [レールの面の高さ...], 'ground': [...],
       'decks': 場面の橋の形の上 [[s0, s1]...], 'hidden': トンネル, 'viaducts': 高架橋を作る所, 'ends': ['line'|'end', ...]}
    川をまたぐ本線（OSM）から両側へ本線だけをたどる（車両基地・側線・渡り線には入らない）。path は 8 m おき。
    場面の橋の形がある所はその橋の deckY、OSM で橋（高架橋）の所もその高さ、ほかは地面。
    """
    net = RailNet(elements)
    out, taken = [], set()
    decks = [(b, [tuple(p) for p in _resample([tuple(q) for q in b['path']], 4)]) for b in bridges if b['id'] in train_ids]
    for bi, b in enumerate(bridges):
        if b['id'] not in train_ids:
            continue
        P = [tuple(p) for p in b['path']]
        name = b.get('name')
        # 橋の線に乗っている本線のうち、水の上をいちばん長く通るもの
        best = None
        bx0, bx1 = min(p[0] for p in P) - 10, max(p[0] for p in P) + 10
        bz0, bz1 = min(p[1] for p in P) - 10, max(p[1] for p in P) + 10
        for w in net.ways:
            if not any(bx0 < x < bx1 and bz0 < z < bz1 for x, z in w['pts']):
                continue
            if w['yard'] or w['tags'].get('service') or w['tags'].get('name') not in (name, None):
                continue
            on = [p for p in _resample(w['pts'], 10) if min(_seg_dist(p, a, c) for a, c in zip(P, P[1:])) < 6]
            wet = sum(dem.is_water(*p) for p in on)
            if wet and (not best or wet > best[0]):
                best = (wet, w)
        if not best:
            log(f'rail {b["id"]}: 川をまたぐ本線が見つからない')
            continue
        w0 = best[1]
        if w0['id'] in taken:  # 同じ本線を別の橋の線からもう作った
            continue
        used = {w0['id']}
        pts0 = w0['pts']
        tail = net.walk(pts0[-1], _unit(pts0[-2], pts0[-1]), name, reach, used)
        head = net.walk(pts0[0], _unit(pts0[1], pts0[0]), name, reach, used)
        taken |= used
        pts = head[::-1] + [(x, z, w0['kind']) for x, z in pts0] + tail
        # 場面の外（原点から radius m より遠い所）は切る
        keep = [i for i, (x, z, _) in enumerate(pts) if math.hypot(x, z) < radius]
        if not keep:
            continue
        pts = pts[keep[0]:keep[-1] + 1]
        # 8 m おきに（種類は区間の終わりの点のものを使う）
        rs = [(pts[0][0], pts[0][1], pts[0][2])]
        for a, c in zip(pts, pts[1:]):
            d = math.dist(a[:2], c[:2])
            n = max(1, int(round(d / STEP)))
            rs += [(a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n, c[2]) for k in range(1, n + 1)]
        s = [0.0]
        for a, c in zip(rs, rs[1:]):
            s.append(s[-1] + math.dist(a[:2], c[:2]))
        ground = [tp2y(dem.height(x, z)) for x, z, _ in rs]
        # 地面：10 m ほどの範囲の高い方（DEM の細かいへこみ・道路の切り欠き）
        gsm = [max(ground[max(0, i - 1):i + 2]) for i in range(len(ground))]
        # 場面の橋の形の上にある点（その橋の deckY）
        cover = []
        for x, z, _ in rs:
            c = None
            for bb, dp in decks:
                if any(abs(px - x) < 5 and abs(pz - z) < 5 and math.hypot(px - x, pz - z) < 5 for px, pz in dp):
                    c = bb['deckY']
                    break
            cover.append(c)
        rs = [(x, z, 'deck' if c is not None else k) for (x, z, k), c in zip(rs, cover)]
        raw = []
        for (x, z, k), g, c in zip(rs, gsm, cover):
            if k == 'deck':
                raw.append(c)
            elif k == 'bridge':
                raw.append(b['deckY'])
            elif k == 'tunnel':
                raw.append(g - 6)
            else:
                raw.append(g + RAIL_UP)
        # 勾配をならす：上へは y(s) = max(raw(s'), - GRADE |s - s'|)（低い所は坂で埋め、トンネルは除く）
        y = raw[:]
        for i in range(1, len(y)):
            if rs[i][2] != 'tunnel':
                y[i] = max(y[i], y[i - 1] - GRADE * (s[i] - s[i - 1]))
        for i in range(len(y) - 2, -1, -1):
            if rs[i][2] != 'tunnel':
                y[i] = max(y[i], y[i + 1] - GRADE * (s[i + 1] - s[i]))

        def runs(flag):
            res, st = [], None
            for i, f in enumerate(flag):
                if f and st is None:
                    st = i
                if (not f or i == len(flag) - 1) and st is not None:
                    e = i if f else i - 1
                    if s[e] - s[st] > 1:
                        res.append([round(s[st], 1), round(s[e], 1)])
                    st = None
            return res
        hidden = runs([r[2] == 'tunnel' for r in rs])
        deck_runs = runs([r[2] == 'deck' for r in rs])
        via = runs([r[2] != 'deck' and r[2] != 'tunnel' and y[i] - ground[i] > VIADUCT_MIN for i, r in enumerate(rs)])
        out.append({'id': b['id'], 'name': name, 'path': [[round(x, 1), round(z, 1)] for x, z, _ in rs],
                    'y': [round(v, 2) for v in y], 'ground': [round(v, 2) for v in ground],
                    'decks': deck_runs, 'hidden': hidden, 'viaducts': via,
                    'ends': ['line' if head else 'end', 'line' if tail else 'end']})
        kinds = {}
        for a, c in zip(rs, rs[1:]):
            kinds[c[2]] = kinds.get(c[2], 0) + math.dist(a[:2], c[:2])
        log(f'rail {b["id"]}: {round(s[-1])} m  ' + ' '.join(f'{k} {round(v)}' for k, v in kinds.items())
            + f'  ends {out[-1]["ends"]}  viaducts {len(via)} ({round(sum(e - a for a, e in via))} m)  tunnels {len(hidden)}')
    return out
