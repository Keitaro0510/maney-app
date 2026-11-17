// キリンのセリフの材料（src/mascot-facts.ts）。D34。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysToPayday, budgetFact, weekdayFact, mascotFacts, factLines } from '../src/mascot-facts.ts';
import { mascotView } from '../src/mascot.ts';

const ex = (date, amount) => ({ date, type: 'expense', amount, name: '', cat: '', pay: '' });

test('daysToPayday: 今日が給料日なら0・今月の後ろ・来月・年またぎ・複数の給料日は近いほう', () => {
  assert.equal(daysToPayday('2026-11-25', [25]), 0);
  assert.equal(daysToPayday('2026-11-20', [25]), 5);
  assert.equal(daysToPayday('2026-11-26', [25]), 29); // 来月の25日まで（11月は30日）
  assert.equal(daysToPayday('2026-12-28', [10]), 13); // 年をまたぐ
  assert.equal(daysToPayday('2026-11-20', [25, 22]), 2);
  assert.equal(daysToPayday('2026-11-20', []), null);
  assert.equal(daysToPayday('2026-11-20', [0, 32]), null); // 範囲の外は無視
});

test('daysToPayday: 31日の給料日は、短い月では月末にする', () => {
  assert.equal(daysToPayday('2026-02-20', [31]), 8); // 2月は28日が月末
  assert.equal(daysToPayday('2026-04-29', [31]), 1); // 4月は30日が月末
});

test('budgetFact: 予算なし・月の初め・使いきり・ペース（遅い/ちょうど/早い）', () => {
  assert.equal(budgetFact(1000, 0, '2026-11-15'), null);
  assert.deepEqual(budgetFact(1000, 30000, '2026-11-05'), { pct: 3, pace: null }); // 7日までは、まだ分からない
  assert.deepEqual(budgetFact(30000, 30000, '2026-11-05'), { pct: 100, pace: 'over' }); // 使いきりは月の初めでも
  assert.deepEqual(budgetFact(40000, 30000, '2026-11-20'), { pct: 133, pace: 'over' });
  // 11月（30日）の15日＝経過50%
  assert.equal(budgetFact(10000, 30000, '2026-11-15').pace, 'slow'); // 33% ÷ 50% = 0.67
  assert.equal(budgetFact(15000, 30000, '2026-11-15').pace, 'ok'); // 50% ÷ 50% = 1.0
  assert.equal(budgetFact(20000, 30000, '2026-11-15').pace, 'fast'); // 67% ÷ 50% = 1.33
});

test('weekdayFact: その曜日が多い・少ない。日数が足りない・支出なしは null', () => {
  // 2026-11-17 は火曜。直近6か月の火曜は約26回。火曜だけ大きく使った記録を作る
  const ledger = [];
  for (let d = new Date(2026, 4, 19); d <= new Date(2026, 10, 17); d.setDate(d.getDate() + 1)) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ledger.push(ex(ds, d.getDay() === 2 ? 3000 : 1000));
  }
  assert.deepEqual(weekdayFact(ledger, '2026-11-17'), { label: '火', trend: 'high' });
  assert.equal(weekdayFact(ledger, '2026-11-18'), null); // 水曜はふつう
  const low = ledger.map(l => ({ ...l, amount: new Date(l.date).getDay() === 2 ? 100 : 1000 }));
  assert.deepEqual(weekdayFact(low, '2026-11-17'), { label: '火', trend: 'low' });
  assert.equal(weekdayFact([], '2026-11-17'), null);
  assert.equal(weekdayFact([ex('2026-11-10', 5000)], '2026-11-17'), null); // 記録の期間が8週間に満たない（1件だけ）
  assert.equal(weekdayFact(ledger.filter(l => l.date >= '2026-10-01'), '2026-11-17'), null); // 10/1 から（48日）では足りない
  assert.ok(weekdayFact(ledger.filter(l => l.date >= '2026-09-20'), '2026-11-17')); // 9/20 から（58日）なら言える
});

