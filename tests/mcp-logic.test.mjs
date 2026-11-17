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

// ---------------- シフト（読むだけ） ----------------
import { shiftHours, formatShift, describeShift } from '../supabase/functions/mcp/logic.ts';

const JOBS = [{ id: 'j1', name: 'カフェ' }, { id: 'j2', name: '居酒屋' }];
const SHIFT = { id: 's1', date: '2026-11-20', job_id: 'j1', start_time: '17:00:00', end_time: '22:00:00', wage: 1200, rest_minutes: 30, updated_at: 'u' };

test('shiftHours: 休憩を引く。日をまたぐシフトは翌日の終わりまで。小数第2位まで', () => {
  assert.equal(shiftHours('17:00', '22:00', 30), 4.5);
  assert.equal(shiftHours('09:00', '13:00', 0), 4);
  assert.equal(shiftHours('22:00', '05:00', 60), 6); // 7時間 − 休憩1時間
  assert.equal(shiftHours('09:00', '09:20', 0), 0.33);
  assert.equal(shiftHours('09:00', '09:30', 60), 0); // 休憩が長くても、負にしない
});

test('formatShift: バイト先の名前・曜日・実働。時給は出さない。日をまたぐシフトの印', () => {
  const f = formatShift(SHIFT, JOBS);
  assert.deepEqual(f, { id: 's1', date: '2026-11-20', weekday: '金', job: 'カフェ', start_time: '17:00', end_time: '22:00', overnight: false, rest_minutes: 30, hours: 4.5 });
  assert.ok(!('wage' in f));
  const night = formatShift({ ...SHIFT, start_time: '22:00:00', end_time: '05:00:00', rest_minutes: 0 }, JOBS);
  assert.equal(night.overnight, true);
  assert.equal(night.hours, 7);
  assert.equal(formatShift({ ...SHIFT, job_id: 'ない' }, JOBS).job, null); // 削除済みのバイト先でも、落ちない
});

test('describeShift: 確認用の1行', () => {
  assert.equal(describeShift(formatShift(SHIFT, JOBS)), '2026-11-20（金）カフェ 17時〜22時（休憩30分・実働4.5時間）');
  assert.equal(describeShift(formatShift({ ...SHIFT, rest_minutes: 0, start_time: '22:00', end_time: '05:30' }, JOBS)), '2026-11-20（金）カフェ 22時〜（翌日）5時30分（実働7.5時間）');
  assert.match(describeShift(formatShift({ ...SHIFT, job_id: 'ない' }, JOBS)), /バイト先不明/);
});

// ---------------- シフト（追加・変更・削除） ----------------
import { resolveJob, buildNewShift, buildShiftUpdate, findDuplicateShift } from '../supabase/functions/mcp/logic.ts';

const JOBS_W = [{ id: 'j1', name: 'カフェ', wage: 1200 }, { id: 'j2', name: '居酒屋', wage: 1500 }];
const CUR_SHIFT = { id: 's1', date: '2026-12-15', job_id: 'j1', start_time: '17:00:00', end_time: '22:00:00', wage: 1200, rest_minutes: 30, updated_at: 'u' };

test('resolveJob: バイト先の名前から選ぶ。無い・複数のときは、登録のバイト先を教える', () => {
  assert.equal(ok(resolveJob(JOBS_W, 'カフェ')).id, 'j1');
  assert.equal(ok(resolveJob(JOBS_W, '居酒')).id, 'j2'); // 一部
  bad(resolveJob(JOBS_W, 'コンビニ'), /バイト先「コンビニ」が見つかりません。登録されているバイト先: 「カフェ」、「居酒屋」/);
  bad(resolveJob([{ id: 'a', name: 'カフェA', wage: 1 }, { id: 'b', name: 'カフェB', wage: 1 }], 'カフェ'), /バイト先が複数/);
  bad(resolveJob([], 'カフェ'), /バイト先が登録されていません/);
});

test('buildNewShift: 時給はバイト先の今の時給をコピー（Claude からは指定しない）。休憩は省くと0', () => {
  const row = ok(buildNewShift({ job: 'カフェ', date: '2026-12-15', start_time: '17:00', end_time: '22:00', rest_minutes: 30 }, JOBS_W, 4));
  assert.deepEqual(row, { date: '2026-12-15', start_time: '17:00', end_time: '22:00', rest_minutes: 30, job_id: 'j1', wage: 1200, position: 4 });
  assert.equal(ok(buildNewShift({ job: '居酒屋', date: '2026-12-15', start_time: '10:00', end_time: '14:00' }, JOBS_W, 0)).rest_minutes, 0);
  assert.equal(ok(buildNewShift({ job: '居酒屋', date: '2026-12-15', start_time: '10:00', end_time: '14:00' }, JOBS_W, 0)).wage, 1500);
});

