// なぎさ公園から見える周りの目立つもの（scene.json の landmarks.specials。OSM と紹介記事の数値から）
//   シンデレラ城・プロメテウス火山（東京ディズニーリゾート）、葛西臨海水族園のガラスドーム、クリスタルビュー
//   1.4〜2.7 km 先なので形は簡略（色と輪郭が分かる程度）。ロゴや細かな意匠は描かない
//   東京ゲートブリッジ（6 km 先）は、遠景の影絵として backdrop に渡す（gateBridgeBackdrop）
import * as THREE from 'three';
import { GeoBuilder } from '../engine/structures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createSurroundings({ toon, specials }) {
  const group = new THREE.Group();
  const nightLights = [];
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };

  // ---- シンデレラ城：石の土台、白い壁の本体、中央の高い塔と青い円すいの屋根、四隅の小さな塔
  const C = specials.castle;
  if (C) {
    const wall = toon({ color: '#e8e4ee' }), stone = toon({ color: '#b8b2b4' }), roof = toon({ color: '#5a78c8' });
    const s = C.size, y0 = C.groundY, H = C.height;
    add(new THREE.BoxGeometry(s, H * 0.22, s), stone, C.x, y0 + H * 0.11, C.z);
    add(new THREE.BoxGeometry(s * 0.6, H * 0.28, s * 0.6), wall, C.x, y0 + H * 0.36, C.z);
    add(new THREE.CylinderGeometry(s * 0.12, s * 0.13, H * 0.24, 8), wall, C.x, y0 + H * 0.62, C.z);
    add(new THREE.ConeGeometry(s * 0.14, H * 0.26, 8), roof, C.x, y0 + H * 0.87, C.z);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = C.x + dx * s * 0.3, z = C.z + dz * s * 0.3;
      add(new THREE.CylinderGeometry(s * 0.06, s * 0.065, H * 0.38, 6), wall, x, y0 + H * 0.41, z);
      add(new THREE.ConeGeometry(s * 0.075, H * 0.16, 6), roof, x, y0 + H * 0.68, z);
    }
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = C.x + dx * s * 0.2, z = C.z + dz * s * 0.2;
      add(new THREE.ConeGeometry(s * 0.06, H * 0.14, 6), roof, x, y0 + H * 0.57, z);
    }
  }

  // ---- プロメテウス火山：裾の広い岩山（赤茶色）、上に火口
  const Vo = specials.volcano;
  if (Vo) {
    const rock = toon({ color: '#8a5444' }), dark = toon({ color: '#5a3a32' });
    add(new THREE.CylinderGeometry(Vo.base * 0.08, Vo.base / 2, Vo.height, 10, 3), rock, Vo.x, Vo.groundY + Vo.height / 2, Vo.z);
    add(new THREE.CylinderGeometry(Vo.base * 0.07, Vo.base * 0.1, Vo.height * 0.06, 10), dark, Vo.x, Vo.groundY + Vo.height * 0.98, Vo.z);
  }

  // ---- 葛西臨海水族園：低い本館（高さ 9.7 m）の上のガラスドーム（頂部 30.7 m）
  const A = specials.aquaDome;
  if (A) {
    const glass = toon({ color: '#a8c4d4', emissive: 0x9fd0ff, emissiveIntensity: 0 });
    glass.userData.lampMax = 0.9;
    nightLights.push(glass);
    const base = toon({ color: '#c8c4bc' });
    add(new THREE.CylinderGeometry(A.radius * 1.3, A.radius * 1.35, A.baseHeight, 16), base, A.x, A.groundY + A.baseHeight / 2, A.z);
    const dome = add(new THREE.SphereGeometry(A.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, A.x, A.groundY + A.baseHeight, A.z);
    dome.scale.y = (A.height - A.baseHeight) / A.radius;
    // ドームの骨組み（経線）：遠くでも分かるよう 1 ドットの線で
    const lines = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      for (let i = 0; i < 8; i++) {
        const t0 = i / 8 * Math.PI / 2, t1 = (i + 1) / 8 * Math.PI / 2;
        const P = t => [A.x + Math.cos(a) * Math.cos(t) * A.radius, A.groundY + A.baseHeight + Math.sin(t) * (A.height - A.baseHeight), A.z + Math.sin(a) * Math.cos(t) * A.radius];
        lines.push(...P(t0), ...P(t1));
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8a9aa6 })));
  }

  // ---- クリスタルビュー：ガラスの細長い建物
  const CV = specials.crystalView;
  if (CV) {
    const glass = toon({ color: '#b8ccd8', emissive: 0xffe8c0, emissiveIntensity: 0 });
    glass.userData.lampMax = 0.6;
    nightLights.push(glass);
    const shape = new THREE.Shape(CV.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: CV.height, bevelEnabled: false }).rotateX(-Math.PI / 2), glass);
    m.position.y = CV.groundY;
    group.add(m);
  }
  // ---- イトーヨーカドー（ポニーランドの北）：ベージュの箱に、立体駐車場の横の帯。西の端の屋上に看板（赤と青の地に白い鳩、下に赤い文字の帯）
  const IY = specials.itoYokado;
  if (IY) {
    const shape = new THREE.Shape(IY.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: IY.height, bevelEnabled: false }).rotateX(-Math.PI / 2), [toon({ color: '#d8d0bc' }), toon({ color: '#ffffff', map: bandTex() })]);
    body.position.y = IY.groundY - 0.5;
    body.receiveShadow = true;
    group.add(body);
    const S = IY.sign, top = IY.groundY + IY.height;
    add(new THREE.BoxGeometry(1.2, 6, 1.2), toon({ color: '#d0ccc0' }), S.x, top + 3, S.z);
    const face = toon({ color: '#ffffff', map: signTex() });
    const board = add(new THREE.BoxGeometry(S.w, S.h, 0.8), [face, face, toon({ color: '#e8e6e0' }), toon({ color: '#e8e6e0' }), face, face], S.x, top + 6 + S.h / 2, S.z);
    board.castShadow = true;
  }
  return { group, nightLights };
}