test('mascotFacts: 今月の支出は家計簿の記録だけ（収入・先月は数えない）', () => {
  const f = mascotFacts({ ledger: [ex('2026-11-02', 4000), ex('2026-11-10', 5000), ex('2026-10-30', 99999), { ...ex('2026-11-11', 99999), type: 'income' }], payDays: [25], budget: 30000, today: '2026-11-15' });
  assert.equal(f.budget.pct, 30); // 9000 ÷ 30000
  assert.equal(f.daysToPayday, 10);
});

test('factLines: 給料日は7日前から。0日・1日・n日の言い方。8日以上先は言わない', () => {
  const base = { daysToPayday: null, budget: null, weekday: null };
  assert.deepEqual(factLines(base), []);
  assert.match(factLines({ ...base, daysToPayday: 0 })[0], /今日は給料日/);
  assert.match(factLines({ ...base, daysToPayday: 1 })[0], /明日は給料日/);
  assert.match(factLines({ ...base, daysToPayday: 5 })[0], /あと5日/);
  assert.deepEqual(factLines({ ...base, daysToPayday: 8 }), []);
});

test('factLines: 予算のペースと曜日の傾向。月の初め（ペースが分からない）は予算の文を出さない', () => {
  const base = { daysToPayday: null, budget: null, weekday: null };
  assert.match(factLines({ ...base, budget: { pct: 40, pace: 'slow' } })[0], /40%.*いいペース/);
  assert.match(factLines({ ...base, budget: { pct: 80, pace: 'fast' } })[0], /80%.*早め/);
  assert.match(factLines({ ...base, budget: { pct: 100, pace: 'over' } })[0], /使いきった/);
  assert.deepEqual(factLines({ ...base, budget: { pct: 3, pace: null } }), []);
  assert.match(factLines({ ...base, weekday: { label: '金', trend: 'high' } })[0], /金曜日/);
  assert.match(factLines({ ...base, weekday: { label: '日', trend: 'low' } })[0], /日曜日/);
});

test('どの材料の文も、責めたり、叱ったりする言葉を使わない', () => {
  const all = [];
  for (const d of [0, 1, 3]) all.push(...factLines({ daysToPayday: d, budget: null, weekday: null }));
  for (const pace of ['over', 'fast', 'ok', 'slow']) all.push(...factLines({ daysToPayday: null, budget: { pct: 90, pace }, weekday: null }));
  for (const trend of ['high', 'low']) all.push(...factLines({ daysToPayday: null, budget: null, weekday: { label: '土', trend } }));
  assert.ok(all.length >= 9);
  for (const text of all) assert.doesNotMatch(text, /使いすぎ|ダメ|だめ|ざんねん|残念|節約しな|我慢|やめ/);
});

test('mascotView: 材料の文は、ふだんと今日記録したときだけ混ざる。足りない・連続・おかえりは決まった文のまま', () => {
  const facts = { daysToPayday: 2, budget: null, weekday: null };
  const base = { spendable: 50000, streak: 0, recordedToday: false, daysSinceRecord: 1, today: '2026-11-17', facts };
  const texts = situation => new Set(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(today => mascotView({ ...base, ...situation, today }).text));
  assert.ok([...texts({})].some(t => /給料日まであと2日/.test(t))); // ふだん
  assert.ok([...texts({ recordedToday: true })].some(t => /給料日まであと2日/.test(t))); // 今日記録した
  for (const s of [{ spendable: -1 }, { streak: 5 }, { daysSinceRecord: 5 }]) {
    assert.ok(![...texts(s)].some(t => /給料日/.test(t)), JSON.stringify(s));
  }
});

test('mascotView: 材料がなくても（facts なしでも）今までどおり動く', () => {
  const v = mascotView({ spendable: 1, streak: 0, recordedToday: false, daysSinceRecord: 1, today: '2026-11-17' });
  assert.ok(v.text.length > 0);
});

