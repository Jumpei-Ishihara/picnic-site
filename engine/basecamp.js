// 拠点（レジャーシートと持ち物）を好きな場所へ移す
//   root（シートの中心に置いた組）ごと動かす。地面の傾きに合わせて少し傾け、水の上・急な斜面・木や建物の上には敷かない。
//   移した場所は場面ごとにブラウザに覚える（使えないときは毎回もとの場所から）。
//   シートを基準にした視点（座る・寝ころぶ）は fromHome で「もとの場所での位置」を「いまの場所での位置」に読み替える。
import * as THREE from 'three';

/**
 * @param {object} o
 * @param {THREE.Object3D} o.root        シートの中心に置いた組（-z が座ったときの正面）
 * @param {{x:number, z:number, yaw:number}} o.home   もとの場所と向き
 * @param {{w:number, d:number}} o.size   シートの大きさ（m）
 * @param {(x:number, z:number) => number} o.heightAt
 * @param {(x:number, z:number) => boolean} [o.isWater]
 * @param {(x:number, z:number) => boolean} [o.isBlocked]   木・建物・柵など（シートの持ち物は除く）
 * @param {(x:number, z:number) => boolean} [o.inBounds]    歩ける範囲
 * @param {number} [o.maxSlope]   これより急な所には敷かない（1:5 = 0.2）
 * @param {string} [o.storageKey]
 * @param {(base:object) => void} [o.onMove]   動かしたあと（湯気・草・当たり判定などを合わせる）
 */
export function createBaseCamp({ root, home, size, heightAt, isWater = () => false, isBlocked = () => false, inBounds = () => true, maxSlope = 0.2, storageKey = null, onMove = null }) {
  const pose = { x: home.x, z: home.z, yaw: home.yaw };
  const hw = size.w / 2, hd = size.d / 2;
  // 組の中の点 (lx, lz) → 場面の (x, z)
  const toWorld = (lx, lz, p = pose) => [p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw)];
  const toLocal = (x, z, p = pose) => {
    const dx = x - p.x, dz = z - p.z;
    return [dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)];
  };

  // シートとまわり 0.3 m を調べる。だめなら理由を返す
  function check(p) {
    const m = 0.3;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const [x, z] = toWorld(-hw - m + (size.w + 2 * m) * i / 4, -hd - m + (size.d + 2 * m) * j / 4, p);
      if (!inBounds(x, z)) return 'ここから先には敷けないみたい';
      if (isWater(x, z)) return '水の上には敷けないよ';
      if (isBlocked(x, z)) return '木や建物にかかってしまうよ';
    }
    const { sx, sz } = slopes(p);
    if (Math.hypot(sx, sz) > maxSlope) return '坂が急すぎて、シートがすべりそう';
    return null;
  }
  // シートの幅・奥行きの向きの傾き
  function slopes(p) {
    const h = (lx, lz) => heightAt(...toWorld(lx, lz, p));
    const sx = (h(hw, -hd) + h(hw, hd) - h(-hw, -hd) - h(-hw, hd)) / (4 * hw);
    const sz = (h(-hw, hd) + h(hw, hd) - h(-hw, -hd) - h(hw, -hd)) / (4 * hd);
    return { sx, sz };
  }
  function apply() {
    const { sx, sz } = slopes(pose);
    // 高さ：四隅と中心の平均（傾けた面が地面にほどよく沿う）
    let y = 0;
    for (const [lx, lz] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) y += heightAt(...toWorld(lx, lz)) / 5;
    root.position.set(pose.x, y, pose.z);
    root.rotation.order = 'YXZ';
    root.rotation.set(-Math.atan(sz), pose.yaw, Math.atan(sx));
    root.updateMatrixWorld(true);
    onMove?.(api);
  }
  function save() {
    if (!storageKey) return;
    try {
      if (api.isHome) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(pose));
    } catch { /* 覚えられなくても動く */ }
  }

  const api = {
    pose, size, toWorld, toLocal,
    get isHome() { return Math.hypot(pose.x - home.x, pose.z - home.z) < 0.01 && Math.abs(pose.yaw - home.yaw) < 1e-4; },
    /** その場所と向きに敷く。敷けないときは { ok: false, reason } */
    moveTo(x, z, yaw, { force = false } = {}) {
      const p = { x, z, yaw };
      const reason = force ? null : check(p);
      if (reason) return { ok: false, reason };
      Object.assign(pose, p);
      apply();
      save();
      return { ok: true };
    },
    /** 立っている人の前に、その人の向いている方を正面にして敷く */
    placeInFront(px, pz, yaw, gap = 0.5) {
      const d = hd + gap;
      return api.moveTo(px - Math.sin(yaw) * d, pz - Math.cos(yaw) * d, yaw);
    },
    reset() { Object.assign(pose, home); apply(); save(); return { ok: true }; },
    /** もとの場所を基準にした位置・向き（視点）を、いまの場所に読み替える */
    fromHome(x, z, yaw) {
      const [lx, lz] = toLocal(x, z, home);
      const [wx, wz] = toWorld(lx, lz);
      return { x: wx, z: wz, yaw: yaw + (pose.yaw - home.yaw) };
    },
    /** シートの上（まわり pad m を含む）か */
    covers(x, z, pad = 0) {
      const [lx, lz] = toLocal(x, z);
      return Math.abs(lx) < hw + pad && Math.abs(lz) < hd + pad;
    },
    /** 保存してあれば、その場所に敷く（敷けなくなっていたら、もとの場所） */
    restore() {
      let saved = null;
      try { saved = storageKey && JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { saved = null; }
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) && Number.isFinite(saved.yaw) && api.moveTo(saved.x, saved.z, saved.yaw).ok) return true;
      apply();
      return false;
    }
  };
  return api;
}

