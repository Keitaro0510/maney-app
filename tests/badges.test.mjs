// 実績バッジの計算（src/badges.ts）。D30。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, badgeProgress, recordStreak, monthSums, budgetMonths, surplusRun, completedTasks } from '../src/badges.ts'; // Node が型を消して読む（D17）

const e = (date, type, amount) => ({ date, type, amount, name: '', cat: '', pay: '' });

test('badgeProgress: 段階と、次に必要な値', () => {
  assert.deepEqual(badgeProgress(0, [7, 30, 100]), { value: 0, tier: 0, next: 7 });
  assert.deepEqual(badgeProgress(7, [7, 30, 100]), { value: 7, tier: 1, next: 30 });
  assert.deepEqual(badgeProgress(99, [7, 30, 100]), { value: 99, tier: 2, next: 100 });
  assert.deepEqual(badgeProgress(150, [7, 30, 100]), { value: 150, tier: 3, next: null });
  assert.equal(Object.keys(THRESHOLDS).length, 4);
});

test('recordStreak: いちばん長い連続（月またぎ・重複・うるう日）', () => {
  const dates = ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-01', '2028-03-05'];
  assert.equal(recordStreak(dates, '2028-03-20').best, 4); // 2/27〜3/1。2028年はうるう年
  assert.equal(recordStreak([], '2026-11-07').best, 0);
});

test('recordStreak: 今の連続は、今日か昨日まで記録があるときだけ', () => {
  const d = ['2026-11-04', '2026-11-05', '2026-11-06'];
  assert.equal(recordStreak(d, '2026-11-06').current, 3); // 今日まで
  assert.equal(recordStreak(d, '2026-11-07').current, 3); // まだ今日は付けていないが、昨日までつづいている
  assert.equal(recordStreak(d, '2026-11-08').current, 0); // 1日あいたので切れた
  assert.equal(recordStreak(d, '2026-11-08').best, 3); // いちばん長い連続は残る
});

test('monthSums: 月ごとの収入・支出（収入・支出以外は数えない）', () => {
  const m = monthSums([e('2026-10-01', 'income', 100), e('2026-10-02', 'expense', 40), e('2026-10-03', 'other', 9999), e('2026-09-30', 'expense', 5)]);
  assert.deepEqual([...m.entries()].sort(), [['2026-09', { income: 0, expense: 5 }], ['2026-10', { income: 100, expense: 40 }]]);
});

test('budgetMonths: 終わった月で支出が予算以下の月数。予算なしは null', () => {
  const m = monthSums([e('2026-08-01', 'expense', 90), e('2026-09-01', 'expense', 100), e('2026-10-01', 'expense', 101), e('2026-11-01', 'expense', 1)]);
  assert.equal(budgetMonths(m, 100, '2026-11-07'), 2); // 8月・9月。10月は超過、11月は途中なので数えない
  assert.equal(budgetMonths(m, 0, '2026-11-07'), null);
});

test('surplusRun: 黒字がつづいた月数（記録のない月・赤字でつづきが切れる。途中の月は数えない）', () => {
  const m = monthSums([
    e('2026-01-01', 'income', 10), e('2026-02-01', 'income', 10), e('2026-03-01', 'income', 10), // 1〜3月: 黒字3つ
    e('2026-04-01', 'expense', 10), // 4月: 赤字
    e('2026-05-01', 'income', 10), e('2026-07-01', 'income', 10), // 5月と7月（6月は記録なし）
    e('2026-11-01', 'income', 10), // 今月（途中）
  ]);
  assert.equal(surplusRun(m, '2026-11-07'), 3);
});

test('completedTasks: 完了日時のあるタスクの数', () => {
  assert.equal(completedTasks([{ completed_at: '2026-11-01T00:00:00Z' }, { completed_at: null }, {}, { completed_at: '2026-11-02T00:00:00Z' }]), 2);
});
