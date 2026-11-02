// 画面を比べる道具（D20 の 0）。画面を src/ に移す PR が、表示を変えていないことを確かめる。
//   npm run test:screens                   # 比べる（ローカルの Supabase を立ててから）
//   npm run test:screens -- --update-snapshots   # 基準の写しを作り直す（差分は PR で見る）
// - ローカルの Supabase・固定した時刻（2026-11-12 10:00）・固定した架空のデータ（tests/screens/seed.sql）で開く
// - 公開と同じ形のビルド（MANEY_TARGET=local）を、手元の開発用（8765）とは別の場所（8775）で配る
// - 比べるもの: 画面ごとの DOM の写し（__snapshots__/*.html。OS によらない）と、画面の写真（__screenshots__/*-<OS>.png。文字の描き方が OS で違うので OS ごと）
// - 祝日の取得は固定の答えにし、Service Worker は止める
import { defineConfig } from '@playwright/test';

const PORT = 8775;

export default defineConfig({
  testDir: 'tests/screens',
  testMatch: '*.spec.mjs',
  globalSetup: './tests/screens/global-setup.mjs',
  outputDir: 'test-results/screens',
  workers: 1, // 同じテスト用のユーザーを使う
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  // 基準がないときに CI で黙って作らない（作るのは手元で。CI では失敗にする）
  updateSnapshots: 'missing', // 一時的: CI で Linux の基準を作る
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      pathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    serviceWorkers: 'block',
  },
  webServer: {
    command: `bash scripts/build-pages.sh _site_screens && npx vite preview --outDir _site_screens --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
  },
});
