// データと同期の状態の入れ物（src/state.ts）と、js/ のための window の互換の層（D19 の手順3）。
// js/ はふつうの <script> で、st・server などを名前で読み書きする。それが getter・setter を通して入れ物に届くことは、
// 型の検査では確かめられないので、Node の vm で、ふつうの <script> と同じ形（モジュールでない・strict でない）のコードを動かして確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { state, exposeLegacyState, LEGACY_STATE_NAMES } from '../src/state.ts'; // Node が型を消して読む（D17）

// 1つの入れ物を共有するので、テストごとに初めの値に戻す
function fresh() {
  state.st = /** @type {any} */ ({ ledger: [] });
  state.server = null;
  state.outbox = [];
  state.currentUser = null;
  state.remoteReady = state.loadingRemote = state.sending = false;
  state.sendBlocked = null;
  const win = {};
  exposeLegacyState(win);
  return vm.createContext(win);
}

test('ふつうの <script> の st = …・中身の変更・分割代入が、入れ物に届く', () => {
  const ctx = fresh();
  vm.runInContext(`
    st = { ledger: [] };
    st.ledger.push({ name: 'ランチ', amount: 800 });
    ({ server, outbox } = { server: { rows: {}, epoch: 1, loadedAt: 'x' }, outbox: [{ id: 'op1' }] });
    outbox = [...outbox, { id: 'op2' }];
    sending = true; sendBlocked = 'conflict'; currentUser = { id: 'u1' };
  `, ctx);
  // vm の中で作ったオブジェクトは別の世界の Object なので、JSON にして比べる
  assert.equal(JSON.stringify(state.st), JSON.stringify({ ledger: [{ name: 'ランチ', amount: 800 }] }));
  assert.equal(state.server?.epoch, 1);
  assert.equal(state.outbox.map(o => o.id).join(','), 'op1,op2');
  assert.equal(state.sending, true);
  assert.equal(state.sendBlocked, 'conflict');
  assert.equal(state.currentUser?.id, 'u1');
});

test('入れ物を src/ 側で変えると、ふつうの <script> から見える値も変わる', () => {
  const ctx = fresh();
  state.outbox = [/** @type {any} */ ({ id: 'a' })];
  state.remoteReady = true;
  assert.equal(vm.runInContext('outbox.length + ":" + remoteReady', ctx), '1:true');
});

test('window に出した名前は、消したり上書きしたりできない（ブラウザでは、古い let st が残っているとエラーで止まる）', () => {
  // vm の大域は本物の window と違い、残った let を止めないので、ここでは設定だけを確かめる。残った宣言は下のテストで見つける
  const win = {};
  exposeLegacyState(win);
  for (const name of LEGACY_STATE_NAMES) {
    const d = Object.getOwnPropertyDescriptor(win, name);
    assert.equal(d?.configurable, false, name);
    assert.equal(typeof d?.get, 'function', name);
    assert.equal(typeof d?.set, 'function', name);
  }
  assert.throws(() => Object.defineProperty(win, 'st', { value: 1 }), TypeError);
});

test('st を入れる前に読むと止める', async () => {
  // 入れる前の状態は、新しく読み込んだモジュールでしか作れない
  const { state: s } = await import(`../src/state.ts?before=${Date.now()}`);
  assert.throws(() => s.st, /入れる前に読みました/);
});

test('js/ のファイルは、入れ物に移した状態を let・var・const で宣言していない', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const name of LEGACY_STATE_NAMES) {
      assert.doesNotMatch(src, new RegExp(`^(let|var|const)\s+${name}\b`, 'm'), `js/${f} に ${name} の宣言が残っています`);
    }
  }
});