// ---------------- D35: 今日のお知らせ・ひとこと ----------------
import { tomorrowOf, todayShiftFact, tomorrowShiftFact, todayPlansFact, lastMonthFact, fmtTime, periodOf, noticeLines, ambientLines } from '../src/mascot-facts.ts';

const shift = (date, start = '17:00', end = '22:00', extra = {}) => ({ job: 'カフェ', date, start, end, rest: 0, wage: 1000, ...extra });
const plan = (title, dateStart, dateEnd = dateStart, extra = {}) => ({ id: 1, title, date: dateStart, dateStart, dateEnd, timeStart: '', timeEnd: '', ...extra });
const inc = (date, amount) => ({ date, type: 'income', amount, name: '', cat: '', pay: '' });

test('tomorrowOf: 月末・年末・うるう日をまたぐ', () => {
  assert.equal(tomorrowOf('2026-11-30'), '2026-12-01');
  assert.equal(tomorrowOf('2026-12-31'), '2027-01-01');
  assert.equal(tomorrowOf('2028-02-28'), '2028-02-29');
});

test('fmtTime・periodOf: 9:00 → 9時、9:30 → 9時30分。時間帯の境目', () => {
  assert.equal(fmtTime('09:00'), '9時');
  assert.equal(fmtTime('09:30'), '9時30分');
  assert.equal(fmtTime('17:05'), '17時5分');
  assert.deepEqual([4, 5, 9, 10, 16, 17, 20, 21, 23, 0].map(periodOf), ['night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night', 'night', 'night']);
});

test('todayShiftFact: 今日のシフトと、今月で何日目か（同じ日に2つでも1日。削除済み・今日より先・先月は数えない）', () => {
  const s = [shift('2026-11-03'), shift('2026-11-10'), shift('2026-11-17', '09:00', '13:00'), shift('2026-11-17', '17:00'), shift('2026-11-18'), shift('2026-10-30'), shift('2026-11-05', '17:00', '22:00', { _deleted: true })];
  assert.deepEqual(todayShiftFact(s, '2026-11-17'), { job: 'カフェ', start: '09:00', end: '13:00', nth: 3 }); // 3・10・17日
  assert.equal(todayShiftFact(s, '2026-11-16'), null);
  assert.equal(todayShiftFact([], '2026-11-17'), null);
});

test('tomorrowShiftFact: 明日（月末は来月1日）のいちばん早いシフト', () => {
  assert.equal(tomorrowShiftFact([shift('2026-12-01', '10:00', '15:00')], '2026-11-30').start, '10:00');
  assert.equal(tomorrowShiftFact([shift('2026-11-18', '17:00', '22:00', { _deleted: true })], '2026-11-17'), null);
  assert.equal(tomorrowShiftFact([shift('2026-11-18', null, null)], '2026-11-17').start, null); // 時刻なし
});

test('todayPlansFact: 今日の予定（期間予定の途中の日も）。済み・削除は除く。時刻は、はじめの日だけ', () => {
  const p = [plan('飲み会', '2026-11-17', '2026-11-17', { timeStart: '19:00' }), plan('旅行', '2026-11-16', '2026-11-18', { timeStart: '08:00' }), plan('済み', '2026-11-17', '2026-11-17', { done: true }), plan('消した', '2026-11-17', '2026-11-17', { _deleted: true }), plan('明日', '2026-11-18')];
  assert.deepEqual(todayPlansFact(p, '2026-11-17'), [{ title: '飲み会', time: '19:00' }, { title: '旅行', time: '' }]);
  assert.deepEqual(todayPlansFact(p, '2026-11-16'), [{ title: '旅行', time: '08:00' }]);
});

