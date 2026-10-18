// 一人称の歩行操作：キーボード・ドラッグ見回し・スマホのスティック・タップした場所へ歩く・おまかせ散策
import * as THREE from 'three';
import { findPath } from './collision.js';

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {THREE.PerspectiveCamera} o.camera   rotation.order は 'YXZ' にしておく
 * @param {THREE.Scene} o.scene                タップ先の目印を置く
 * @param {{ solidAt(x:number, z:number, r:number): boolean }} o.collider
 * @param {{ x:number, z:number, yaw?:number, pitch?:number }} o.start
 * @param {THREE.Curve<THREE.Vector3>} [o.route]  おまかせ散策で歩く閉じた曲線
 * @param {THREE.Object3D[]} [o.tapTargets]    タップで歩き先を探す対象（地面・建物など）
 * @param {(hit: THREE.Intersection) => object|null} [o.resolveTap]  当たった物から歩き先 {x, z, ...} を決める。null なら歩かない
 * @param {(target: object) => void} [o.onArrive]   歩き先に着いた
 * @param {() => void} [o.onStuck]                  障害物で進めなくなった
 * @param {(x:number, z:number) => void} [o.onStep] 一歩ごと（足音用）
 * @param {() => void} [o.onPointerDown]            最初の操作で音を有効にするなど
 * @param {() => void} [o.onStateChange]            モード・一時停止が変わった
 * @param {() => boolean} [o.isInputEnabled]        false の間は操作を受け付けない（タイトル画面・パネル表示中）
 * @param {() => boolean} [o.isFrozen]              true の間は自動の移動も止める（パネル表示中）
 * @param {(x:number, z:number) => number} [o.heightAt]  足元の地面の高さ（起伏・橋）。既定は平らな y = 0
 */
