// 写実版の地形の形を作る Web Worker（real/js/terrain.js から使う）。計算は real/js/terrain-core.js
import { buildTerrainMeshes, transferables } from './terrain-core.js';

self.onmessage = e => {
  const r = buildTerrainMeshes(e.data);
  self.postMessage(r, transferables(r));
};