test('lastMonthFact: 先月の黒字（貯まった額）と、先月の同じ日までとの支出の比べ', () => {
  const led = [inc('2026-10-25', 100000), ex('2026-10-05', 40000), ex('2026-10-10', 10000), ex('2026-10-20', 20000), ex('2026-11-02', 20000), ex('2026-11-12', 20000)];
  // 先月（10月）は収入10万 − 支出7万 = 3万の黒字。11/15 まで: 先月の15日までの支出は 5万、今月は 4万 → 1万少ない
  const f = lastMonthFact(led, '2026-11-15');
  assert.equal(f.saved, 30000);
  assert.deepEqual(f.compare, { diff: -10000 });
  assert.equal(lastMonthFact(led, '2026-11-07').compare, null); // 月の初め（7日まで）は比べない
  assert.equal(lastMonthFact([], '2026-11-15'), null);
  assert.equal(lastMonthFact([ex('2026-10-05', 2000), ex('2026-11-02', 100)], '2026-11-15'), null); // 先月の支出が3000円未満・赤字
  const small = lastMonthFact([ex('2026-10-05', 10000), ex('2026-11-02', 10500)], '2026-11-15'); // 差が500円（5%）
  assert.equal(small, null);
  // 年またぎ: 1月の「先月」は前の年の12月
  assert.deepEqual(lastMonthFact([ex('2026-12-05', 10000), ex('2027-01-03', 2000)], '2027-01-15').compare, { diff: -8000 });
});

test('noticeLines: 夜（21時から）は明日のシフトが最優先。今日のシフト・予定・祝日は、あるものだけ', () => {
  const none = { daysToPayday: null, budget: null, weekday: null };
  assert.deepEqual(noticeLines(none, 12), { urgent: null, today: [] });
  const f = {
    ...none, holiday: '文化の日',
    todayShift: { job: 'カフェ', start: '17:00', end: '22:00', nth: 3 },
    tomorrowShift: { job: 'カフェ', start: '09:00', end: '13:00' },
    todayPlans: [{ title: '飲み会', time: '19:00' }],
  };
  assert.equal(noticeLines(f, 20).urgent, null); // 20時まではまだ言わない
  assert.equal(noticeLines(f, 21).urgent, '明日は9時からカフェだよ！早めに休もうね');
  assert.deepEqual(noticeLines(f, 12).today, ['今日はカフェの日！今月3日目のバイトだよ（17時〜22時）', '今日は19時から「飲み会」だよ', '今日は文化の日だよ']);
  assert.equal(noticeLines({ ...none, tomorrowShift: { job: 'カフェ', start: null, end: null } }, 22).urgent, '明日はカフェのシフトがあるよ。早めに休もうね');
});

test('noticeLines: 予定が複数のときは「ほかn件」。時刻なしのシフト・予定の言い方', () => {
  const none = { daysToPayday: null, budget: null, weekday: null };
  assert.deepEqual(noticeLines({ ...none, todayPlans: [{ title: 'A', time: '' }, { title: 'B', time: '' }, { title: 'C', time: '' }] }, 12).today, ['今日は「A」ほか2件の予定があるよ']);
  assert.deepEqual(noticeLines({ ...none, todayPlans: [{ title: 'A', time: '' }] }, 12).today, ['今日は「A」の予定があるよ']);
  assert.deepEqual(noticeLines({ ...none, todayShift: { job: 'カフェ', start: null, end: null, nth: 1 } }, 12).today, ['今日はカフェの日！今月1日目のバイトだよ']);
});

test('ambientLines: 貯まった額は月の初めの10日間だけ。先月との比べ。季節のひとこと（材料なしでも出る）', () => {
  const f = { daysToPayday: null, budget: null, weekday: null, lastMonth: { saved: 30000, compare: { diff: -10000 } } };
  const early = ambientLines(f, 11, 5);
  assert.ok(early.some(t => /先月は ¥30,000 貯まったよ/.test(t)));
  assert.ok(early.some(t => /先月の今ごろより、支出が ¥10,000 少ない/.test(t)));
  assert.ok(!ambientLines(f, 11, 11).some(t => /貯まった/.test(t)));
  assert.match(ambientLines({ ...f, lastMonth: { saved: null, compare: { diff: 4000 } } }, 11, 20)[0], /¥4,000 多め/);
  assert.equal(ambientLines(undefined, 12, 20).length, 1); // 季節だけ
  assert.match(ambientLines(undefined, 12, 20)[0], /年末/);
  for (let m = 1; m <= 12; m++) assert.ok(ambientLines(undefined, m, 20)[0].length > 5, `${m}月`);
});

