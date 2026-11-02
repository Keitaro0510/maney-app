// 保存・送信・読み込みの本物の流れ（src/sync.ts。D19 の手順4）を、ローカルの Supabase で通す。
// 画面で st を変えて save() し、送る・通信の失敗と送り直し・2台の端末の競合・移し直したあと を、本物の DB で確かめる。
// 実行: npm run test:integration（ローカルの Supabase を起動してから。CI でも流す）
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { skip, createUser, URL_, SERVICE } from './helpers.mjs';
import { syncDevice } from '../sync-device.mjs';

// 新しいユーザーの st（js/app-core.js の defaultSt と同じ形）
const emptySt = () => ({
  acctBase: 0, baseDate: '2026-11-01', shiftCloseDay: 31, shiftPayDay: 10, budget: 0, jobs: [], shifts: [],
  ledger: [], cards: [], wds: [], actualInputs: [], fuyouLimit: '1300000', otherIncome: 0, plans: [],
  catExp: ['食費', 'その他'], catInc: ['給与', 'その他'],
});

// 通信できない状態にできる Supabase（apply_op だけ止める）
function switchable(supa) {
  const s = {
    offline: false,
    from: (...a) => supa.from(...a),
    rpc: (...a) => (s.offline ? Promise.reject(new TypeError('Failed to fetch')) : supa.rpc(...a)),
  };
  return s;
}

let user;
const device = supa => syncDevice(supa, { userId: user.id, defaultSt: emptySt });
before(async () => { if (!skip) user = await createUser('flow'); });

test('保存すると DB に入り、別の端末で読み込むと見える', { skip }, async () => {
  const a = device(user.supa);
  await a.load();
  await a.save(st => st.ledger.push({ date: '2026-11-02', amount: 800, name: '本物のランチ', cat: st.catExp[0], type: 'expense', pay: '現金', memo: '' }));
  assert.equal(a.sendBlocked, null);
  assert.equal(a.outbox.length, 0);
  const b = device(user.supa);
  await b.load();
  assert.ok(b.st.ledger.some(l => l.name === '本物のランチ' && l.amount === 800));
});

test('通信できないと送信待ちに残り、「もう一度送る」で DB に入る', { skip }, async () => {
  const supa = switchable(user.supa);
  const a = device(supa);
  await a.load();
  supa.offline = true;
  await a.save(st => { st.budget = 30000; });
  assert.equal(a.outbox.length, 1);
  assert.match(a.banner.msg, /通信できないため/);
  supa.offline = false;
  await a.click('もう一度送る');
  assert.equal(a.outbox.length, 0);
  const b = device(user.supa);
  await b.load();
  assert.equal(b.st.budget, 30000);
});

test('2台の端末の競合: 「この端末の内容で上書き」で、この端末の内容が DB に入る', { skip }, async () => {
  const a = device(user.supa);
  const b = device(user.supa);
  await a.load();
  await b.load();
  await b.save(st => { st.budget = 41000; });
  await a.save(st => { st.budget = 42000; });
  assert.equal(a.sendBlocked, 'conflict');
  assert.match(a.banner.msg, /・設定: 別の端末で変更されています/);
  await a.click('この端末の内容で上書き');
  assert.equal(a.sendBlocked, null);
  assert.equal(a.outbox.length, 0);
  await b.load();
  assert.equal(b.st.budget, 42000);
});

test('2台の端末の競合: 「サーバーの内容にする」で、この端末の変更を捨ててサーバーの内容になる', { skip }, async () => {
  const a = device(user.supa);
  const b = device(user.supa);
  await a.load();
  await b.load();
  await b.save(st => { st.budget = 51000; });
  await a.save(st => { st.budget = 52000; });
  assert.equal(a.sendBlocked, 'conflict');
  await a.click('サーバーの内容にする');
  assert.equal(a.sendBlocked, null);
  assert.equal(a.outbox.length, 0);
  assert.equal(a.st.budget, 51000);
});

test('移し直したあと（移行の番号が上がった）は止めて、「捨てて読み込み直す」で新しい番号から保存できる', { skip }, async () => {
  const a = device(user.supa);
  await a.load();
  const res = await fetch(`${URL_}/rest/v1/sync_state`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, epoch: 9 }),
  });
  assert.ok(res.ok, '管理者として移行の番号を上げる');
  await a.save(st => { st.budget = 61000; });
  assert.equal(a.sendBlocked, 'stale_epoch');
  assert.match(a.banner.msg, /移し直されたため、この端末の送れていない変更（1件）は保存できません/);
  await a.click('捨てて読み込み直す');
  assert.equal(a.server.epoch, 9);
  await a.save(st => { st.budget = 62000; });
  assert.equal(a.sendBlocked, null);
  assert.equal(a.outbox.length, 0);
});
