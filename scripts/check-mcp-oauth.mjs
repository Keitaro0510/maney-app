// ローカルの Supabase で、MCP（Edge Function `mcp`）への OAuth の一連の流れを、同意画面の代わりにスクリプトで通して確かめる（Issue #190）。
// 実行: node scripts/check-mcp-oauth.mjs   （準備は docs/MCP.md。ローカル専用で、本番には向けない）
//   登録 → 認可（PKCE）→ 同意（画面の代わりに承認）→ トークン → MCP のツール呼び出し → 更新トークン → 連携の取り消し
// 事前に、テストユーザー mcp-spike@example.com（パスワード spike-password-123）を、ローカルの Auth に作っておく（docs/MCP.md）。
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

const API = 'http://127.0.0.1:54321';
const KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const REDIRECT = 'http://127.0.0.1:6274/callback';
const b64url = buf => Buffer.from(buf).toString('base64url');
const log = (...a) => console.log(...a);

// 1. ログイン（同意画面でログインする人の代わり）
const supa = createClient(API, KEY, { auth: { persistSession: false } });
const { data: login, error: loginErr } = await supa.auth.signInWithPassword({ email: 'mcp-spike@example.com', password: 'spike-password-123' });
if (loginErr) throw loginErr;
log('1. ログインOK', login.user.email);

// 2. クライアントを動的に登録（MCP クライアントがやること）
const reg = await (await fetch(`${API}/auth/v1/oauth/clients/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'spike-client-2', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
})).json();
log('2. クライアント登録OK', reg.client_id);

// 3. 認可リクエスト（PKCE）。同意画面（site_url + /oauth/consent）へのリダイレクトが返る
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(8));
const authUrl = `${API}/auth/v1/oauth/authorize?` + new URLSearchParams({
  response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid email', state,
});
const authRes = await fetch(authUrl, { redirect: 'manual' });
const consentUrl = authRes.headers.get('location');
log('3. 認可リクエスト →', authRes.status, consentUrl);
const authorizationId = new URL(consentUrl).searchParams.get('authorization_id');
if (!authorizationId) throw new Error('authorization_id がありません');

// 4. 同意画面がやること: 内容を取得 → 承認
const { data: details, error: detErr } = await supa.auth.oauth.getAuthorizationDetails(authorizationId);
if (detErr) throw detErr;
log('4a. 同意画面に出す内容', JSON.stringify({ client: details.client?.name, scope: details.scope, redirect_uri: details.redirect_uri }));
const { data: approved, error: apErr } = await supa.auth.oauth.approveAuthorization(authorizationId);
if (apErr) throw apErr;
log('4b. 承認 → 戻り先', approved.redirect_url);
const code = new URL(approved.redirect_url).searchParams.get('code');
if (new URL(approved.redirect_url).searchParams.get('state') !== state) throw new Error('state が違います');

// 5. トークンと交換（MCP クライアントがやること）
const tok = await (await fetch(`${API}/auth/v1/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }),
})).json();
log('5. トークン', tok.access_token ? `OK（${tok.token_type}・有効${tok.expires_in}秒・refresh=${!!tok.refresh_token}）` : JSON.stringify(tok));
const claims = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64url').toString());
log('   claims:', JSON.stringify({ iss: claims.iss, aud: claims.aud, role: claims.role, client_id: claims.client_id, scope: claims.scope }));

// 6. OAuth のトークンで MCP を呼ぶ
const call = async (id, method, params) => {
  const r = await fetch(`${API}/functions/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return `${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 220)}`;
};
log('6a. tools/list →', await call(1, 'tools/list', {}));
log('6b. whoami     →', await call(2, 'tools/call', { name: 'whoami', arguments: {} }));

// 7. 更新トークン
const ref = await (await fetch(`${API}/auth/v1/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }),
})).json();
log('7. 更新トークン', ref.access_token ? 'OK' : JSON.stringify(ref));

// 8. 利用者が連携を取り消す → 以前のトークンでも呼べなくなるか
const { error: revErr } = await supa.auth.oauth.revokeGrant({ clientId: reg.client_id });
log('8. 連携の取り消し', revErr ? JSON.stringify(revErr) : 'OK');
const after = await fetch(`${API}/auth/v1/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ref.refresh_token || tok.refresh_token, client_id: reg.client_id }),
});
log('   取り消し後に更新トークンを使うと →', after.status);
