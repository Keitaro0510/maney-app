// Claude から予定・タスクを入れる・変える MCP の、DB に触れない部分（supabase/functions/mcp/logic.ts）。Issue #190・D37。
// 実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDate, isValidTime, hm, addDays, todayJst, weekdayOf, fmtTime, norm, normalizeTags, resolveCard,
  buildNewPlan, buildPlanUpdate, findDuplicatePlan, buildNewTask, buildTaskUpdate, findDuplicateTask,
  formatPlan, formatTask, describePlan, describeTask, applyOpProblem, PLAN_DEFAULT_COLOR, MAX_BUDGET,
} from '../supabase/functions/mcp/logic.ts';

const CARDS = [{ id: 'c1', name: '楽天カード' }, { id: 'c2', name: '三井住友カード' }];
const ok = r => { assert.equal(r.ok, true, r.error); return r.value; };
const bad = (r, pattern) => { assert.equal(r.ok, false); assert.match(r.error, pattern); };

test('isValidDate・isValidTime: 実在する日付と24時間の時刻だけ', () => {
  assert.equal(isValidDate('2026-11-20'), true);
  assert.equal(isValidDate('2028-02-29'), true); // うるう日
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-1-5'), false);
  assert.equal(isValidDate('11/20'), false);
  assert.equal(isValidDate(20261120), false);
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('9:00'), false);
  assert.equal(isValidTime('09:00:00'), false);
});

test('日付の計算: addDays（月・年またぎ）・todayJst（日本時間）・weekdayOf・hm・fmtTime', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(todayJst(new Date('2026-11-17T15:30:00Z')), '2026-11-18'); // UTC の夕方は、日本では翌日
  assert.equal(todayJst(new Date('2026-11-17T14:59:00Z')), '2026-11-17');
  assert.equal(weekdayOf('2026-11-17'), '火');
  assert.equal(hm('19:00:00'), '19:00');
  assert.equal(hm(null), null);
  assert.equal(fmtTime('09:00'), '9時');
  assert.equal(fmtTime('19:30'), '19時30分');
});

test('normalizeTags: 空白・空・重複を整える。多すぎる・長すぎるものは誤り', () => {
  assert.deepEqual(ok(normalizeTags([' 就活 ', '', '就活', 'バイト'])), ['就活', 'バイト']);
  bad(normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)), /10個まで/);
  bad(normalizeTags(['あ'.repeat(31)]), /30文字まで/);
});

test('resolveCard: 同じ名前が優先・名前の一部が1つだけなら選ぶ・複数や無いときは教える', () => {
  assert.equal(ok(resolveCard(CARDS, '楽天カード')).id, 'c1');
  assert.equal(ok(resolveCard(CARDS, '楽天')).id, 'c1'); // 一部
  assert.equal(ok(resolveCard(CARDS, '  三井住友カード ')).id, 'c2'); // 空白
  bad(resolveCard(CARDS, 'カード'), /複数/); // どちらにも合う
  bad(resolveCard(CARDS, 'ゴールド'), /登録されているカード: 「楽天カード」、「三井住友カード」/);
  bad(resolveCard([], '楽天'), /カードが登録されていません/);
  assert.equal(ok(resolveCard([{ id: 'x', name: 'A' }, { id: 'y', name: 'AB' }], 'a')).id, 'x'); // 完全一致が先
});

test('buildNewPlan: 最小の予定（終日・予算なし・現金）。色は既定、済みではない', () => {
  const row = ok(buildNewPlan({ title: ' 歯医者 ', start_date: '2026-11-20' }, CARDS, 7));
  assert.deepEqual(row, { title: '歯医者', start_date: '2026-11-20', end_date: '2026-11-20', start_time: null, end_time: null, budget: 0, memo: '', done: false, color: PLAN_DEFAULT_COLOR, card_id: null, position: 7 });
});

test('buildNewPlan: 時間・予算・カード払い・複数日', () => {
  const row = ok(buildNewPlan({ title: '旅行', start_date: '2026-12-01', end_date: '2026-12-03', start_time: '08:00', end_time: '20:00', budget: 50000, payment: 'card', card: '楽天', memo: ' 宿は予約済み ' }, CARDS, 0));
  assert.equal(row.end_date, '2026-12-03');
  assert.equal(row.card_id, 'c1');
  assert.equal(row.budget, 50000);
  assert.equal(row.memo, '宿は予約済み');
  assert.equal(ok(buildNewPlan({ title: 'x', start_date: '2026-12-01', payment: 'cash' }, CARDS, 0)).card_id, null);
  assert.equal(ok(buildNewPlan({ title: 'x', start_date: '2026-12-01', card: '三井住友' }, CARDS, 0)).card_id, 'c2'); // カード名だけでも、カード払い
});

