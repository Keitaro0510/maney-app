// D18 手順5。HTML と画面のコードがグローバルなイベント名に頼らないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as ui from '../src/ui.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const srcFiles = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(f => String(f).split('\\').join('/'))
  .filter(f => f.endsWith('.ts')).map(f => `src/${f}`);
const jsFiles = readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `js/${f}`);

test('HTML と画面がイベント属性を使わない', () => {
  for (const path of ['index.html', ...srcFiles, ...jsFiles]) {
    assert.doesNotMatch(read(path), /\s(?:onclick|onchange|oninput|onsubmit|onkeydown|onkeyup|onblur|onfocus)\s*=/, path);
  }
});

test('起動時に関数を window に公開しない', () => {
  assert.doesNotMatch(read('src/main.ts'), /Object\.assign\(window|LEGACY_/, 'src/main.ts');
});

test('画面のモジュールは window の関数を直接呼ばない', () => {
  for (const path of srcFiles.filter(f => f.startsWith('src/screens/'))) {
    assert.doesNotMatch(read(path), /\bglobalThis\b|\bwindow\.\w+\(/, path);
  }
});

test('画面の部品（src/ui.ts）が出すもの', () => {
  assert.deepEqual(Object.keys(ui).sort(), ['checkRow', 'dialogById', 'downloadJson', 'el', 'elementById', 'escapeHtml', 'inputById', 'openSheet', 'selectById', 'textareaById', 'toast']);
});