/**
 * 東京ゲートブリッジの影絵（backdrop の items に足す）。OSM の線の各点を方位・距離にし、
 * 中央の約 440 m はトラスの山形（頂部 88 m）、ほかは桁（約 55 m）から両端へ下る
 */
// 場面の座標 (x, z) の方位（度）。-z が upstreamBearing の方位
const bearing = (x, z, ub) => ((ub + Math.atan2(x, -z) * 180 / Math.PI) % 360 + 360) % 360;

export function gateBridgeBackdrop(gb, upstreamBearing = 0) {
  const pts = gb.path.map(([x, z]) => ({ x, z }));
  let L = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cum.push(L); }
  const prof = s => {
    const f = s / L;                                    // 0〜1
    const mid = Math.abs(s - L / 2);
    if (mid < gb.mainSpan / 2) return gb.deck + (gb.trussTop - gb.deck) * Math.sin((1 - mid / (gb.mainSpan / 2)) * Math.PI / 2) ** 0.7;
    return gb.deck * Math.min(1, Math.min(f, 1 - f) * 4); // 両端の取り付け部は下っていく
  };
  return {
    id: 'gate-bridge', kind: 'profile', note: '東京ゲートブリッジ',
    points: pts.map((p, i) => ({ bearing: bearing(p.x, p.z, upstreamBearing), dist: Math.hypot(p.x, p.z), height: prof(cum[i]), base: Math.max(0, prof(cum[i]) - 10) })),
    dist: Math.hypot(pts[pts.length >> 1].x, pts[pts.length >> 1].z),
    bearing: bearing(pts[pts.length >> 1].x, pts[pts.length >> 1].z, upstreamBearing)
  };
}

// 壁の横の帯（立体駐車場の開口と、ベージュの壁が 3 m ごとに交互）
function bandTex() {
  const c = document.createElement('canvas'); c.width = 2; c.height = 4;
  const x = c.getContext('2d');
  x.fillStyle = '#e4dccb'; x.fillRect(0, 0, 2, 4);
  x.fillStyle = '#5a5c60'; x.fillRect(0, 1, 2, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.05, 1 / 6);
  return t;
}
// 看板：左上が赤・右下が青の地に白い鳩、下に白地に赤い文字の帯（16 × 16 ドット）
function signTex() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#d8283a'; x.fillRect(0, 0, 16, 12);
  x.fillStyle = '#2a5ab8'; x.beginPath(); x.moveTo(16, 0); x.lineTo(16, 12); x.lineTo(4, 12); x.closePath(); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.moveTo(3, 4); x.lineTo(9, 7); x.lineTo(13, 3); x.lineTo(11, 8); x.lineTo(6, 10); x.closePath(); x.fill(); // 鳩
  x.fillRect(0, 12, 16, 4);
  x.fillStyle = '#d8283a'; for (let i = 1; i < 15; i += 2) x.fillRect(i, 13, 1, 2);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
  return t;
}
