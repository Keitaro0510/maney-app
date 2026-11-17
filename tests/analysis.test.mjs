// 分析の計算（src/analysis.ts）。D28。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTotals } from '../src/analysis.ts'; // Node が型を消して読む（D17）

const e = (date, type, amount) => ({ date, type, amount, name: '', cat: '', pay: '' });

test('monthlyTotals: 終わりの月までの月数だけ、古い順に並ぶ', () => {
  const t = monthlyTotals([], 2026, 10, 12); // 2026年11月まで
  assert.equal(t.length, 12);
  assert.deepEqual([t[0].y, t[0].m], [2025, 11]); // 2025年12月
  assert.deepEqual([t[11].y, t[11].m], [2026, 10]);
  assert.equal(t[0].label, '12月');
});

test('monthlyTotals: 収入・支出・収支を月ごとに足す（年をまたぐ）', () => {
  const t = monthlyTotals([
    e('2025-12-31', 'expense', 1000), e('2026-01-01', 'income', 5000), e('2026-01-15', 'expense', 1200), e('2026-01-31', 'expense', 300),
  ], 2026, 0, 3);
  assert.deepEqual(t.map(x => [x.income, x.expense, x.net]), [[0, 0, 0], [0, 1000, -1000], [5000, 1500, 3500]]);
});

test('monthlyTotals: 範囲の外の記録・金額が文字列・種類が不明な記録', () => {
  const t = monthlyTotals([e('2024-01-01', 'expense', 999), e('2026-01-02', 'expense', '700'), e('2026-01-03', 'other', 50)], 2026, 0, 2);
  assert.deepEqual(t.map(x => [x.income, x.expense]), [[0, 0], [0, 700]]);
});

import { fuyouGauge, fuyouLimits } from '../src/analysis.ts';

test('fuyouGauge: 進み具合の段階（70%・90%・超えた）', () => {
  assert.equal(fuyouGauge(1000, 600, 600).level, 'ok');
  assert.equal(fuyouGauge(1000, 700, 700).level, 'warn');
  assert.equal(fuyouGauge(1000, 899, 899).level, 'warn');
  assert.equal(fuyouGauge(1000, 900, 900).level, 'danger');
  assert.equal(fuyouGauge(1000, 1000, 1000).level, 'over');
});

test('fuyouGauge: 残りと余裕は引き算（超えるとマイナス）。割合は0〜100で止める', () => {
  const g = fuyouGauge(1030000, 500000, 1200000);
  assert.equal(g.remaining, 530000);
  assert.equal(g.margin, -170000); // 予想は超える
  assert.equal(g.estimatedPct, 100);
  assert.ok(Math.abs(g.confirmedPct - (500000 / 1030000) * 100) < 1e-9);
  assert.equal(fuyouGauge(1000, 0, 0).confirmedPct, 0);
});

test('fuyouLimits: 設定どおりの限度額を出す', () => {
  assert.deepEqual(fuyouLimits('1030000').map(l => l.amount), [1030000]);
  assert.deepEqual(fuyouLimits('1300000').map(l => l.amount), [1300000]);
  assert.deepEqual(fuyouLimits('both').map(l => l.amount), [1030000, 1300000]);
  assert.deepEqual(fuyouLimits('').map(l => l.amount), []);
});

import { dailyExpenseHeat } from '../src/analysis.ts';

test('dailyExpenseHeat: 月の日数・1日の曜日・支出だけを日ごとに足す', () => {
  const h = dailyExpenseHeat([
    e('2026-11-05', 'expense', 1000), e('2026-11-05', 'expense', 500), e('2026-11-05', 'income', 99999),
    e('2026-11-30', 'expense', 3000), e('2026-10-31', 'expense', 7777), e('2026-12-01', 'expense', 8888),
  ], 2026, 10);
  assert.equal(h.cells.length, 30);
  assert.equal(h.offset, 0); // 2026-11-01 は日曜日
  assert.deepEqual([h.cells[4].amount, h.cells[4].count], [1500, 2]);
  assert.equal(h.cells[29].amount, 3000);
  assert.equal(h.total, 4500); // 前後の月と収入は数えない
  assert.equal(h.maxDay, 30);
});

test('dailyExpenseHeat: 濃さは最多の日を基準にする（使っていない日は0）', () => {
  const h = dailyExpenseHeat([e('2026-02-01', 'expense', 100), e('2026-02-02', 'expense', 200), e('2026-02-03', 'expense', 300), e('2026-02-04', 'expense', 400)], 2026, 1);
  assert.deepEqual(h.cells.slice(0, 5).map(c => c.level), [1, 2, 3, 4, 0]); // 25%・50%・75%・100%
  assert.equal(h.cells.length, 28);
});

