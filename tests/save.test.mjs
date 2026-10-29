// 保存の向き（互換の st → テーブルの行 → 送信待ちの操作）のテスト。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rowsToSt, stToRows, createdMs } = require('../next/compat.js');
const {
  diffRows, makeOp, applyChanges, applyOutbox, isReady, acknowledge, rewriteForOverwrite, discardOp, sendOp,
} = require('../next/data.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/compat-fixture.json', import.meta.url), 'utf8'));
const NOW = '2026-10-30T00:00:00.000Z';

// 決まった順に id を作る
function options() {
  let n = 0;
  return { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, now: NOW };
}

// 画面で st を変えて保存したときの変更の列
function changesAfter(edit, base = fixture.rows) {
  const st = rowsToSt(base);
  edit(st);
  return diffRows(base, stToRows(st, base, options()));
}

const rowOf = (table, pred) => fixture.rows[table].find(pred);

// ============================================================
// 互換の st → テーブルの行
// ============================================================

test('何も変えなければ、変更は0件（開いただけで余計な更新を送らない）', () => {
  assert.deepStrictEqual(changesAfter(() => {}), []);
});

test('家計簿の記録を追加すると、1件の追加になる（最後の並び・カテゴリの ID・現金払い）', () => {
  const changes = changesAfter(st => st.ledger.push({
    date: '2026-10-30', amount: 800, name: 'パン', cat: '食費', type: 'expense', pay: '現金', memo: '',
  }));
  assert.equal(changes.length, 1);
  const [c] = changes;
  assert.equal(c.table, 'ledger_entries');
  assert.equal(c.action, 'insert');
  assert.equal(c.row.position, Math.max(...fixture.rows.ledger_entries.map(r => r.position)) + 1);
  assert.equal(c.row.category_id, rowOf('categories', r => r.kind === 'expense' && r.name === '食費').id);
  assert.equal(c.row.payment_method, 'cash');
  assert.equal(c.row.card_id, null);
});

test('記録を _id を付けたまま編集すると、その行の更新になる（行の内容をすべて送る）', () => {
  const changes = changesAfter(st => {
    const i = st.ledger.findIndex(l => l.name === '電車');
    st.ledger[i] = { ...st.ledger[i], amount: 600 };
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'update');
  assert.equal(changes[0].row.amount, 600);
  assert.equal(changes[0].row.memo, 'メモ', '変えていない列も送る');
});

test('記録を消すと、その行の削除になる', () => {
  const target = rowOf('ledger_entries', r => r.name === '電車');
  const changes = changesAfter(st => { st.ledger = st.ledger.filter(l => l._id !== target.id); });
  assert.deepStrictEqual(changes, [{ table: 'ledger_entries', action: 'delete', id: target.id }]);
});

test('カードを削除済みにしても、記録の参照は変わらない（カードの行の更新だけ）', () => {
  const changes = changesAfter(st => { st.cards.find(c => c.name === 'Aカード')._deleted = true; });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'cards');
  assert.equal(changes[0].row.deleted_at, NOW);
});

test('配列からカードが消えても、行は消さずに削除済みにする', () => {
  const base = applyChanges(fixture.rows, [{
    table: 'cards', action: 'insert', id: 'card-x',
    row: { name: 'Xカード', close_day: 10, bill_day: 20, position: 3, deleted_at: null },
  }], NOW);
  const changes = changesAfter(st => { st.cards.pop(); }, base);
  assert.deepStrictEqual(changes.map(c => [c.table, c.action, c.id, c.row.deleted_at]), [['cards', 'update', 'card-x', NOW]]);
});

test('記録が参照しているカードが配列から消えたら、保存しない（参照を壊さない）', () => {
  assert.throws(() => changesAfter(st => { st.cards.pop(); }), /予定: カード 2 がありません/);
});