test('buildNewPlan: 誤りを、直せる文面で返す', () => {
  bad(buildNewPlan({ title: '', start_date: '2026-11-20' }, CARDS, 0), /タイトルが空/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-02-30' }, CARDS, 0), /日付が正しくありません/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', end_date: '2026-11-19' }, CARDS, 0), /前です/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', start_time: '25:00' }, CARDS, 0), /開始時刻が正しくありません/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', end_time: '18:00' }, CARDS, 0), /終了時刻だけ/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', budget: -1 }, CARDS, 0), /予算は/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', budget: 1.5 }, CARDS, 0), /予算は/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', budget: MAX_BUDGET + 1 }, CARDS, 0), /予算は/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', payment: 'card' }, CARDS, 0), /どのカードか教えて.*楽天カード/); // カード払いなのにカード名がない
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', payment: 'cash', card: '楽天' }, CARDS, 0), /同時には/);
  bad(buildNewPlan({ title: 'x', start_date: '2026-11-20', payment: 'card', card: 'ない' }, CARDS, 0), /見つかりません/);
});

const CUR = {
  id: 'p1', title: '飲み会', start_date: '2026-11-20', end_date: '2026-11-20', start_time: '19:00:00', end_time: '21:00:00',
  budget: 4000, done: false, memo: '', card_id: null, updated_at: 't0',
};

test('buildPlanUpdate: 変えた列だけを返す。変えていなければ空（時刻の秒は無視する）', () => {
  const same = ok(buildPlanUpdate(CUR, { title: '飲み会', start_time: '19:00' }, CARDS));
  assert.deepEqual(same.changes, {});
  const r = ok(buildPlanUpdate(CUR, { budget: 5000, memo: ' 割り勘 ' }, CARDS));
  assert.deepEqual(r.changes, { budget: 5000, memo: '割り勘' });
});

test('buildPlanUpdate: 日付を変えると、期間の長さを保って終わりの日もずらす。終わりの日を指定すればそのまま', () => {
  const multi = { ...CUR, start_date: '2026-12-01', end_date: '2026-12-03' };
  const moved = ok(buildPlanUpdate(multi, { start_date: '2026-12-10' }, CARDS));
  assert.deepEqual(moved.changes, { start_date: '2026-12-10', end_date: '2026-12-12' });
  const single = ok(buildPlanUpdate(CUR, { start_date: '2026-11-25' }, CARDS));
  assert.deepEqual(single.changes, { start_date: '2026-11-25', end_date: '2026-11-25' });
  const explicit = ok(buildPlanUpdate(CUR, { start_date: '2026-11-25', end_date: '2026-11-27' }, CARDS));
  assert.deepEqual(explicit.changes, { start_date: '2026-11-25', end_date: '2026-11-27' });
  const year = ok(buildPlanUpdate({ ...CUR, start_date: '2026-12-30', end_date: '2026-12-31' }, { start_date: '2027-01-02' }, CARDS)); // 年またぎ
  assert.equal(year.changes.end_date, '2027-01-03');
});

test('buildPlanUpdate: 開始時刻を消す（終日にする）と、終了時刻も消える。終了時刻だけは設定できない', () => {
  const allDay = ok(buildPlanUpdate(CUR, { start_time: null }, CARDS));
  assert.deepEqual(allDay.changes, { start_time: null, end_time: null });
  const noTime = { ...CUR, start_time: null, end_time: null };
  bad(buildPlanUpdate(noTime, { end_time: '18:00' }, CARDS), /終了時刻だけ/);
  assert.deepEqual(ok(buildPlanUpdate(noTime, { start_time: '10:00', end_time: '11:00' }, CARDS)).changes, { start_time: '10:00', end_time: '11:00' });
});

test('buildPlanUpdate: 払い方の変更と、済みにする', () => {
  assert.equal(ok(buildPlanUpdate(CUR, { payment: 'card', card: '楽天' }, CARDS)).changes.card_id, 'c1');
  const withCard = { ...CUR, card_id: 'c1' };
  assert.deepEqual(ok(buildPlanUpdate(withCard, { payment: 'cash' }, CARDS)).changes, { card_id: null });
  assert.deepEqual(ok(buildPlanUpdate(withCard, { payment: 'card' }, CARDS)).changes, {}); // カード名なしでも、元のカードのまま
  bad(buildPlanUpdate(CUR, { payment: 'card' }, CARDS), /どのカードか/);
  assert.deepEqual(ok(buildPlanUpdate(CUR, { done: true }, CARDS)).changes, { done: true });
  bad(buildPlanUpdate(CUR, { end_date: '2026-11-19' }, CARDS), /前です/);
});

