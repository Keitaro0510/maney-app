// 関数を window に出す互換の層（D19・D20）を守る。実行: node --test "tests/*.test.mjs"
// HTML の onclick など（index.html と src/ が文字で組み立てる HTML）は、関数を名前で呼ぶ（手順5でイベントの登録に置き換えるまで）。
// src/main.ts が onclick で使う関数を LEGACY_〜 の一覧で window に出す。
// 一覧に出し忘れると、そのボタンは押しても動かない（型の検査では見つからない）。ここで見つける
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LEGACY_SYNC } from '../src/sync.ts'; // Node が型を消して読む（D17）
import { LEGACY_TASKS } from '../src/screens/tasks.ts';
import { LEGACY_CARDS } from '../src/cards.ts';
import { LEGACY_SETTINGS } from '../src/screens/settings.ts';
import { LEGACY_CARD_SCREEN } from '../src/screens/cards.ts';
import { LEGACY_ATM } from '../src/screens/atm.ts';
import { LEGACY_SHIFTS } from '../src/shifts.ts';
import { LEGACY_SHIFT_SCREEN } from '../src/screens/shift.ts';
import { LEGACY_PLANS } from '../src/plans.ts';
import { LEGACY_PLAN_SCREEN } from '../src/screens/plans.ts';
import { LEGACY_LEDGER } from '../src/ledger.ts';
import { LEGACY_MONTHLY_SCREEN } from '../src/screens/monthly.ts';
import { LEGACY_LEDGER_SCREEN } from '../src/screens/ledger.ts';
import { LEGACY_CALENDAR } from '../src/screens/calendar.ts';
import * as ui from '../src/ui.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const jsFiles = readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `js/${f}`);
const srcFiles = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(f => String(f).split('\\').join('/'))
  .filter(f => f.endsWith('.ts')).map(f => `src/${f}`);

// src/main.ts が window に出す名前（名前のまま出すもの）
const LEGACY = { ...LEGACY_SYNC, ...LEGACY_TASKS, ...LEGACY_CARDS, ...LEGACY_SETTINGS, ...LEGACY_CARD_SCREEN, ...LEGACY_ATM, ...LEGACY_SHIFTS, ...LEGACY_SHIFT_SCREEN, ...LEGACY_PLANS, ...LEGACY_PLAN_SCREEN, ...LEGACY_LEDGER, ...LEGACY_MONTHLY_SCREEN, ...LEGACY_LEDGER_SCREEN, ...LEGACY_CALENDAR };
// js/ のトップレベルの関数・変数
const jsNames = new Set(jsFiles.flatMap(f => [...read(f).matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1] || m[2])));
// ブラウザにもともとある名前と、JavaScript の言葉
const BUILTIN = new Set(['String', 'Number', 'parseInt', 'parseFloat', 'Math', 'Date', 'event', 'this', 'if', 'return', 'function', 'confirm', 'alert']);

// HTML の on〜="…" の中で、名前で呼んでいる関数（a.b( の b は除く）
function handlerCalls(text) {
  const names = [];
  for (const m of text.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
    for (const c of m[1].matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) names.push(c[1]);
  }
  return names;
}

test('HTML の onclick などが呼ぶ関数は、src/main.ts が window に出している', () => {
  const missing = [];
  for (const f of ['index.html', ...jsFiles, ...srcFiles]) {
    for (const name of handlerCalls(read(f))) {
      if (BUILTIN.has(name) || jsNames.has(name) || name in LEGACY || name === 'MoneyUI') continue;
      missing.push(`${f}: ${name}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'window に出していない関数を、HTML が呼んでいます');
});

test('js/ のファイルは、window に出した名前を宣言していない（宣言すると window の名前を上書きしてしまう）', () => {
  for (const name of Object.keys(LEGACY)) assert.equal(jsNames.has(name), false, `js/ に ${name} の宣言があります`);
  assert.equal(jsNames.has('MoneyUI'), false);
});

test('画面のモジュールは window の関数を直接呼ばない', () => {
  for (const f of srcFiles.filter(f => f.startsWith('src/screens/'))) {
    assert.doesNotMatch(read(f), /\bglobalThis\b|\bwindow\.\w+\(/, `${f} が window の関数を直接呼んでいます`);
  }
});

test('画面の部品（src/ui.ts）が出すもの', () => {
  assert.deepEqual(Object.keys(ui).sort(), ['checkRow', 'dialogById', 'downloadJson', 'el', 'elementById', 'escapeHtml', 'inputById', 'openSheet', 'selectById', 'textareaById', 'toast']);
});
