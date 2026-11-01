// Service Worker（sw.js）と公開の決まり（D15・D17）のテスト。実行: node --test "tests/*.test.mjs"
// ここではリポジトリにあるファイル（ソース）を確かめる。ビルドで作るもの（assets/）が ASSETS とそろっているかは、
// 公開の手順（scripts/build-pages.sh）がビルドしたあとで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
// ASSETS の中の手元のファイル（'./〜'）。assets/ はビルドで作るもの、ほかはリポジトリにあるもの
const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
const built = assets.filter(f => f.startsWith('assets/'));
const source = assets.filter(f => !f.startsWith('assets/'));

test('CACHE_NAME は、リポジトリでは money-app-dev のまま（公開するときに中身の指紋に置き換える）', () => {
  assert.match(sw, /const CACHE_NAME = 'money-app-dev';/);
  assert.equal(sw.split("'money-app-dev'").length - 1, 1, "'money-app-dev' は1か所だけ（2か所あると両方置き換わる）");
});

test('ASSETS にあるリポジトリのファイル（assets/ 以外）は、すべてある', () => {
  for (const f of source) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} がありません`);
});

test('ASSETS のビルドで作るものは assets/main.js だけ（名前は vite.config.mjs で固定している。D17）', () => {
  assert.deepEqual(built, ['assets/main.js']);
  assert.match(read('vite.config.mjs'), /entryFileNames: 'assets\/main\.js'/);
});

test('index.html が読む js/・css/ のファイルと manifest.json は、すべて ASSETS にある（足し忘れると、通信できないときに開けない）', () => {
  const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
  const styles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  assert.ok(styles.length > 0);
  for (const f of [...scripts, ...styles, 'manifest.json', 'index.html']) assert.ok(assets.includes(f), `${f} が sw.js の ASSETS にありません`);
});

// js/ は window.MoneyCalc などを使うので、src/main.ts（モジュール）が先に動かないといけない（D17）。
// モジュールはいつも HTML を読み終えてから動くので、js/ にも defer を付けて同じ列に並べる。
// <head> に置くと、ビルドしたときに Vite がモジュールを <head> の最後に動かし、js/ のほうが先になってしまう
test('モジュールの入口は1つ（src/main.ts）で、ファイルがある', () => {
  const modules = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(modules, ['src/main.ts']);
  assert.ok(existsSync(new URL('../src/main.ts', import.meta.url)));
});

test('js/ の <script> は、すべて defer を付けて <body> に置く（モジュールのあとに動くように）', () => {
  const bodyAt = html.indexOf('<body');
  const tags = [...html.matchAll(/<script src="js\/[^"]+"[^>]*>/g)];
  assert.ok(tags.length > 0);
  for (const m of tags) {
    assert.match(m[0], /\sdefer[\s>]/, `${m[0]} に defer がありません`);
    assert.ok(m.index > bodyAt, `${m[0]} が <body> の中にありません`);
  }
  assert.ok(html.indexOf('<script type="module"') < tags[0].index, 'モジュールの入口が js/ より後にあります');
});
