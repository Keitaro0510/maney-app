// 予定を複数日に入れるときの、日ごとの予算（src/plans.ts）。D40。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetsForDays } from '../src/plans.ts'; // Node が型を消して読む（D17）

test('budgetsForDays: 日付の順に並べ、予算は最初の日だけ', () => {
  assert.deepEqual(budgetsForDays(['2026-11-25', '2026-11-12', '2026-11-18'], 3000), [
    { date: '2026-11-12', budget: 3000 },
    { date: '2026-11-18', budget: 0 },
    { date: '2026-11-25', budget: 0 },
  ]);
});

test('budgetsForDays: 重なる日は1つにする。1日だけなら、その日に全額', () => {
  assert.deepEqual(budgetsForDays(new Set(['2026-11-12']), 500), [{ date: '2026-11-12', budget: 500 }]);
  assert.deepEqual(budgetsForDays(['2026-11-12', '2026-11-12'], 500), [{ date: '2026-11-12', budget: 500 }]);
});

test('budgetsForDays: 日がなければ空。予算0なら全部0', () => {
  assert.deepEqual(budgetsForDays([], 1000), []);
  assert.deepEqual(budgetsForDays(['2026-12-01', '2026-11-30'], 0).map(e => e.budget), [0, 0]);
});