/**
 * まとめ描きの草などで、シートの下に入ったものを隠す（もとの形は覚えておき、シートが離れたら戻す）
 * @param {THREE.InstancedMesh} mesh
 */
export function instanceHider(mesh) {
  const orig = [];
  const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); orig.push(m.clone()); }
  return {
    /** @param {(x:number, z:number) => boolean} hide */
    update(hide) {
      for (let i = 0; i < orig.length; i++) {
        const e = orig[i].elements;
        mesh.setMatrixAt(i, hide(e[12], e[14]) ? zero : orig[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
}

/**
 * 「ここに敷く」「もとの場所」のボタンと B キー
 * @param {object} o
 * @param {ReturnType<typeof createBaseCamp>} o.base
 * @param {{ show(msg:string):void }} o.toast
 * @param {() => {x:number, z:number, yaw:number}} o.player   立っている位置と向き
 * @param {() => boolean} [o.isEnabled]
 * @param {(how:'here'|'home') => void} [o.onPlaced]
 * @param {(id:string, fn:() => void) => void} o.bind   ボタンにつなぐ関数（engine/ui.js の bindButton）
 */
export function bindBaseCampUI({ base, toast, player, isEnabled = () => true, onPlaced = null, bind, hereId = 'b-here', homeId = 'b-home' }) {
  const homeBtn = document.getElementById(homeId);
  const sync = () => homeBtn?.classList.toggle('on', !base.isHome);
  function here() {
    if (!isEnabled()) return;
    const p = player();
    const r = base.placeInFront(p.x, p.z, p.yaw);
    if (!r.ok) { toast.show('🧺 ' + r.reason); return; }
    sync();
    toast.show('🧺 シートをここに敷きました');
    onPlaced?.('here');
  }
  function home() {
    if (!isEnabled()) return;
    base.reset();
    sync();
    toast.show('🧺 シートをもとの場所に戻しました');
    onPlaced?.('home');
  }
  bind(hereId, here);
  bind(homeId, home);
  addEventListener('keydown', e => { if (e.code === 'KeyB' && !e.repeat && !e.metaKey && !e.ctrlKey) here(); });
  sync();
  return { here, home, sync };
}
