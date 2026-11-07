// Vite の設定（D4 の手順2〜6）。src/ の .ts（ES モジュール）は Vite がまとめ、css/ はそのまま出す。
// - src/main.ts（入口）と分割したモジュールには指紋付きの名前を付ける。公開する一覧はビルド後に作る（D4 の手順6）
// - index.html の css/・manifest・アイコンには vite-ignore を付け、Vite に触らせない。ビルドのあとで、そのまま出力にコピーする
// - React（D27）: @vitejs/plugin-react で .tsx を変換する。新しい画面から使い、既存の画面は触らない
// - CSS・JavaScript を縮めない（画面比較の差分を追いやすくする）
// - 公開するときは scripts/build-pages.sh がこのビルドを使い、sw.js の CACHE_NAME を中身の指紋にする（D15）
// - 接続先（D19）: 環境変数 MANEY_TARGET が prod（本番）か local（ローカルの Supabase）。ビルドは、指定しないと止める（つなぎ間違えて公開しないように）。
//   npm run dev は、指定しなければ今までどおり本番につなぐ。local のときは MANEY_LOCAL_API_URL・MANEY_LOCAL_PUBLISHABLE_KEY が要る（scripts/local-supabase.mjs が入れる）
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

// 本番の Supabase。sb_publishable_… はブラウザ用の公開キーで、秘密ではない（D19）
const PROD_SUPA = { url: 'https://sgvyjolyfuqchugltvls.supabase.co', key: 'sb_publishable_xQszLlsL0IVxrnxsHK0ZtA_AHqsaDMu' };

// 接続先を決める。ビルドで指定がない・知らない値・ローカルの値が足りないときは止める
function supaTarget(command) {
  const target = process.env.MANEY_TARGET || (command === 'serve' ? 'prod' : '');
  if (target === 'prod') return { target, ...PROD_SUPA };
  if (target === 'local') {
    const url = process.env.MANEY_LOCAL_API_URL, key = process.env.MANEY_LOCAL_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('MANEY_TARGET=local には MANEY_LOCAL_API_URL と MANEY_LOCAL_PUBLISHABLE_KEY が要る（node scripts/local-supabase.mjs から動かす。D19）');
    return { target, url, key };
  }
  throw new Error(`接続先を MANEY_TARGET=prod か MANEY_TARGET=local で指定する（今は「${target}」。D19）`);
}

// まだ Vite を通さないファイル（そのまま公開する）
const STATIC_FILES = ['css', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

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

export default defineConfig(({ command }) => {
  const supa = supaTarget(command);
  return {
  // src/env.ts の __MANEY_*__ を置き換える（D19）
  define: {
    __MANEY_TARGET__: JSON.stringify(supa.target),
    __MANEY_SUPA_URL__: JSON.stringify(supa.url),
    __MANEY_SUPA_KEY__: JSON.stringify(supa.key),
  },
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
    modulePreload: false, // Service Worker がビルドした全ファイルを先読みする
    rolldownOptions: {
      onLog(level, log, handler) {
        // Vite は「対象では使えない」と警告するだけでビルドを続けるので、ここで止める
        if (/Top-level await/.test(log.message)) throw new Error(`src/ でトップレベルの await は使わない（D17）: ${log.message}`);
        handler(level, log);
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // 手元で開く場所。祝日を読む Google のキーは 127.0.0.1:8765 だけを許しているので、それに合わせる
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  preview: { host: '127.0.0.1', port: 8765, strictPort: true },
  plugins: [react(), copyStaticFiles()],
  };
});
