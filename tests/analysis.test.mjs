// 分析の計算（src/analysis.ts）。D28。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTotals } from '../src/analysis.ts'; // Node が型を消して読む（D17）

const e = (date, type, amount) => ({ date, type, amount, name: '', cat: '', pay: '' });

test('monthlyTotals: 終わりの月までの月数だけ、古い順に並ぶ', () => {
  const t = monthlyTotals([], 2026, 10, 12); // 2026年11月まで
  assert.equal(t.length, 12);
  assert.deepEqual([t[0].y, t[0].m], [2025, 11]); // 2025年12月
  assert.deepEqual([t[11].y, t[11].m], [2026, 10]);
  assert.equal(t[0].label, '12月');
});

test('monthlyTotals: 収入・支出・収支を月ごとに足す（年をまたぐ）', () => {
  const t = monthlyTotals([
    e('2025-12-31', 'expense', 1000), e('2026-01-01', 'income', 5000), e('2026-01-15', 'expense', 1200), e('2026-01-31', 'expense', 300),
  ], 2026, 0, 3);
  assert.deepEqual(t.map(x => [x.income, x.expense, x.net]), [[0, 0, 0], [0, 1000, -1000], [5000, 1500, 3500]]);
});

test('monthlyTotals: 範囲の外の記録・金額が文字列・種類が不明な記録', () => {
  const t = monthlyTotals([e('2024-01-01', 'expense', 999), e('2026-01-02', 'expense', '700'), e('2026-01-03', 'other', 50)], 2026, 0, 2);
  assert.deepEqual(t.map(x => [x.income, x.expense]), [[0, 0], [0, 700]]);
});

import { fuyouGauge, fuyouLimits } from '../src/analysis.ts';

test('fuyouGauge: 進み具合の段階（70%・90%・超えた）', () => {
  assert.equal(fuyouGauge(1000, 600, 600).level, 'ok');
  assert.equal(fuyouGauge(1000, 700, 700).level, 'warn');
  assert.equal(fuyouGauge(1000, 899, 899).level, 'warn');
  assert.equal(fuyouGauge(1000, 900, 900).level, 'danger');
  assert.equal(fuyouGauge(1000, 1000, 1000).level, 'over');
});

test('fuyouGauge: 残りと余裕は引き算（超えるとマイナス）。割合は0〜100で止める', () => {
  const g = fuyouGauge(1030000, 500000, 1200000);
  assert.equal(g.remaining, 530000);
  assert.equal(g.margin, -170000); // 予想は超える
  assert.equal(g.estimatedPct, 100);
  assert.ok(Math.abs(g.confirmedPct - (500000 / 1030000) * 100) < 1e-9);
  assert.equal(fuyouGauge(1000, 0, 0).confirmedPct, 0);
});

test('fuyouLimits: 設定どおりの限度額を出す', () => {
  assert.deepEqual(fuyouLimits('1030000').map(l => l.amount), [1030000]);
  assert.deepEqual(fuyouLimits('1300000').map(l => l.amount), [1300000]);
  assert.deepEqual(fuyouLimits('both').map(l => l.amount), [1030000, 1300000]);
  assert.deepEqual(fuyouLimits('').map(l => l.amount), []);
});

import { dailyExpenseHeat } from '../src/analysis.ts';

test('dailyExpenseHeat: 月の日数・1日の曜日・支出だけを日ごとに足す', () => {
  const h = dailyExpenseHeat([
    e('2026-11-05', 'expense', 1000), e('2026-11-05', 'expense', 500), e('2026-11-05', 'income', 99999),
    e('2026-11-30', 'expense', 3000), e('2026-10-31', 'expense', 7777), e('2026-12-01', 'expense', 8888),
  ], 2026, 10);
  assert.equal(h.cells.length, 30);
  assert.equal(h.offset, 0); // 2026-11-01 は日曜日
  assert.deepEqual([h.cells[4].amount, h.cells[4].count], [1500, 2]);
  assert.equal(h.cells[29].amount, 3000);
  assert.equal(h.total, 4500); // 前後の月と収入は数えない
  assert.equal(h.maxDay, 30);
});

test('dailyExpenseHeat: 濃さは最多の日を基準にする（使っていない日は0）', () => {
  const h = dailyExpenseHeat([e('2026-02-01', 'expense', 100), e('2026-02-02', 'expense', 200), e('2026-02-03', 'expense', 300), e('2026-02-04', 'expense', 400)], 2026, 1);
  assert.deepEqual(h.cells.slice(0, 5).map(c => c.level), [1, 2, 3, 4, 0]); // 25%・50%・75%・100%
  assert.equal(h.cells.length, 28);
});

test('dailyExpenseHeat: 記録がない月は maxDay が null、うるう年の2月は29日', () => {
  const h = dailyExpenseHeat([], 2028, 1);
  assert.equal(h.maxDay, null);
  assert.equal(h.total, 0);
  assert.equal(h.cells.length, 29);
  assert.ok(h.cells.every(c => c.level === 0));
});