test('dailyExpenseHeat: 記録がない月は maxDay が null、うるう年の2月は29日', () => {
  const h = dailyExpenseHeat([], 2028, 1);
  assert.equal(h.maxDay, null);
  assert.equal(h.total, 0);
  assert.equal(h.cells.length, 29);
  assert.ok(h.cells.every(c => c.level === 0));
});

import { averageWage, workHours, fmtHours, spendInWork } from '../src/analysis.ts';

test('averageWage: 削除済み・時給なしを除いた平均。なければ null', () => {
  assert.equal(averageWage([]), null);
  assert.equal(averageWage([{ name: 'a', wage: 1100 }, { name: 'b', wage: 1300 }]), 1200);
  assert.equal(averageWage([{ name: 'a', wage: 1100 }, { name: 'b', wage: 1300, _deleted: true }, { name: 'c' }, { name: 'd', wage: 0 }]), 1100);
  assert.equal(averageWage([{ name: 'a', wage: 1000 }, { name: 'b', wage: 1001 }]), 1001); // 四捨五入
});

test('workHours・fmtHours: 時間の計算と見せ方', () => {
  assert.equal(workHours(3000, 1200), 2.5);
  assert.equal(workHours(3000, 0), 0); // 時給がなければ0
  assert.equal(fmtHours(2.5), '2.5');
  assert.equal(fmtHours(2.04), '2');
  assert.equal(fmtHours(9.96), '10'); // 10時間未満は小数1桁（9.96は10.0に丸まる）
  assert.equal(fmtHours(70.4), '70');
  assert.equal(fmtHours(0), '0');
});

test('spendInWork: 期間の支出・時間・カテゴリの上位（支出だけ）', () => {
  const c = (date, type, amount, cat) => ({ date, type, amount, name: '', cat, pay: '' });
  const led = [c('2026-11-01', 'expense', 3000, '食費'), c('2026-11-09', 'expense', 6000, '娯楽'), c('2026-11-20', 'expense', 1000, '食費'),
    c('2026-11-21', 'income', 99999, '給料'), c('2026-10-01', 'expense', 500, '食費'), c('2026-11-22', 'expense', 200, '交通'), c('2026-11-23', 'expense', 100, '日用品')];
  const m = spendInWork(led, 2026, 10, 1000);
  assert.equal(m.total, 10300);
  assert.equal(m.hours, 10.3);
  assert.deepEqual(m.top.map(t => [t.cat, t.amount, t.hours]), [['娯楽', 6000, 6], ['食費', 4000, 4], ['交通', 200, 0.2]]); // 上位3つ
  assert.equal(spendInWork(led, 2026, null, 1000).total, 10800); // 年ぜんぶ
  const none = spendInWork(led, 2026, 10, null);
  assert.equal(none.hours, 0); // 時給がなければ時間は0（合計は出る）
  assert.equal(none.total, 10300);
});

// ---- 曜日ごとの平均（D32） ----
import { weekdayAverages, weekdayRangeStart, topWeekday } from '../src/analysis.ts';

