// Vite の設定（D4 の手順2〜4）。src/ の .ts（ES モジュール）は Vite がまとめ、js/ のふつうの <script> と css/ はそのまま出す。
// - src/main.ts（入口）は assets/main.js の1つにまとめる。名前は固定で、sw.js の ASSETS に書く（D17。指紋を付けるのは手順6）
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
    // トップレベルの await（ES2022）を使えない対象にする。使うと、待っている間に js/ の <script> が先に動いてしまう（D17）
    target: 'es2021',
    modulePreload: false, // 出力は1つなので、先読みの <link> は要らない
    rolldownOptions: {
      onLog(level, log, handler) {
        // Vite は「対象では使えない」と警告するだけでビルドを続けるので、ここで止める
        if (/Top-level await/.test(log.message)) throw new Error(`src/ でトップレベルの await は使わない（D17）: ${log.message}`);
        handler(level, log);
      },
      output: {
        // 名前を固定する。ほかのファイルが出たら、公開の手順（scripts/build-pages.sh）が ASSETS にないことを見つけて止める
        entryFileNames: 'assets/main.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  // 手元で開く場所。祝日を読む Google のキーは 127.0.0.1:8765 だけを許しているので、それに合わせる
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  preview: { host: '127.0.0.1', port: 8765, strictPort: true },
  plugins: [copyStaticFiles()],
});
