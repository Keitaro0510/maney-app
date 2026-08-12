# maney-app-sync

[maney-app](https://github.com/Keitaro0510/maney-app)（バイト学生向け家計管理PWA）の拡張プロジェクト。楽天カードの利用明細メールを自動で取り込み、家計簿への手入力をほぼゼロにすることを目指す。

## これは何か

`maney-app` は単一HTMLファイル構成のPWA（Supabaseでクラウド同期）だが、支出記録は依然として手入力に頼っていた。このリポジトリは、その手入力を自動化するための **Google Apps Script (GAS) バックエンド** と、その設計ドキュメントを管理する。

## なぜ独立リポジトリなのか

GASはPWA（ブラウザで動くフロントエンド）とは独立したプロセスとして、Googleのサーバー上で定期実行される。`maney-app` 本体（`index.html` / `sw.js` / `manifest.json`）とはデプロイ先・実行環境・言語ランタイムがすべて異なるため、コードは分離して管理する。PWA側の改修は引き続き `maney-app` リポジトリで行う。

## 構成

```
maney-app-sync/
├── README.md       — このファイル
├── docs/
│   └── design.md   — 詳細設計書（背景・DB設計・パース方針・重複防止・承認フロー・検証方法など）
├── gas/
│   └── main.gs      — GAS本体（Gmail検索・パース・Supabase送信・ラベル付与・失敗通知）
├── sql/
│   └── card_tx.sql  — Supabaseに作成する card_tx テーブルのDDL
└── tests/
    └── parse.test.js — パース関数の動作検証（実際のメールサンプルで14/14 PASS確認済み）
```

## 全体像（詳細は `docs/design.md`）

```
Gmail（楽天カード確定版メール）
  → GAS（時間主導トリガー）がパース
  → Supabase card_tx テーブルに INSERT（重複防止つき）
  → maney-app が起動時に未取り込み明細を読み込み
  → ユーザーがワンタップ承認 → 通常の家計簿エントリとして記録
```

## 進捗状況

**稼働中**（2026-08-10〜）。以下すべて完了済み。

- [x] 設計（本リポジトリ `docs/design.md`）
- [x] 関連する既存バグ（残高グラフの二重計上）を `maney-app` 側で修正済み（[commit](https://github.com/Keitaro0510/maney-app/commit/6ec597f)）
- [x] GAS実装（`gas/main.gs`、パース関数はNode.jsで14/14テストPASS確認済み）
- [x] `maney-app` 側インボックスUI実装（[commit](https://github.com/Keitaro0510/maney-app/commit/aa7e067)）
- [x] Supabase `card_tx` テーブル作成
- [x] GASプロジェクトの作成・デプロイ、15分おきのトリガー稼働確認済み
- [x] 実際の楽天カードメールでの動作確認（バックフィルで162件取り込み成功）
- [x] デプロイ後に見つかった3つの不具合を修正（詳細は `docs/design.md` の「稼働後に見つかった問題」参照）
  - GASの`UrlFetchApp`がSupabaseの新secret keyにブラウザ判定される401エラー → レガシーservice_role keyへの切り替えで解決
  - `SUPABASE_URL`の二重パス起因のPGRST125エラー → URL正規化処理を追加
  - GASのメール送信クォータ枯渇 → 失敗通知を実行1回につき1通に集約
- [x] 「すべて承認」連打による記録重複バグを修正、復旧用の重複整理ツールを追加（`maney-app` 側、[commit](https://github.com/Keitaro0510/maney-app/commit/3fadb49)）
- [x] カテゴリ学習を承認後の編集でも効くように拡張 + 手動入力との重複を承認時に自動統合（`maney-app` 側、[PR #1](https://github.com/Keitaro0510/maney-app/pull/1)）

### AI機能 + LINEダイジェスト通知（2026-08-11〜、コード実装済み・設定待ち）

詳細設計は [`docs/design.md`](docs/design.md) の「拡張: AI機能（カテゴリ自動判定・月次アドバイス） + 毎朝のLINEダイジェスト通知」節を参照。無料のGoogle Gemini API・LINE Messaging APIを使い、いずれもGAS側だけで完結させてPWA（ブラウザ）にはAPIキーを一切露出させない設計。コードは[maney-app-sync PR #1](https://github.com/Keitaro0510/maney-app-sync/pull/1)と[maney-app PR #5](https://github.com/Keitaro0510/maney-app/pull/5)でmainにマージ済み。残るは下記セットアップ手順6・7の設定作業のみ。

- [x] Supabase: `card_tx.ai_suggested_cat`カラム追加、`ai_insights`テーブル新設（`sql/ai_features.sql`）※SQL自体はSupabaseで未実行、手順1と同様に手動実行が必要
- [x] `gas/shared.gs`: `fetchUserData_()` / `getGeminiKey_()`
- [x] `gas/categorize.gs`: 楽天カード明細の初見店名をGeminiでカテゴリ自動判定（学習済み店名は呼ばない）
- [x] `gas/advice.gs`: 月次支出アドバイス（カテゴリ別前月比をGASで集計 → Geminiが自然文化）
- [x] `gas/notify.gs`: 毎朝7時のLINEダイジェスト通知（予定・シフト・お金のイベント・未承認明細件数）
- [x] `maney-app`側: `resolveCardTxCategory_()`, `#ai-insight-card`, `loadAiInsight()`
- [ ] `sql/ai_features.sql`をSupabaseで実行
- [ ] `GEMINI_API_KEY`・`LINE_CHANNEL_ACCESS_TOKEN`・`LINE_USER_ID`をGASのスクリプトプロパティに設定
- [ ] `installMonthlyAdviceTrigger()` / `installDigestTrigger()`を手動実行してトリガー登録

以下のセットアップ手順は、今後別アカウント・別環境で同じ仕組みを再構築する場合の再現手順として残す。

### 1. Supabaseに `card_tx` テーブルを作成する

1. [Supabaseダッシュボード](https://supabase.com/dashboard) → `maney-app` のプロジェクトを開く
2. 左メニュー「SQL Editor」を開き、[`sql/card_tx.sql`](sql/card_tx.sql) の中身を貼り付けて実行する
3. 左メニュー「Table Editor」で `card_tx` テーブルが作成されていることを確認する

### 2. GASに渡す3つの値をSupabaseから取得する

1. **SUPABASE_URL**: 左メニュー「Project Settings」→「API」の「Project URL」（`index.html` 内の `SUPA_URL` と同じ値）
2. **SUPABASE_SERVICE_ROLE_KEY**: 同じ画面の「service_role」キー（**anon/publishableキーではない方**。RLSをバイパスする強い権限を持つので、GAS以外の場所には絶対に書かない）
3. **USER_ID**: 左メニュー「Authentication」→「Users」で自分のGoogleアカウントの行を探し、UUID（`id`列）をコピーする

### 3. GASプロジェクトを作成する

1. [script.google.com](https://script.google.com/) で「新しいプロジェクト」を作成
2. デフォルトの `Code.gs` の中身を全部消し、[`gas/main.gs`](gas/main.gs) の内容を貼り付けて保存
3. 左メニュー「プロジェクトの設定」の歯車アイコン →「スクリプト プロパティ」で以下の3つを追加
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `USER_ID`
4. 上部の関数選択ドロップダウンで `installTrigger` を選び、実行ボタン（▶）を押す
   - 初回は「承認が必要です」→「権限を確認」→ Googleアカウントを選択 →「このアプリは Google で確認されていません」画面で「詳細」→「(プロジェクト名)に移動」→ 許可、の流れで進む（自分だけが使う個人スクリプトなので安全）
   - 実行ログに「トリガーを設定しました」と出れば成功（以後15分おきに自動実行される）

### 4. 動作確認

1. 関数選択を `importRakutenMails_` ではなく、まずは手動で試したいので `backfill` を選んで実行する（デフォルトで過去400日分を対象にしている。件数が多いと数分かかる）
2. 実行ログ（表示 → ログ、または実行数の履歴）で `imported=` の件数を確認する
3. Supabaseの Table Editor で `card_tx` にレコードが入っているか確認する
4. `maney-app` を開き、設定タブの「楽天カード自動取り込み」で取り込み先カード（楽天カード）を選んで保存する
5. 家計簿タブに戻ると「楽天カード 未確認の明細」カードが出るはずなので、開いて内容を確認・承認する

### 5. 継続運用

- 通常は15分おきの `main` トリガーが自動で新着メールを処理する（稼働確認済み）
- 何かおかしい場合は、GASプロジェクトの「トリガー」画面（時計アイコン）で `main` トリガーの実行履歴・エラーを確認する
- パースやSupabase書き込みに失敗した場合は自分のGmail宛にエラーメールが届く（実行1回につき1通に集約、詳細は実行ログを参照）
- **「最終取り込み」の表示が古いままでも、それ自体は異常とは限らない**。`maney-app`の設定画面の表示は`card_tx`の最新`created_at`を見ているだけなので、単に楽天カードを使っていない（＝取り込む新着メールがない）期間はそのまま古い時刻が表示され続ける。GAS側にエラー通知が来ていなければ正常。楽天カード側の仕様として、**500円未満の利用・海外利用・公共料金の継続利用・ETCカード利用はメール自体が配信されない**という制約があることも判明している（2026-08-03付けの楽天カード公式案内より）

### 6.（実装後に必要）AI機能を有効化する

カテゴリ自動判定・月次アドバイスの実装後にこの手順が必要になる。無料のGoogle Gemini APIを使う（クレジットカード登録不要）。

1. [Google AI Studio](https://aistudio.google.com/)でGoogleアカウントでログインし、APIキーを発行
2. GASの「プロジェクトの設定」→「スクリプト プロパティ」に`GEMINI_API_KEY`を追加
3. 未設定のままでも既存のカード取り込み・カテゴリ判定（学習済みルール＋静的ルール）はそのまま動く。AI機能だけが黙ってスキップされる設計

### 7.（実装後に必要）LINE通知を有効化する

毎朝7時のダイジェスト通知の実装後にこの手順が必要になる。LINE Notifyは終了済みのため、後継のLINE Messaging APIを使う（無料プランで月200通まで、本機能は月31通で十分収まる）。

1. [LINE Developers](https://developers.line.biz/)でプロバイダー→Messaging APIチャネルを作成
2. Messaging APIタブでチャネルアクセストークン（長期）を発行
3. 同画面の「あなたのユーザーID」を控える
4. 発行されたLINE公式アカウントを自分のLINEで友だち追加（未追加だとpushが届かない）
5. GASのスクリプトプロパティに`LINE_CHANNEL_ACCESS_TOKEN`と`LINE_USER_ID`を追加

## 関連リポジトリ

- [Keitaro0510/maney-app](https://github.com/Keitaro0510/maney-app) — アプリ本体（PWA）
