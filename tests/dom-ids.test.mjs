// js/ の MoneyUI.inputById('id') などが指す要素が、HTML の中で本当にその種類か（D16）。実行: node --test "tests/*.test.mjs"
// 取り出す関数は種類が違うと止めるので、取り違えると、その画面がまるごと動かなくなる。それを公開する前に見つける
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const jsFiles = readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `js/${f}`);
// HTML は index.html と、js/ の中で文字として組み立てているもの
const html = [read('index.html'), ...jsFiles.map(read)].join('\n');
const TAG = { inputById: 'input', selectById: 'select', textareaById: 'textarea', dialogById: 'dialog' };

// id ごとの要素の種類（<tag ... id="x">）
const tagsOf = id => new Set([...html.matchAll(/<(\w+)\b[^<>]*?\bid=["']([^"'$]+)["']/g)].filter(m => m[2] === id).map(m => m[1].toLowerCase()));

// js/ で、id を文字そのままで渡している所。`${prefix}-close` のように組み立てる id は、ここでは確かめられない
const calls = jsFiles.flatMap(f => [...read(f).matchAll(/MoneyUI\.(inputById|selectById|textareaById|dialogById)\('([^']+)'\)/g)]
  .map(m => ({ file: f, fn: m[1], id: m[2] })));

test('MoneyUI.〜ById で取る要素を使っている', () => {
  assert.ok(calls.length > 100);
});

test('MoneyUI.〜ById の id は、HTML の中でその種類の要素にだけ付いている', () => {
  for (const { file, fn, id } of calls) {
    const tags = [...tagsOf(id)];
    assert.deepEqual(tags, [TAG[fn]], `${file} の ${fn}('${id}'): HTML では ${tags.length ? tags.join('・') : '見つからない'}`);
  }
});
