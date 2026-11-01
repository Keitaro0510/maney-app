// Vite の設定（D4 の手順2・3）。今はまだ、アプリの JavaScript は js/ のふつうの <script>、見た目は css/ のふつうの CSS のまま動かす。
// - index.html の js/・css/・manifest・アイコンには vite-ignore を付け、Vite に触らせない。ビルドのあとで、そのまま出力にコピーする
// - CSS・JavaScript を縮めない（出力の index.html を、元とほぼ同じにする。モジュールに移したら見直す）
// - 公開するときは scripts/build-pages.sh がこのビルドを使い、sw.js の CACHE_NAME を中身の指紋にする（D15）
import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

// まだ Vite を通さないファイル（そのまま公開する）
const STATIC_FILES = ['js', 'css', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

function copyStaticFiles() {
  let outDir;
  return {
    name: 'copy-static-files',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      for (const f of STATIC_FILES) cpSync(f, resolve(outDir, f), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './', // GitHub Pages の /maney-app/ の下でも動くように、相対のパスにする
  appType: 'mpa', // 知らない場所には index.html ではなく 404 を返す（GitHub Pages と同じ）
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    cssMinify: false,
  },
  // 手元で開く場所。祝日を読む Google のキーは 127.0.0.1:8765 だけを許しているので、それに合わせる
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  preview: { host: '127.0.0.1', port: 8765, strictPort: true },
  plugins: [copyStaticFiles()],
});
