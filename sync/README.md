# sync/ — 月次アドバイス・LINE通知（GAS）

maney-app（バイト学生向け家計管理PWA）の、Google Apps Script (GAS) で動かす拡張機能。

- **月次支出アドバイス**: 毎月1日に、カテゴリ別の前月比をGASで集計し、Geminiが2〜3文の助言にする。アプリのホーム画面の 💡 カード（`#ai-insight-card`）に表示される
- **毎朝のLINE通知**: その日の予定・シフト・お金のイベントを毎朝7時頃にLINEへ送る

元は別リポジトリ `maney-app-sync` で管理していたが、2026-10-24 にこの `sync/` フォルダへ統合した。

## 現在の状態（2026-10-24 時点）

- **月次アドバイス・LINE通知: 未稼働**。コードはあるが、トリガー登録（`installMonthlyAdviceTrigger()` / `installDigestTrigger()`）と LINE のトークン設定をしていないので、一度も動いていない
- **楽天カード明細の自動取り込み（とAIカテゴリ判定）: 2026-10-24 に削除**。楽天カードの「カード利用のお知らせ」メールが 2026-07-17 を最後に届かなくなり（2026-08-03 に楽天カードアプリの利用通知サービスの案内あり）、読み取るメールがなくなったため。アプリ側の「未確認の明細」画面と設定も削除済み
  - 削除前のコード（`gas/main.gs`・`gas/categorize.gs`・`sql/card_tx.sql`・テスト）は、このリポジトリの PR #7 の最初のコミット `7433b75` で見られる
  - **script.google.com の GAS プロジェクトには、取り込み用のコードと15分おきのトリガー `main` がまだ残っている**。止めるには、プロジェクトを開いて左の時計アイコン（トリガー）から `main` を削除する
  - Supabase の `card_tx` テーブルは 2026-10-24 に削除した（539件すべて承認済みで、家計簿の記録には反映済みだった）。削除前の時点で、GAS からのアクセスは過去24時間ゼロだった

> **GASプロジェクトを更新するときの注意**: このフォルダの `gas/shared.gs` には、以前 `main.gs` にあった `getConfig_()` / `logFailure_()` などが移してある。GASプロジェクト側に古い `main.gs` を残したまま新しい `shared.gs` を貼ると、同じ名前の定義が重複してエラーになる。先に GAS 上の `main.gs`・`categorize.gs` を削除してから貼り替えること。

## なぜフォルダを分けているのか

GASはPWA（ブラウザで動くフロントエンド）とは独立したプロセスとして、Googleのサーバー上で定期実行される。アプリ本体（ルートの `index.html` / `sw.js` / `manifest.json`）とはデプロイ先・実行環境が異なる。このフォルダのコードはアプリからは読み込まれず、script.google.com に手で貼り付けて使う。

## 構成

```
sync/
├── README.md       — このファイル
├── docs/
│   └── design.md   — 設計書（取り込み機能の設計も記録として残している）
├── gas/
│   ├── shared.gs          — 共通ヘルパー（設定読み込み・失敗通知・user_data取得・Geminiキー取得）
│   ├── advice.gs          — 月次支出アドバイス
│   ├── notify.gs          — 毎朝のLINEダイジェスト通知
│   └── get_line_userid.gs — LINE userId 取得用の一時ヘルパー
└── sql/
    └── ai_features.sql    — ai_insights テーブル
```

## 全体像（詳細は `docs/design.md`「拡張: AI機能」節）

```
月次アドバイス:
  GAS（毎月1日 8時頃）が Supabase の user_data を読んで前月比を集計
  → Gemini が助言文を生成 → ai_insights テーブルに INSERT
  → アプリがホーム画面で最新1件を表示

LINE通知:
  GAS（毎朝7時頃）が user_data を読んで今日の予定・シフト・お金のイベントを整形
  → LINE Messaging API で自分宛に push
```

AI呼び出し・LINE送信はすべてGAS側で行い、アプリ（ブラウザ）にはAPIキーを一切置かない。

## セットアップ手順

### 1. Supabase に `ai_insights` テーブルを作成する（実行済み）

