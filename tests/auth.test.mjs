// ログインと起動の流れ（src/auth.ts。D19 の手順5）を、偽の Supabase と偽の画面で確かめる。実行: node --test "tests/*.test.mjs"
// 本物のログイン（ローカルの Supabase）・ログアウト・アプリに戻ったときの読み直しは、ブラウザで確かめる（docs/db/LOCAL.md）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { state } from '../src/state.ts'; // Node が型を消して読む（D17）
import { initSync } from '../src/sync.ts';
import { initAuth, loadData, logout, handleLegacyLocalData, loginWithGoogle } from '../src/auth.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/compat-fixture.json', import.meta.url), 'utf8'));
const NOW = '2026-11-02T00:00:00.000Z';
const USER = { id: 'u1', email: 'u1@example.test' };

const emptySt = () => ({
  acctBase: 0, baseDate: '2026-11-01', shiftCloseDay: 31, shiftPayDay: 10, budget: 0, jobs: [], shifts: [],
  ledger: [], cards: [], wds: [], actualInputs: [], fuyouLimit: '1300000', otherIncome: 0, plans: [],
  catExp: ['食費', 'その他'], catInc: ['給与', 'その他'],
});

// localStorage の代わり（key(i)・length も使う）
class MemoryStorage {
  #m = new Map();
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  keys() { return [...this.#m.keys()]; }
}

function setup({ session = null, tables = fixture.rows, storage = new MemoryStorage() } = {}) {
  const calls = [];
  const banners = [];
  let authListener = null;
  const supa = {
    sent: [],
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: cb => { authListener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { calls.push(['signOut']); return { error: null }; },
      signInWithOAuth: async args => { calls.push(['signInWithOAuth', args]); return { error: null }; },
    },
    async rpc(fn, { op }) {
      supa.sent.push(op);
      return { data: { status: 'applied', rows: op.changes.filter(c => c.action !== 'delete').map(c => ({ table: c.table, id: c.id, updated_at: NOW })) }, error: null, status: 200 };
    },
    from(table) {
      if (table === 'sync_state') return { select: () => ({ maybeSingle: async () => ({ data: { epoch: 1 }, error: null }) }) };
      const rows = tables[table] || [];
      const q = { order: () => q, range: async (a, b) => ({ data: rows.slice(a, b + 1), error: null, count: rows.length }) };
      return { select: () => q };
    },
  };
  const rec = name => (...args) => calls.push([name, ...args]);
  const ui = {
    showBanner: (msg, actions) => { calls.push(['showBanner', msg]); banners.push({ msg, actions }); },
    hideBanner: rec('hideBanner'),
    renderCurrentSection: rec('renderCurrentSection'),
    updateSyncStatus: rec('updateSyncStatus'),
    hasOpenModal: () => false,
    downloadJson: rec('downloadJson'),
    showLogin: rec('showLogin'),
    hideLogin: rec('hideLogin'),
    renderFirst: rec('renderFirst'),
    showStartupTasks: rec('showStartupTasks'),
    reload: rec('reload'),
  };
  // 状態を初めに戻す
  state.st = emptySt();
  state.server = null; state.outbox = []; state.currentUser = null;
  state.remoteReady = state.loadingRemote = state.sending = false; state.sendBlocked = null;
  const common = { supa, ui, storagePrefix: 'test:', storage, fixDefaults: rec('fixDefaults') };
  initSync({ ...common, defaultSt: emptySt });
  initAuth({ ...common, currentUrl: () => 'http://127.0.0.1:8765/' });
  return { supa, ui, calls, banners, storage, fire: (event, s) => authListener(event, s) };
}

const names = calls => calls.map(c => c[0]);

test('開いたときにログイン済みなら、端末の写しで描いてから読み込み、開いたときのタスクを出して送る（今までと同じ順）', async () => {
  const storage = new MemoryStorage();
  storage.setItem('test:u1:v2:server', JSON.stringify({ rows: fixture.rows, epoch: 1, loadedAt: NOW }));
  const { calls } = setup({ session: { user: USER }, storage });
  await loadData();
  assert.equal(state.currentUser.id, 'u1');
  assert.equal(state.remoteReady, true);
  const order = names(calls).filter(n => ['fixDefaults', 'hideLogin', 'renderFirst', 'renderCurrentSection', 'showStartupTasks', 'showLogin'].includes(n));
  // fixDefaults は loadData の始めと、st を作り直すたび（端末の写し・読み込み）
  assert.deepEqual(order, ['fixDefaults', 'hideLogin', 'fixDefaults', 'renderFirst', 'fixDefaults', 'renderCurrentSection', 'showStartupTasks']);
  assert.deepEqual(calls.find(c => c[0] === 'hideLogin')[1], USER);
});

test('ログインしていなければ、ログイン画面を出す。ログインしたら1回だけ起動する', async () => {
  const { calls, fire } = setup();
  await loadData();
  assert.ok(names(calls).includes('showLogin'));
  assert.equal(state.currentUser, null);
  await fire('SIGNED_IN', { user: USER });
  assert.equal(state.currentUser.id, 'u1');
  assert.equal(state.remoteReady, true);
  await fire('SIGNED_IN', { user: USER }); // アプリに戻ったときの再発火では、起動し直さない
  assert.equal(names(calls).filter(n => n === 'hideLogin').length, 1);
});

test('ログアウトの知らせ（SIGNED_OUT）で、状態を空にしてログイン画面を出す', async () => {
  const { calls, fire } = setup({ session: { user: USER } });
  await loadData();
  await fire('SIGNED_OUT', null);
  assert.equal(state.currentUser, null);
  assert.equal(state.server, null);
  assert.deepEqual(state.outbox, []);
  assert.equal(state.remoteReady, false);
  assert.equal(names(calls).at(-1), 'showLogin');
  await fire('SIGNED_IN', { user: USER }); // もう一度ログインすると、また起動する
  assert.equal(state.currentUser.id, 'u1');
});

test('ログアウトすると、この端末の写しと送信待ちを消して読み込み直す', async () => {
  const { calls, storage } = setup({ session: { user: USER } });
  await loadData();
  assert.ok(storage.getItem('test:u1:v2:server'));
  await logout();
  assert.deepEqual(names(calls).slice(-2), ['signOut', 'reload']);
  assert.equal(storage.getItem('test:u1:v2:server'), null);
  assert.equal(storage.getItem('test:u1:v2:outbox'), null);
});

test('送れていない変更があるときは、ログアウトする前に確かめる（「やめる」でやめる）', async () => {
  const { calls, banners } = setup({ session: { user: USER } });
  await loadData();
  state.outbox = [{ id: 'op1', epoch: 1, createdAt: NOW, changes: [] }];
  await logout();
  assert.match(banners.at(-1).msg, /送れていない変更が1件あります/);
  assert.ok(!names(calls).includes('signOut'));
  await banners.at(-1).actions.find(a => a.label === 'やめる').onclick();
  assert.ok(!names(calls).includes('signOut'));
  await logout();
  await banners.at(-1).actions.find(a => a.label === 'ログアウトする').onclick();
  assert.deepEqual(names(calls).slice(-2), ['signOut', 'reload']);
});

test('Google でログインすると、今のページに戻るように頼む', async () => {
  const { calls } = setup();
  await loginWithGoogle();
  assert.deepEqual(calls.at(-1), ['signInWithOAuth', { provider: 'google', options: { redirectTo: 'http://127.0.0.1:8765/' } }]);
});

test('切り替える前の版のデータ: 送れていない変更があれば書き出せるようにし、なければ消す。試験版のキーは消す', () => {
  const storage = new MemoryStorage();
  storage.setItem('mavSync', JSON.stringify({ dirty: true }));
  storage.setItem('mavFinal2', '{"old":1}');
  storage.setItem('maney:next:x', '1');
  storage.setItem('maney:prod:keep', '1');
  const { calls, banners } = setup({ storage });
  handleLegacyLocalData();
  assert.deepEqual(storage.keys().sort(), ['maney:prod:keep', 'mavFinal2', 'mavSync']);
  assert.match(banners.at(-1).msg, /切り替える前の版で/);
  banners.at(-1).actions.find(a => a.label === '書き出す').onclick();
  assert.deepEqual(calls.at(-1), ['downloadJson', 'maney-before-cutover', '{"old":1}']);
  banners.at(-1).actions.find(a => a.label === '捨てる').onclick();
  assert.deepEqual(storage.keys(), ['maney:prod:keep']);

  const clean = new MemoryStorage();
  clean.setItem('mavSync', JSON.stringify({ dirty: false }));
  clean.setItem('mavFinal2', '{}');
  const s2 = setup({ storage: clean });
  handleLegacyLocalData();
  assert.deepEqual(clean.keys(), []);
  assert.equal(s2.banners.length, 0);
});

test('js/ のファイルは、window に出したログインと起動の名前を宣言していない', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const n of ['supa', 'loginWithGoogle', 'logout', 'loadData', 'startWithUser', 'reallyLogout']) {
      assert.doesNotMatch(src, new RegExp(`^((async )?function|let|var|const)\\s+${n}\\b`, 'm'), `js/${f} に ${n} の宣言があります`);
    }
  }
});
