// 記録の連続日数（src/streak.ts）。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordStreak } from '../src/streak.ts'; // Node が型を消して読む（D17）

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