1. [Supabaseダッシュボード](https://supabase.com/dashboard) → `maney-app` のプロジェクトを開く
2. 左メニュー「SQL Editor」を開き、[`sql/ai_features.sql`](sql/ai_features.sql) の中身を貼り付けて実行する

### 2. GASに渡す3つの値をSupabaseから取得する

1. **SUPABASE_URL**: 左メニュー「Project Settings」→「API」の「Project URL」（`index.html` 内の `SUPA_URL` と同じ値）
2. **SUPABASE_SERVICE_ROLE_KEY**: 同じ画面の「service_role」キー（**anon/publishableキーではない方**。RLSをバイパスする強い権限を持つので、GAS以外の場所には絶対に書かない）。新しい secret key（`sb_secret_...`）はGASからだとブラウザ判定されて401になるので、レガシーの service_role キーを使う（`docs/design.md`「稼働後に見つかった問題と対応」参照）
3. **USER_ID**: 左メニュー「Authentication」→「Users」で自分のGoogleアカウントの行を探し、UUID（`id`列）をコピーする

### 3. GASプロジェクトを用意する

1. [script.google.com](https://script.google.com/) でプロジェクトを開く（なければ「新しいプロジェクト」を作成）
2. `gas/` の各ファイルを、同じ名前のスクリプトファイルとして貼り付けて保存する（古い `main.gs`・`categorize.gs` が残っている場合は先に削除する）
3. 左メニュー「プロジェクトの設定」の歯車アイコン →「スクリプト プロパティ」で以下を追加
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `USER_ID`
4. 関数を初めて実行するときは「承認が必要です」→「権限を確認」→ Googleアカウントを選択 →「このアプリは Google で確認されていません」画面で「詳細」→「(プロジェクト名)に移動」→ 許可、の流れで進む（自分だけが使う個人スクリプトなので安全）

### 4. 月次アドバイスを有効化する（`GEMINI_API_KEY` は設定済み）

無料のGoogle Gemini APIを使う（クレジットカード登録不要）。

1. [Google AI Studio](https://aistudio.google.com/)でGoogleアカウントでログインし、APIキーを発行
2. GASの「プロジェクトの設定」→「スクリプト プロパティ」に`GEMINI_API_KEY`を追加
3. 関数選択で `installMonthlyAdviceTrigger` を選んで実行する（毎月1日の朝8時頃に `monthlyAdvice` が動くようになる）。すぐ試したい場合は `monthlyAdvice` を直接実行する
4. `GEMINI_API_KEY` が未設定の間は、何も生成せず静かにスキップする

### 5. LINE通知を有効化する

LINE Notifyは終了済みのため、後継のLINE Messaging APIを使う（無料プランで月200通まで、本機能は月31通で十分収まる）。

**5-1. チャネルを作成しトークンを取得する**

1. [LINE Developers](https://developers.line.biz/console/)にログインし、プロバイダー（ビジネスマネージャーの組織）を作成、または既存のものを選択する
2. プロバイダー内で「Messaging API」チャネルを新規作成する（チャネル名は何でもよい。運用目的は「その他」、主な使い方は「メッセージ配信用」を選ぶ）
3. 作成したチャネルの「Messaging API settings」タブで「Channel access token (long-lived)」を発行して控える
4. 同タブに表示されるQRコードを、自分のスマホのLINEで読み取って**友だち追加する**（これを忘れるとpushが届かない）
5. （推奨）同タブの「Auto-reply messages」「Greeting messages」を無効化しておく（送信専用の用途で、Botからの自動応答は不要なため）

**5-2. `LINE_USER_ID`（送信先）を取得する**

> **注意（2026-08-11時点で判明）**: LINE Developersコンソールには「Your user ID」のような自己参照フィールドが存在しない。そのため、「Webhookで受信したイベントからsource.userIdを読み取る」方式で取得する。[`gas/get_line_userid.gs`](gas/get_line_userid.gs)がこの取得作業専用の一時ヘルパー（同ファイルの冒頭コメントに詳細手順あり）。

1. `gas/get_line_userid.gs`をGASプロジェクトに追加した状態で、「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」、実行するユーザー「自分」、アクセスできるユーザー「全員」でデプロイし、発行されたURLを控える
2. LINE Developersの「Messaging API settings」タブ →「Webhook URL」に1のURLを貼り付けて「Update」→「Use webhook」をEnabledにする（「Verify」ボタンは接続確認用の空リクエストなので、押してもuserIdは取得できない。気にしなくてよい）
3. 友だち追加済みのBotへ、スマホのLINEから何かメッセージを送る
4. GASの実行アカウントのGmailに「[maney-app-sync] LINE userId取得」という件名でメールが届く。本文の`U`から始まる文字列が`LINE_USER_ID`
5. 取得できたら「Use webhook」をDisabledに戻す（このアプリは送信専用のため常時有効化は不要。`gas/get_line_userid.gs`のdoPostはそのまま残しておいて害はない）

**5-3. スクリプトプロパティに登録してトリガーを設定する**

1. GASの「プロジェクトの設定」→「スクリプト プロパティ」に、5-1・5-2で取得した2つを追加
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_USER_ID`
2. 関数選択で `installDigestTrigger` を選んで実行する（毎朝7時頃に `dailyDigest` が動くようになる）。すぐ試したい場合は `dailyDigest` を直接実行する

チャネルアクセストークンをどこか（チャット・メモアプリ等）に一時的に貼り付けた場合は、スクリプトプロパティへの登録が終わったら、LINE Developers側で一度**再発行（前のトークンを無効化）**しておくと安全。

### 失敗したとき

- 失敗すると自分のGmail宛にエラーメールが届く（実行1回につき1通に集約。件名は「[maney-app-sync] N件のエラーが発生しました」）
- 詳細はGASプロジェクトの「実行数」画面のログで確認できる

## 関連

- アプリ本体（PWA）はこのリポジトリのルート（`index.html` など）
