// タスクの計算（js/tasks.js）のテスト。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  daysBetween, sortTasks, isFolded, groupForTab, startupGroups, shouldShowStartup, dueLabel, nextPosition,
} = require('../js/tasks.js');

const TODAY = '2026-11-02';                       // 月曜
const NOW = new Date(2026, 10, 2, 9, 0);           // 11/2 9:00（端末の時刻）
let n = 0;
const task = (props = {}) => ({
  id: `t${++n}`, title: `タスク${n}`, due_date: null, completed_at: null, memo: '', position: n,
  created_at: `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00Z`, ...props,
});
const titles = list => list.map(t => t.title);

test('日数の差（月・年をまたぐ）', () => {
  assert.equal(daysBetween('2026-11-02', '2026-11-02'), 0);
  assert.equal(daysBetween('2026-11-02', '2026-11-03'), 1);
  assert.equal(daysBetween('2026-11-02', '2026-10-31'), -2);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('期限の早い順。期限のないものは下。同じ期限なら先に作ったものが上', () => {
  const list = [
    task({ title: 'なし' }), task({ title: '11/5', due_date: '2026-11-05' }),
    task({ title: '11/3-後', due_date: '2026-11-03', created_at: '2026-10-20T00:00:00Z' }),
    task({ title: '11/3-先', due_date: '2026-11-03', created_at: '2026-10-01T00:00:00Z' }),
  ];
  assert.deepEqual(titles(sortTasks(list)), ['11/3-先', '11/3-後', '11/5', 'なし']);
});

test('完了して7日たったらたたむ。まだなら、たたまない', () => {
  assert.equal(isFolded(task(), NOW), false);
  assert.equal(isFolded(task({ completed_at: new Date(2026, 9, 27, 9, 0).toISOString() }), NOW), false); // 6日前
  assert.equal(isFolded(task({ completed_at: new Date(2026, 9, 26, 9, 0).toISOString() }), NOW), true);  // 7日前
});

test('タスクのタブ: 期限で区切り、完了したものはその場に残し、7日たったものはたたむ', () => {
  const list = [
    task({ title: '昨日まで', due_date: '2026-11-01' }),
    task({ title: '昨日まで・済み', due_date: '2026-11-01', completed_at: new Date(2026, 10, 2, 8).toISOString() }),
    task({ title: '今日', due_date: '2026-11-02' }),
    task({ title: '明日', due_date: '2026-11-03' }),
    task({ title: '2週間後', due_date: '2026-11-16' }),
    task({ title: '15日後', due_date: '2026-11-17' }),
    task({ title: '期限なし' }),
    task({ title: '先月に済み', completed_at: new Date(2026, 9, 1).toISOString() }),
    task({ title: '先週に済み', completed_at: new Date(2026, 9, 20).toISOString() }),
  ];
  const { sections, folded } = groupForTab(list, TODAY, NOW);
  assert.deepEqual(sections.map(s => [s.key, titles(s.tasks)]), [
    ['overdue', ['昨日まで', '昨日まで・済み']],
    ['today', ['今日']],
    ['tomorrow', ['明日']],
    ['soon', ['2週間後']],
    ['later', ['15日後']],
    ['none', ['期限なし']],
  ]);
  assert.deepEqual(titles(folded), ['先週に済み', '先月に済み'], 'たたんだものは、新しく済んだ順');
});

test('タスクのタブ: 空の区切りは出さない', () => {
  const { sections, folded } = groupForTab([task({ title: '期限なし' })], TODAY, NOW);
  assert.deepEqual(sections.map(s => s.key), ['none']);
  assert.equal(folded.length, 0);
});

test('開いたときの一覧: 期限切れ → 今日 → 2週間以内。期限なし・済み・15日後は出さない', () => {
  const list = [
    task({ title: '15日後', due_date: '2026-11-17' }),
    task({ title: '2週間後', due_date: '2026-11-16' }),
    task({ title: '今日', due_date: '2026-11-02' }),
    task({ title: '期限切れ', due_date: '2026-10-30' }),
    task({ title: '今日・済み', due_date: '2026-11-02', completed_at: '2026-11-02T00:00:00Z' }),
    task({ title: '期限なし' }),
  ];
  assert.deepEqual(startupGroups(list, TODAY).map(g => [g.key, titles(g.tasks)]), [
    ['overdue', ['期限切れ']],
    ['today', ['今日']],
    ['soon', ['2週間後']],
  ]);
});

test('開いたときの一覧を出すのは、その日にまだ出しておらず、出すタスクがあるとき', () => {
  const list = [task({ due_date: '2026-11-02' })];
  assert.equal(shouldShowStartup(null, TODAY, list), true, 'はじめて');
  assert.equal(shouldShowStartup('2026-11-01', TODAY, list), true, '前の日に出した');
  assert.equal(shouldShowStartup(TODAY, TODAY, list), false, '今日はもう出した');
  assert.equal(shouldShowStartup(null, TODAY, [task()]), false, '期限のないタスクだけなら出さない');
  assert.equal(shouldShowStartup(null, TODAY, []), false, 'タスクがなければ出さない');
});

test('期限の説明', () => {
  assert.equal(dueLabel(null, TODAY), '');
  assert.equal(dueLabel('2026-11-02', TODAY), '今日まで');
  assert.equal(dueLabel('2026-11-03', TODAY), '明日まで');
  assert.equal(dueLabel('2026-11-05', TODAY), '11/5（木）まで');
  assert.equal(dueLabel('2026-10-30', TODAY), '10/30（金）まで・3日すぎています');
});

test('新しいタスクの並びは、今の最後のあと', () => {
  assert.equal(nextPosition([]), 0);
  assert.equal(nextPosition([{ position: 3 }, { position: 7 }]), 8);
});
