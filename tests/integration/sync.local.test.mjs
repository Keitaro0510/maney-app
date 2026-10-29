// 試験版の保存を、ローカルの Supabase（docs/db/LOCAL.md）で実際に通すテスト。
// JavaScript が作った操作を DB の apply_op が受け付けるか、2台の端末の競合を、本物の DB で確かめる。
//
// 実行（ローカルの Supabase を起動してから）:
//   eval "$(npx supabase status -o env | sed 's/^/export MANEY_LOCAL_/')"
//   node --test "tests/integration/*.test.mjs"
// 環境変数（MANEY_LOCAL_API_URL など）がなければ、このテストは飛ばす。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rowsToSt, stToRows, stripMeta } = require('../../js/compat.js');
const { loadAllTables, diffRows, makeOp, applyOutbox, acknowledge, rewriteForOverwrite, sendOp } = require('../../js/data.js');

const URL_ = process.env.MANEY_LOCAL_API_URL;
const ANON = process.env.MANEY_LOCAL_PUBLISHABLE_KEY || process.env.MANEY_LOCAL_ANON_KEY;
const SERVICE = process.env.MANEY_LOCAL_SERVICE_ROLE_KEY;
const skip = !(URL_ && ANON && SERVICE) && 'ローカルの Supabase の環境変数がない';

