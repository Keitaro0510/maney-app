// Claude などに予定・タスクを書く許可を出す画面の流れ（src/oauth-consent.ts）。Issue #190・D37。実行: node --test "tests/*.test.mjs"
// 偽の Supabase（auth.oauth）と偽の画面で確かめる。本物の流れ（Auth → 同意 → トークン）は scripts/check-mcp-oauth.mjs（ローカルの Supabase）で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationIdFromSearch, rememberAuthorizationId, pendingAuthorizationId, clearPendingAuthorizationId, redirectHost, isAllowedRedirect,
  runConsent, PENDING_TTL_MS, PENDING_KEY,
} from '../src/oauth-consent.ts';

class MemoryStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
}

const ID = 'rjzpxbhujxvatjfofltlc746mof6blnc';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

test('authorizationIdFromSearch: ?authorization_id= を取り出す。形が違うもの・ないときは null', () => {
  assert.equal(authorizationIdFromSearch(`?authorization_id=${ID}`), ID);
  assert.equal(authorizationIdFromSearch(`?x=1&authorization_id=${ID}&y=2`), ID);
  assert.equal(authorizationIdFromSearch(''), null);
  assert.equal(authorizationIdFromSearch('?code=abc'), null);
  assert.equal(authorizationIdFromSearch('?authorization_id='), null);
  assert.equal(authorizationIdFromSearch('?authorization_id=<script>alert(1)</script>'), null);
  assert.equal(authorizationIdFromSearch('?authorization_id=short'), null);
});

test('rememberAuthorizationId・pendingAuthorizationId: 10分以内だけ取り出せる。古いものは捨てる', () => {
  const s = new MemoryStorage();
  assert.equal(pendingAuthorizationId(s, 1000), null);
  rememberAuthorizationId(s, ID, 1000);
  assert.equal(pendingAuthorizationId(s, 1000 + PENDING_TTL_MS), ID);
  assert.equal(pendingAuthorizationId(s, 1000 + PENDING_TTL_MS + 1), null); // 10分を過ぎた
  assert.equal(s.getItem(PENDING_KEY), null); // 古いものは消えている
  rememberAuthorizationId(s, ID, 5000);
  assert.equal(pendingAuthorizationId(s, 4000), null); // 時計が戻っているときは、あてにしない
  clearPendingAuthorizationId(s);
  assert.equal(s.getItem(PENDING_KEY), null);
});

test('pendingAuthorizationId: 壊れた保存・形の違う id は、ないものとして捨てる', () => {
  const s = new MemoryStorage();
  s.setItem(PENDING_KEY, 'これはJSONではない');
  assert.equal(pendingAuthorizationId(s, 0), null);
  s.setItem(PENDING_KEY, JSON.stringify({ id: '<bad>', at: 0 }));
  assert.equal(pendingAuthorizationId(s, 0), null);
  assert.equal(s.getItem(PENDING_KEY), null);
});

test('redirectHost・isAllowedRedirect: 許すのは https の claude.ai だけ。localhost は local のときだけ', () => {
  assert.equal(redirectHost(CLAUDE), 'claude.ai');
  assert.equal(redirectHost('not a url'), null);
  assert.equal(isAllowedRedirect(CLAUDE, false), true);
  assert.equal(isAllowedRedirect('http://claude.ai/cb', false), false); // https でない
  assert.equal(isAllowedRedirect('https://evil.example/claude.ai', false), false);
  assert.equal(isAllowedRedirect('https://claude.ai.evil.example/cb', false), false); // 似た名前
  assert.equal(isAllowedRedirect('https://evil.example/cb?next=https://claude.ai', false), false);
  assert.equal(isAllowedRedirect('claude://auth/callback', false), false); // 独自のスキームは、いまは許さない
  assert.equal(isAllowedRedirect('javascript:alert(1)', false), false);
  assert.equal(isAllowedRedirect('not a url', true), false);
  assert.equal(isAllowedRedirect('http://127.0.0.1:6274/callback', false), false);
  assert.equal(isAllowedRedirect('http://127.0.0.1:6274/callback', true), true); // ローカルの検証
  assert.equal(isAllowedRedirect('http://localhost:6274/callback', true), true);
  assert.equal(isAllowedRedirect('http://evil.example/callback', true), false);
});

