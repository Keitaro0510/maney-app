# Claude から予定・タスクを入れる（MCP）の、ローカルでの確かめ方

Issue #190・D37。Edge Function `mcp`（`supabase/functions/mcp/index.ts`）に MCP サーバーを置き、Supabase Auth を OAuth 2.1 の認可サーバーにして、Claude から呼ぶ。
`mcp` は、予定・タスクを読む・追加・変更・削除する（下の「ツール」）。家計簿の記録・残高・設定は、読めない・書けない。

## ツール（D37。2026-11-17）

| ツール | できること |
|---|---|
| `list_cards` | カードの名前の一覧（払い方でカードを選ぶため） |
| `list_plans` | 予定の一覧（期間・キーワード。省くと今日から60日先）。変える・消す相手の id を調べる |
| `list_tasks` | タスクの一覧（済みを含める・期限・キーワード）。省くと、未完了を期限の近い順に |
| `list_shifts` | バイトのシフトの一覧（バイト先の名前・日付・曜日・開始と終了・休憩・実働時間）。時給は出さない。バイトの予定は「予定」ではなく、シフトのテーブルにある |
| `list_jobs` | バイト先の名前の一覧（シフトを入れるとき、どのバイト先か確かめる）。時給などは返さない |
| `add_shift` | シフトを追加（バイト先の名前・日付・出勤・退勤・休憩）。**時給は指定させず、バイト先の今の時給をコピー**（アプリと同じ）。休憩を言っていなければ聞く。同じバイト先・日・時間があれば、入れずに知らせる |
| `update_shift` | シフトを変える（バイト先・日付・出勤・退勤・休憩）。バイト先を変えたときだけ、時給も新しいバイト先のものにする |
| `delete_shift` | シフトを削除 |
| `add_plan` | 予定を追加（日付・終わりの日・時間・予算・払い方 cash／card・カード名・メモ）。同じタイトル・同じ日があれば、入れずに知らせる |
| `update_plan` | 予定を変える（日付・時間・予算・払い方・タイトル・メモ・済み）。はじめの日だけ変えると、期間の長さを保って終わりの日もずれる。`start_time` に null で終日 |
| `delete_plan` | 予定を削除 |
| `add_task` | タスクを追加（期限・メモ・タグ）。同じタイトル・同じ期限の未完了があれば、入れずに知らせる |
| `update_task` | タスクを変える（タイトル・期限・メモ・タグ）。`due_date` に null で期限なし |
| `complete_task` | 済みにする（`done: false` で未完了に戻す） |
| `delete_task` | タスクを削除 |
| `whoami` | 動作確認。ログイン中のメールを返す |

決まり:
- **足りない情報は、Claude が聞き返す**。`add_plan` の説明に「時間・予算・払い方（カードならどのカード）を、ユーザーが言っていないときは、呼ぶ前に必ず聞く。「なし」と言われたら省く」と書いてある。確実な保証はできない（Claude の判断）。最初から「何時、予算はいくら、カードで」と言えば、聞かずに入る
- 予定の色は、Claude からは指定しない（アプリの新しい予定と同じ `pink`）
- **保存は、アプリと同じ `apply_op`**（履歴・競合の検知・二重保存の防止つき）を、その人の権限で呼ぶ。削除も履歴に残り、戻せる（`docs/db/RESTORE.md`）。更新・削除は、読んだときの `updated_at` を `base` に付けるので、あとからアプリで変えられていたら、上書きせずに「変更されています」と返す
- 触れるのは、`plans`・`tasks`・`shifts`・`cards`／`jobs`（名前を読むだけ。`jobs` の時給は、シフトを作るときのコピー元として内部で読むだけで、Claude には返さない）・`sync_state`（移行の番号）だけ。家計簿・残高・設定・毎月のお金は、ツールがない
- **シフトは、アプリと同じく、退勤が出勤より後のものだけ**（日をまたぐシフトは、アプリの入力が受け付けず、給与の計算も想定していないので、Claude からも入れない。すでにある日をまたぐシフトは、`list_shifts` では読める）。休憩は、働く時間より短く（0〜720分）
- 入力は、zod（形）と `logic.ts`（実在する日付・時刻・予算の範囲・終了時刻だけの指定・カードの名前）で検査する。誤りは、直し方が分かる文面で返す
- DB や MCP に触れない部分は `supabase/functions/mcp/logic.ts` に分け、`tests/mcp-logic.test.mjs` で確かめる（Node。CI で動く）。実際の DB に対する確かめは `scripts/check-mcp-tools.mjs`（ローカルの Supabase。下の手順）

ローカルで、ツールを実際に呼んで確かめる:
```bash
# 「ローカルで試す」の手順 1〜5 のあと（signing_keys・config.toml・supabase start・functions serve mcp・テストユーザー）
node scripts/check-mcp-tools.mjs
```
OAuth でトークンを取り、全ツールを順に呼ぶ（追加・重複・誤り・日付変更・時間を消す・済み・アプリが先に変えたあとの更新・削除）。作ったものは、終わりに片付ける。同意画面の代わりに、`getAuthorizationDetails` → `approveAuthorization` の順に呼ぶ（`getAuthorizationDetails` を飛ばすと、承認が `oauth_authorization_not_found` になる）

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

## 本番の今の状態

2026-11-17 に、ユーザーの許可を取って、Supabase のダッシュボード（Claude in Chrome で操作）と、Edge Function のデプロイで変えた。

