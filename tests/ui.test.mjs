// 画面の部品（js/ui.js）のテスト。実行: node --test "tests/*.test.mjs"
// 画面（document）を使う部品は、手元のブラウザで確かめる。ここでは文字のエスケープと、id で要素を取る関数（小さな偽の document で）
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

// ---------- id で要素を取る（D16）----------
// Node には画面がないので、document と要素の種類を小さく作って試す
const { inputById, selectById, textareaById, dialogById } = require('../js/ui.js');

function withFakeDom(elements, fn) {
  const saved = {};
  const types = { HTMLInputElement: class {}, HTMLSelectElement: class {}, HTMLTextAreaElement: class {}, HTMLDialogElement: class {} };
  const fake = { document: { getElementById: id => (elements(types)[id] ?? null) }, ...types };
  for (const k of Object.keys(fake)) { saved[k] = globalThis[k]; globalThis[k] = fake[k]; }
  try { fn(types); } finally { for (const k of Object.keys(fake)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } }
}

test('id で取った要素の種類が合っていれば、その要素を返す', () => {
  const made = {};
  withFakeDom(t => (made.input ??= new t.HTMLInputElement(), made.select ??= new t.HTMLSelectElement(),
    made.textarea ??= new t.HTMLTextAreaElement(), made.dialog ??= new t.HTMLDialogElement(),
    { a: made.input, b: made.select, c: made.textarea, d: made.dialog }), () => {
    assert.equal(inputById('a'), made.input);
    assert.equal(selectById('b'), made.select);
    assert.equal(textareaById('c'), made.textarea);
    assert.equal(dialogById('d'), made.dialog);
  });
});

test('要素がないときは、どの id かを書いて止める', () => {
  withFakeDom(() => ({}), () => {
    assert.throws(() => inputById('ldg-amount'), /入力欄（input）が見つかりません: #ldg-amount/);
  });
});

test('種類が違う要素のときも止める（select を inputById で取るなど）', () => {
  withFakeDom(t => ({ s: new t.HTMLSelectElement() }), () => {
    assert.throws(() => inputById('s'), /入力欄（input）が見つかりません: #s/);
  });
});