test('D35 の文も、責めたり、叱ったりする言葉を使わない', () => {
  const f = {
    daysToPayday: null, budget: null, weekday: null, holiday: '勤労感謝の日',
    todayShift: { job: 'カフェ', start: '09:00', end: '18:00', nth: 12 }, tomorrowShift: { job: 'カフェ', start: '06:30', end: null },
    todayPlans: [{ title: '旅行', time: '' }], lastMonth: { saved: 12345, compare: { diff: 5000 } },
  };
  const all = [...Object.values(noticeLines(f, 22)).flat(), ...ambientLines(f, 5, 3), ...ambientLines({ ...f, lastMonth: { saved: null, compare: { diff: -5000 } } }, 5, 3)];
  for (let m = 1; m <= 12; m++) all.push(ambientLines(undefined, m, 20)[0]);
  for (const text of all) { assert.ok(text); assert.doesNotMatch(text, /使いすぎ|ダメ|だめ|ざんねん|残念|節約しな|我慢|やめ|遅刻|サボ/); }
});

test('mascotView: 今日のお知らせは、連続記録・今日記録した・ふだんで言う。足りない・おかえりのときは言わない', () => {
  const none = { daysToPayday: null, budget: null, weekday: null };
  const facts = { ...none, todayShift: { job: 'カフェ', start: '17:00', end: '22:00', nth: 3 } };
  const v = s => mascotView({ spendable: 50000, streak: 0, recordedToday: false, daysSinceRecord: 1, today: '2026-11-17', hour: 12, facts, ...s });
  for (const s of [{}, { recordedToday: true }, { streak: 5 }]) assert.match(v(s).text, /今月3日目のバイト/, JSON.stringify(s));
  assert.equal(v({ streak: 5 }).mood, 'happy'); // 表情は状況のまま
  for (const s of [{ spendable: -1 }, { daysSinceRecord: 6 }]) assert.doesNotMatch(v(s).text, /バイト/, JSON.stringify(s));
  assert.equal(v({ spendable: -1 }).mood, 'worried');
});

test('mascotView: 夜の明日のシフトが最優先。今日のお知らせが複数あるときは時間帯で入れ替わる', () => {
  const none = { daysToPayday: null, budget: null, weekday: null };
  const facts = { ...none, holiday: '文化の日', todayShift: { job: 'カフェ', start: '17:00', end: '22:00', nth: 3 }, tomorrowShift: { job: 'カフェ', start: '09:00', end: '13:00' } };
  const v = hour => mascotView({ spendable: 50000, streak: 0, recordedToday: false, daysSinceRecord: 1, today: '2026-11-17', hour, facts }).text;
  assert.match(v(22), /明日は9時からカフェ/);
  assert.match(v(8), /文化の日/); // 6〜11時 → 時間帯の番号1 → 2つのうち2番目（祝日）
  assert.match(v(13), /バイト/); // 12〜17時 → 番号2 → 1番目（シフト）
  assert.equal(v(8), v(9)); // 同じ時間帯なら同じ文
});

test('mascotView: ふだんのあいさつは時間帯で変わる（夜に「こんにちは」と言わない）。季節のひとことも混ざる', () => {
  const v = (hour, today) => mascotView({ spendable: 50000, streak: 0, recordedToday: false, daysSinceRecord: 1, today, hour }).text;
  const days = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
  for (const d of days) { assert.doesNotMatch(v(23, d), /こんにちは|おはよう/); assert.doesNotMatch(v(8, d), /こんにちは|こんばんは/); }
  assert.ok(days.some(d => /冷える日/.test(v(12, d)))); // 11月のひとこと（4日で一巡する中に入る）
});
