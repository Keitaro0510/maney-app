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
