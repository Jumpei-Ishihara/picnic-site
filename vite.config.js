import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function copyDirFiltered(src, dest, exclude) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (exclude && exclude(srcPath, entry)) continue;
    if (entry.isDirectory()) copyDirFiltered(srcPath, destPath, exclude);
    else fs.copyFileSync(srcPath, destPath);
  }
}

// Keep raw PNGs in scenes/* for tools/geo editing, but publish only WebP + JSON + attribution.
function picnicAssetsPlugin() {
  return {
    name: 'picnic-static-assets',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // When bundled by Vite (dev or build), let Vite resolve 'three' from package.json
        // instead of the CDN importmap kept for zero-build python http.server compatibility.
        if (ctx.server || ctx.bundle) {
          return html.replace(/<script\s+type=["']importmap["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
        }
        return html;
      }
    },
    closeBundle() {
      const dist = path.join(rootDir, 'dist');
      copyDirFiltered(
        path.join(rootDir, 'scenes'),
        path.join(dist, 'scenes'),
        (_p, entry) => !entry.isDirectory() && entry.name.endsWith('.png')
      );
      copyDirFiltered(path.join(rootDir, 'real', 'assets'), path.join(dist, 'real', 'assets'));
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [picnicAssetsPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(rootDir, 'index.html'),
        picnic: path.resolve(rootDir, 'picnic.html'),
        edogawa: path.resolve(rootDir, 'edogawa.html'),
        nagisa: path.resolve(rootDir, 'nagisa.html'),
        myoden: path.resolve(rootDir, 'myoden.html'),
        myodenFar: path.resolve(rootDir, 'myoden-far.html'),
        town3d: path.resolve(rootDir, 'town_3d.html'),
        realIndex: path.resolve(rootDir, 'real/index.html'),
        realEdogawa: path.resolve(rootDir, 'real/edogawa.html'),
        realNagisa: path.resolve(rootDir, 'real/nagisa.html'),
        realMyoden: path.resolve(rootDir, 'real/myoden.html')
      }
    }
  }
});