test('findDuplicatePlan・findDuplicateTask: 同じタイトル（全角半角・大文字小文字を無視）と同じ日', () => {
  assert.equal(findDuplicatePlan([CUR], ' 飲み会 ', '2026-11-20'), CUR);
  assert.equal(findDuplicatePlan([CUR], '飲み会', '2026-11-21'), null);
  assert.equal(findDuplicatePlan([{ ...CUR, title: 'ＡＢＣ' }], 'abc', '2026-11-20')?.id, 'p1');
  const t = { id: 't1', title: 'レポート', due_date: '2026-11-25', completed_at: null };
  assert.equal(findDuplicateTask([t], 'レポート', '2026-11-25'), t);
  assert.equal(findDuplicateTask([t], 'レポート', null), null);
  assert.equal(findDuplicateTask([{ ...t, completed_at: '2026-11-01T00:00:00Z' }], 'レポート', '2026-11-25'), null); // 済みは重複とみなさない
  assert.equal(findDuplicateTask([{ ...t, due_date: null }], 'レポート', null)?.id, 't1');
});

test('buildNewTask・buildTaskUpdate: 追加・変更（期限は null で消せる）・誤り', () => {
  assert.deepEqual(ok(buildNewTask({ title: ' レポート ' }, 3)), { title: 'レポート', due_date: null, memo: '', tags: [], position: 3, completed_at: null });
  assert.deepEqual(ok(buildNewTask({ title: 'x', due_date: '2026-11-25', memo: 'm', tags: ['就活', '就活'] }, 0)).tags, ['就活']);
  bad(buildNewTask({ title: ' ' }, 0), /タイトルが空/);
  bad(buildNewTask({ title: 'x', due_date: '2026-02-30' }, 0), /期限が正しくありません/);
  const cur = { id: 't1', title: 'レポート', due_date: '2026-11-25', memo: '', tags: ['就活'], completed_at: null };
  assert.deepEqual(ok(buildTaskUpdate(cur, { due_date: '2026-11-30' })).changes, { due_date: '2026-11-30' });
  assert.deepEqual(ok(buildTaskUpdate(cur, { due_date: null })).changes, { due_date: null });
  assert.deepEqual(ok(buildTaskUpdate(cur, { tags: ['就活'] })).changes, {}); // 変わっていない
  assert.deepEqual(ok(buildTaskUpdate(cur, { tags: [] })).changes, { tags: [] });
  assert.deepEqual(ok(buildTaskUpdate(cur, { title: '提出', memo: ' メモ ' })).changes, { title: '提出', memo: 'メモ' });
  bad(buildTaskUpdate(cur, { title: '' }), /タイトルが空/);
  bad(buildTaskUpdate(cur, { due_date: '2026-13-01' }), /期限が正しくありません/);
});

test('formatPlan・formatTask・describePlan・describeTask: 読みやすい形と確認の文', () => {
  const plan = formatPlan({ ...CUR, card_id: 'c1' }, CARDS);
  assert.deepEqual([plan.start_time, plan.end_time, plan.payment, plan.card], ['19:00', '21:00', 'card', '楽天カード']);
  assert.equal(describePlan(plan), '2026-11-20（金） 19時〜21時「飲み会」 予算 ¥4,000・カード「楽天カード」');
  assert.equal(describePlan({ ...formatPlan(CUR, CARDS), done: true }), '2026-11-20（金） 19時〜21時「飲み会」 予算 ¥4,000・現金（済み）');
  assert.equal(describePlan(formatPlan({ ...CUR, start_time: null, end_time: null, budget: 0 }, CARDS)), '2026-11-20（金） 終日「飲み会」');
  assert.equal(describePlan(formatPlan({ ...CUR, start_date: '2026-12-01', end_date: '2026-12-03', end_time: null }, CARDS)), '2026-12-01（火）〜2026-12-03（木） 19時から「飲み会」 予算 ¥4,000・現金');
  const task = formatTask({ id: 't1', title: 'レポート', due_date: '2026-11-25', completed_at: null, memo: '', tags: null, updated_at: 'u' });
  assert.deepEqual([task.done, task.tags], [false, []]);
  assert.equal(describeTask(task), '「レポート」期限 2026-11-25（水）');
  assert.equal(describeTask({ ...task, due_date: null, done: true }), '「レポート」期限なし（済み）');
});

test('applyOpProblem: 成功は null。競合・消えた・移行は、やり直し方が分かる文', () => {
  assert.equal(applyOpProblem({ status: 'applied' }), null);
  assert.match(applyOpProblem({ status: 'conflict', conflicts: [{ reason: 'changed' }] }), /あとからアプリなどで変更/);
  assert.match(applyOpProblem({ status: 'conflict', conflicts: [{ reason: 'missing' }] }), /すでに削除/);
  assert.match(applyOpProblem({ status: 'stale_epoch', epoch: 2 }), /移行/);
  assert.match(applyOpProblem({ status: 'conflict', conflicts: [] }), /競合/);
  assert.match(applyOpProblem({ status: 'weird' }), /weird/);
});

test('norm: 全角半角・大文字小文字・前後の空白', () => {
  assert.equal(norm('  ＡＢＣ１２３ '), 'abc123');
});
