# Claude から予定・タスクを入れる（MCP）の、ローカルでの確かめ方

Issue #190・D37。Edge Function `mcp`（`supabase/functions/mcp/index.ts`）に MCP サーバーを置き、Supabase Auth を OAuth 2.1 の認可サーバーにして、Claude から呼ぶ。
いまの `mcp` は**検証用**（`hello` と `whoami` だけ。データには触れない）。

## 仕組み

```
Claude（スマホ）──OAuth──▶ Supabase Auth（認可サーバー）──同意画面──▶ アプリ（/oauth/consent）
        │                         │
        └──トークン付きで──▶ Edge Function mcp（トークンを確かめて、その人として動く。RLS が効く）
```

- 関数は `withOAuthProtectedResource()`（どこで認証するかの案内）と `withSupabase({ auth: 'user' })`（トークンの検証）を通す
- 同意画面は Supabase が持たない。**アプリに作る**（本実装で。D37）
- 発行されるのは、ふつうのログインと同じ種類の JWT（`client_id` が付く）。`auth.uid()` を使う今の RLS が、そのまま効く

## ローカルで試す（検証のときだけ、設定を変える）

リポジトリの `supabase/config.toml` は、CI が壊れないよう、MCP の設定を**切った状態**にしてある。試すときだけ変える。**変えたら、コミットしない**。

1. **署名鍵を作る**（ローカルの Supabase は、既定だと古い HS256 で署名する。`withSupabase` は ES256/RS256 だけ受け付ける）
   ```bash
   npx supabase gen signing-key --algorithm ES256
   ```
   出てきた `{"kty":"EC",...}` の1行を、`[` と `]` で囲んで `supabase/signing_keys.json` に保存する（`.gitignore` 済み。コミットしない）。
2. `supabase/config.toml` を変える
   - `[auth]` の `# signing_keys_path = "./signing_keys.json"` のコメントを外す
   - `[auth.oauth_server]` の `enabled = true`・`allow_dynamic_registration = true`
   - `[edge_runtime]` の `enabled = true`
3. Supabase を立て直し、関数を動かす
   ```bash
   npx supabase stop
   npx supabase start
   npx supabase functions serve mcp
   ```
4. 確かめる（別のターミナルで）
   ```bash
   # 認証なし → 401 と、認証サーバーの場所の案内
   curl -si -X POST http://127.0.0.1:54321/functions/v1/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | grep -i '^HTTP\|www-authenticate'
   curl -s http://127.0.0.1:54321/functions/v1/mcp/oauth-protected-resource
   ```
5. テストユーザーを作り、OAuth の一連の流れを通す
   ```bash
   curl -s -X POST http://127.0.0.1:54321/auth/v1/signup -H 'apikey: <ローカルの publishable key>' -H 'Content-Type: application/json' -d '{"email":"mcp-spike@example.com","password":"spike-password-123"}'
   node scripts/check-mcp-oauth.mjs
   ```
6. 終わったら、`config.toml` を元に戻す（`git checkout supabase/config.toml`）

## 2026-11-17 の検証の結果（ローカル）

通ったこと:
- 認証なし → `401` と `www-authenticate: Bearer resource_metadata=...`。`/oauth-protected-resource` が `authorization_servers` を返す
- 認可サーバーの案内（`/auth/v1/.well-known/oauth-authorization-server`）に、認可・トークン・登録・JWKS の場所が出る
- 動的なクライアント登録（`/auth/v1/oauth/clients/register`）
- 認可（PKCE）→ 同意画面へのリダイレクト（`<site_url>/oauth/consent?authorization_id=...`）→ `getAuthorizationDetails`・`approveAuthorization` → コード → トークン（有効3600秒・更新トークン付き）
- トークンの中身: `iss`＝Auth の URL、`aud`＝`authenticated`、`role`＝`authenticated`、`client_id`、`scope`
- そのトークンで `tools/list`・`whoami`（ログイン中のメールを返す）が動く。壊れたトークンは `401`
- 更新トークンで新しいトークンが取れる。`revokeGrant({ clientId })` で連携を取り消すと、更新トークンは `400` で拒否される

分かったこと:
- ローカルの署名鍵は、既定が HS256。**ES256 の鍵を作って `signing_keys_path` に入れないと、`withSupabase` が拒否する**
- `revokeGrant` の引数は `{ clientId }`（文字列そのものではない）
- 認可サーバーの案内の場所は、ローカルでは `/auth/v1/.well-known/oauth-authorization-server`。本番では、ルート直下の `/.well-known/oauth-authorization-server/auth/v1` でも返るはず（本番で確かめる）

## 本番に出すときに要ること（まだやっていない）

本番の Supabase は、**署名鍵はすでに ES256**（JWKS で確認）。OAuth サーバー機能は**無効**（`feature_disabled`）。

- [ ] 本番の Auth で、OAuth サーバー（**ベータ**）と動的なクライアント登録を有効にする
- [ ] 同意画面（`authorization_url_path`）を、アプリの静的サイトに置く。GitHub Pages は `https://keitaro0510.github.io/maney-app/` の下なので、置き場所と Site URL の関係を確かめる
- [ ] `supabase functions deploy mcp`（公開される。検証用の `hello`・`whoami` は、データに触れない）
- [ ] claude.ai の設定でカスタムコネクタを追加する（URL: `https://sgvyjolyfuqchugltvls.supabase.co/functions/v1/mcp`）
- [ ] スマホの Claude から呼べるか確かめる

本番の設定を変えるのは、ユーザーの許可を取ってから（CLAUDE.md の「本番アプリとしてのルール」）。
