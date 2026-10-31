// データの書き出し・読み込みのファイルの形（js/backup.js、D13）のテスト。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../js/backup.js');
const { TABLES } = require('../js/data.js');

const NOW = '2026-10-31T12:00:00.000Z';
const rows = () => ({
  settings: [{ id: 's1', user_id: 'u', acct_base: 1000, created_at: 'c', updated_at: 'u1' }],
  cards: [
    { id: 'c1', user_id: 'u', name: '楽天', close_day: 15, bill_day: 27, position: 0, deleted_at: null, created_at: 'c', updated_at: 'u2' },
    { id: 'c2', user_id: 'u', name: '古いカード', close_day: 31, bill_day: 10, position: 1, deleted_at: '2026-05-01T00:00:00Z', created_at: 'c', updated_at: 'u3' },
  ],
  ledger_entries: [{ id: 'l1', user_id: 'u', amount: 500, card_id: 'c2', created_at: 'c', updated_at: null }],
  tasks: [{ id: 't1', title: 'レポート', due_date: null, completed_at: null, memo: '', position: 0 }],
});

test('書き出すテーブルは、DB が読み込むテーブル（private.import_tables()）と同じ並び', () => {
  // DB の側は supabase/tests/database/08_import_backup.test.sql で、同じ並びかを確かめている。テーブルを足したら両方を直す
  assert.deepStrictEqual(TABLES, [
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks']);
});

test('書き出し: 外側の形と、すべてのテーブル', () => {
  const file = B.buildExport(rows(), TABLES, NOW);
  assert.equal(file.format, 'maney-export');
  assert.equal(file.version, 1);
  assert.equal(file.exported_at, NOW);
  assert.deepStrictEqual(Object.keys(file.tables), TABLES, 'テーブルの名前は DB と同じで、参照される側が先');
  assert.deepStrictEqual(file.tables.jobs, [], '行のないテーブルも空の配列で入れる');
  assert.ok(!('fixed_incomes' in file.tables), 'もう使わない固定収入は入れない');
});

test('書き出し: サーバーが決める列（user_id・created_at・updated_at）は入れず、id と中身の列は入れる', () => {
  const file = B.buildExport(rows(), TABLES, NOW);
  assert.deepStrictEqual(file.tables.settings, [{ id: 's1', acct_base: 1000 }]);
  assert.deepStrictEqual(file.tables.ledger_entries, [{ id: 'l1', amount: 500, card_id: 'c2' }], 'ほかのテーブルを指す ID も入れる');
  assert.equal(file.tables.cards[1].deleted_at, '2026-05-01T00:00:00Z', '削除済みのカードも入れる');
});

test('書き出し: 元の行は変えない', () => {
  const r = rows();
  B.buildExport(r, TABLES, NOW);
  assert.equal(r.settings[0].user_id, 'u');
});

test('書き出し: まだ読み込めていない（設定の行がない）ときは書き出さない（空のファイルを作らない）', () => {
  assert.throws(() => B.buildExport({}, TABLES, NOW), /まだデータを読み込めていない/);
  assert.throws(() => B.buildExport(null, TABLES, NOW), /まだデータを読み込めていない/);
});

test('読み込み: 書き出したファイルは、そのまま読める', () => {
  const file = B.buildExport(rows(), TABLES, NOW);
  const parsed = B.parseImport(JSON.stringify(file), TABLES);
  assert.deepStrictEqual(parsed.file, file);
  assert.equal(parsed.exportedAt, NOW);
  assert.equal(parsed.counts.cards, 2);
  assert.equal(parsed.counts.jobs, 0);
  assert.equal(parsed.counts.tasks, 1);
});

test('読み込み: 正しくないファイルは、わけを書いて止める', () => {
  const good = () => B.buildExport(rows(), TABLES, NOW);
  const parse = f => () => B.parseImport(typeof f === 'string' ? f : JSON.stringify(f), TABLES);

  assert.throws(parse('{ こわれている'), /JSON のファイルとして読めません/);
  assert.throws(parse([]), /このアプリが書き出したファイルではありません/);
  assert.throws(parse({ ...good(), format: 'other' }), /このアプリが書き出したファイルではありません/);
  assert.throws(parse({ ...good(), version: 2 }), /新しい版で書き出したファイル/);
  assert.throws(parse({ ...good(), version: '1' }), /ファイルの版（1）は読み込めません/);
  assert.throws(parse({ ...good(), tables: [] }), /tables がありません/);

  const missing = good();
  delete missing.tables.tasks;
  assert.throws(parse(missing), /ファイルにテーブル tasks がありません/, 'テーブルが欠けていたら止める');

  const extra = good();
  extra.tables.fixed_incomes = [];
  assert.throws(parse(extra), /読み込めないテーブルがあります: fixed_incomes/);

  const noId = good();
  noId.tables.cards[1] = { name: 'x' };
  assert.throws(parse(noId), /cards の 2件目: id がありません/);

  const noSettings = good();
  noSettings.tables.settings = [];
  assert.throws(parse(noSettings), /設定（settings）の行は1つ/);
});

test('確かめの画面の件数: ファイルと今を、テーブルごとに並べる（設定は出さない）', () => {
  const list = B.compareCounts({ cards: 3, ledger_entries: 10 }, rows(), TABLES);
  assert.equal(list[0].table, 'cards');
  assert.ok(!list.some(x => x.table === 'settings'));
  assert.deepStrictEqual(list.find(x => x.table === 'cards'), { table: 'cards', file: 3, now: 2 });
  assert.deepStrictEqual(list.find(x => x.table === 'jobs'), { table: 'jobs', file: 0, now: 0 });
  assert.equal(list.length, TABLES.length - 1);
});
