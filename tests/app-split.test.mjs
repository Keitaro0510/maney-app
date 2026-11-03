// アプリは src/main.ts のモジュールだけから起動する（D20 の 10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('旧 js/ の app スクリプトを HTML が読まない', () => {
  assert.doesNotMatch(read('index.html'), /<script src="js\/app-/);
  assert.deepEqual(readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')), []);
});

test('画面とログインの準備後に bootstrap を起動する', () => {
  const main = read('src/main.ts');
  assert.match(main, /initSync\(/);
  assert.match(main, /initAuth\(/);
  assert.ok(main.indexOf('initAuth(') < main.lastIndexOf('startBootstrap()'));
  assert.match(read('src/bootstrap.ts'), /void loadData\(\)/);
});
