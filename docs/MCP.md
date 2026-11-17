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

## 同意画面の設計（2026-11-17）

Auth は、認可の途中で、**`<Site URL><authorization_url_path>?authorization_id=<id>`** へ人を案内する。同意画面は Supabase が持たないので、アプリに作る（`src/oauth-consent.ts`・`src/oauth-consent-ui.ts`・`index.html` の `#oauth-consent`）。

決めたこと:
- **別のページを増やさず、アプリのトップ（`/maney-app/`）で受ける**。`authorization_url_path = "/"`。既存のログインと Supabase のクライアントを、そのまま使える
  - ローカルの Auth で、Site URL とパスの結合を確かめた（`https://…/maney-app/` + `/oauth/consent` → `https://…/maney-app/oauth/consent?authorization_id=…`。スラッシュの重複は Auth が整える。`/` なら `https://…/maney-app/?authorization_id=…`）
- 案内の id は、**端末に一時保存**（10分）してから URL を整える。ログイン（Google）を挟むと、戻り先の許可リストの一致が厳しく、`?authorization_id` が消えるおそれがあるため
- ログインしていなければ、ふつうのログイン画面。ログインして戻ってきたら、保存した id で許可の画面を出す
- **許してよいつなぎ先は、`https://claude.ai` の redirect_uri だけ**（動的登録は、だれでも名前を自由に付けて登録できるため、名前ではなく戻り先で確かめる）。それ以外は、本人に聞かずに拒否し、つなぎ先を画面に出すだけで、そこへは移らない。ローカル（`ENV.target = local`）のときだけ、手元（127.0.0.1・localhost）も許す
  - claude.ai の実際の redirect_uri は、Anthropic の資料では `https://claude.ai/api/mcp/auth_callback`。違っていた場合は、画面に出るつなぎ先を見て、許可リスト（`ALLOWED_REDIRECT_HOSTS`）を直す
- 画面には、つなぎ先の名前と host、できること（予定とタスクの追加。家計簿は読めない・書けない）を出す

## 本番の今の状態（2026-11-17。読み取りだけで確かめた）

- **署名鍵**: すでに ES256（JWKS で確認）。変更は要らない
- **OAuth サーバー機能**: 無効（`feature_disabled`）
- **Site URL が壊れている**: `https://keitaro0510.github.io/money-app/ `（古い名前の `money-app`・末尾に空白つき。開くと 404）。今の Google ログインは、戻り先を毎回明示している（`redirectTo: currentUrl()`）ので影響が出ていないが、**OAuth の案内は「Site URL ＋ パス」で作られるので、直さないと同意画面に来られない**。正しくは `https://keitaro0510.github.io/maney-app/`
- **Edge Function `mcp`**: まだ無い

## 本番に出す手順（ユーザーが Supabase のダッシュボードで行う部分と、Claude が行う部分）

ダッシュボードの設定（ユーザー）:
1. Authentication → **URL Configuration** → **Site URL** を `https://keitaro0510.github.io/maney-app/` にする（末尾の空白に注意）。**Redirect URLs** に、同じ `https://keitaro0510.github.io/maney-app/` が入っていることを確かめる（今のログインが使っているので、入っているはず）
   - 影響: 今のログインは戻り先を明示しているので変わらない。確認のため、設定後に一度ログアウト→ログインして動くことを確かめる
2. Authentication → **OAuth Server**（ベータ）を有効にする
   - **Allow dynamic OAuth apps**（動的登録）を有効にする
   - **Authorization Path**（同意画面のパス）を `/` にする
   - 影響: クライアントが自由に登録できるようになるが、本人が同意画面で許可しないと何も起きない。同意画面は上のとおり、claude.ai の戻り先以外を拒否する

Claude が行う部分（上の設定が済んでから）:
3. このアプリ（同意画面）を公開する（PR をマージ。`?authorization_id` がないときは、今までと何も変わらない）
4. `mcp`（検証用の `hello`・`whoami`。データに触れない）をデプロイする
5. claude.ai の設定で、カスタムコネクタを追加する（ユーザー。URL: `https://sgvyjolyfuqchugltvls.supabase.co/functions/v1/mcp`）
6. スマホの Claude から呼べるか確かめる

本番の設定を変えるのは、ユーザーの許可を取ってから（CLAUDE.md の「本番アプリとしてのルール」）。
