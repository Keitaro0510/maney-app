// お金の計算（js/money.js）のテスト。実行: node --test "tests/*.test.mjs"
// 架空の行を組み立てて、D11・D14 の数え方を確かめる。月（m）は 0 が1月
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/clock.js');
const M = require('../js/money.js');

// 基本の行: 基準日 10/1 に残高 100,000円。カード1枚（月末締め・27日払い）、バイト1つ（25日払い）
function baseRows(extra = {}) {
  return {
    settings: [{ id: 's', acct_base: 100000, base_date: '2026-10-01', budget: 0, shift_pay_day: 10, shift_close_day: 31 }],
    cards: [{ id: 'card1', name: 'Aカード', close_day: 31, bill_day: 27, position: 0 }],
    jobs: [{ id: 'job1', name: 'カフェ', wage: 1000, night_start: '22:00:00', night_rate: 25, transport: 0, pay_day: 25, close_day: 31, position: 0 }],
    categories: [], ledger_entries: [], shifts: [], plans: [], fixed_costs: [], withdrawals: [],
    salary_actuals: [], card_bill_actuals: [],
    ...extra,
  };
}
let n = 0;
const id = p => `${p}${++n}`;
const ledger = (date, kind, amount, payment_method, card_id = null) => ({ id: id('l'), date, kind, amount, payment_method, card_id, name: 'x', position: n });
const shift = (date, start, end, rest = 0) => ({ id: id('s'), date, job_id: 'job1', start_time: `${start}:00`, end_time: `${end}:00`, rest_minutes: rest, position: n });
const fixed = props => ({ id: id('f'), name: '固定', amount: 0, day: 1, kind: 'expense', payment_method: 'bank', card_id: null, start_month: null, end_month: null, position: n, ...props });
const plan = props => ({ id: id('p'), title: '予定', start_date: '2026-11-10', end_date: '2026-11-10', budget: 0, done: false, card_id: null, position: n, ...props });

// ---------- シフトの給料 ----------
test('シフトの給料: ふつうの時間・深夜の割増・休憩・交通費', () => {
  const job = { wage: 1000, nightStart: '22:00', nightRate: 25, transport: 300 };
  assert.deepEqual(M.shiftIncome({ start: '10:00', end: '15:00', rest: 0 }, job).total, 5000 + 600);
  const night = M.shiftIncome({ start: '20:00:00', end: '23:00:00', rest: 0 }, job);
  assert.equal(night.wage, 2000);
  assert.equal(night.nightWage, 1250);
  // 休憩60分は、ふつうと深夜の時間に割合で分ける（3時間 → 2時間）
  const rest = M.shiftIncome({ start: '20:00', end: '23:00', rest: 60 }, job);
  assert.equal(rest.wage + rest.nightWage, Math.round(2000 * 2 / 3) + Math.round(1250 * 2 / 3));
});

// ---------- カード ----------
test('カードの集計: 前々月の締め日の次の日から前月の締め日まで（月末締め）', () => {
  const rows = baseRows({
    ledger_entries: [
      ledger('2026-09-30', 'expense', 1000, 'card', 'card1'), // 前の集計
      ledger('2026-10-01', 'expense', 2000, 'card', 'card1'),
      ledger('2026-10-31', 'expense', 3000, 'card', 'card1'),
      ledger('2026-11-01', 'expense', 4000, 'card', 'card1'), // 次の集計
      ledger('2026-10-15', 'expense', 9999, 'cash'),           // 現金は入らない
    ],
  });
  const c = M.cardCycle(rows, rows.cards[0], 2026, 10); // 11月に引き落とし
  assert.equal(c.cs, '2026-10-01');
  assert.equal(c.ce, '2026-10-31');
  assert.equal(c.amount, 5000);
});

test('カードの集計: カード払いの固定費と予定（済みでないもの）も入る。固定費は期間の外の月を数えない', () => {
  const rows = baseRows({
    fixed_costs: [
      fixed({ name: 'サブスク', amount: 990, day: 15, payment_method: 'card', card_id: 'card1' }),
      fixed({ name: 'やめたサブスク', amount: 500, day: 15, payment_method: 'card', card_id: 'card1', end_month: '2026-09-01' }),
    ],
    plans: [
      plan({ budget: 3000, start_date: '2026-10-20', end_date: '2026-10-20', card_id: 'card1' }),
      plan({ budget: 7000, start_date: '2026-10-21', end_date: '2026-10-21', card_id: 'card1', done: true }),
    ],
  });
  assert.equal(M.cardCycle(rows, rows.cards[0], 2026, 10).amount, 990 + 3000);
  // 9月分（10月に引き落とし）では、やめたサブスクも数える
  assert.equal(M.cardCycle(rows, rows.cards[0], 2026, 9).amount, 990 + 500);
});

