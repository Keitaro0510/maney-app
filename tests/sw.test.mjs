// Service Worker（sw.js）と公開の決まり（D15）のテスト。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
// ASSETS の中の手元のファイル（'./〜'）
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);

test('CACHE_NAME は、リポジトリでは money-app-dev のまま（公開するときに中身の指紋に置き換える）', () => {
  assert.match(sw, /const CACHE_NAME = 'money-app-dev';/);
  assert.equal(sw.split("'money-app-dev'").length - 1, 1, "'money-app-dev' は1か所だけ（2か所あると両方置き換わる）");
});

test('ASSETS にある手元のファイルは、すべてある', () => {
  for (const f of assets) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} がありません`);
});

test('index.html が読む js/ のファイルと manifest.json は、すべて ASSETS にある（足し忘れると、通信できないときに開けない）', () => {
  const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  for (const f of [...scripts, 'manifest.json', 'index.html']) assert.ok(assets.includes(f), `${f} が sw.js の ASSETS にありません`);
});
