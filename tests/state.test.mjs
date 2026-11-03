// 状態の初期値と、読み込んだ古い予定の補完（D20 の 10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, defaultSt, fixDefaults } from '../src/state.ts';

test('初期状態は TypeScript の画面からすぐ読める', () => {
  assert.deepEqual(state.st, defaultSt());
  const first = defaultSt(), second = defaultSt();
  first.ledger.push({ date: '2026-11-01', amount: 1, name: 'A', cat: '食費', type: 'expense', pay: '現金' });
  assert.equal(second.ledger.length, 0);
});

test('古い予定の時刻と空のカテゴリを補う', () => {
  const before = state.st;
  try {
    state.st = { ...defaultSt(), catExp: [], catInc: [], plans: [{ id: 1, title: '予定', date: '2026-11-01' }] };
    fixDefaults();
    assert.equal(state.st.plans[0].timeStart, '');
    assert.equal(state.st.plans[0].timeEnd, '');
    assert.ok(state.st.catExp.length > 0);
    assert.ok(state.st.catInc.length > 0);
  } finally { state.st = before; }
});
