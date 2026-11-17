// カレンダーの共有（src/share.ts）の、画面を使わない部分。D39。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatShareCode, sharedPlansOnDay, sharedPlanTime, sharedShiftsOnDay, sharedShiftTime } from '../src/share.ts'; // Node が型を消して読む（D17）

const plan = (over) => ({ id: 'p', title: '予定', start_date: '2026-11-20', end_date: '2026-11-20', start_time: null, end_time: null, color: 'pink', ...over });

test('formatShareCode: 16桁を4桁ずつ区切る', () => {
  assert.equal(formatShareCode('0123456789abcdef'), '0123-4567-89ab-cdef');
  assert.equal(formatShareCode(''), '');
});

test('sharedPlansOnDay: 期間予定は初日から最終日までの日に入る', () => {
  const list = [plan({ id: 'a' }), plan({ id: 'b', start_date: '2026-11-28', end_date: '2026-12-02' })];
  assert.deepEqual(sharedPlansOnDay(list, '2026-11-20').map(p => p.id), ['a']);
  assert.deepEqual(sharedPlansOnDay(list, '2026-11-30').map(p => p.id), ['b']); // 月またぎの中日
  assert.deepEqual(sharedPlansOnDay(list, '2026-12-02').map(p => p.id), ['b']); // 最終日
  assert.deepEqual(sharedPlansOnDay(list, '2026-12-03').map(p => p.id), []);
});

test('sharedPlanTime: 1日の予定は開始と終了（秒は落とす）', () => {
  const p = plan({ start_time: '18:00:00', end_time: '20:00:00' });
  assert.deepEqual(sharedPlanTime(p, '2026-11-20'), { start: '18:00', end: '20:00', min: 1080 });
  assert.deepEqual(sharedPlanTime(plan(), '2026-11-20'), { start: '', end: '', min: -1 }); // 終日
});

test('sharedPlanTime: 期間予定は、初日が開始・最終日が終了・中日は終日（自分の予定と同じ）', () => {
  const p = plan({ start_date: '2026-11-28', end_date: '2026-11-30', start_time: '09:00:00', end_time: '17:00:00' });
  assert.deepEqual(sharedPlanTime(p, '2026-11-28'), { start: '09:00', end: '', min: 540 });
  assert.deepEqual(sharedPlanTime(p, '2026-11-29'), { start: '', end: '', min: -1 });
  assert.deepEqual(sharedPlanTime(p, '2026-11-30'), { start: '', end: '17:00', min: 1020 });
});

test('sharedShiftsOnDay・sharedShiftTime: その日のシフトだけ。時刻の秒は落とす', () => {
  const shifts = [
    { id: 's1', date: '2026-11-22', start_time: '10:00:00', end_time: '15:00:00', job: 'カフェ' },
    { id: 's2', date: '2026-11-23', start_time: '09:00:00', end_time: '12:00:00', job: 'カフェ' },
  ];
  assert.deepEqual(sharedShiftsOnDay(shifts, '2026-11-22').map(s => s.id), ['s1']);
  assert.deepEqual(sharedShiftTime(shifts[0]), { start: '10:00', end: '15:00' });
});
