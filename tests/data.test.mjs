// データの層（next/data.js）の読み込みのテスト。実行: node --test tests/
// Supabase の代わりに、ページ分けと件数を真似る偽物を使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TABLES, loadTable, loadAllTables } = require('../next/data.js');

// tables: {テーブル名: 行の配列}。options で、件数の変化・上限・エラーを起こす
function fakeSupabase(tables, options = {}) {
  const calls = [];
  let requests = 0;
  return {
    calls,
    from(table) {
      const call = { table, order: [], count: null };
      calls.push(call);
      const query = {
        select(_columns, opts) { call.count = opts && opts.count; return query; },
        order(column) { call.order.push(column); return query; },
        async range(from, to) {
          requests += 1;
          if (options.errorTable === table) return { data: null, error: new Error(`${table} を読めない`), count: null };
          const rows = tables[table] || [];
          const limit = options.maxRows ? Math.min(to, from + options.maxRows - 1) : to;
          const count = options.countAfterFirstPage && requests > 1 ? rows.length + 1 : rows.length;
          return { data: rows.slice(from, limit + 1), error: null, count };
        },
        async maybeSingle() { return { data: (tables[table] || [])[0] || null, error: null }; },
      };
      return query;
    },
  };
}

const ledger = Array.from({ length: 1201 }, (_, i) => ({ id: `id-${String(i).padStart(4, '0')}`, position: i }));

test('ページに分けて最後まで読み、件数と合うことを確かめる', async () => {
  const supa = fakeSupabase({ ledger_entries: ledger });
  const rows = await loadTable(supa, 'ledger_entries', 500);
  assert.equal(rows.length, 1201);
  assert.deepStrictEqual(rows, ledger);
  assert.equal(supa.calls.length, 3, '500件ずつ3回に分けて読む');
  assert.ok(supa.calls.every(c => c.count === 'exact'), '件数を一緒に受け取る');
  assert.deepStrictEqual(supa.calls[0].order, ['position', 'id'], 'position, id の順で読む');
});

test('設定は id の順で読む（position がない）', async () => {
  const supa = fakeSupabase({ settings: [{ id: 's1' }] });
  await loadTable(supa, 'settings', 500);
  assert.deepStrictEqual(supa.calls[0].order, ['id']);
});

test('読んでいる間に件数が変わったら、エラーにする', async () => {
  const supa = fakeSupabase({ ledger_entries: ledger }, { countAfterFirstPage: true });
  await assert.rejects(loadTable(supa, 'ledger_entries', 500), /件数が変わりました/);
});

test('サーバーの上限で、件数より少なく返ってきたら、エラーにする（取りこぼさない）', async () => {
  const supa = fakeSupabase({ ledger_entries: ledger.slice(0, 5) }, { maxRows: 2 });
  await assert.rejects(loadTable(supa, 'ledger_entries', 3), /件数（5）と合いません/);
});

test('全テーブルを読み、移行の番号を返す', async () => {
  const tables = Object.fromEntries(TABLES.map(t => [t, [{ id: `${t}-1`, position: 0 }]]));
  tables.sync_state = [{ epoch: 3 }];
  const loaded = await loadAllTables(fakeSupabase(tables), 500);
  assert.deepStrictEqual(Object.keys(loaded.rows), TABLES);
  assert.equal(loaded.epoch, 3);
});

test('移行の番号の行がなければ 1', async () => {
  const loaded = await loadAllTables(fakeSupabase({}), 500);
  assert.equal(loaded.epoch, 1);
});

test('1つのテーブルでも読めなければ、全体を失敗にする', async () => {
  const tables = Object.fromEntries(TABLES.map(t => [t, []]));
  await assert.rejects(loadAllTables(fakeSupabase(tables, { errorTable: 'shifts' }), 500), /shifts を読めない/);
});
