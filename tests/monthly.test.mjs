// 毎月のお金の計算（js/monthly.js）のテスト。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../js/monthly.js');

const TODAY = '2026-11-15';
const rule = props => ({
  id: 'r1', name: '家賃', amount: 50000, day: 27, kind: 'expense', payment_method: 'bank', card_id: null,
  start_month: null, end_month: null, legacy_id: null, position: 0, ...props,
});

test('状態: 今月も数える・これから始まる・終わった', () => {
  assert.equal(M.status(rule(), TODAY), 'active');
  assert.equal(M.status(rule({ start_month: '2026-11-01' }), TODAY), 'active', '今月から');
  assert.equal(M.status(rule({ end_month: '2026-11-01' }), TODAY), 'active', '今月まで（今月はまだ数える）');
  assert.equal(M.status(rule({ start_month: '2026-12-01' }), TODAY), 'future');
  assert.equal(M.status(rule({ end_month: '2026-10-01' }), TODAY), 'ended');
});

test('期間の文字', () => {
  assert.equal(M.periodLabel(rule()), '');
  assert.equal(M.periodLabel(rule({ start_month: '2026-11-01' })), '2026年11月から');
  assert.equal(M.periodLabel(rule({ end_month: '2027-01-01' })), '2027年1月まで');
  assert.equal(M.periodLabel(rule({ start_month: '2026-06-01', end_month: '2026-10-01' })), '2026年6月〜2026年10月');
  assert.equal(M.periodLabel(rule({ start_month: '2026-11-01', end_month: '2026-11-01' })), '2026年11月だけ');
});

test('やめる: 今月まで・先月まで。始まる月より前にはできない', () => {
  assert.equal(M.stopMonth(rule(), TODAY, 'this'), '2026-11-01');
  assert.equal(M.stopMonth(rule(), TODAY, 'last'), '2026-10-01');
  assert.equal(M.stopMonth(rule(), '2026-01-31', 'last'), '2025-12-01', '年をまたぐ');
  assert.equal(M.stopMonth(rule({ start_month: '2026-11-01' }), TODAY, 'this'), '2026-11-01');
  assert.equal(M.stopMonth(rule({ start_month: '2026-11-01' }), TODAY, 'last'), null, '今月から始めたものを先月までにはできない');
  assert.equal(M.stopMonth(rule({ start_month: '2026-12-01' }), TODAY, 'this'), null, 'まだ始まっていない');
});

test('来月から金額を変える: 今のルールを今月までにして、来月からのルールを作る（過去の金額は変わらない）', () => {
  const changes = M.changeAmountChanges(rule({ payment_method: 'card', card_id: 'c1', position: 3 }), TODAY, 55000,
    { newId: () => 'r2', position: 9 });
  assert.deepStrictEqual(changes, [
    { table: 'fixed_costs', action: 'update', id: 'r1', row: { end_month: '2026-11-01' } },
    { table: 'fixed_costs', action: 'insert', id: 'r2', row: {
      name: '家賃', amount: 55000, day: 27, kind: 'expense', payment_method: 'card', card_id: 'c1',
      start_month: '2026-12-01', end_month: null, position: 9,
    } },
  ]);
});

test('来月から金額を変える: 先にやめる月が決まっていれば、新しいルールもその月まで', () => {
  const [, insert] = M.changeAmountChanges(rule({ end_month: '2027-03-01' }), TODAY, 1, { newId: () => 'r2', position: 1 });
  assert.equal(insert.row.end_month, '2027-03-01');
});

test('来月から金額を変える: 来月より先から始まるものは、金額を直すだけ', () => {
  assert.deepStrictEqual(M.changeAmountChanges(rule({ start_month: '2026-12-01' }), TODAY, 60000, { newId: () => 'x', position: 1 }),
    [{ table: 'fixed_costs', action: 'update', id: 'r1', row: { amount: 60000 } }]);
});

