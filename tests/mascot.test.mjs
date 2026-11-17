// マスコットの表情とセリフ（src/mascot.ts）。D33。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situationOf, mascotView, STREAK_CHEER, MASCOT_IMAGE } from '../src/mascot.ts';

const base = { spendable: 50000, streak: 0, recordedToday: false, today: '2026-11-17' };

test('situationOf: 足りない → 連続記録 → 今日記録した → ふだん の順', () => {
  assert.equal(situationOf(base), 'greeting');
  assert.equal(situationOf({ ...base, recordedToday: true }), 'recorded');
  assert.equal(situationOf({ ...base, recordedToday: true, streak: STREAK_CHEER }), 'streak');
  assert.equal(situationOf({ ...base, streak: STREAK_CHEER }), 'streak'); // 昨日までの連続でも
  assert.equal(situationOf({ ...base, streak: STREAK_CHEER - 1 }), 'greeting');
});

test('situationOf: 足りないときは、連続記録や今日の記録より先にやさしく知らせる。ちょうど0円は足りている', () => {
  assert.equal(situationOf({ ...base, spendable: -1, streak: 30, recordedToday: true }), 'short');
  assert.equal(situationOf({ ...base, spendable: 0 }), 'greeting');
});

test('mascotView: うれしい顔は、連続記録か今日の記録のときだけ。足りないときは泣き顔（心配）で、連続記録や今日の記録より優先', () => {
  assert.equal(mascotView(base).mood, 'normal');
  assert.equal(mascotView({ ...base, recordedToday: true }).mood, 'happy');
  assert.equal(mascotView({ ...base, streak: 5 }).mood, 'happy');
  assert.equal(mascotView({ ...base, spendable: -100, streak: 5, recordedToday: true }).mood, 'worried');
  assert.equal(mascotView({ ...base, spendable: -1 }).mood, 'worried');
  assert.equal(mascotView({ ...base, spendable: 0 }).mood, 'normal'); // ちょうど0円は足りている
});

test('mascotView: セリフは日替わり（同じ日は同じ文、3日で一巡する）。連続日数が入る', () => {
  const t = d => mascotView({ ...base, today: d }).text;
  assert.equal(t('2026-11-17'), t('2026-11-17'));
  assert.notEqual(t('2026-11-17'), t('2026-11-18'));
  assert.equal(t('2026-11-17'), t('2026-11-20'));
  const s = mascotView({ ...base, streak: 12 });
  assert.match(s.text, /12/);
  assert.doesNotMatch(s.text, /\{n\}/);
});

test('mascotView: 足りないときのセリフは、責めずに一緒に考える言い方（叱る・笑う言葉を使わない）', () => {
  for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) {
    const text = mascotView({ ...base, spendable: -500, today: day }).text;
    assert.doesNotMatch(text, /使いすぎ|ダメ|だめ|ざんねん|残念|！{2}/);
    assert.ok(text.length > 0);
  }
});

test('MASCOT_IMAGE: 絵のファイルは img/ にある', async () => {
  const { existsSync } = await import('node:fs');
  for (const path of Object.values(MASCOT_IMAGE)) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
});