test('カードの引き落とし額: 実績があれば実績', () => {
  const rows = baseRows({
    ledger_entries: [ledger('2026-10-05', 'expense', 2000, 'card', 'card1')],
    card_bill_actuals: [{ id: 'a', card_id: 'card1', bill_month: '2026-11-01', actual_amount: 2500, estimated_amount: 2000 }],
  });
  assert.deepEqual(M.cardBill(rows, rows.cards[0], 2026, 10), { amount: 2500, actual: true });
  assert.deepEqual(M.cardBill(rows, rows.cards[0], 2026, 11), { amount: 0, actual: false });
});

test('確定と集計中の引き落としの月（締め日の前と後）', () => {
  const card = { close_day: 15, bill_day: 10 };
  assert.deepEqual(M.cardCycleMonths(card, '2026-10-15'), { confirmed: { y: 2026, m: 9 }, pending: { y: 2026, m: 10 } });
  assert.deepEqual(M.cardCycleMonths(card, '2026-10-16'), { confirmed: { y: 2026, m: 10 }, pending: { y: 2026, m: 11 } });
});

// ---------- 給料 ----------
test('給料: 実績があれば実績、なければ前の月のシフトから', () => {
  const rows = baseRows({
    shifts: [shift('2026-09-10', '10:00', '15:00'), shift('2026-10-10', '10:00', '12:00')],
    salary_actuals: [{ id: 'a', job_id: 'job1', pay_month: '2026-10-01', paid_on: '2026-10-25', actual_amount: 4800, estimated_amount: 5000 }],
  });
  const job = rows.jobs[0];
  assert.deepEqual(M.salary(rows, job, 2026, 9), { amount: 4800, actual: true });   // 10月払い（9月分）
  assert.deepEqual(M.salary(rows, job, 2026, 10), { amount: 2000, actual: false }); // 11月払い（10月分）
});

// ---------- 残高 ----------
test('残高: 給料・固定費・カード・ATM・口座振込の収入。現金の支出は引かない', () => {
  const rows = baseRows({
    shifts: [shift('2026-09-10', '10:00', '20:00')],                                       // 10/25 に 10,000円
    fixed_costs: [
      fixed({ name: '家賃', amount: 30000, day: 27, payment_method: 'bank' }),
      fixed({ name: 'ジム', amount: 5000, day: 5, payment_method: 'cash' }),            // 現金は口座の外
      fixed({ name: '仕送り', amount: 20000, day: 3, kind: 'income', payment_method: null }),
      fixed({ name: '奨学金', amount: 40000, day: 11, kind: 'income', payment_method: null }),
    ],
    ledger_entries: [
      ledger('2026-09-20', 'expense', 6000, 'card', 'card1'),                               // 10/27 に引き落とし
      ledger('2026-10-02', 'expense', 1500, 'cash'),                                        // 現金は引かない
      ledger('2026-10-08', 'income', 3000, 'bank'),
      ledger('2026-10-09', 'income', 1000, 'cash'),                                         // 現金の収入も口座の外
    ],
    withdrawals: [{ id: 'w', date: '2026-10-12', amount: 10000 }],
  });
  const expected = 100000 + 20000 + 3000 + 40000 - 10000 + 10000 - 30000 - 6000;
  assert.equal(M.balanceAt(rows, '2026-10-31'), expected);
  // 基準日より前の動きは数えない
  assert.equal(M.balanceAt(rows, '2026-10-01'), 100000);
});

test('残高: 支出の口座払いは、その日に引く（D11）', () => {
  const rows = baseRows({ ledger_entries: [ledger('2026-10-27', 'expense', 50000, 'bank')] });
  assert.equal(M.balanceAt(rows, '2026-10-26'), 100000);
  assert.equal(M.balanceAt(rows, '2026-10-27'), 50000);
});

test('残高: やめた固定費も、過去の月は数え続ける（D14）', () => {
  const rows = baseRows({ fixed_costs: [fixed({ amount: 1000, day: 20, end_month: '2026-11-01' })] });
  assert.equal(M.balanceAt(rows, '2027-01-31'), 100000 - 1000 * 2); // 10月・11月だけ
  const later = baseRows({ fixed_costs: [fixed({ amount: 1000, day: 20, start_month: '2026-12-01' })] });
  assert.equal(M.balanceAt(later, '2027-01-31'), 100000 - 1000 * 2); // 12月・1月だけ
});