変える前に見つかったこと:
- **Site URL が壊れていた**: `https://keitaro0510.github.io/money-app/ `（古い名前の `money-app`・末尾に空白つき。開くと 404）。今の Google ログインは、戻り先を毎回明示している（`redirectTo: currentUrl()`）ので影響が出ていなかったが、**OAuth の案内は「Site URL ＋ パス」で作られるので、直さないと同意画面に来られない**
- 署名鍵は、すでに ES256（JWKS で確認）。OAuth サーバー機能は無効（`feature_disabled`）。`mcp` は無かった

変えたこと（2026-11-17）:
- [x] **Site URL** を `https://keitaro0510.github.io/maney-app/` に直した（空白もなくした）。Redirect URLs には、正しい `…/maney-app/` と `…/maney-app` が元から入っていた（変更なし）
- [x] **OAuth Server**（ベータ）を有効にした。**Authorization Path** を `/` に、**Allow Dynamic OAuth Apps**（動的登録）を有効にした（確認のダイアログ「誰でもクライアントを登録できる公開の入口ができる」を承認。アプリ側は、claude.ai の戻り先以外を拒否して備えている）
- [x] Edge Function `mcp`（検証用の `hello`・`whoami`。データには触れない）を本番にデプロイした（`verify_jwt = false`。関数が自分でトークンを検証する。バージョン1）

読み取りで確かめたこと:
- 認可サーバーの案内が、Claude が探すルート直下（`/.well-known/oauth-authorization-server/auth/v1`）で `200` で返る。動的登録の入口が動く（空の登録は「redirect_uris が必要」と検証の応答）
- `mcp`: 認証なしは `401` と `WWW-Authenticate`、`/oauth-protected-resource` が認可サーバーを案内、壊れたトークンは `401`

ダッシュボードの操作の注意（Claude in Chrome）:
- 上に出るバナーで、画面がずれる。座標ではなく、要素の指定で押し、入力の前に画面で確かめる（座標のクリックが外れて、キー入力がダッシュボードのショートカットに当たったことがあった。移動だけで、設定は変わらなかった）

## claude.ai でつないだ結果（2026-11-17。Claude in Chrome で操作）

**成功。** claude.ai のカスタムコネクタ「maney」から、OAuth を通して本番の `mcp` を呼べた。新しい会話で「maney の whoami を呼んで」と頼むと、ログイン中のメールアドレス（keitaro.takaoki@gmail.com）が返った。

つなぎ方（claude.ai の設定は「プラグイン」に移っている。プラグイン → 追加 → カスタムコネクタを追加）:
- 名前: `maney`／URL: `https://sgvyjolyfuqchugltvls.supabase.co/functions/v1/mcp`
- 認証: 「今すぐサインイン」（検出済み）／OAuth クライアント: **「自動的に登録（DCR）」**（検出済み）。既定の「Claude の公開アイデンティティ（CIMD）」は、Supabase の対応を確かめていないので選ばなかった
- 追加すると、ブラウザでアプリの同意画面（「Claude につなぎますか？」）が開く。つなぎ先は「Claude（claude.ai）」と表示され、許可リストを通った。「つなぐ」を押すと「maneyに接続しました」
- ツールを初めて使うときは、Claude が「1回だけ許可／常に許可」を聞く（Claude 側の確認）

つまずいたことと、直したこと:
- **コネクタの URL を Chrome に入力したとき、`v` が1文字抜けて `/functions/1/mcp` になった**（ツールの文字入力で、`v` だけが落ちる）。Claude は `/functions/1/mcp` に接続しに行き、「サインインサービスに登録できませんでした」と出た。Supabase のログ（`edge_logs`）で、リクエストの URL が `functions/1/mcp` になっているのを見て気づいた。コネクタを削除して作り直し、`v` だけ別に入力して、画面で確かめた
- **同意画面が、「今日のタスク」のダイアログに隠れた**。アプリを開くと、タスクの `<dialog>`（`showModal`。最前面）が先に開き、`z-index` だけでは前に出られなかった。同意画面も `<dialog>` の `showModal` にして、あとから開くものが前に出るようにした。Esc で黙って閉じないようにもした

スマホの Claude アプリで使えるかは、まだ確かめていない（web で追加したコネクタは、同じアカウントのスマホでも使えるはず。ユーザーが確かめる）。

## 本番でツールを確かめた結果（2026-11-17。Claude in Chrome で操作）

`mcp` を、予定・タスクのツール入りに更新（Edge Function バージョン2。`verify_jwt = false`）して、claude.ai で確かめた。
- コネクタの「権限」に、**新しいツールが全部**出た: 読み取り専用4（list_cards・list_plans・list_tasks・whoami）／書き込み・削除5（complete_task・delete_plan・delete_task・update_plan・update_task）／その他2（add_plan・add_task）。**書き込み・削除・追加は、初期状態が「承認が必要」**（変更の前に、毎回 Claude が本人に確認する）。読み取りだけは確認なしに設定できる
- 新しい会話で「今日から2週間の予定とタスクを教えて」と頼むと、`list_plans`・`list_tasks` が呼ばれ、本番の予定7件・タスク3件が、メモ・予算・カード名つきで正しく読めた
- **聞き返し**: 「maney コネクタを使って、12月3日に歯医者の予定を入れて」と頼むと、Claude が、登録する前に「時間・予算・払い方（カードならどのカードか）」を聞いてきた（`add_plan` の説明どおり）。データは変えていない
- ツールの一覧は、Claude の会話ごとの読み込みで、まれに古い状態（hello・whoami だけ）に見えることがあった（言い方を変えた別の会話では、正しく見えた）。「maney コネクタを使って」のように、コネクタ名を入れて頼むと確実
- 確認のために、ユーザーの Claude アカウントに、確認用の会話が数件できた（削除してよい）

## 本番に出す手順（2026-11-17 にすべて済み。スマホの Claude での確認だけ残り）

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
