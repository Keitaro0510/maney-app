// 朝の通知の文面（supabase/functions/push/digest.ts）。Issue #189・D36。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, todayJst, shorten, tabUrl } from '../supabase/functions/push/digest.ts'; // Node が型を消して読む（D17）

const TODAY = '2026-11-17';
const plan = (over) => ({ title: '予定', start_date: TODAY, end_date: TODAY, start_time: null, done: false, ...over });
const task = (over) => ({ title: 'タスク', due_date: TODAY, completed_at: null, ...over });

test('todayJst: 日本時間の日付（UTC の夕方は、もう翌日）', () => {
  assert.equal(todayJst(new Date('2026-11-16T14:59:59Z')), '2026-11-16'); // 23:59:59 JST
  assert.equal(todayJst(new Date('2026-11-16T15:00:00Z')), '2026-11-17'); // 0:00 JST
  assert.equal(todayJst(new Date('2026-11-16T23:00:00Z')), '2026-11-17'); // 朝8時に送る時刻（cron: 23:00 UTC）
});

test('buildDigest: 何も無い日は送らない（null）', () => {
  assert.equal(buildDigest({ today: TODAY, plans: [], tasks: [] }), null);
  // 別の日の予定・期限のないタスク・完了したタスク・済みの予定は、数えない
  assert.equal(buildDigest({
    today: TODAY,
    plans: [plan({ start_date: '2026-11-18', end_date: '2026-11-18' }), plan({ done: true })],
    tasks: [task({ due_date: null }), task({ completed_at: '2026-11-16T10:00:00Z' }), task({ due_date: '2026-11-20' })],
  }), null);
});

test('buildDigest: 予定・今日が期限・期限切れを1本にまとめる', () => {
  const d = buildDigest({
    today: TODAY,
    plans: [plan({ title: '映画', start_time: '18:00:00' }), plan({ title: '歯医者', start_time: '09:00:00' })],
    tasks: [task(), task({ due_date: '2026-11-10' }), task({ due_date: '2026-11-01' })],
  });
  assert.deepEqual(d, { title: '今日の予定とタスク', body: '予定2件（歯医者ほか）・今日が期限のタスク1件・期限切れ2件', tab: 'home' });
});

test('buildDigest: 予定が1件なら「ほか」を付けない。終日の予定が、時刻のある予定より先', () => {
  assert.equal(buildDigest({ today: TODAY, plans: [plan({ title: '休み' })], tasks: [] }).body, '予定1件（休み）');
  assert.match(buildDigest({ today: TODAY, plans: [plan({ title: '会議', start_time: '10:00' }), plan({ title: '誕生日' })], tasks: [] }).body, /誕生日ほか/);
});

test('buildDigest: 期間の予定は、期間のあいだ毎日数える（最終日まで）', () => {
  const trip = plan({ title: '旅行', start_date: '2026-11-15', end_date: '2026-11-17' });
  assert.equal(buildDigest({ today: TODAY, plans: [trip], tasks: [] }).body, '予定1件（旅行）');
  assert.equal(buildDigest({ today: '2026-11-18', plans: [trip], tasks: [] }), null);
});

test('buildDigest: 予定が無くタスクだけの日は、タスクの画面を開く', () => {
  const d = buildDigest({ today: TODAY, plans: [], tasks: [task()] });
  assert.equal(d.body, '今日が期限のタスク1件');
  assert.equal(d.tab, 'task');
});

test('buildDigest: 金額は、入っていても文面に出ない（予算・メモなどの列は使わない）', () => {
  const d = buildDigest({
    today: TODAY,
    plans: [{ ...plan({ title: '旅行' }), budget: 50000, memo: '秘密のメモ', card_id: 'x' }],
    tasks: [{ ...task(), memo: '秘密のメモ' }],
  });
  assert.ok(!/50000|5万|¥|円|秘密/.test(`${d.title}${d.body}`), d.body);
});

test('shorten: 長い題名は切って…を付ける（絵文字も1文字として数える）', () => {
  assert.equal(shorten('短い'), '短い');
  assert.equal(shorten('あいうえおかきくけこさしすせそ'), 'あいうえおかきくけこさしすせ…');
  assert.equal(shorten('  空白   だらけ  '), '空白 だらけ');
  assert.equal(shorten('😀😀😀', 2), '😀😀…');
});

test('tabUrl: 通知を押したときの URL', () => {
  assert.equal(tabUrl('home'), './?tab=home');
  assert.equal(tabUrl('task'), './?tab=task');
});