export function createPlayerController(o) {
  const {
    canvas, camera, scene, collider, start,
    eye = 1.6, radius = 0.3, walkSpeed = 3.0, runSpeed = 5.2, strollSpeed = 1.35,
    route = null, tapTargets = [], maxTapDistance = 45,
    joyEl = null, joyKnobEl = null, joyRadius = 50,
    isTouch = matchMedia('(pointer: coarse)').matches,
    resolveTap = hit => ({ x: hit.point.x, z: hit.point.z }),
    onArrive = () => {}, onStuck = () => {}, onStep = () => {}, onPointerDown = () => {}, onStateChange = () => {},
    isInputEnabled = () => true, isFrozen = () => false,
    heightAt = () => 0
  } = o;

  const player = { x: start.x, z: start.z, yaw: start.yaw ?? 0, pitch: start.pitch ?? 0, bob: 0, bobBlend: 0, lastStep: 0 };
  const keys = {};
  const routeLen = route ? route.getLength() : 0;
  let mode = 'walk';
  let strollU = 0, strollPaused = false, strollLookYaw = 0, strollLookPitch = 0, lookIdle = 0, strollYaw = null;
  const joy = { id: null, x0: 0, y0: 0, dx: 0, dy: 0, moved: false, t0: 0 };
  let lookPointer = null, lastLX = 0, lastLY = 0, tapStart = null;
  let autoWalk = null; // { x, z, stuckT, ...resolveTap が返した情報 }
  let elapsed = 0;
  let eyeNow = eye, eyeTarget = eye; // 目の高さ（座る・立つでなめらかに変わる）
  const tmpV = new THREE.Vector3(), tanV = new THREE.Vector3();

  // タップした歩き先の目印
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.38, 8), new THREE.MeshBasicMaterial({ color: 0xf6c95b, fog: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);

  function look(dx, dy) {
    if (mode === 'stroll') {
      strollLookYaw -= dx * 0.005;
      strollLookPitch = Math.max(-0.9, Math.min(0.9, strollLookPitch - dy * 0.005));
      lookIdle = 0;
    } else {
      player.yaw -= dx * 0.005;
      player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - dy * 0.005));
    }
  }

  // ---- ポインター（マウス・タッチ）----
  const capture = id => { try { canvas.setPointerCapture(id); } catch (err) { /* 合成イベントなど */ } };
  canvas.addEventListener('pointerdown', e => {
    if (!isInputEnabled()) return;
    onPointerDown();
    // スマホ：画面左半分はスティック（触れた位置が中心になる）
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.5 && mode === 'walk' && joy.id === null) {
      Object.assign(joy, { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, t0: performance.now() });
      if (joyEl) {
        joyEl.style.left = `${e.clientX - 60}px`;
        joyEl.style.top = `${e.clientY - 60}px`;
        joyEl.classList.add('active');
      }
      capture(e.pointerId);
      return;
    }
    lookPointer = e.pointerId; lastLX = e.clientX; lastLY = e.clientY;
    tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    capture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.x0, dy = e.clientY - joy.y0;
      const len = Math.hypot(dx, dy);
      if (len > 8) joy.moved = true;
      if (len > joyRadius) { dx *= joyRadius / len; dy *= joyRadius / len; }
      joy.dx = dx; joy.dy = dy;
      if (joyKnobEl) joyKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      if (joy.moved) autoWalk = null;
      return;
    }
    if (tapStart && e.pointerId === tapStart.id && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 8) tapStart.moved = true;
    if (e.pointerId !== lookPointer) return;
    look(e.clientX - lastLX, e.clientY - lastLY);
    lastLX = e.clientX; lastLY = e.clientY;
  });
  const resetJoy = () => {
    joy.id = null; joy.dx = joy.dy = 0;
    if (joyKnobEl) joyKnobEl.style.transform = '';
    if (joyEl) { joyEl.classList.remove('active'); joyEl.style.left = joyEl.style.top = ''; }
  };
  const endPointer = e => {
    const isTap = (t0, moved) => !moved && performance.now() - t0 < 350 && e.type === 'pointerup';
    if (e.pointerId === joy.id) {
      if (isTap(joy.t0, joy.moved)) tapAt(e.clientX, e.clientY);
      resetJoy();
    }
    if (e.pointerId === lookPointer) lookPointer = null;
    if (tapStart && e.pointerId === tapStart.id) {
      if (isTap(tapStart.t, tapStart.moved)) tapAt(e.clientX, e.clientY);
      tapStart = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (mode === 'stroll' && route) strollU = (strollU + e.deltaY * 0.004 / routeLen + 1) % 1;
  }, { passive: false });

  // ---- タップ（クリック）した場所へ歩く ----
  const raycaster = new THREE.Raycaster();
  function tapAt(clientX, clientY) {
    if (mode !== 'walk' || isFrozen()) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(tapTargets, true)[0];
    if (!hit || hit.distance > maxTapDistance) return;
    const target = resolveTap(hit);
    if (target) walkTo(target);
  }
  function walkTo(target) {
    // 障害物を避ける経路（見つからなければまっすぐ向かい、ぶつかったら止まる）
    const path = collider.solidAt(target.x, target.z, radius) ? null : findPath(collider, player, target, radius);
    autoWalk = { ...target, path: path || [{ x: target.x, z: target.z }], stuckT: 0 };
    marker.position.set(target.x, heightAt(target.x, target.z) + 0.06, target.z);
    marker.visible = true;
  }

  // ---- キーボード（移動キーのみ。E や Esc は場面側で扱う）----
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', e => {
    if (e.repeat && keys[e.code]) return;
    keys[e.code] = true;
    if (!isInputEnabled()) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (MOVE_KEYS.includes(e.code) && mode === 'stroll') setMode('walk');
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function setMode(m) {
    if (m === 'stroll' && !route) return;
    if (m === 'walk' && mode === 'stroll') {
      player.yaw = (strollYaw ?? player.yaw) + strollLookYaw;
      player.pitch = strollLookPitch * 0.5;
    }
    if (m === 'stroll') {
      // 現在地に一番近いルート上の点から歩き始める
      let best = 0, bd = Infinity;
      for (let i = 0; i < 400; i++) {
        const p = route.getPointAt(i / 400);
        const dd = (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
        if (dd < bd) { bd = dd; best = i / 400; }
      }
      strollU = best; strollLookYaw = 0; strollLookPitch = 0; strollPaused = false; strollYaw = null;
    }
    mode = m;
    autoWalk = null;
    marker.visible = false;
    if (joyEl) joyEl.classList.toggle('hidden', !(isTouch && m === 'walk' && isInputEnabled()));
    onStateChange();
  }

  function togglePause() { strollPaused = !strollPaused; onStateChange(); }

  // 壁に沿って滑るように、x と z を別々に試す。めり込んでいるときは脱出を許す。
  function tryMove(mx, mz) {
    const stuck = collider.solidAt(player.x, player.z, radius);
    const ox = player.x, oz = player.z;
    if (stuck || !collider.solidAt(player.x + mx, player.z, radius)) player.x += mx;
    if (stuck || !collider.solidAt(player.x, player.z + mz, radius)) player.z += mz;
    return Math.hypot(player.x - ox, player.z - oz);
  }

  // 毎フレーム：移動・視点・歩行の揺れ。カメラの向き（yaw）を返す。
  function update(dt) {
    elapsed += dt;
    let moved = 0;
    if (mode === 'walk') {
      let ix = 0, iz = 0;
      if (isInputEnabled()) {
        if (keys.KeyW || keys.ArrowUp) iz -= 1;
        if (keys.KeyS || keys.ArrowDown) iz += 1;
        if (keys.KeyA || keys.ArrowLeft) ix -= 1;
        if (keys.KeyD || keys.ArrowRight) ix += 1;
        if (joy.id !== null) { ix += joy.dx / joyRadius; iz += joy.dy / joyRadius; }
      }
      const len = Math.hypot(ix, iz);
      if (len > 0.08) {
        autoWalk = null;
        // Shift か、スティックを端まで倒すと走る
        const running = keys.ShiftLeft || keys.ShiftRight || (joy.id !== null && len > 0.92);
        const speed = (running ? runSpeed : walkSpeed) * Math.min(1, len) * dt;
        ix /= len; iz /= len;
        const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
        moved = tryMove((ix * cy + iz * sy) * speed, (-ix * sy + iz * cy) * speed);
      } else if (autoWalk && !isFrozen()) {
        // いまの目標＝経路の次の曲がり角
        while (autoWalk.path.length > 1 && Math.hypot(autoWalk.path[0].x - player.x, autoWalk.path[0].z - player.z) < 0.3) autoWalk.path.shift();
        const wp = autoWalk.path[0];
        const dx = wp.x - player.x, dz = wp.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3 && autoWalk.path.length === 1) {
          const a = autoWalk;
          autoWalk = null;
          onArrive(a);
        } else {
          const step = Math.min(dist, walkSpeed * dt);
          const ox = player.x, oz = player.z;
          moved = tryMove(dx / dist * step, dz / dist * step);
          // ぶつかったら少し左右へよけて回り込む（よける向きは一度決めたら保つ）
          if (moved < step * 0.3) {
            const side = autoWalk.side || 1;
            for (const a of [0.7 * side, 1.3 * side, -0.7 * side, -1.3 * side]) {
              player.x = ox; player.z = oz;
              const c = Math.cos(a), s = Math.sin(a);
              const m = tryMove((dx * c - dz * s) / dist * step, (dx * s + dz * c) / dist * step);
              if (m > step * 0.5) { moved = m; autoWalk.side = Math.sign(a); break; }
              player.x = ox; player.z = oz;
            }
          }
          // 進行方向へ視線をゆっくり向ける（見回し中は任せる）
          if (lookPointer === null) {
            let dy = Math.atan2(-dx, -dz) - player.yaw;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            player.yaw += dy * Math.min(1, dt * 4);
          }
          autoWalk.stuckT = moved < step * 0.3 ? autoWalk.stuckT + dt : 0;
          if (autoWalk.stuckT > 0.5) { autoWalk = null; onStuck(); }
        }
      }
      if (!autoWalk) marker.visible = false;
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else {
      if (!strollPaused && !isFrozen()) strollU = (strollU + strollSpeed * dt / routeLen) % 1;
      const p = route.getPointAt(strollU, tmpV);
      moved = Math.hypot(p.x - player.x, p.z - player.z);
      if (moved > 1) moved = 0;
      player.x = p.x; player.z = p.z;
      route.getTangentAt(strollU, tanV);
      const targetYaw = Math.atan2(-tanV.x, -tanV.z);
      if (strollYaw === null) strollYaw = targetYaw;
      let dy = targetYaw - strollYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      strollYaw += dy * Math.min(1, dt * 2.5);
      lookIdle += dt;
      if (lookIdle > 2.5) {
        strollLookYaw *= Math.max(0, 1 - dt * 1.5);
        strollLookPitch *= Math.max(0, 1 - dt * 1.5);
      }
      const sway = Math.sin(elapsed * 0.25) * 0.12;
      camera.rotation.set(-0.02 + strollLookPitch, strollYaw + strollLookYaw + sway, 0);
    }

    // 歩行の上下揺れと足音
    if (moved > 0.0005) {
      player.bob += moved * 2.3;
      player.bobBlend = Math.min(1, player.bobBlend + dt * 6);
      const s = Math.floor(player.bob / Math.PI);
      if (s !== player.lastStep) { player.lastStep = s; onStep(player.x, player.z); }
    } else {
      player.bobBlend = Math.max(0, player.bobBlend - dt * 5);
    }
    const bobY = Math.abs(Math.sin(player.bob)) * 0.055 * player.bobBlend;
    const bobX = Math.cos(player.bob) * 0.025 * player.bobBlend;
    const yaw = camera.rotation.y;
    eyeNow += (eyeTarget - eyeNow) * Math.min(1, dt * 8);
    camera.position.set(player.x + Math.cos(yaw) * bobX, heightAt(player.x, player.z) + eyeNow + bobY - 0.03 * player.bobBlend, player.z - Math.sin(yaw) * bobX);
    return yaw;
  }

  return {
    player, keys, update, setMode, togglePause, walkTo, marker,
    // 目の高さを変える（座る・立つ）。instant なら補間せずに即座に
    setEye(h, instant = false) { eyeTarget = h; if (instant) eyeNow = h; },
    // 目の高さの補間と歩行の揺れを止めて、カメラを静止させる（ループ動画の録画前に）
    settle() { eyeNow = eyeTarget; player.bobBlend = 0; },
    get eye() { return eyeTarget; },
    get mode() { return mode; },
    get paused() { return strollPaused; },
    get walking() { return !!autoWalk; },
    cancelWalk() { autoWalk = null; marker.visible = false; }
  };
}
