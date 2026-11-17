// マスコットの表情とセリフ（src/mascot.ts）。D33。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situationOf, mascotView, daysSinceRecord, STREAK_CHEER, AWAY_DAYS, MASCOT_IMAGE } from '../src/mascot.ts';

const base = { spendable: 50000, streak: 0, recordedToday: false, daysSinceRecord: 1, today: '2026-11-17' };

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

test('daysSinceRecord: 最後に記録した日から何日か。今日なら0・記録なしは null・今日より先の記録は数えない', () => {
  assert.equal(daysSinceRecord(['2026-11-17'], '2026-11-17'), 0);
  assert.equal(daysSinceRecord(['2026-11-10', '2026-11-14', '2026-11-12'], '2026-11-17'), 3);
  assert.equal(daysSinceRecord(['2026-11-10', '2026-11-20'], '2026-11-17'), 7); // 先の日付は数えない
  assert.equal(daysSinceRecord([], '2026-11-17'), null);
  assert.equal(daysSinceRecord(['2026-11-20'], '2026-11-17'), null);
  assert.equal(daysSinceRecord(['2026-10-30'], '2026-11-02'), 3); // 月またぎ
});

test('situationOf: 3日以上あいたら「おかえり」（応援）。記録なし（はじめて）・2日までは、ふだん', () => {
  assert.equal(situationOf({ ...base, daysSinceRecord: AWAY_DAYS }), 'away');
  assert.equal(situationOf({ ...base, daysSinceRecord: AWAY_DAYS - 1 }), 'greeting');
  assert.equal(situationOf({ ...base, daysSinceRecord: null }), 'greeting'); // まだ1件も記録がない人に「おかえり」は変
  assert.equal(situationOf({ ...base, daysSinceRecord: 10, spendable: -1 }), 'short'); // 足りないときが先
});

test('mascotView: おかえりは応援の顔。責めたり、あきれたりする言葉を使わない', () => {
  for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) {
    const v = mascotView({ ...base, daysSinceRecord: 5, today: day });
    assert.equal(v.mood, 'cheer');
    assert.doesNotMatch(v.text, /忘れ|サボ|さぼ|全然|ぜんぜん|なんで|どうして|やっと|ずっと/);
  }
});