test('buildNewShift: アプリと同じく、退勤は出勤より後だけ（日をまたぐ・同じ時刻は誤り）。休憩・日付・時刻・バイト先の検査', () => {
  const base = { job: 'カフェ', date: '2026-12-15', start_time: '17:00', end_time: '22:00' };
  bad(buildNewShift({ ...base, start_time: '22:00', end_time: '05:00' }, JOBS_W, 0), /出勤より後.*日をまたぐ/);
  bad(buildNewShift({ ...base, end_time: '17:00' }, JOBS_W, 0), /出勤より後/);
  bad(buildNewShift({ ...base, rest_minutes: 300 }, JOBS_W, 0), /休憩が、働く時間/); // 5時間の勤務に300分
  bad(buildNewShift({ ...base, rest_minutes: -5 }, JOBS_W, 0), /休憩は/);
  bad(buildNewShift({ ...base, rest_minutes: 1.5 }, JOBS_W, 0), /休憩は/);
  bad(buildNewShift({ ...base, date: '2026-02-30' }, JOBS_W, 0), /日付が正しくありません/);
  bad(buildNewShift({ ...base, start_time: '25:00' }, JOBS_W, 0), /出勤の時刻が正しくありません/);
  bad(buildNewShift({ ...base, end_time: '9:00' }, JOBS_W, 0), /退勤の時刻が正しくありません/);
  bad(buildNewShift({ ...base, job: 'ない' }, JOBS_W, 0), /見つかりません/);
  assert.equal(ok(buildNewShift({ ...base, rest_minutes: 299 }, JOBS_W, 0)).rest_minutes, 299); // ぎりぎり
});

test('buildShiftUpdate: 変えた列だけ。バイト先を変えたときだけ、時給も新しいバイト先のものに', () => {
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { start_time: '18:00' }, JOBS_W)).changes, { start_time: '18:00' });
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { date: '2026-12-20', rest_minutes: 60 }, JOBS_W)).changes, { date: '2026-12-20', rest_minutes: 60 });
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { start_time: '17:00', end_time: '22:00' }, JOBS_W)).changes, {}); // 変わっていない（秒は無視）
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { job: 'カフェ' }, JOBS_W)).changes, {}); // 同じバイト先なら、時給は触らない
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { job: '居酒屋' }, JOBS_W)).changes, { job_id: 'j2', wage: 1500 });
  // 過去のシフトの時給は、時給が変わったバイト先でも、そのままにする
  const raised = [{ id: 'j1', name: 'カフェ', wage: 1400 }];
  assert.deepEqual(ok(buildShiftUpdate(CUR_SHIFT, { start_time: '18:00' }, raised)).changes, { start_time: '18:00' });
});

test('buildShiftUpdate: 変えたあとの形も検査する（日をまたぐ・休憩が長い・存在しないバイト先）', () => {
  bad(buildShiftUpdate(CUR_SHIFT, { end_time: '16:00' }, JOBS_W), /出勤より後/);
  bad(buildShiftUpdate(CUR_SHIFT, { rest_minutes: 400 }, JOBS_W), /休憩が、働く時間/);
  bad(buildShiftUpdate(CUR_SHIFT, { start_time: '21:30', rest_minutes: 30 }, JOBS_W), /休憩が、働く時間/); // 30分勤務に30分休憩
  bad(buildShiftUpdate(CUR_SHIFT, { job: 'ない' }, JOBS_W), /見つかりません/);
  bad(buildShiftUpdate(CUR_SHIFT, { date: '2026-13-01' }, JOBS_W), /日付が正しくありません/);
});

test('findDuplicateShift: 同じバイト先・日・時間（秒は無視）。時間が違えば別', () => {
  assert.equal(findDuplicateShift([CUR_SHIFT], 'j1', '2026-12-15', '17:00', '22:00'), CUR_SHIFT);
  assert.equal(findDuplicateShift([CUR_SHIFT], 'j1', '2026-12-15', '17:00', '21:00'), null);
  assert.equal(findDuplicateShift([CUR_SHIFT], 'j2', '2026-12-15', '17:00', '22:00'), null);
  assert.equal(findDuplicateShift([CUR_SHIFT], 'j1', '2026-12-16', '17:00', '22:00'), null);
});