// 偽の Supabase と、偽の画面
function setup({ details, detailsError = null, answer = 'approve', local = false, approveResult, denyResult } = {}) {
  const calls = [];
  const events = [];
  const storage = new MemoryStorage();
  rememberAuthorizationId(storage, ID, 0);
  const supa = {
    auth: {
      oauth: {
        getAuthorizationDetails: async id => { calls.push(['details', id]); return { data: details ?? null, error: detailsError }; },
        approveAuthorization: async id => { calls.push(['approve', id]); return approveResult ?? { data: { redirect_url: `${CLAUDE}?code=OK&state=S` }, error: null }; },
        denyAuthorization: async id => { calls.push(['deny', id]); return denyResult ?? { data: { redirect_url: `${CLAUDE}?error=access_denied&state=S` }, error: null }; },
      },
    },
  };
  const ui = {
    ask: async info => { events.push(['ask', info]); return answer; },
    notify: message => events.push(['notify', message]),
    redirect: url => events.push(['redirect', url]),
  };
  return { deps: { supa, storage, now: () => 1000, local, ui }, calls, events, storage };
}

const DETAILS = { authorization_id: ID, redirect_uri: CLAUDE, client: { id: 'c1', name: 'Claude' }, scope: 'openid email', user: { id: 'u1' } };

test('runConsent: 許可する → Auth に伝え、返ってきた戻り先へ移る。id は1回で消える', async () => {
  const t = setup({ details: DETAILS });
  assert.equal(await runConsent(t.deps), 'approved');
  assert.deepEqual(t.calls, [['details', ID], ['approve', ID]]);
  assert.deepEqual(t.events.map(e => e[0]), ['ask', 'redirect']);
  assert.deepEqual(t.events[0][1], { clientName: 'Claude', host: 'claude.ai' });
  assert.equal(t.events[1][1], `${CLAUDE}?code=OK&state=S`);
  assert.equal(pendingAuthorizationId(t.storage, 1000), null);
  assert.equal(await runConsent(t.deps), 'none'); // 2回目は何もしない
});

test('runConsent: つながない → 拒否を Auth に伝え、戻り先へ移る', async () => {
  const t = setup({ details: DETAILS, answer: 'deny' });
  assert.equal(await runConsent(t.deps), 'denied');
  assert.deepEqual(t.calls, [['details', ID], ['deny', ID]]);
  assert.match(t.events[1][1], /access_denied/);
});

test('runConsent: 許せないつなぎ先 → 本人に聞かず、拒否して知らせるだけ。つなぎ先へは移らない', async () => {
  const t = setup({ details: { ...DETAILS, redirect_uri: 'https://evil.example/cb' } });
  assert.equal(await runConsent(t.deps), 'blocked');
  assert.deepEqual(t.calls, [['details', ID], ['deny', ID]]);
  assert.deepEqual(t.events.map(e => e[0]), ['notify']); // ask も redirect もない
  assert.match(t.events[0][1], /evil\.example/);
  assert.match(t.events[0][1], /何も許可していません/);
});

test('runConsent: 手元（127.0.0.1）は local のときだけ許す', async () => {
  const d = { ...DETAILS, redirect_uri: 'http://127.0.0.1:6274/callback' };
  assert.equal(await runConsent(setup({ details: d, local: false }).deps), 'blocked');
  assert.equal(await runConsent(setup({ details: d, local: true }).deps), 'approved');
});

test('runConsent: id がないとき・読み込みに失敗したとき・すでに許可済みのとき', async () => {
  const none = setup({ details: DETAILS });
  none.storage.removeItem(PENDING_KEY);
  assert.equal(await runConsent(none.deps), 'none');
  assert.deepEqual(none.calls, []); // Auth に何も聞かない

  const bad = setup({ detailsError: { message: 'expired' } });
  assert.equal(await runConsent(bad.deps), 'error');
  assert.match(bad.events[0][1], /もう一度つなぎ直して/);
  assert.equal(pendingAuthorizationId(bad.storage, 1000), null); // 失敗しても、同じ id でやり直さない

  const done = setup({ details: { redirect_url: `${CLAUDE}?code=ALREADY` } });
  assert.equal(await runConsent(done.deps), 'already');
  assert.deepEqual(done.events, [['redirect', `${CLAUDE}?code=ALREADY`]]);
});

test('runConsent: 許可の送信に失敗したら、移動せずに知らせる', async () => {
  const t = setup({ details: DETAILS, approveResult: { data: null, error: { message: 'x' } } });
  assert.equal(await runConsent(t.deps), 'error');
  assert.deepEqual(t.events.map(e => e[0]), ['ask', 'notify']);
});