// ---------- supabase-js の代わり（data.js が使う分だけ） ----------
function client(token) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    from(table) {
      const query = { orders: [] };
      const api = {
        select() { return api; },
        order(column) { query.orders.push(`${column}.asc`); return api; },
        async range(from, to) {
          const res = await fetch(`${URL_}/rest/v1/${table}?select=*&order=${query.orders.join(',')}`, {
            headers: { ...headers, Range: `${from}-${to}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
          });
          const body = await res.json();
          if (!res.ok) return { data: null, error: body, count: null };
          return { data: body, error: null, count: Number(res.headers.get('content-range').split('/')[1]) };
        },
        async maybeSingle() {
          const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, { headers });
          const body = await res.json();
          return res.ok ? { data: body[0] || null, error: null } : { data: null, error: body };
        },
      };
      return api;
    },
    async rpc(fn, args) {
      const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
      const body = await res.json();
      return res.ok ? { data: body, error: null, status: res.status } : { data: null, error: body, status: res.status };
    },
  };
}

async function createUser(name) {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'local-test-password';
  const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
  }).then(r => r.json());
  const session = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  return { id: created.id, supa: client(session.access_token) };
}

// ---------- 1台の端末（next.html の保存の流れと同じ） ----------
function device(supa) {
  const d = {
    server: null, outbox: [], st: null,
    async load() { d.server = await loadAllTables(supa); d.rebuild(); },
    rows() { return applyOutbox(d.server.rows, d.outbox); },
    rebuild() { d.st = rowsToSt(d.rows()); },
    // 画面で st を変えて save() したのと同じ
    save(edit) {
      edit(d.st);
      const now = new Date().toISOString();
      const before = d.rows();
      const changes = diffRows(before, stToRows(d.st, before, { newId: () => crypto.randomUUID(), now }));
      if (changes.length) d.outbox.push(makeOp(changes, { id: crypto.randomUUID(), epoch: d.server.epoch, now, server: d.server, outbox: d.outbox }));
      d.rebuild();
      return changes;
    },
    // 送信待ちを送る。最初に止まった結果（競合など）を返す
    async flush() {
      while (d.outbox.length) {
        const op = d.outbox[0];
        const res = await sendOp(supa, op);
        if (res.kind !== 'applied') return { ...res, op };
        ({ server: d.server, outbox: d.outbox } = acknowledge(d, op, res.result));
      }
      return { kind: 'done' };
    },
  };
  return d;
}

// 新しいユーザーの st（index.html の st の初期値と同じ）
const emptySt = () => ({
  acctBase: 0, baseDate: '2026-10-01', shiftCloseDay: 31, shiftPayDay: 10, budget: 0, fixedIncs: [], jobs: [], shifts: [],
  ledger: [], cards: [], wds: [], actualInputs: [], fuyouLimit: '1300000', otherIncome: 0, plans: [],
  catExp: ['食費', '交通費', 'その他'], catInc: ['給与', 'その他'], fixedCosts: [],
});

// 新しい予定・固定費の st の id は登録日時から作るので、端末とサーバーで少し違う。それ以外を比べる
const comparable = st => {
  const s = stripMeta(st);
  s.plans.forEach(p => delete p.id);
  s.fixedCosts.forEach(f => delete f.id);
  return s;
};

let alice;
before(async () => { if (!skip) alice = await createUser('alice'); });

test('新しいユーザーが一通り記録し、読み込み直しても同じ画面のデータになる', { skip }, async () => {
  const a = device(alice.supa);
  await a.load();
  assert.equal(a.st, null, 'まだ設定の行がない');

  // 最初の保存（設定とカテゴリを作る）
  a.st = emptySt();
  const first = a.save(() => {});
  assert.ok(first.some(c => c.table === 'settings' && c.action === 'insert'));
  assert.equal((await a.flush()).kind, 'done');

  a.save(st => { st.cards.push({ name: 'Aカード', closeDay: '31', billDay: '27' }); });
  a.save(st => { st.jobs.push({ name: 'カフェ', wage: 1300, color: 'blue', nightStart: '22:00', nightRate: 25, transport: 200, closeDay: 31, payDay: 25 }); });
  a.save(st => {
    st.ledger.push({ date: '2026-10-01', amount: 1200, name: 'ランチ', cat: '食費', type: 'expense', pay: 'Aカード', memo: '', cardIdx: 0 });
    st.ledger.push({ date: '2026-10-02', amount: 100000, name: '給料', cat: '給与', type: 'income', pay: '現金', memo: '', receive: '口座振込' });
  });
  a.save(st => {
    ['2026-10-03', '2026-10-04'].forEach(date => st.shifts.push({ job: 'カフェ', date, start: '10:00', end: '15:00', rest: 0, wage: 1300 }));
  });
  a.save(st => {
    st.plans.push({ id: Date.now(), title: '旅行', date: '2026-11-01', dateStart: '2026-11-01', dateEnd: '2026-11-02', timeStart: '', timeEnd: '', budget: 30000, memo: '', color: 'green', done: false, planCardIdx: 0 });
    st.fixedCosts.push({ id: Date.now(), name: '家賃', amount: 50000, day: 27, type: 'expense', pay: 'bank' });
    st.fixedCosts.push({ id: Date.now(), name: '音楽', amount: 980, day: 2, type: 'expense', pay: 'card-0' });
    st.fixedIncs.push({ name: '仕送り', amount: '30000', day: '25' });
    st.wds.push({ date: '2026-10-05', amount: 3000 });
    st.actualInputs.push({ type: 'card', cardKey: 'card-0-2026-10', cardIdx: 0, billY: 2026, billM: 9, actualAmount: 1200, estimatedAmount: 1200 });
    st.actualInputs.push({ type: 'shift', job: 'カフェ', salaryKey: 'カフェ|2026-11', date: '2026-11-25', actualAmount: 13000, estimatedAmount: 13000 });
  });
  assert.equal(a.outbox.length, 5, '5つの操作が送信待ち');
  assert.equal((await a.flush()).kind, 'done');
  assert.equal(a.outbox.length, 0);

  // 編集・削除（ID を引き継ぐ）
  a.save(st => { st.ledger[0] = { ...st.ledger[0], amount: 1500 }; });
  a.save(st => { st.shifts.splice(1, 1); });
  a.save(st => { st.cards[0]._deleted = true; });
  assert.equal((await a.flush()).kind, 'done');

  const local = comparable(a.st);
  const fresh = device(alice.supa);
  await fresh.load();
  assert.deepStrictEqual(comparable(fresh.st), local, '別の端末で読み込んでも、同じ画面のデータになる');
  assert.equal(fresh.st.ledger[0].amount, 1500);
  assert.equal(fresh.st.shifts.length, 1);
  assert.equal(fresh.st.cards[0]._deleted, true);
  assert.equal(fresh.st.ledger[0].pay, 'Aカード', '削除済みのカードの記録は、正しい名前のまま');
});

test('2台の端末の競合: 別の端末が変えた記録を、この端末の内容で上書きできる', { skip }, async () => {
  const a = device(alice.supa);
  const b = device(alice.supa);
  await a.load();
  await b.load();

  a.save(st => { st.ledger[0] = { ...st.ledger[0], memo: 'A が書いた' }; });
  assert.equal((await a.flush()).kind, 'done');

  b.save(st => { st.ledger[0] = { ...st.ledger[0], memo: 'B が書いた' }; });
  const res = await b.flush();
  assert.equal(res.kind, 'conflict');
  assert.equal(res.conflicts[0].reason, 'changed');
  assert.equal(res.conflicts[0].server.memo, 'A が書いた');

  b.outbox = rewriteForOverwrite(b.outbox, res.op, res.conflicts, crypto.randomUUID());
  assert.equal((await b.flush()).kind, 'done');
  await a.load();
  assert.equal(a.st.ledger[0].memo, 'B が書いた');
});

test('2台の端末の競合: 別の端末が消した記録を編集すると、作り直せる', { skip }, async () => {
  const a = device(alice.supa);
  const b = device(alice.supa);
  await a.load();
  await b.load();
  const id = a.st.wds[0]._id;

  a.save(st => { st.wds = st.wds.filter(w => w._id !== id); });
  assert.equal((await a.flush()).kind, 'done');

  b.save(st => { st.wds.find(w => w._id === id).amount = 4000; });
  const res = await b.flush();
  assert.equal(res.conflicts[0].reason, 'missing');
  b.outbox = rewriteForOverwrite(b.outbox, res.op, res.conflicts, crypto.randomUUID());
  assert.equal((await b.flush()).kind, 'done');

  await a.load();
  assert.deepStrictEqual(a.st.wds.map(w => [w._id, w.amount]), [[id, 4000]]);
});

test('2台の端末の競合: 同じ月の給与の実績を別々に登録すると、サーバーの行をこの端末の内容で更新できる', { skip }, async () => {
  const a = device(alice.supa);
  const b = device(alice.supa);
  await a.load();
  await b.load();
  const salary = amount => st => {
    st.actualInputs.push({ type: 'shift', job: 'カフェ', salaryKey: 'カフェ|2026-12', date: '2026-12-25', actualAmount: amount, estimatedAmount: 0 });
  };

  a.save(salary(20000));
  assert.equal((await a.flush()).kind, 'done');
  b.save(salary(21000));
  const res = await b.flush();
  assert.equal(res.conflicts[0].reason, 'duplicate');
  b.outbox = rewriteForOverwrite(b.outbox, res.op, res.conflicts, crypto.randomUUID());
  assert.equal((await b.flush()).kind, 'done');

  await a.load();
  const december = a.st.actualInputs.filter(x => x.salaryKey === 'カフェ|2026-12');
  assert.deepStrictEqual(december.map(x => x.actualAmount), [21000], '1件だけで、この端末の金額になる');
});

test('送れていない操作が続いていても、前の操作が保存できてから送る（base を引き継ぐ）', { skip }, async () => {
  const a = device(alice.supa);
  await a.load();
  a.save(st => { st.wds.push({ date: '2026-10-20', amount: 700 }); });
  a.save(st => { st.wds.at(-1).amount = 800; });
  a.save(st => { st.wds.pop(); });
  assert.equal(a.outbox.length, 3);
  assert.equal(a.outbox[1].changes[0].base, `pending:${a.outbox[0].id}`);
  assert.equal((await a.flush()).kind, 'done');
  const fresh = device(alice.supa);
  await fresh.load();
  assert.ok(!fresh.st.wds.some(w => w.date === '2026-10-20'));
});

test('ほかのユーザーには、何も見えない', { skip }, async () => {
  const bob = await createUser('bob');
  const b = device(bob.supa);
  await b.load();
  assert.equal(b.st, null);
  assert.ok(Object.values(b.server.rows).every(rows => rows.length === 0));
});

test('移し直したあと（移行の番号が上がった）は、古い番号の操作を受け付けない', { skip }, async () => {
  const a = device(alice.supa);
  await a.load();
  a.save(st => { st.budget = 12345; });
  const res = await fetch(`${URL_}/rest/v1/sync_state`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: alice.id, epoch: 7 }),
  });
  assert.ok(res.ok, '管理者として移行の番号を上げる');
  const sent = await a.flush();
  assert.equal(sent.kind, 'stale_epoch');
  assert.equal(sent.epoch, 7);
});
