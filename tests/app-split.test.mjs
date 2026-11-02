// js/app.js を分けたファイル（D18）の読む順番を守る。
// loadData()（認証とサーバーからの読み込みの開始）を呼ぶのは、最後に読む bootstrap だけにする。
// 共通部分や画面のファイルで呼ぶと、非同期の処理が先に終わったとき、まだ読んでいない画面の関数を呼んで描画に失敗しうる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appFiles = [...html.matchAll(/<script src="js\/(app-[\w-]+\.js)"/g)].map(m => m[1]);

test('js/app-*.js は、index.html に読む順で並んでいて、js/ にあるファイルと過不足がない', () => {
  const onDisk = readdirSync(new URL('../js/', import.meta.url)).filter(f => /^app-.*\.js$/.test(f)).sort();
  assert.deepEqual([...appFiles].sort(), onDisk);
  assert.equal(appFiles[0], 'app-core.js', '共通部分が先頭にありません');
  assert.equal(appFiles.at(-1), 'app-bootstrap.js', 'bootstrap が最後にありません');
});

test('loadData() を呼ぶのは bootstrap だけ（ほかのファイルは定義だけ）', () => {
  for (const f of appFiles) {
    const src = readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
    const callsAtTopLevel = /^loadData\(\)/m.test(src);
    assert.equal(callsAtTopLevel, f === 'app-bootstrap.js', `${f}: loadData() の呼び出しの場所が違います`);
  }
});
