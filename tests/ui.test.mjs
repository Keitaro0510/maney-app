// 画面の部品（js/ui.js）のテスト。実行: node --test "tests/*.test.mjs"
// 画面（document）を使う部品は、手元のブラウザで確かめる。ここでは文字のエスケープだけ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { escapeHtml } = require('../js/ui.js');

test('HTML で意味を持つ文字を、そのまま表示される形にする', () => {
  assert.equal(escapeHtml('<b>レポート</b> & "課題" \'2\''), '&lt;b&gt;レポート&lt;/b&gt; &amp; &quot;課題&quot; &#39;2&#39;');
});

test('ボタンの onclick に入れても、文字が外に出ない', () => {
  const name = "');alert(1);('";
  assert.equal(escapeHtml(name).includes("'"), false);
});

test('空・null・数値も文字にする', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(1200), '1200');
});

test('すでにエスケープした文字も、もう一度エスケープする（表示は元の文字のまま）', () => {
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
});
