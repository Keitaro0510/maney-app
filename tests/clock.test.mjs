// 「今日」を扱う部品（js/clock.js）のテスト。実行: node --test "tests/*.test.mjs"
// 日付は、その端末の時刻（new Date(年, 月, 日, 時, 分)）で作る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dayKey, msUntilNextDay, createDayWatcher, followMonth } = require('../js/clock.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test('日付の文字列は、月と日を2けたにそろえる', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 9, 31, 23, 59, 59)), '2026-10-31');
});

test('次の日の0時までの時間を数える（月末・年末もまたぐ）', () => {
  assert.equal(msUntilNextDay(new Date(2026, 9, 31, 23, 59)), MIN);
  assert.equal(msUntilNextDay(new Date(2026, 11, 31, 23, 0)), HOUR);
  assert.equal(msUntilNextDay(new Date(2026, 10, 1, 0, 0)), 24 * HOUR);
});

test('同じ日のあいだは、知らせない', () => {
  let time = new Date(2026, 9, 31, 8, 0);
  const calls = [];
  const watcher = createDayWatcher(() => time, (...args) => calls.push(args));

  time = new Date(2026, 9, 31, 23, 59);
  assert.equal(watcher.check(), false);
  assert.equal(watcher.key, '2026-10-31');
  assert.equal(calls.length, 0);
});

test('日をまたいだら1回だけ知らせ、前の日付も渡す', () => {
  let time = new Date(2026, 9, 31, 23, 0);
  const calls = [];
  const watcher = createDayWatcher(() => time, (date, prev) => calls.push([dayKey(date), prev]));

  // 裏に置いたまま翌朝に戻ってきた
  time = new Date(2026, 10, 1, 7, 30);
  assert.equal(watcher.check(), true);
  assert.equal(watcher.key, '2026-11-01');
  // 同じ日にもう一度確かめても、知らせない
  assert.equal(watcher.check(), false);
  assert.deepEqual(calls, [['2026-11-01', '2026-10-31']]);
});

test('何日も空けて戻ってきても、知らせるのは1回', () => {
  let time = new Date(2026, 9, 28, 12, 0);
  const calls = [];
  const watcher = createDayWatcher(() => time, (date, prev) => calls.push([dayKey(date), prev]));

  time = new Date(2026, 10, 2, 9, 0);
  watcher.check();
  assert.deepEqual(calls, [['2026-11-02', '2026-10-28']]);
});

test('今月を見ていたら、日付が変わって月が変わると新しい今月にする', () => {
  const prev = new Date(2026, 9, 31, 23, 0);
  const now = new Date(2026, 10, 1, 7, 0);
  assert.deepEqual(followMonth({ y: 2026, m: 9 }, prev, now), { y: 2026, m: 10 });
});

test('ほかの月を見ていたら、そのままにする', () => {
  const prev = new Date(2026, 9, 31, 23, 0);
  const now = new Date(2026, 10, 1, 7, 0);
  const view = { y: 2026, m: 7 };
  assert.equal(followMonth(view, prev, now), view);
});

test('同じ月の中で日付が変わっても、見ている月は変えない', () => {
  const prev = new Date(2026, 9, 30, 23, 0);
  const now = new Date(2026, 9, 31, 7, 0);
  assert.deepEqual(followMonth({ y: 2026, m: 9 }, prev, now), { y: 2026, m: 9 });
});

test('年をまたいでも、今月を見ていたら新しい年の1月にする', () => {
  const prev = new Date(2026, 11, 31, 23, 0);
  const now = new Date(2027, 0, 1, 7, 0);
  assert.deepEqual(followMonth({ y: 2026, m: 11 }, prev, now), { y: 2027, m: 0 });
});
