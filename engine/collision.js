// 水平面（x, z）の当たり判定。プレイヤーは半径 r の円として扱う。
export const circleRect = (x, z, r, x0, z0, x1, z1) => {
  const qx = Math.max(x0, Math.min(x, x1)), qz = Math.max(z0, Math.min(z, z1));
  return (x - qx) ** 2 + (z - qz) ** 2 < r * r;
};

/**
 * 静的な四角形・円を格子に登録して高速に引けるようにした当たり判定。
 * 動くもの（通行人など）は addDynamic で毎回調べる関数を足す。
 */
export function createCollider({ cell = 2 } = {}) {
  const grid = new Map();
  const dynamics = [];
  let bounds = null;
  const key = (cx, cz) => `${cx},${cz}`;

  function insert(shape, x0, z0, x1, z1) {
    for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        const k = key(cx, cz);
        let list = grid.get(k);
        if (!list) grid.set(k, list = []);
        list.push(shape);
      }
    }
  }

  const hits = (s, x, z, r) => s.kind === 'rect'
    ? circleRect(x, z, r, s.x0, s.z0, s.x1, s.z1)
    : Math.hypot(x - s.x, z - s.z) < r + s.r;

  return {
    addRect(x0, z0, x1, z1, tag) { insert({ kind: 'rect', x0, z0, x1, z1, tag }, x0, z0, x1, z1); },
    addCircle(x, z, r, tag) { insert({ kind: 'circle', x, z, r, tag }, x - r, z - r, x + r, z + r); },
    addDynamic(fn) { dynamics.push(fn); },
    // この範囲の外へは出られない
    setBounds(x0, z0, x1, z1) { bounds = { x0, z0, x1, z1 }; },
    solidAt(x, z, r) {
      if (bounds && (x - r < bounds.x0 || x + r > bounds.x1 || z - r < bounds.z0 || z + r > bounds.z1)) return true;
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) {
        for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
          const list = grid.get(key(cx, cz));
          if (list) for (const s of list) if (hits(s, x, z, r)) return true;
        }
      }
      for (const fn of dynamics) if (fn(x, z, r)) return true;
      return false;
    }
  };
}

/**
 * 格子上の A* で、障害物を避けて from から to へ行く経路を探す。
 * 見通しのよい区間は間引いて、曲がり角だけの点列 [{x, z}, ...]（to を含む）を返す。見つからなければ null。
 */
export function findPath(collider, from, to, radius, { cell = 0.25, margin = 4, maxNodes = 12000 } = {}) {
  const free = (x, z) => !collider.solidAt(x, z, radius);
  const clear = (a, b) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let i = 1; i <= n; i++) if (!free(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false;
    return true;
  };
  if (clear(from, to)) return [{ x: to.x, z: to.z }];

  const x0 = Math.min(from.x, to.x) - margin, z0 = Math.min(from.z, to.z) - margin;
  const W = Math.ceil((Math.abs(from.x - to.x) + margin * 2) / cell), H = Math.ceil((Math.abs(from.z - to.z) + margin * 2) / cell);
  const idx = (i, j) => j * W + i;
  const cx = i => x0 + (i + 0.5) * cell, cz = j => z0 + (j + 0.5) * cell;
  const si = Math.floor((from.x - x0) / cell), sj = Math.floor((from.z - z0) / cell);
  const ti = Math.floor((to.x - x0) / cell), tj = Math.floor((to.z - z0) / cell);
  const g = new Float32Array(W * H).fill(Infinity), parent = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const blocked = new Int8Array(W * H).fill(-1); // -1 未計算 / 0 通れる / 1 通れない
  const isFree = (i, j) => { const k = idx(i, j); if (blocked[k] < 0) blocked[k] = free(cx(i), cz(j)) ? 0 : 1; return blocked[k] === 0; };
  const h = (i, j) => Math.hypot(i - ti, j - tj);
  const open = [[h(si, sj), si, sj]];
  g[idx(si, sj)] = 0;
  let found = false, nodes = 0;
  while (open.length && nodes++ < maxNodes) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, i, j] = open.splice(bi, 1)[0];
    const k = idx(i, j);
    if (closed[k]) continue;
    closed[k] = 1;
    if (i === ti && j === tj) { found = true; break; }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = idx(ni, nj);
      if (closed[nk] || !isFree(ni, nj)) continue;
      const ng = g[k] + (di && dj ? 1.414 : 1);
      if (ng < g[nk]) { g[nk] = ng; parent[nk] = k; open.push([ng + h(ni, nj), ni, nj]); }
    }
  }
  if (!found) return null;
  const pts = [];
  for (let k = idx(ti, tj); k !== -1 && k !== idx(si, sj); k = parent[k]) pts.unshift({ x: cx(k % W), z: cz(Math.floor(k / W)) });
  if (!pts.length) return [{ x: to.x, z: to.z }];
  pts[pts.length - 1] = { x: to.x, z: to.z };
  // 見通しのきく点は飛ばす
  const out = [];
  let cur = from;
  for (let a = 0; a < pts.length;) {
    let b = pts.length - 1;
    while (b > a && !clear(cur, pts[b])) b--;
    out.push(pts[b]);
    cur = pts[b];
    a = b + 1;
  }
  return out;
}