test('weekdayAverages: 記録のない日も0円として日数に数える（平均は1日あたり）', () => {
  // 2026-11-02(月)〜2026-11-15(日) の2週間。各曜日2日ずつ
  const w = weekdayAverages([e('2026-11-02', 'expense', 1000), e('2026-11-09', 'expense', 500), e('2026-11-14', 'expense', 3000)], '2026-11-02', '2026-11-15');
  assert.deepEqual(w.map(x => x.days), [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(w[1].total, 1500); assert.equal(w[1].avg, 750); // 月曜
  assert.equal(w[6].avg, 1500); // 土曜
  assert.equal(w[0].avg, 0); // 日曜は使っていない
  assert.equal(w[0].label, '日');
});

test('weekdayAverages: 曜日ごとの日数が違う期間・両端を含む・期間の外と収入は数えない', () => {
  // 2026-11-02(月)〜2026-11-04(水)
  const w = weekdayAverages([e('2026-11-01', 'expense', 999), e('2026-11-02', 'expense', 100), e('2026-11-04', 'expense', 200), e('2026-11-05', 'expense', 999), e('2026-11-03', 'income', 999)], '2026-11-02', '2026-11-04');
  assert.deepEqual(w.map(x => x.days), [0, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual([w[1].avg, w[2].avg, w[3].avg], [100, 0, 200]);
  assert.equal(w[0].avg, 0); // 日数が0の曜日は0で割らない
});

test('weekdayAverages: 金額が文字列・割り切れない平均は四捨五入', () => {
  const w = weekdayAverages([e('2026-11-02', 'expense', '100')], '2026-11-02', '2026-11-16'); // 月曜が3回
  assert.equal(w[1].days, 3);
  assert.equal(w[1].avg, 33);
});

test('weekdayRangeStart: 3か月・6か月は今日を含めてさかのぼる。all は最古の支出の日', () => {
  assert.equal(weekdayRangeStart([], '3m', '2026-11-17'), '2026-08-18');
  assert.equal(weekdayRangeStart([], '6m', '2026-11-17'), '2026-05-18');
  assert.equal(weekdayRangeStart([], '3m', '2026-05-31'), '2026-03-01'); // 2月31日は無いので、2月末の翌日
  assert.equal(weekdayRangeStart([], '3m', '2027-01-15'), '2026-10-16'); // 年をまたぐ
  const led = [e('2026-03-05', 'income', 1), e('2026-04-10', 'expense', 5), e('2026-06-01', 'expense', 5), e('2026-12-01', 'expense', 5)];
  assert.equal(weekdayRangeStart(led, 'all', '2026-11-17'), '2026-04-10'); // 収入と、今日より先の記録は数えない
  assert.equal(weekdayRangeStart([e('2026-03-05', 'income', 1)], 'all', '2026-11-17'), null);
});

test('topWeekday: 平均が最大の曜日。支出がなければ null', () => {
  const w = weekdayAverages([e('2026-11-02', 'expense', 100), e('2026-11-06', 'expense', 900)], '2026-11-02', '2026-11-08');
  assert.equal(topWeekday(w).label, '金');
  assert.equal(topWeekday(weekdayAverages([], '2026-11-02', '2026-11-08')), null);
});

// ---- カテゴリ別の月推移（D32） ----
import { categoryTrend } from '../src/analysis.ts';
const ec = (date, cat, amount) => ({ date, type: 'expense', amount, name: '', cat, pay: '' });

test('categoryTrend: 月の並び（古い順・年またぎ）とカテゴリごとの月別の合計', () => {
  const t = categoryTrend([ec('2025-12-05', '食費', 1000), ec('2026-01-10', '食費', 500), ec('2026-01-20', '交通', 300), ec('2026-01-21', '食費', '200')], 2026, 0, 3);
  assert.deepEqual(t.labels, ['11月', '12月', '1月']);
  assert.deepEqual(t.series.map(s => [s.cat, s.amounts]), [['食費', [0, 1000, 700]], ['交通', [0, 0, 300]]]);
  assert.deepEqual(t.monthTotals, [0, 1000, 1000]);
});

test('categoryTrend: 上位 n 個のほかは「その他」にまとめて最後に置く', () => {
  const led = [ec('2026-01-01', 'A', 500), ec('2026-01-01', 'B', 400), ec('2026-01-01', 'C', 300), ec('2026-02-01', 'D', 100), ec('2026-01-01', 'E', 50)];
  const t = categoryTrend(led, 2026, 1, 2, 2);
  assert.deepEqual(t.series.map(s => s.cat), ['A', 'B', 'その他']);
  assert.deepEqual(t.series[2].amounts, [350, 100]); // C+E と D
  assert.deepEqual(t.monthTotals, [1250, 100]);
});

test('categoryTrend: 同額はカテゴリ名順・範囲の外と収入と0円は数えない・支出なしは空', () => {
  const t = categoryTrend([ec('2026-01-01', 'B', 100), ec('2026-01-02', 'A', 100), ec('2024-01-01', 'Z', 999), { ...ec('2026-01-03', 'X', 999), type: 'income' }, ec('2026-01-04', 'Y', 0)], 2026, 0, 1);
  assert.deepEqual(t.series.map(s => s.cat), ['A', 'B']);
  const none = categoryTrend([], 2026, 0, 3);
  assert.deepEqual(none.series, []);
  assert.deepEqual(none.monthTotals, [0, 0, 0]);
});

test('categoryTrend: 上位 n 個ちょうどなら「その他」は作らない', () => {
  const t = categoryTrend([ec('2026-01-01', 'A', 1), ec('2026-01-01', 'B', 2)], 2026, 0, 1, 2);
  assert.deepEqual(t.series.map(s => s.cat), ['B', 'A']);
});

// ---- 月の中の時期（D32） ----
import { dayOfMonthAverages, averageOnDays } from '../src/analysis.ts';

test('dayOfMonthAverages: 日にちごとに、その日にちが何回あったかで割る（29〜31日はある月だけ）', () => {
  // 2026-01-01〜2026-02-28（1月31日・2月28日）。31日は1月だけ、29・30日は1月だけ（2月は28日まで）
  const t = dayOfMonthAverages([ec('2026-01-31', 'A', 900), ec('2026-01-05', 'A', 100), ec('2026-02-05', 'A', 300)], '2026-01-01', '2026-02-28');
  assert.equal(t.length, 31);
  assert.deepEqual([t[0].days, t[27].days, t[28].days, t[30].days], [2, 2, 1, 1]);
  assert.equal(t[4].avg, 200); // 5日: (100+300)÷2回
  assert.equal(t[30].avg, 900); // 31日: 900÷1回
  assert.equal(t[0].avg, 0);
});

test('dayOfMonthAverages: 期間の途中から・外の記録と収入は数えない', () => {
  const t = dayOfMonthAverages([ec('2026-01-10', 'A', 999), ec('2026-01-20', 'A', 500), { ...ec('2026-01-20', 'A', 999), type: 'income' }], '2026-01-15', '2026-02-15');
  assert.equal(t[9].days, 1); // 10日は2/10だけ
  assert.equal(t[9].total, 0);
  assert.equal(t[19].avg, 500);
  assert.equal(t[14].days, 2); // 15日は両端
});

test('averageOnDays: 指定した日にちの1日あたりの平均。該当がなければ null', () => {
  const t = dayOfMonthAverages([ec('2026-01-05', 'A', 300), ec('2026-01-10', 'A', 100)], '2026-01-01', '2026-02-28');
  assert.equal(averageOnDays(t, [5, 10]), 100); // (300+100)÷(2+2)
  assert.equal(averageOnDays(t, [5]), 150);
  assert.equal(averageOnDays(t, []), null);
  assert.equal(averageOnDays(dayOfMonthAverages([], '2026-02-01', '2026-02-10'), [31]), null); // 期間に31日がない
});

test('weekdayRangeStart: 12か月', () => {
  assert.equal(weekdayRangeStart([], '12m', '2026-11-17'), '2025-11-18');
});

// ---- 予定・シフトの日とない日（D32） ----
import { eventDaySet, compareEventDays } from '../src/analysis.ts';
const plan = (dateStart, dateEnd, extra = {}) => ({ id: 1, title: 'p', date: dateStart, dateStart, dateEnd, timeStart: '', timeEnd: '', ...extra });
const shift = (date, extra = {}) => ({ job: 'j', date, start: null, end: null, rest: 0, wage: 0, ...extra });

test('eventDaySet: 予定は期間の全日、シフトはその日。削除済みは除く・月またぎ', () => {
  const s = eventDaySet(
    [plan('2026-01-30', '2026-02-02'), plan('2026-03-05', '2026-03-05'), plan('2026-04-01', '2026-04-03', { _deleted: true })],
    [shift('2026-01-10'), shift('2026-01-11', { _deleted: true })]);
  assert.deepEqual([...s].sort(), ['2026-01-10', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-03-05']);
});

test('eventDaySet: 終わりの日がない・終わりが前・長すぎる予定', () => {
  assert.deepEqual([...eventDaySet([plan('2026-01-05', '')], [])], ['2026-01-05']);
  assert.deepEqual([...eventDaySet([plan('2026-01-05', '2026-01-01')], [])], ['2026-01-05']); // 終わりが前なら開始の日だけ
  assert.equal(eventDaySet([plan('2026-01-01', '2030-01-01')], []).size, 366);
});

test('compareEventDays: 予定・シフトのある日とない日で、1日あたりの平均を出す', () => {
  // 2026-01-01〜01-10。予定の日: 1・2・3日、シフトの日: 3日・10日 → 4日分
  const ev = eventDaySet([plan('2026-01-01', '2026-01-03')], [shift('2026-01-03'), shift('2026-01-10')]);
  const r = compareEventDays([ec('2026-01-02', 'A', 800), ec('2026-01-03', 'A', 400), ec('2026-01-05', 'A', 600), ec('2025-12-31', 'A', 999), { ...ec('2026-01-06', 'A', 999), type: 'income' }], ev, '2026-01-01', '2026-01-10');
  assert.deepEqual(r.withEvent, { days: 4, total: 1200, avg: 300 });
  assert.deepEqual(r.without, { days: 6, total: 600, avg: 100 });
});

test('compareEventDays: 該当の日がなければ平均は0（0で割らない）', () => {
  const r = compareEventDays([], new Set(), '2026-01-01', '2026-01-03');
  assert.deepEqual(r.withEvent, { days: 0, total: 0, avg: 0 });
  assert.equal(r.without.days, 3);
});
