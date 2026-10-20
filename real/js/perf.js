// 写実版の表示を軽くする仕組み
//   createResolutionScaler：fps（測れる端末は GPU の時間）を見て、描く解像度を 0.5〜1 倍の間で自動で上げ下げする
//   createShadowScheduler ：影を毎コマ描き直さず、太陽・影の範囲・視点が変わったときと数コマに 1 回だけ描き直す
import * as THREE from 'three';

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {number} o.baseRatio    画質の解像度の倍率（端末の画素密度を上限にした値）。これの 0.5〜1 倍で描く
 * @param {(w:number, h:number) => void} [o.onChange]  描く大きさが変わったとき（水面の映り込みの大きさを合わせる）
 * @param {boolean} [o.enabled]
 */
export function createResolutionScaler({ renderer, baseRatio, onChange = () => {}, enabled = true }) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const MIN = 0.5, DOWN = 18.5, GPU_UP = 11, WINDOW = 500;
  let scale = 1;
  // 画素がとても多い画面（ノートの画面いっぱいなど）は 0.75 倍から始める（最初の数秒が重くならないように）
  {
    const px = innerWidth * innerHeight * baseRatio * baseRatio;
    if (enabled && px > 3.5e6) scale = 0.75;
  }
  const frames = [], gpu = [];
  let lastGpu = null, lastFrame = null;
  let tWin = performance.now(), slow = 0, fast = 0, steady = 0, holdUntil = 0, trial = null, settle = 1;
  const pending = [];
  let active = null;

  function apply() {
    renderer.setPixelRatio(baseRatio * scale);
    renderer.setSize(innerWidth, innerHeight, false);
    onChange(renderer.domElement.width, renderer.domElement.height);
    settle = 1; // 変えた直後の 1 区切りは数えない
  }
  apply();

  // GPU の時間を測る（対応している端末だけ）。結果は数コマ遅れて届く
  function begin() {
    if (!ext || !enabled || active) return;
    active = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
  }
  function end() {
    if (!active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(active);
    active = null;
  }
  function poll() {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) gpu.push(ns / 1e6);
      gl.deleteQuery(q);
      pending.shift();
    }
  }

  return {
    begin, end,
    get scale() { return scale; },
    get gpuMs() { return lastGpu; },
    get frameMs() { return lastFrame; },
    get hasGpuTimer() { return !!ext; },
    /** 毎コマ：前のコマからの時間（ms） */
    update(dtMs) {
      if (!enabled) return;
      if (ext) poll();
      if (dtMs > 0 && dtMs < 250) frames.push(dtMs); // タブが裏にあった間などは除く
      const now = performance.now();
      if (now - tWin < WINDOW) return;
      tWin = now;
      const f = median(frames), g = gpu.length ? median(gpu) : null;
      frames.length = 0; gpu.length = 0;
      if (!f) return;
      lastFrame = f; if (g !== null) lastGpu = g;
      if (settle > 0) { settle--; return; }
      // 試しに上げたあと遅くなったら戻し、30 秒は上げない
      if (trial && f > DOWN) { scale = trial; trial = null; holdUntil = now + 30000; apply(); return; }
      if (trial) { trial = null; }
      slow = f > DOWN ? slow + 1 : 0;
      if (slow >= 2 && scale > MIN) { scale = Math.max(MIN, scale * 0.85); slow = 0; fast = steady = 0; apply(); return; }
      if (scale >= 1 || now < holdUntil) return;
      if (g !== null) {
        // GPU に余裕があるときだけ上げる
        fast = g < GPU_UP ? fast + 1 : 0;
        if (fast >= 6) { scale = Math.min(1, scale * 1.08); fast = 0; apply(); }
      } else {
        // GPU の時間を測れない端末：60 fps が 4 秒続いたら試しに上げる
        steady = f < 17.5 ? steady + 1 : 0;
        if (steady >= 8) { trial = scale; scale = Math.min(1, scale * 1.08); steady = 0; apply(); }
      }
    }
  };
}

/**
 * 影を描き直すのは：太陽の向きが変わった・影の範囲の中心が動いた・視点を移した（invalidate）・every コマに 1 回（葉の揺れ）
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} every
 */
export function createShadowScheduler(renderer, every = 4) {
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const lastDir = new THREE.Vector3(), lastCenter = new THREE.Vector3(1e9, 0, 1e9);
  let frame = 0, force = true;
  return {
    invalidate() { force = true; },
    /** 毎コマ、描く前に：太陽の向きと影の範囲の中心（4 m の格子に合わせたもの） */
    update(sunDir, center) {
      frame++;
      const moved = center.x !== lastCenter.x || center.z !== lastCenter.z;
      const turned = sunDir.distanceToSquared(lastDir) > 1e-8;
      if (force || moved || turned || frame % every === 0) {
        renderer.shadowMap.needsUpdate = true;
        lastDir.copy(sunDir); lastCenter.copy(center); force = false;
      }
    }
  };
}
