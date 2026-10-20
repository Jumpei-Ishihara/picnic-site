"""写実版のページ（real/*.html）の頭に、読むファイルの予告（preload）を書き込む。

ブラウザは「ページ → app.js → その中の部品 → 場面データ → 素材」と、前のファイルを読んでから次を知る。
頭で予告しておくと、最初から同時に読み始めるので、回線が遅いほど待ち時間が減る。

  python3 tools/real/preload.py      # real/*.html の <!-- preload:start --> 〜 <!-- preload:end --> を書き換える

予告するもの：
  - JavaScript の部品（modulepreload）：ページの import から、部品の import をたどって全部（CDN の Three.js も）
  - 場面データ（fetch）：scene.json と、scene.json の files にある画像
  - 木の素材（image）：real/assets/trees/ の WebP
  - 地面の素材（fetch）：画質で大きさが変わるので、画質を決める小さなスクリプトで予告する（real/js/quality.js と同じ決め方）
部品の import を足したり、素材の名前を変えたりしたら、もう一度実行する。
"""
import json
import os
import re

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REAL = os.path.join(ROOT, 'real')
IMPORT_RE = re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]""")
LAYERS = ['grass', 'worn', 'gravel', 'asphalt', 'concrete']
SIZES = {'high': (1024, 1024), 'medium': (1024, 512), 'low': (512, 512)}


def importmap(html):
    m = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
    return json.loads(m.group(1))['imports'] if m else {}


def resolve(spec, base_url, imap):
    """import の書き方 → URL（ページからの相対の URL か CDN の URL）"""
    if spec in imap:
        return imap[spec]
    for k, v in imap.items():
        if k.endswith('/') and spec.startswith(k):
            return v + spec[len(k):]
    if spec.startswith('http'):
        return spec
    return os.path.normpath(os.path.join(os.path.dirname(base_url), spec))


def walk_modules(html_path, html, imap):
    """ページのモジュールのスクリプトから、ローカルの部品の import をたどる（CDN の部品の中まではたどらない）"""
    page_dir = os.path.dirname(html_path)
    found, todo = [], []
    for script in re.findall(r'<script type="module">(.*?)</script>', html, re.S):
        for a, b in IMPORT_RE.findall(script):
            todo.append(resolve(a or b, os.path.join(page_dir, 'x.html'), imap))
    while todo:
        u = todo.pop(0)
        if u in found:
            continue
        found.append(u)
        if u.startswith('http'):
            continue
        with open(u) as f:
            src = f.read()
        for a, b in IMPORT_RE.findall(src):
            todo.append(resolve(a or b, u, imap))
    return found


def rel(path, page_dir):
    return path if path.startswith('http') else os.path.relpath(path, page_dir).replace(os.sep, '/')


def build(html_path):
    with open(html_path) as f:
        html = f.read()
    if '<!-- preload:start' not in html:
        return False
    page_dir = os.path.dirname(html_path)
    imap = importmap(html)
    lines = []
    for u in walk_modules(html_path, html, imap):
        lines.append(f'<link rel="modulepreload" href="{rel(u, page_dir)}" />')
    # 場面データ
    m = re.search(r"base: '([^']+)'", html)
    if m:
        scene_dir = os.path.normpath(os.path.join(page_dir, m.group(1)))
        with open(os.path.join(scene_dir, 'scene.json')) as f:
            files = json.load(f)['files']
        names = ['scene.json']
        for part in files.values():
            for k in ('height', 'ground', 'groundColor'):
                if isinstance(part.get(k), str):
                    names.append(part[k])
            if isinstance(part.get('color'), dict):
                names.append(part['color']['file'])
        for n in dict.fromkeys(names):
            lines.append(f'<link rel="preload" as="fetch" crossorigin href="{rel(os.path.join(scene_dir, n), page_dir)}" />')
    # 木の素材（three の TextureLoader は crossOrigin="anonymous" の画像として読む）
    trees = os.path.join(REAL, 'assets', 'trees')
    for n in sorted(os.listdir(trees)):
        if n.endswith('.webp'):
            lines.append(f'<link rel="preload" as="image" crossorigin="anonymous" href="{rel(os.path.join(trees, n), page_dir)}" />')
    # 地面の素材：画質で大きさが変わる
    ground = rel(os.path.join(REAL, 'assets', 'ground'), page_dir) + '/'
    files_by_q = {q: [f'{l}_color_{c}.webp' for l in LAYERS] + [f'{l}_normal_{n}.webp' for l in LAYERS] + [f'{l}_rough_512.webp' for l in LAYERS] + ['means.json']
                  for q, (c, n) in SIZES.items()}
    lines.append('<script>')
    lines.append('  // 地面の素材の予告：画質の決め方は real/js/quality.js の getQuality と同じ')
    lines.append(f'  (() => {{ const F = {json.dumps(files_by_q, separators=(",", ":"))};')
    lines.append("    let q = null; try { q = new URLSearchParams(location.search).get('quality'); } catch { q = null; }")
    lines.append("    if (!F[q]) { try { q = localStorage.getItem('picnic-site:real-quality'); } catch { q = null; } }")
    lines.append("    if (!F[q]) q = matchMedia('(pointer: coarse)').matches ? 'low' : devicePixelRatio >= 2 ? 'high' : 'medium';")
    lines.append(f"    for (const f of F[q]) {{ const l = document.createElement('link'); l.rel = 'preload'; l.as = 'fetch'; l.crossOrigin = ''; l.href = '{ground}' + f; document.head.append(l); }}")
    lines.append('  })();')
    lines.append('</script>')
    block = '\n  '.join(['<!-- preload:start（tools/real/preload.py が書く。手で直さない） -->'] + lines + ['<!-- preload:end -->'])
    html2 = re.sub(r'<!-- preload:start.*?<!-- preload:end -->', lambda _: block, html, flags=re.S)
    with open(html_path, 'w') as f:
        f.write(html2)
    print(f'{os.path.relpath(html_path, ROOT)}: {len(lines)} 行')
    return True


if __name__ == '__main__':
    for n in sorted(os.listdir(REAL)):
        if n.endswith('.html'):
            build(os.path.join(REAL, n))
