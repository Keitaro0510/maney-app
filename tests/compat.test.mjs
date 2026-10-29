// 互換層（js/compat.js）のテスト。実行: node --test "tests/*.test.mjs"
// tests/fixtures/compat-fixture.json は、ローカルの Supabase で作った「テーブルの行」と「DB の逆の変換の結果」
// （作り方は tests/fixtures/compat_fixture.sql の先頭）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rowsToSt, stripMeta, createdMs } = require('../js/compat.js');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/compat-fixture.json', import.meta.url), 'utf8'));

test('同じ行から、DB の逆の変換（private.export_to_user_data）と完全に同じ st を作る', () => {
  assert.deepStrictEqual(stripMeta(rowsToSt(fixture.rows)), fixture.export);
});

test('st の各記録は、元の行の id を _id として持つ', () => {
  const st = rowsToSt(fixture.rows);
  assert.deepStrictEqual(st.ledger.map(l => l._id), fixture.rows.ledger_entries.map(r => r.id));
  assert.deepStrictEqual(st.cards.map(c => c._id), fixture.rows.cards.map(r => r.id));
  for (const key of ['jobs', 'shifts', 'plans', 'fixedCosts', 'fixedIncs', 'wds', 'actualInputs']) {
    assert.ok(st[key].every(x => typeof x._id === 'string'), `${key} に _id がない記録がある`);
  }
});

test('削除済みのカード・バイト先も st に残し、_deleted を付ける（記録の参照と計算に使い続ける）', () => {
  const st = rowsToSt(fixture.rows);
  const card = st.cards.find(c => c.name === 'Cカード');
  const job = st.jobs.find(j => j.name === '塾');
  assert.equal(card._deleted, true);
  assert.equal(job._deleted, true);
  assert.equal(st.plans[0].planCardIdx, st.cards.indexOf(card), '削除済みのカードを参照する予定');
  assert.ok(st.shifts.some(s => s.job === '塾'), '削除済みのバイト先のシフト');
  assert.ok(st.cards.filter(c => !c._deleted).every(c => !('_deleted' in c)));
});

test('削除済みのカテゴリは一覧（catExp）に出さないが、記録には名前が残る', () => {
  const st = rowsToSt(fixture.rows);
  assert.ok(!st.catExp.includes('娯楽'));
  assert.ok(st.ledger.some(l => l.cat === '娯楽'));
});

test('行の並び順に関係なく、position, id の順で組み立てる', () => {
  const shuffled = Object.fromEntries(Object.entries(fixture.rows).map(([t, rows]) => [t, [...rows].reverse()]));
  assert.deepStrictEqual(stripMeta(rowsToSt(shuffled)), fixture.export);
});

test('設定の行がなければ null（まだ移行していない）', () => {
  assert.equal(rowsToSt({ ...fixture.rows, settings: [] }), null);
});

test('新しい予定・固定費の id は、登録日時をミリ秒にした数値（DB と同じく四捨五入）', () => {
  assert.equal(createdMs('2026-10-29T08:57:56.3021+00:00'), Date.parse('2026-10-29T08:57:56.302Z'));
  assert.equal(createdMs('2026-10-29T08:57:56.1235+00:00'), Date.parse('2026-10-29T08:57:56.124Z'));
  assert.equal(createdMs('2026-10-29T08:57:56+00:00'), Date.parse('2026-10-29T08:57:56.000Z'));
});