test('残高推移: 今日の次の日から、予定（カード払い以外・済みでないもの）も予定の日に引く', () => {
  const rows = baseRows({
    plans: [
      plan({ budget: 8000, start_date: '2026-11-03', end_date: '2026-11-05' }),
      plan({ budget: 5000, start_date: '2026-11-04', end_date: '2026-11-04', card_id: 'card1' }), // カードの集計に入る（12/27）
      plan({ budget: 9000, start_date: '2026-11-04', end_date: '2026-11-04', done: true }),
    ],
  });
  const s = M.balanceSeries(rows, '2026-11-01', 5);
  assert.deepEqual(s.map(p => p.balance), [100000, 100000, 92000, 92000, 92000, 92000]);
  assert.equal(s[0].date, '2026-11-01');
});

// ---------- 給料日までに使えるお金 ----------
test('次の給料日: 今日が給料日なら、その次。月にない日は月末', () => {
  const rows = baseRows();
  assert.deepEqual(M.nextPayday(rows, '2026-10-24'), { date: '2026-10-25', days: 1 });
  assert.deepEqual(M.nextPayday(rows, '2026-10-25'), { date: '2026-11-25', days: 31 });
  const end = baseRows({ jobs: [{ ...baseRows().jobs[0], pay_day: 31 }] });
  assert.deepEqual(M.nextPayday(end, '2026-11-10'), { date: '2026-11-30', days: 20 });
});

test('次の給料日: 削除したバイト先は数えない。バイト先がなければ設定の給料日', () => {
  const rows = baseRows({ jobs: [{ ...baseRows().jobs[0], pay_day: 5, deleted_at: '2026-10-01T00:00:00Z' }] });
  assert.equal(M.nextPayday(rows, '2026-11-01').date, '2026-11-10');
});

test('給料日までに使えるお金: 給料日の前の日までの引き落とし・予定を引く。カード払いの予定は二重に引かない', () => {
  const rows = baseRows({
    fixed_costs: [fixed({ name: '家賃', amount: 30000, day: 20, payment_method: 'bank' }), fixed({ name: '25日以降', amount: 7000, day: 26 })],
    ledger_entries: [ledger('2026-10-10', 'expense', 6000, 'card', 'card1')], // 11/27 に引き落とし（給料日のあと）
    plans: [
      plan({ budget: 4000, start_date: '2026-11-12', end_date: '2026-11-12' }),
      plan({ budget: 2000, start_date: '2026-11-08', end_date: '2026-11-11' }),             // 今日より前に始まって、続いている
      plan({ budget: 5000, start_date: '2026-11-13', end_date: '2026-11-13', card_id: 'card1' }), // カードの集計に入る（12/27）
      plan({ budget: 3000, start_date: '2026-11-25', end_date: '2026-11-25' }),             // 給料日のあと
    ],
  });
  const today = '2026-11-10';
  const balance = M.balanceAt(rows, today); // 100,000 − 家賃（10/20）− 25日以降（10/26）
  assert.equal(balance, 100000 - 30000 - 7000);
  const s = M.spendable(rows, today);
  assert.equal(s.payday, '2026-11-25');
  assert.equal(s.until, '2026-11-24');
  assert.equal(s.days, 15);
  assert.equal(s.amount, balance - 30000 - 4000 - 2000); // 11/20 の家賃と、給料日の前の予定
  assert.equal(s.perDay, Math.floor(s.amount / 15));
});

test('給料日までに使えるお金は、足りないときマイナスのまま（D11）', () => {
  const rows = baseRows({ fixed_costs: [fixed({ amount: 150000, day: 20 })] });
  const s = M.spendable(rows, '2026-11-10');
  assert.ok(s.amount < 0);
  assert.ok(s.perDay < 0);
});

test('これから先のお金の動き: 日付の順。0円のものは出さない', () => {
  const rows = baseRows({
    fixed_costs: [fixed({ name: '家賃', amount: 30000, day: 20 })],
    plans: [plan({ title: '旅行', budget: 8000, start_date: '2026-11-15', end_date: '2026-11-16' })],
  });
  const list = M.upcoming(rows, '2026-11-10', 14);
  assert.deepEqual(list.map(e => [e.date, e.kind, e.amount]), [['2026-11-15', 'plan', -8000], ['2026-11-20', 'fixed_cost', -30000]]);
});