test('バイト先の名前を変えると、バイト先の行の更新だけになる（シフト・給与の実績は ID で参照している）', () => {
  const changes = changesAfter(st => {
    const i = st.jobs.findIndex(j => j.name === 'カフェ');
    st.jobs[i] = { ...st.jobs[i], name: '喫茶店' };
    st.shifts.forEach(s => { if (s.job === 'カフェ') s.job = '喫茶店'; });
    st.actualInputs.forEach(a => {
      if (a.type === 'shift' && a.job === 'カフェ') { a.job = '喫茶店'; a.salaryKey = a.salaryKey.replace('カフェ|', '喫茶店|'); }
    });
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'jobs');
  assert.equal(changes[0].row.name, '喫茶店');
});

test('削除済みのバイト先と同じ名前で追加すると、その行を戻す（新しい行を作らない）', () => {
  const dead = rowOf('jobs', r => r.name === '塾');
  const changes = changesAfter(st => {
    st.jobs.push({ name: '塾', wage: 1600, color: 'green', nightStart: '22:00', nightRate: 25, transport: 0 });
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'update');
  assert.equal(changes[0].id, dead.id);
  assert.equal(changes[0].row.deleted_at, null);
  assert.equal(changes[0].row.wage, 1600);
});

test('カテゴリを一覧から消すと削除済みにし、また足すと同じ行を戻す', () => {
  const food = rowOf('categories', r => r.kind === 'expense' && r.name === '食費');
  const removed = changesAfter(st => { st.catExp = st.catExp.filter(c => c !== '食費'); });
  assert.deepStrictEqual(removed.map(c => [c.table, c.action, c.id, c.row.deleted_at]), [['categories', 'update', food.id, NOW]]);

  const dead = rowOf('categories', r => r.name === '娯楽');
  const added = changesAfter(st => { st.catExp.push('娯楽'); });
  assert.equal(added.length, 1);
  assert.equal(added[0].id, dead.id);
  assert.equal(added[0].row.deleted_at, null);
});

test('新しいカードと、それを使う記録を一度に追加すると、カードを先に追加する', () => {
  const changes = changesAfter(st => {
    st.cards.push({ name: 'Dカード', closeDay: '20', billDay: '5' });
    st.ledger.push({ date: '2026-10-30', amount: 3000, name: '靴', cat: 'その他', type: 'expense', pay: 'Dカード', memo: '', cardIdx: st.cards.length - 1 });
  });
  assert.deepStrictEqual(changes.map(c => [c.table, c.action]), [['cards', 'insert'], ['ledger_entries', 'insert']]);
  assert.equal(changes[1].row.card_id, changes[0].id);
  assert.equal(changes[1].row.payment_method, 'card');
});

test('カードの実績を _id なしで置き換えても、同じカード・同じ月の行の更新になる', () => {
  const changes = changesAfter(st => {
    const i = st.actualInputs.findIndex(a => a.type === 'card' && a.cardKey === 'card-1-2026-09');
    const { _id, ...rest } = st.actualInputs[i];
    st.actualInputs[i] = { ...rest, actualAmount: 52000 };
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'update');
  assert.equal(changes[0].row.actual_amount, 52000);
});

test('新しい給与の実績は、2つの実績のテーブルを通した最後の並びに付ける', () => {
  const changes = changesAfter(st => {
    st.actualInputs.push({ type: 'shift', job: 'カフェ', salaryKey: 'カフェ|2026-11', date: '2026-11-10', actualAmount: 50000, estimatedAmount: 49000 });
  });
  const max = Math.max(...fixture.rows.card_bill_actuals.map(r => r.position), ...fixture.rows.salary_actuals.map(r => r.position));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'salary_actuals');
  assert.equal(changes[0].row.position, max + 1);
  assert.equal(changes[0].row.pay_month, '2026-11-01');
});

test('新しい予定は legacy_id を持たず、st の id は登録日時になる', () => {
  const base = fixture.rows;
  const st = rowsToSt(base);
  st.plans.push({ id: 1, title: '映画', date: '2026-11-20', dateStart: '2026-11-20', dateEnd: '2026-11-20', timeStart: '18:00', timeEnd: '', budget: 2000, memo: '', color: 'pink', done: false });
  const changes = diffRows(base, stToRows(st, base, options()));
  assert.equal(changes[0].row.legacy_id, null);
  assert.equal(changes[0].row.start_time, '18:00:00');
  const rebuilt = rowsToSt(applyChanges(base, changes, NOW));
  assert.equal(rebuilt.plans.at(-1).id, createdMs(NOW));
});

test('設定を変えると、設定の行の更新になる', () => {
  const changes = changesAfter(st => { st.budget = 90000; });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'settings');
  assert.equal(changes[0].row.budget, 90000);
});

test('数値にできない金額はエラーにする（DB に送らない）', () => {
  assert.throws(() => changesAfter(st => { st.wds.push({ date: '2026-10-30', amount: 'abc' }); }), /数値ではありません/);
});

test('変更を重ねた行から作った st は、変えた内容になっている', () => {
  const base = fixture.rows;
  const st = rowsToSt(base);
  st.wds.push({ date: '2026-10-30', amount: 1000 });
  st.budget = 70000;
  const after = stToRows(st, base, options());
  const rebuilt = rowsToSt(applyChanges(base, diffRows(base, after), NOW));
  assert.equal(rebuilt.wds.length, 3);
  assert.equal(rebuilt.budget, 70000);
  assert.deepStrictEqual(diffRows(after, stToRows(rebuilt, after, options())), [], '作り直した st から、もう一度変更は出ない');
});

// ============================================================
// 送信待ちの操作
// ============================================================

const server = { rows: fixture.rows, epoch: 2 };
const train = rowOf('ledger_entries', r => r.name === '電車');

test('操作の base は、サーバーの写しの updated_at', () => {
  const op = makeOp([{ table: 'ledger_entries', action: 'update', id: train.id, row: { amount: 1 } }],
    { id: 'op1', epoch: 2, now: NOW, server, outbox: [] });
  assert.equal(op.changes[0].base, train.updated_at);
  assert.equal(op.epoch, 2);
  assert.ok(isReady(op));
});

test('前の送信待ちの操作が変えた行の base は、その操作が保存できてから決める', () => {
  const op1 = makeOp([{ table: 'ledger_entries', action: 'update', id: train.id, row: { amount: 1 } }],
    { id: 'op1', epoch: 2, now: NOW, server, outbox: [] });
  const op2 = makeOp([{ table: 'ledger_entries', action: 'delete', id: train.id }],
    { id: 'op2', epoch: 2, now: NOW, server, outbox: [op1] });
  assert.equal(op2.changes[0].base, 'pending:op1');
  assert.ok(!isReady(op2));

  const after = acknowledge({ server, outbox: [op1, op2] }, op1, {
    status: 'applied', rows: [{ table: 'ledger_entries', id: train.id, action: 'update', updated_at: '2026-10-30T01:00:00+00:00' }],
  });
  assert.deepStrictEqual(after.outbox.map(o => o.id), ['op2']);
  assert.equal(after.outbox[0].changes[0].base, '2026-10-30T01:00:00+00:00');
  const saved = after.server.rows.ledger_entries.find(r => r.id === train.id);
  assert.equal(saved.amount, 1);
  assert.equal(saved.updated_at, '2026-10-30T01:00:00+00:00');
});

test('サーバーの写しに送信待ちを重ねると、追加・更新・削除が見える（消えた行の更新は重ねない）', () => {
  const outbox = [{
    id: 'op1', createdAt: NOW, changes: [
      { table: 'withdrawals', action: 'insert', id: 'w-new', row: { date: '2026-10-30', amount: 500, position: 9 } },
      { table: 'ledger_entries', action: 'update', id: train.id, row: { amount: 2 } },
      { table: 'ledger_entries', action: 'update', id: 'gone', row: { amount: 3 } },
    ],
  }, {
    id: 'op2', createdAt: NOW, changes: [{ table: 'withdrawals', action: 'delete', id: fixture.rows.withdrawals[0].id }],
  }];
  const rows = applyOutbox(fixture.rows, outbox);
  assert.equal(rows.withdrawals.length, fixture.rows.withdrawals.length);
  assert.ok(rows.withdrawals.some(w => w.id === 'w-new' && w.created_at === NOW));
  assert.equal(rows.ledger_entries.find(r => r.id === train.id).amount, 2);
  assert.ok(!rows.ledger_entries.some(r => r.id === 'gone'));
  assert.equal(fixture.rows.ledger_entries.find(r => r.id === train.id).amount, 500, '元の写しは変えない');
});

test('「この端末の内容で上書き」: 競合の理由ごとに操作を書き換える', () => {
  const op = {
    id: 'op1', epoch: 2, createdAt: NOW, changes: [
      { table: 'ledger_entries', action: 'update', id: 'a', base: 'old', row: { amount: 1 } },
      { table: 'ledger_entries', action: 'update', id: 'b', base: 'old', row: { amount: 2 } },
      { table: 'ledger_entries', action: 'insert', id: 'c', row: { amount: 3 } },
      { table: 'salary_actuals', action: 'insert', id: 'mine', row: { actual_amount: 4 } },
    ],
  };
  const later = { id: 'op2', epoch: 2, createdAt: NOW, changes: [{ table: 'salary_actuals', action: 'update', id: 'mine', base: 'pending:op1', row: { actual_amount: 5 } }] };
  const conflicts = [
    { index: 1, table: 'ledger_entries', id: 'a', reason: 'changed', server: { id: 'a', updated_at: 'srv-a' } },
    { index: 2, table: 'ledger_entries', id: 'b', reason: 'missing', server: null },
    { index: 3, table: 'ledger_entries', id: 'c', reason: 'exists', server: { id: 'c', updated_at: 'srv-c' } },
    { index: 4, table: 'salary_actuals', id: 'mine', reason: 'duplicate', server: { id: 'theirs', updated_at: 'srv-t' } },
  ];
  const [rewritten, next] = rewriteForOverwrite([op, later], op, conflicts, 'op1b');
  assert.equal(rewritten.id, 'op1b', '新しい操作 ID を付ける');
  assert.deepStrictEqual(rewritten.changes.map(c => [c.action, c.id, c.base]), [
    ['update', 'a', 'srv-a'],
    ['insert', 'b', undefined],
    ['update', 'c', 'srv-c'],
    ['update', 'theirs', 'srv-t'],
  ]);
  assert.equal(next.changes[0].id, 'theirs', 'あとの操作の ID も付け替える');
});

test('送れない操作を捨てると、それを前提にしたあとの操作も捨てる', () => {
  const ops = [
    { id: 'op1', changes: [{ table: 'withdrawals', action: 'insert', id: 'w1', row: {} }] },
    { id: 'op2', changes: [{ table: 'withdrawals', action: 'update', id: 'w1', base: 'pending:op1', row: {} }] },
    { id: 'op3', changes: [{ table: 'withdrawals', action: 'delete', id: 'w1', base: 'pending:op2' }] },
    { id: 'op4', changes: [{ table: 'withdrawals', action: 'insert', id: 'w2', row: {} }] },
  ];
  assert.deepStrictEqual(discardOp(ops, 'op1').map(o => o.id), ['op4']);
  assert.deepStrictEqual(discardOp(ops, 'op4').map(o => o.id), ['op1', 'op2', 'op3']);
});

// ============================================================
// apply_op を呼ぶ
// ============================================================

const readyOp = { id: 'op1', epoch: 2, createdAt: NOW, changes: [{ table: 'withdrawals', action: 'insert', id: 'w', row: {} }] };
const fakeRpc = response => ({ rpc: async (name, args) => { assert.equal(name, 'apply_op'); assert.ok(!('createdAt' in args.op)); return typeof response === 'function' ? response() : response; } });

test('apply_op の結果を種類に分ける', async () => {
  assert.equal((await sendOp(fakeRpc({ data: { status: 'applied', rows: [] }, error: null, status: 200 }), readyOp)).kind, 'applied');
  assert.equal((await sendOp(fakeRpc({ data: { status: 'conflict', conflicts: [] }, error: null, status: 200 }), readyOp)).kind, 'conflict');
  assert.equal((await sendOp(fakeRpc({ data: { status: 'stale_epoch', epoch: 3 }, error: null, status: 200 }), readyOp)).epoch, 3);
  assert.equal((await sendOp(fakeRpc(() => { throw new TypeError('Failed to fetch'); }), readyOp)).kind, 'network');
  assert.equal((await sendOp(fakeRpc({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }), readyOp)).kind, 'network');
  assert.equal((await sendOp(fakeRpc({ data: null, error: { message: 'bad gateway' }, status: 502 }), readyOp)).kind, 'network');
  assert.equal((await sendOp(fakeRpc({ data: null, error: { code: '23514', message: 'check' }, status: 400 }), readyOp)).kind, 'error');
});

test('base が決まっていない操作は送らない', async () => {
  const op = { ...readyOp, changes: [{ table: 'withdrawals', action: 'delete', id: 'w', base: 'pending:op0' }] };
  await assert.rejects(sendOp(fakeRpc({}), op), /まだ保存できていません/);
});
