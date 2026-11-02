// 保存・送信・読み込みの流れ（src/sync.ts。D19 の手順4）を、偽の Supabase と偽の画面で確かめる。実行: node --test "tests/*.test.mjs"
// 本物の DB では起こしにくい場合（受け付けられない・保存の失敗・読み込む前の保存・入力中の読み直し など）はここで、
// 本物の DB を通す場合（送る・通信の失敗・2台の端末の競合）は tests/integration/sync-flow.local.test.mjs で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncDevice } from './sync-device.mjs';
import { TABLE_LABELS } from '../src/sync.ts'; // Node が型を消して読む（D17）

const fixture = JSON.parse(readFileSync(new URL('./fixtures/compat-fixture.json', import.meta.url), 'utf8'));
const NOW = '2026-11-02T00:00:00.000Z';

// 新しいユーザーの st（js/app-core.js の defaultSt と同じ形）
const emptySt = () => ({
  acctBase: 0, baseDate: '2026-11-01', shiftCloseDay: 31, shiftPayDay: 10, budget: 0, jobs: [], shifts: [],
  ledger: [], cards: [], wds: [], actualInputs: [], fuyouLimit: '1300000', otherIncome: 0, plans: [],
  catExp: ['食費', 'その他'], catInc: ['給与', 'その他'],
});

// apply_op の代わり。mode で結果を変える
function fakeSupa() {
  const f = {
    mode: 'ok', // ok・offline・conflict・error
    sent: [],
    tables: {}, // 読み込み（loadRemote）で返す行
    async rpc(fn, { op }) {
      f.sent.push(op);
      if (f.mode === 'offline') throw new TypeError('Failed to fetch');
      if (f.mode === 'error') return { data: null, error: { message: 'new row violates check constraint', code: '23514' }, status: 400 };
      if (f.mode === 'conflict') {
        const c = op.changes[0];
        return { data: { status: 'conflict', conflicts: [{ index: 1, table: c.table, id: c.id, reason: 'missing', server: null }] }, error: null, status: 200 };
      }
      const rows = op.changes.filter(c => c.action !== 'delete').map(c => ({ table: c.table, id: c.id, updated_at: NOW }));
      return { data: { status: 'applied', rows }, error: null, status: 200 };
    },
    from(table) {
      if (table === 'sync_state') return { select: () => ({ maybeSingle: async () => ({ data: { epoch: 1 }, error: null }) }) };
      const rows = f.tables[table] || [];
      const q = { order: () => q, range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null, count: rows.length }) };
      return { select: () => q };
    },
  };
  return f;
}

async function loaded(options = {}) {
  const supa = fakeSupa();
  const d = syncDevice(supa, { userId: 'u1', defaultSt: emptySt, ...options });
  await d.setServer({ rows: structuredClone(fixture.rows), epoch: 1, loadedAt: NOW });
  return { supa, d };
}

const addLunch = st => st.ledger.push({ date: '2026-11-02', amount: 800, name: 'テストのランチ', cat: st.catExp[0], type: 'expense', pay: '現金', memo: '' });
const hasLunch = rows => rows.ledger_entries.some(r => r.name === 'テストのランチ');

test('保存すると送信待ちに積んで送り、受け付けられたら写しに入って送信待ちが空になる', async () => {
  const { supa, d } = await loaded();
  await d.save(addLunch);
  assert.equal(supa.sent.length, 1);
  assert.equal(d.outbox.length, 0);
  assert.ok(hasLunch(d.server.rows));
  assert.ok(d.st.ledger.some(l => l.name === 'テストのランチ'));
  assert.equal(d.banner, null); // 送り終えたらバナーを消す
  assert.ok(d.calls.some(c => c[0] === 'updateSyncStatus'));
  // 端末の保存場所にも写しと送信待ちを入れる
  assert.deepEqual(JSON.parse(d.storage.get('test:u1:v2:outbox')), []);
  assert.ok(hasLunch(JSON.parse(d.storage.get('test:u1:v2:server')).rows));
});

test('通信できないと、送信待ちに残してバナーを出し、「もう一度送る」で送れる', async () => {
  const { supa, d } = await loaded();
  supa.mode = 'offline';
  await d.save(addLunch);
  assert.equal(d.outbox.length, 1);
  assert.equal(d.sendBlocked, null); // 通信の失敗では止めない（戻ったら送る）
  assert.match(d.banner.msg, /通信できないため、送れていない変更が1件あります/);
  assert.ok(JSON.parse(d.storage.get('test:u1:v2:outbox')).length === 1); // 端末に残っている
  supa.mode = 'ok';
  await d.click('もう一度送る');
  assert.equal(d.outbox.length, 0);
  assert.ok(hasLunch(d.server.rows));
});

test('受け付けられない（制約違反など）と止め、「この変更を捨てる」で送信待ちから外して st を戻す', async () => {
  const { supa, d } = await loaded();
  supa.mode = 'error';
  await d.save(addLunch);
  assert.equal(d.sendBlocked, 'error');
  assert.match(d.banner.msg, /受け付けませんでした。\nnew row violates check constraint/);
  await d.save(st => { st.budget = 12345; }); // 止めている間は送らない
  assert.equal(supa.sent.length, 1);
  assert.equal(d.outbox.length, 2);
  supa.mode = 'ok';
  await d.click('この変更を捨てる');
  assert.equal(d.sendBlocked, null);
  assert.equal(d.outbox.length, 0); // 捨てた操作のあとの操作は送れた
  assert.equal(supa.sent.length, 2);
  assert.ok(!d.st.ledger.some(l => l.name === 'テストのランチ'));
});

