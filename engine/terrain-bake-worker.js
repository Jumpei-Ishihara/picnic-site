// ドット絵版の近景の地面の模様を焼く Web Worker（engine/terrain.js から使う）。計算は engine/terrain-bake.js
import { bakeGroundPixels } from './terrain-bake.js';

self.onmessage = e => {
  const r = bakeGroundPixels(e.data);
  self.postMessage(r, [r.data.buffer]);
};
