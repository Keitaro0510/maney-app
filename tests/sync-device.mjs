// テストで使う「1台の端末」（D19 の手順4）。本物の保存の流れ（src/sync.ts）を、偽の画面と端末の保存場所で動かす。
// src/sync.ts の状態（src/state.ts）は1つしかないので、端末ごとに状態を持ち、操作の間だけ入れ物に入れる（2台の端末の競合を1つの Node で試せる）。
// 操作は1つずつ await して使う（同時に2台を動かさない）。
// tests/sync.test.mjs（偽の Supabase）と tests/integration/sync-flow.local.test.mjs（ローカルの Supabase）が使う。
import { state } from '../src/state.ts'; // Node が型を消して読む（D17）
import * as sync from '../src/sync.ts';

const STATE_NAMES = ['st', 'server', 'outbox', 'currentUser', 'remoteReady', 'loadingRemote', 'sending', 'sendBlocked'];

// 送っている途中・読んでいる途中の流れが終わるまで待つ（save() は送るのを待たずに戻る）
async function idle() {
  for (let i = 0; i < 500; i++) {
    await new Promise(r => setTimeout(r, 2));
    if (!state.sending && !state.loadingRemote) return;
  }
  throw new Error('送る・読む流れが終わりません');
}

/**
 * @param {object} supa src/data.ts の SupaClient の形
 * @param {{ userId: string, defaultSt: () => object, fixDefaults?: () => void, hasOpenModal?: () => boolean }} options
 */
export function syncDevice(supa, { userId, defaultSt, fixDefaults = () => {}, hasOpenModal = () => false }) {
  const mem = new Map();
  const storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  const calls = []; // 画面に頼んだことの記録（['showBanner', msg] など）
  const banners = []; // 出したバナー（{ msg, actions }）。消したら null
  const ui = {
    showBanner: (msg, actions) => { calls.push(['showBanner', msg]); banners.push({ msg, actions }); },
    hideBanner: () => { calls.push(['hideBanner']); banners.push(null); },
    renderCurrentSection: () => calls.push(['renderCurrentSection']),
    updateSyncStatus: () => calls.push(['updateSyncStatus']),
    hasOpenModal: () => hasOpenModal(),
    downloadJson: (name, text) => calls.push(['downloadJson', name, text]),
  };
  let snap = {
    st: defaultSt(), server: null, outbox: [], currentUser: { id: userId },
    remoteReady: false, loadingRemote: false, sending: false, sendBlocked: null,
  };

  async function use(fn) {
    for (const n of STATE_NAMES) state[n] = snap[n];
    sync.initSync({ supa, ui, storagePrefix: 'test:', storage, defaultSt, fixDefaults });
    try {
      const result = await fn();
      await idle();
      return result;
    } finally {
      snap = Object.fromEntries(STATE_NAMES.map(n => [n, state[n]]));
    }
  }

  const d = {
    calls, banners, storage: mem,
    get st() { return snap.st; },
    get server() { return snap.server; },
    get outbox() { return snap.outbox; },
    get sendBlocked() { return snap.sendBlocked; },
    get remoteReady() { return snap.remoteReady; },
    /** 今出ているバナー（なければ null） */
    get banner() { return banners.at(-1) ?? null; },
    /** サーバーの写しを直接入れる（偽の Supabase のテスト用） */
    setServer(server) { snap.server = server; return use(() => sync.rebuildSt()); },
    load: () => use(() => sync.loadRemote()),
    resync: () => use(() => sync.resyncRemote()),
    flush: () => use(() => sync.flushOutbox()),
    /** 画面で st を変えて save() したのと同じ（送るのも待つ） */
    save: edit => use(() => { edit(state.st); sync.save(); }),
    saveRows: changes => use(() => sync.saveRows(changes)),
    rows: () => use(() => sync.currentRows()),
    /** 今出ているバナーのボタンを押す */
    click(label) {
      const b = d.banner;
      const action = b && b.actions.find(a => a.label === label);
      if (!action) throw new Error(`バナーに「${label}」がありません: ${b ? b.msg : '（バナーなし）'}`);
      return use(() => action.onclick());
    },
  };
  return d;
}