test('受け付けられないとき「もう一度送る」で、同じ操作を送り直す', async () => {
  const { supa, d } = await loaded();
  supa.mode = 'error';
  await d.save(addLunch);
  supa.mode = 'ok';
  await d.click('もう一度送る');
  assert.equal(d.sendBlocked, null);
  assert.equal(d.outbox.length, 0);
  assert.equal(supa.sent[0].id, supa.sent[1].id);
});

test('競合すると止めて理由を出し、「この端末の内容で上書き」で書き換えて送り、読み込み直す', async () => {
  const { supa, d } = await loaded();
  supa.mode = 'conflict';
  await d.save(addLunch);
  assert.equal(d.sendBlocked, 'conflict');
  assert.match(d.banner.msg, new RegExp(`・${TABLE_LABELS.ledger_entries}: 別の端末で削除されています`));
  supa.mode = 'ok';
  supa.tables = structuredClone(fixture.rows);
  await d.click('この端末の内容で上書き');
  assert.equal(d.sendBlocked, null);
  assert.equal(d.outbox.length, 0);
  assert.notEqual(supa.sent[1].id, supa.sent[0].id); // 新しい操作 ID で送り直す
  assert.equal(d.remoteReady, true); // 送れたら、別の端末のほかの変更も読み込む
});

test('競合して「サーバーの内容にする」と、送信待ちを捨ててサーバーから読み込み直す', async () => {
  const { supa, d } = await loaded();
  supa.mode = 'conflict';
  await d.save(addLunch);
  supa.tables = structuredClone(fixture.rows);
  await d.click('サーバーの内容にする');
  assert.equal(d.sendBlocked, null);
  assert.equal(d.outbox.length, 0);
  assert.equal(d.remoteReady, true);
  assert.ok(!d.st.ledger.some(l => l.name === 'テストのランチ'));
});

test('まだサーバーから読み込めていないときは保存せず、「もう一度読み込む」を出す', async () => {
  const supa = fakeSupa();
  const d = syncDevice(supa, { userId: 'u1', defaultSt: emptySt });
  await d.save(addLunch);
  assert.equal(d.outbox.length, 0);
  assert.match(d.banner.msg, /まだサーバーから読み込めていない/);
  assert.equal(await d.saveRows([{ table: 'tasks', action: 'insert', id: crypto.randomUUID(), row: { title: 'x' } }]), false);
  supa.tables = structuredClone(fixture.rows);
  await d.click('もう一度読み込む');
  assert.equal(d.remoteReady, true);
  assert.ok(d.server);
});

test('st を行に戻せないときは、変えた内容を取り消して知らせる（送信待ちには積まない）', async () => {
  const { supa, d } = await loaded();
  await d.save(st => { st.ledger.push(null); }); // 行に戻すときに止まる形
  assert.equal(d.outbox.length, 0);
  assert.equal(supa.sent.length, 0);
  assert.match(d.banner.msg, /保存できませんでした。変えた内容は取り消しました。/);
  assert.ok(!d.st.ledger.includes(null)); // 今の行から作り直した
  assert.ok(d.calls.some(c => c[0] === 'renderCurrentSection'));
});

test('行を直接保存する入り口（saveRows）は、1回の呼び出しを1つの操作にして送る。形が違えば積まずに false', async () => {
  const { supa, d } = await loaded();
  const id = crypto.randomUUID();
  assert.equal(await d.saveRows([{ table: 'tasks', action: 'insert', id, row: { title: 'テストのタスク', position: 0 } }]), true);
  assert.equal(supa.sent.length, 1);
  assert.ok((await d.rows()).tasks.some(t => t.id === id));
  assert.equal(await d.saveRows([{ table: 'ledger_entries', action: 'insert', id: crypto.randomUUID(), row: {} }]), false);
  assert.equal(supa.sent.length, 1);
  assert.match(d.banner.msg, /保存できませんでした。/);
});

test('戻ってきたときの読み直しは、入力中の画面があれば読み込まない（送るのはする）', async () => {
  let modal = true;
  const { supa, d } = await loaded({ hasOpenModal: () => modal });
  supa.tables = structuredClone(fixture.rows);
  await d.resync();
  assert.equal(d.remoteReady, false);
  modal = false;
  await d.resync();
  assert.equal(d.remoteReady, true);
});

test('読み込めないときは、前の写しを残して知らせる', async () => {
  const { supa, d } = await loaded();
  supa.from = () => { throw new Error('読み込みの失敗'); };
  await d.load();
  assert.equal(d.remoteReady, false);
  assert.ok(d.server);
  assert.match(d.banner.msg, /前に読み込んだ内容を表示しています。\n読み込みの失敗/);
});

test('initSync の前に使うと止める', async () => {
  const fresh = await import(`../src/sync.ts?fresh=${Date.now()}`);
  assert.throws(() => fresh.save(), /initSync の前/);
});

test('js/ のファイルは、window に出した流れの名前を宣言していない（宣言すると window の名前を上書きしてしまう）', () => {
  const names = ['TABLE_LABELS', 'currentRows', 'rebuildSt', 'loadStored', 'save', 'saveRows', 'flushOutbox', 'loadRemote', 'resyncRemote'];
  const dir = new URL('../js/', import.meta.url);
  for (const f of ['app-core.js', 'app-home.js', 'app-calendar.js', 'app-cards.js', 'app-shift.js', 'app-ledger.js', 'app-settings.js', 'app-plan.js', 'app-bootstrap.js', 'ui.js', 'tasks-ui.js', 'monthly-ui.js', 'backup-ui.js']) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const n of names) assert.doesNotMatch(src, new RegExp(`^((async )?function|let|var|const)\\s+${n}\\b`, 'm'), `js/${f} に ${n} の宣言があります`);
  }
});
