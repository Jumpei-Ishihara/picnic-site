// ez-tree 1.1.0（MIT、https://github.com/dgreenheck/ez-tree）を写実版に取り込んだもの。
//   取り込んだのは木の形を作る部分（tree.js・branch.js・options.js・enums.js・rng.js・trellis.js）だけで、ほぼそのまま
//   （import の拡張子を足した）。書き換えたのは presets.js（Oak Medium だけ）と textures.js（オークの WebP を読む）
export { Tree } from './tree.js';
export { BarkType, Billboard, LeafType, TreeType } from './enums.js';
export { OAK_MEDIUM } from './presets.js';
export { ready as texturesReady } from './textures.js';
