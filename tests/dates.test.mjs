// 日付の補助と今の日時（src/dates.ts）・色と最初のカテゴリ（src/palette.ts）。D20 の 1。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  DAYS, getNow, getToday, setNow, gY, gM, gD, toDS, fmtMD, addM, ds2d, monthDay, monthDate, calcH, exposeLegacyDates, LEGACY_DATES,
} from '../src/dates.ts'; // Node が型を消して読む（D17）
import { PLAN_COLORS, planColor, jobColorObj, jobColorByName, DEF_EXP, DEF_INC, CAT_COL, LEGACY_PALETTE } from '../src/palette.ts';
import { state } from '../src/state.ts';

test('toDS・fmtMD・ds2d: 月は 0 から始まり、端末の時刻の日付になる', () => {
  assert.equal(toDS(2026, 0, 5), '2026-01-05');
  assert.equal(toDS(2026, 11, 31), '2026-12-31');
  assert.equal(fmtMD(new Date(2026, 10, 2)), '11/2');
  const d = ds2d('2026-11-02');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 10, 2, 0]);
});

test('addM: 年をまたいで月をずらす', () => {
  assert.deepEqual(addM(2026, 10, 1), { y: 2026, m: 11 });
  assert.deepEqual(addM(2026, 11, 1), { y: 2027, m: 0 });
  assert.deepEqual(addM(2026, 0, -1), { y: 2025, m: 11 });
  assert.deepEqual(addM(2026, 5, 25), { y: 2028, m: 6 });
  assert.deepEqual(addM(2026, 5, -30), { y: 2023, m: 11 });
});

test('monthDay・monthDate: 月にない日は月末にする', () => {
  assert.equal(monthDay(2026, 10, 31), 30); // 11月
  assert.equal(monthDay(2027, 1, 30), 28); // 2月
  assert.equal(monthDay(2026, 10, 15), 15);
  assert.equal(toDS(2026, 10, monthDay(2026, 10, 31)), '2026-11-30');
  const d = monthDate(2026, 10, 31);
  assert.deepEqual([d.getMonth(), d.getDate()], [10, 30]);
});

test('calcH: 休憩を引いた時間。マイナスにはしない。休憩が数でなければ 0', () => {
  assert.equal(calcH('09:00', '17:00', 60), 7);
  assert.equal(calcH('09:00', '17:00', '30'), 7.5);
  assert.equal(calcH('09:00', '17:00', ''), 8);
  assert.equal(calcH('09:00', '09:30', 60), 0);
});

test('今の日時: setNow で今日の日付も変わり、gY・gM・gD も追いかける', () => {
  const before = getNow();
  try {
    setNow(new Date(2026, 10, 12, 10, 0));
    assert.equal(getToday(), '2026-11-12');
    assert.deepEqual([gY(), gM(), gD()], [2026, 10, 12]);
    setNow(new Date(2026, 10, 13, 0, 0, 5));
    assert.equal(getToday(), '2026-11-13');
  } finally { setNow(before); }
  assert.deepEqual(DAYS, ['日', '月', '火', '水', '木', '金', '土']);
});

test('互換の層: ふつうの <script> の _now の読み書きと TODAY の読みが届く。TODAY への代入は止める', () => {
  const before = getNow();
  try {
    const win = {};
    exposeLegacyDates(win);
    const ctx = vm.createContext(win);
    setNow(new Date(2026, 10, 12, 10, 0));
    assert.equal(vm.runInContext('TODAY', ctx), '2026-11-12');
    // 日付が変わったときの更新と同じ（onDayChange）。_now への代入で、今日の日付も変わる
    vm.runInContext('_now = new Date(2026, 10, 13, 9, 0);', ctx);
    assert.equal(getToday(), '2026-11-13');
    assert.equal(vm.runInContext('TODAY', ctx), '2026-11-13');
    assert.equal(vm.runInContext('toDS(_now.getFullYear(), _now.getMonth(), _now.getDate())', ctx), '2026-11-13');
    assert.throws(() => vm.runInContext('TODAY = "2000-01-01";', ctx), /TODAY は/);
    for (const name of Object.keys(LEGACY_DATES)) assert.equal(typeof win[name] !== 'undefined', true, name);
  } finally { setNow(before); }
});

test('色: 名前から引く。なければ最初の色', () => {
  assert.equal(planColor('green').dot, '#5CA020');
  assert.equal(planColor('nothing'), PLAN_COLORS[0]);
  assert.equal(planColor(undefined), PLAN_COLORS[0]);
  assert.equal(PLAN_COLORS.length, 6);
});

test('バイト先の色: 色の指定があればそれ、なければ並びの順。バイト先がなければ最初の色', () => {
  const jobs = [{ name: 'A' }, { name: 'B', color: 'purple' }, { name: 'C' }];
  try {
    state.st = /** @type {any} */ ({ jobs });
    assert.equal(jobColorObj(null), PLAN_COLORS[0]);
    assert.equal(jobColorObj(jobs[1]), planColor('purple'));
    assert.equal(jobColorObj(jobs[2]), PLAN_COLORS[2]);
    assert.equal(jobColorByName('B').key, 'purple');
    assert.equal(jobColorByName('D'), PLAN_COLORS[0]);
  } finally { state.st = /** @type {any} */ ({ jobs: [] }); } // 入れる前の状態には戻せない（読むと止める）ので、空にしておく
});

test('最初のカテゴリとグラフの色', () => {
  assert.equal(DEF_EXP.length, 8);
  assert.deepEqual(DEF_INC, ['給与', 'バイト', '仕送り', 'その他']);
  assert.equal(CAT_COL['食費'], '#185FA5');
  assert.deepEqual(Object.keys(LEGACY_PALETTE).sort(), ['CAT_COL', 'COLOR_NAMES', 'DEF_EXP', 'DEF_INC', 'DOTC', 'PLAN_COLORS', 'jobColorByName', 'jobColorObj', 'planColor']);
});
