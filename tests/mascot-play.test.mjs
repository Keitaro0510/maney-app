// キリンの動きの決め事（src/mascot-play.ts）。D41。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRICKS, pickTrick, nextIdleDelayMs, isNight, isMorning, hasCrown, CROWN_STREAK, TAP_COMBO_MS, SPIN_TAPS,
  nextTapCount, tapLine, tapPlay, celebrateLine, coinBurst,
} from '../src/mascot-play.ts'; // Node が型を消して読む（D17）

test('pickTrick: 乱数の範囲に応じて3つの小ワザを選ぶ（端でも範囲を出ない）', () => {
  assert.equal(pickTrick(0), TRICKS[0]);
  assert.equal(pickTrick(0.5), TRICKS[1]);
  assert.equal(pickTrick(0.999999), TRICKS[2]);
  assert.equal(pickTrick(1), TRICKS[2]); // 1 が来ても落ちない
});

test('nextIdleDelayMs: 7〜16秒', () => {
  assert.equal(nextIdleDelayMs(0), 7000);
  assert.equal(nextIdleDelayMs(1), 16000);
  assert.ok(nextIdleDelayMs(0.5) > 7000 && nextIdleDelayMs(0.5) < 16000);
});

test('isNight・isMorning: 夜は21〜4時台、朝は5〜9時台', () => {
  for (const h of [21, 22, 23, 0, 3, 4]) assert.equal(isNight(h), true, `${h}時`);
  for (const h of [5, 12, 20]) assert.equal(isNight(h), false, `${h}時`);
  for (const h of [5, 7, 9]) assert.equal(isMorning(h), true, `${h}時`);
  for (const h of [4, 10, 15, 23]) assert.equal(isMorning(h), false, `${h}時`);
});

test('hasCrown: 記録の連続が7日以上で王冠', () => {
  assert.equal(CROWN_STREAK, 7);
  assert.equal(hasCrown(6), false);
  assert.equal(hasCrown(7), true);
  assert.equal(hasCrown(100), true);
});

test('nextTapCount: 1.5秒以内なら続き、空いたら1から', () => {
  assert.equal(nextTapCount(0, 0, 1000), 1); // はじめて
  assert.equal(nextTapCount(1, 1000, 1000 + TAP_COMBO_MS), 2); // ちょうど境目は続き
  assert.equal(nextTapCount(4, 1000, 1000 + TAP_COMBO_MS + 1), 1); // 空いた
  assert.equal(nextTapCount(2, 1000, 1500), 3);
});

test('tapPlay: 5回続けたら回る', () => {
  assert.equal(tapPlay(1), 'poyon');
  assert.equal(tapPlay(SPIN_TAPS - 1), 'poyon');
  assert.equal(tapPlay(SPIN_TAPS), 'spin');
});

test('tapLine: 昼は ふつうのセリフ、夜は眠そう、回るときは回るセリフ。乱数の端でも落ちない', () => {
  assert.match(tapLine(1, 12, 0), /^わっ/);
  assert.match(tapLine(1, 23, 0), /ふあぁ/);
  assert.match(tapLine(SPIN_TAPS, 23, 0), /目が回る/); // 回るときは、夜でも回るセリフ
  assert.ok(tapLine(1, 12, 1).length > 0);
  assert.ok(tapLine(1, 2, 1).length > 0);
});

test('セリフは短く、お金で責めない（円・足りない・使いすぎ などを含まない）', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push(tapLine(1, 12, i / 20), tapLine(1, 23, i / 20), tapLine(SPIN_TAPS, 12, i / 20), celebrateLine(i / 20));
  for (const l of lines) {
    assert.ok(l.length <= 20, l);
    assert.ok(!/円|¥|足りな|使いすぎ|ダメ|だめ|無駄/.test(l), l);
  }
});

test('celebrateLine: 範囲の端でも落ちない', () => {
  assert.ok(celebrateLine(0).length > 0);
  assert.ok(celebrateLine(1).length > 0);
});

test('coinBurst: 個数どおり。向き・高さは範囲内、1つずつ遅れて出る', () => {
  let seed = 0;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const coins = coinBurst(6, rand);
  assert.equal(coins.length, 6);
  coins.forEach((c, i) => {
    assert.ok(c.dx >= -45 && c.dx <= 45, `dx ${c.dx}`);
    assert.ok(c.rise >= 40 && c.rise <= 72, `rise ${c.rise}`);
    assert.ok(c.spin >= -360 && c.spin <= 360, `spin ${c.spin}`);
    assert.equal(c.delay, i * 70);
  });
  assert.deepEqual(coinBurst(0, rand), []);
});