test('来月から金額を変える: 今月で終わるもの・終わったものはできない', () => {
  assert.equal(M.canChangeAmount(rule({ end_month: '2026-11-01' }), TODAY), false);
  assert.equal(M.canChangeAmount(rule({ end_month: '2026-10-01' }), TODAY), false);
  assert.equal(M.canChangeAmount(rule({ end_month: '2026-12-01' }), TODAY), true);
  assert.throws(() => M.changeAmountChanges(rule({ end_month: '2026-11-01' }), TODAY, 1, { newId: () => 'x', position: 1 }), /終わっている/);
});

test('来月から払い方を変える（カードを消したとき）: 金額はそのまま、払い方だけ来月から変える', () => {
  const [end, insert] = M.changeFromNextMonthChanges(rule({ payment_method: 'card', card_id: 'c1' }), TODAY,
    { payment_method: 'bank', card_id: null }, { newId: () => 'r2', position: 2 });
  assert.deepStrictEqual(end.row, { end_month: '2026-11-01' });
  assert.equal(insert.row.amount, 50000);
  assert.equal(insert.row.payment_method, 'bank');
  assert.equal(insert.row.card_id, null);
  assert.equal(insert.row.start_month, '2026-12-01');
});

test('毎月くり返す: その日を毎月の日にして、その月から数える', () => {
  assert.deepStrictEqual(
    M.newRule({ name: '動画', amount: 990, dateKey: '2026-11-05', kind: 'expense', payment_method: 'card', card_id: 'c1' }, 4),
    { name: '動画', amount: 990, day: 5, kind: 'expense', payment_method: 'card', card_id: 'c1', start_month: '2026-11-01', end_month: null, position: 4 });
  assert.deepStrictEqual(
    M.newRule({ name: '家賃', amount: 50000, dateKey: '2026-12-27', kind: 'expense', payment_method: 'bank', card_id: 'c1' }, 0),
    { name: '家賃', amount: 50000, day: 27, kind: 'expense', payment_method: 'bank', card_id: null, start_month: '2026-12-01', end_month: null, position: 0 },
    'カード払いでなければ、カードは空');
  assert.deepStrictEqual(
    M.newRule({ name: '仕送り', amount: 30000, dateKey: '2026-11-25', kind: 'income', payment_method: 'cash', card_id: null }, 1),
    { name: '仕送り', amount: 30000, day: 25, kind: 'income', payment_method: null, card_id: null, start_month: '2026-11-01', end_month: null, position: 1 },
    '収入の払い方は空（口座に入るものとして数える）');
});

test('消した行を戻す中身には、サーバーが決める列を入れない', () => {
  const row = { ...rule({ legacy_id: 123 }), user_id: 'u', created_at: 'c', updated_at: 'u' };
  const back = M.restoreRow(row);
  assert.deepStrictEqual(Object.keys(back).sort(),
    ['amount', 'card_id', 'day', 'end_month', 'kind', 'legacy_id', 'name', 'payment_method', 'position', 'start_month']);
  assert.equal(back.legacy_id, 123);
});

test('一覧の分け方と並び', () => {
  const rows = [
    rule({ id: 'a', day: 27 }),
    rule({ id: 'b', day: 3, position: 5 }),
    rule({ id: 'c', end_month: '2026-08-01' }),
    rule({ id: 'd', end_month: '2026-10-01' }),
    rule({ id: 'e', start_month: '2027-02-01' }),
    rule({ id: 'f', start_month: '2026-12-01', day: 30 }),
  ];
  const g = M.groups(rows, TODAY);
  assert.deepStrictEqual(g.active.map(r => r.id), ['b', 'a']);
  assert.deepStrictEqual(g.future.map(r => r.id), ['f', 'e']);
  assert.deepStrictEqual(g.ended.map(r => r.id), ['d', 'c'], '終わった月の新しい順');
});

test('月をずらす・並びの次の番号', () => {
  assert.equal(M.addMonths('2026-12-01', 1), '2027-01-01');
  assert.equal(M.addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(M.nextPosition([]), 0);
  assert.equal(M.nextPosition([{ position: 2 }, { position: 7 }]), 8);
});
