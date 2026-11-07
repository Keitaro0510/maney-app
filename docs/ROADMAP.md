# ROADMAP

毎日使っているアプリなので、**1つの変更 = 1つのブランチ = 1つのPR** で進める（流れは [GIT_WORKFLOW.md](GIT_WORKFLOW.md)）。
各項目の後ろの `ブランチ:` は、名前の例。

## 進める順番（[D12](DECISIONS.md)、2026-10-31 に決定）

Phase の番号の順ではなく、次の順で進める。

1. D10 と D1〜D3、エクスポートするデータの形（D13）を決める（Phase 3）　← 2026-10-31 に済んだ
2. GitHub Actions で PR ごとにテストを動かす（Phase 2）　← 2026-10-31 に済んだ
3. はっきりしたバグ4つを直す（Phase 2）　← 2026-10-31 に済んだ
4. 直した状態に `v1.0.0` のタグを付ける（Phase 2）　← 2026-10-31 に済んだ
5. `st` の外を保存する入り口と、`tasks` のマイグレーション（Phase 3）　← 2026-10-31 に済んだ
6. タスク用の UI 部品（Phase 3）　← 2026-10-31 に済んだ
7. タスクの機能（Phase 3）　← 2026-10-31 に済んだ
8. D11 を決めてお金の計算を1か所にまとめる。JSON のエクスポート・インポート（Phase 2）。D11・D14 は 2026-10-31 に決めた。次の段に分けて進める
   1. 固定費に期間（いつから・いつまで）を足し、固定収入を固定費にまとめる。支出の払い方に「口座」を足す（DB のマイグレーション。D11・D14）　← 2026-10-31 に期間と口座は済んだ（#53）。固定収入のまとめは段4で
   2. お金の計算を1か所にまとめる（`js/money.js` とテスト。D11 の数え方）　← 2026-10-31 に済んだ
   3. ホームを作り直す（D11 の構成）　← 2026-10-31 に済んだ
   4. 毎月のお金の画面（記録の画面の「毎月くり返す」と払い方の「口座」、家計簿のタブの一覧、やめる・金額を変える。設定から外す。D11・D14）　← 2026-10-31 に済んだ
   5. JSON のエクスポート・インポート（D13）　← 2026-10-31 に済んだ（読み込みは全部を置き換える）

手順8のあと、全部の画面を iPhone の幅で確かめて、UI の見直しをした（2026-10-31、[#71](https://github.com/Keitaro0510/maney-app/issues/71)。Codex の [#58](https://github.com/Keitaro0510/maney-app/issues/58) の続き）。

Phase 4 の実装（ファイルの分割・TypeScript・イベント登録・Service Worker のビルド連動）は 2026-11-03 に完了した。残る練習と Phase 6 の機能は、下の未チェック項目を参照。`CACHE_NAME` の自動化は 2026-11-01 に入れた（D15）。

## Phase 0: 今の状態の地図を作る

- [ ] `st`（保存しているデータ全体）の構造を図にする（`cards`、`jobs`、`ledger`、`plans`、`shifts`、`fixedCosts` など）
- [x] 5つのタブ（ホーム・カレンダー・家計簿・シフト・設定）と、主な関数の対応表を作る（2026-10-29、[SCREENS.md](SCREENS.md)。どこを押すとどの画面に行くかの図も）
- [x] 動かなくなった機能を洗い出す（楽天カードの明細の取り込みは 2026-10-24 に削除。AIアドバイス・LINE通知は 2026-10-29 に使わないと決めて消し、GAS のコードは [`archive/sync/`](../archive/sync/) にしまった）
- [x] 外部設計・内部設計・UI を監査する（2026-10-29、Claude と Codex。[design-review/](design-review/README.md)）

## Phase 1: ブランチとPRに慣れる

- [ ] 練習1: 最初のPR（`docs/add-plan`）をレビューしてマージする
- [ ] 練習2: 小さな変更を自分で ブランチ → PR → マージ
- [ ] 練習3: コンフリクトを起こして解決する
- [x] 練習4: main を保護する（直接の push を禁止）（2026-11-01。ルールセット「main を守る」。テストが通らないとマージできない設定も一緒に。[GIT_WORKFLOW.md](GIT_WORKFLOW.md) の練習4・5）

## Phase 2: 安全網を張る

- [x] データを JSON でエクスポート・インポートする機能（改修する前の保険。DB整備① [#8](https://github.com/Keitaro0510/maney-app/issues/8) と重なる）。タスクのあとにする（D12）。データの形は [D13](DECISIONS.md) で決めた　ブランチ: `feature/export-import`（2026-10-31。設定の「データの書き出し・読み込み」。読み込みは全部を置き換え、直前の写しを残す。`js/backup.js`・DB の `import_backup`）
- [x] 楽天カードの取り込みを片付ける（2026-10-24 に削除、[PR #7](https://github.com/Keitaro0510/maney-app/pull/7)、[D5](DECISIONS.md)）
- [x] AIアドバイス・LINE通知を動かすか決める（使わない。[D5](DECISIONS.md)）
- [x] はっきりしたバグを直す（1つずつ小さな PR で、直す関数にテストを付ける。D12。2026-10-31 に4つとも済んだ）
  - [x] 「今日」がアプリを開いたときのまま変わらない（`index.html:811-813`）　ブランチ: `fix/today-stale`（2026-10-31。`js/clock.js` で日付が変わったかを見張る）
  - [x] 月にない日（31日など）の固定費などが翌月にずれる（`index.html:1375`・`1423-1424`）　ブランチ: `fix/missing-day`（2026-10-31。月にない日は月末にする。固定費・固定収入・給料日・カードの引き落とし日と締め日のすべて）
  - [x] 日をまたぐシフト（22:00〜02:00 など）の給料が0円になる（`index.html:1314`）　ブランチ: `fix/overnight-shift`（2026-10-31。日をまたぐシフトはしないので、入力のときに止める。計算は変えない）
  - [x] アプリに戻ってきたとき、月表示の日の詳細が描き直されず、古いボタンから別の記録を消しうる（`index.html:958-961`）　ブランチ: `fix/stale-day-detail`（2026-10-31。カレンダーを描き直すときに日の詳細も描き直し、ボタンは押したときに同じ記録かを ID で確かめる）
- [x] 計算ロジック（残高の推定、カードの締め日、給与）を関数として切り出し、テストを書く（2026-10-31。`js/money.js` と `tests/money.test.mjs`。Vitest ではなく `node --test`。D11）
- [x] GitHub Actions で PR ごとにテストを実行する（練習5。2026-10-31、[`.github/workflows/test.yml`](../.github/workflows/test.yml)。Node だけで通るテストを動かす。テストが通らないとマージできない設定は、2026-11-01 に練習4 の main の保護と一緒に入れた）
- [x] sw.js の `CACHE_NAME` を手で上げるのをやめ、デプロイのたびに自動で変わるようにする。CI とは分け、デプロイの版やハッシュと確実に連動させるやり方（公開を GitHub Actions に移すかどうかも）を決めてから入れる（D12）（2026-11-01。公開を GitHub Actions に移し、公開するファイルの中身の指紋を版にした。[D15](DECISIONS.md)）
- [x] バグ4つを直し、CI で確かめた状態に `v1.0.0` のタグを付ける（練習6、D12。2026-10-31、[Releases](https://github.com/Keitaro0510/maney-app/releases/tag/v1.0.0)）

## Phase 3: タスク管理（最小版）

タスクの前に、Phase 2 の一部と下の土台を先にやる（[D12](DECISIONS.md)。順番は上の「進める順番」）。

- [x] タスクの前に決めること（2026-10-31 にすべて決めた）
  - [x] D1: `tasks` テーブルを作り、`st` を通さずデータの層で読み書きする（2026-10-31）
  - [x] D2: タスクは予定とは別のもの。期限はあってもなくてもよい（2026-10-31）
  - [x] D10: 設定を右上の歯車から開くようにし、空いたタブを「タスク」にする（2026-10-31）
  - [x] D3: タイトル・期限（日付だけ）・完了した日時・メモ。完了したものは横線で薄く残す（2026-10-31）
  - [x] D13: テーブルの行のまま（`format`・`version`・`exported_at`・`tables`）。サーバーが決める列は入れない（2026-10-31）
- [x] `st` の外のテーブルを読み書きする入り口と、`apply_op` に `tasks` を足すマイグレーション（タスクが次の保存で消えないように。`TABLES` に足すだけでは消える。DB でテーブルの名前を並べている3か所＝トリガー・RLS、`apply_op`、毎日の写しにも足す。D1 の「作るときの注意」）。2026-10-31: 画面は `saveRows` で直接保存し、`save()` は `MoneyData.COMPAT_TABLES` だけを比べる。マイグレーションは `20261030170903_tasks.sql`
- [x] タスク用の UI 部品（`<button>`・ダイアログ・44px のタップ領域）。今ある画面はあとで1つずつ直す（2026-10-31、`js/ui.js`: 44px のボタン・アイコンのボタン・チェックの行・`<dialog>` の画面・「元に戻す」の知らせ・`escapeHtml`）
- [x] 設定を右上の歯車（44px）から開くようにし、アカウントの丸をなくす。メールアドレスとログアウトは設定のいちばん下へ（D10）　ブランチ: `feature/settings-gear`（2026-10-31。タスクのタブを足すまで、下のタブは4つ）
- [x] カレンダーのセルから、支出・収入の金額の札を外す（D10。タスクの件数を足す前に）　ブランチ: `feature/calendar-no-amount`（2026-10-31。月表示のセルだけ。週表示・日の詳細・家計簿では見られる）
- [x] タスクのタブで、タスクの追加・完了・削除・期限・メモ。完了したものは横線で薄く残し、7日たったら「完了したタスク」にたたむ。削除のあとに「元に戻す」（D3・D10）　ブランチ: `feature/tasks-mvp`（2026-10-31。Claude と Codex の案を見比べて Claude の案にした）
- [x] その日はじめて開いたときに、期限切れ・今日・2週間以内のタスクを出す（完了もできる。D10）（2026-10-31。Claude と Codex の案を見比べて Claude の案にした）
  - [x] 開くたびに出し、「今日は表示しない」のチェックで止める形に変えた（ユーザーの希望。D10 を書き直した。2026-10-31、[#71](https://github.com/Keitaro0510/maney-app/issues/71)）
- [x] ホームに「今日・期限切れ N件」の1行を出し、押すと同じ一覧を開く（D10）（2026-10-31。どちらも0件なら出さない）
- [x] カレンダーに、タスクの印と件数を出す。日の詳細には名前だけ（D10）（2026-10-31。月のセルは「タスク2」、日・週の表示は「タスク 2件」）
- [x] 予定の「完了チェック」（今もある）との関係を整理する（2026-10-31、D2。予定の「完了」は残し、意味は「済み（予算に含めない）」）
- [x] 予定の「完了」の言葉を「済み（予算に含めない）」のように変える（D2。列名 `done` はそのまま）（2026-10-31。チェックに読み上げ用の名前、済みの予定に「済み・予算に含めない」の札。押せる所を 44px に）

**終わりの目安**: 自分が毎日タスクをこのアプリで管理している

## Phase 4: ファイルの分割とTypeScript

[D4](DECISIONS.md)（2026-11-01）: 最初から Vite と TypeScript。ただし一度に書き直さず、次の順で段階的に移す。

- [x] 1. 公開を GitHub Actions に移す（2026-11-01、D15。#86）
- [x] 2. Vite を入れ、まず今の JavaScript は `.js` のまま動かす（2026-11-01。`js/` は `vite-ignore` でそのまま公開し、出力の `index.html` は元とほぼ同じ）　ブランチ: `feature/vite-foundation`
- [x] 3. TypeScript の検査（`checkJs`）を入れて、型の間違いを直す。その前に `index.html` の CSS と JavaScript をファイルに出す（2026-11-02）
  - [x] `index.html` の `<style>` を `css/app.css` に、`<script>` を `js/app.js` に出す（2026-11-02。CSS と JavaScript は分けずに1つの PR でまとめて出した。中身は1文字も変えず、`js/` と同じく `vite-ignore` でそのまま公開する）　ブランチ: `feature/extract-css-js`
  - [x] `checkJs` を入れて、型の間違いを直す（2026-11-02。336件を0件に。画面の要素は型付きの取り出し関数で取る（[D16](DECISIONS.md)）。`strict` はまだ入れない。CI で `npm run typecheck` を動かす）　ブランチ: `feature/check-js`
- [x] 4. 機能ごとに `.ts` と import/export に移す（home / calendar / ledger / shift / settings / tasks）。計算ロジックから。つなぎ方は [D17](DECISIONS.md)。2026-11-03 完了
  - [x] 土台（`src/main.ts` から `window` に出す・`js/` は `<body>` に `defer`・`src/` は `strict`）と `clock`・`money`（2026-11-02。本番と同じビルドで、起動・主要な画面・オフラインでの読み直しを確かめた）　ブランチ: `feature/ts-clock-money`
  - [x] `tasks`・`monthly`（2026-11-02。架空のデータを読み込ませた13の画面の表示が、移す前と同じことを確かめた）　ブランチ: `feature/ts-tasks-monthly`
  - [x] `data`・`backup`（2026-11-02。表示に加えて、支出の追加・記録の編集・タスクの追加の保存で積まれる送信待ちの操作と、書き出し・読み込みの確かめが、移す前と同じことを確かめた）　ブランチ: `feature/ts-data-backup`
  - [x] `compat`（2026-11-02。DB の全テーブルの行の型を `src/rows.ts` にまとめた。表示と保存の流れが移す前と同じことを確かめた）　ブランチ: `feature/ts-compat`。これで計算ロジックはすべて `src/` に移り、`js/` には画面のファイルだけが残った
  - [x] 結合テスト（`tests/integration/`。ローカルの Supabase で保存を本物の DB に通す）を流す（2026-11-02。Windows の PC で 7 件すべて通った。`supabase.exe` が止まるかは PC による。[db/LOCAL.md](db/LOCAL.md) の「結合テスト」）
  - [x] 画面（home / calendar / ledger / shift / settings / tasks）。やり方は [D18](DECISIONS.md)（2026-11-03 完了）
    - [x] `js/app.js` を、中身を変えずに `js/` の中で「共通部分 → 画面 → bootstrap」のファイルに分ける。`loadData()` を呼ぶのは bootstrap だけ（2026-11-02。9つのファイルに分けた。つなぎ直すと元と1バイトも違わないことと、本番と同じビルドで起動・全200関数の存在を確かめた）　ブランチ: `feature/split-app-js`
    - [x] 共通部分（状態・保存・同期・認証）を `src/` に移す。やり方は [D19](DECISIONS.md)（2026-11-02）
      - [x] Supabase のライブラリの版を固定し、型を付ける（2026-11-02。CDN を 2.118.0 に固定、同じ版を開発用の依存に。#99）　ブランチ: `chore/pin-supabase-js`
      - [x] 接続先をビルドのときに切り替える（明示しないと失敗）・ローカル用のログインの入口・結合テストの専用のコマンドと CI
        - [x] 接続先の切り替えとローカル用のログイン（2026-11-02。ローカルのビルドで、作ったテスト用のアカウントでログインし、支出の保存がローカルの DB に届くことを確かめた）　ブランチ: `feature/build-target`
        - [x] 結合テストの専用のコマンドと CI（2026-11-02。`npm run test:integration`。CI でも PR のたびに流す。Supabase CLI を 3.0.0 に固定）　ブランチ: `feature/integration-ci`
      - [x] state store と `window` の互換の層（ブラウザで `js/` の読み書きが変わらないことを確かめる）（2026-11-02。`src/state.ts` にデータと同期の状態の8つ。ローカルのビルドで、保存・送信・読み込み直し・ログアウトと再ログインを確かめた）　ブランチ: `feature/state-store`
      - [x] 保存・送信・読み込みの流れ（失敗・競合・通信の失敗・送り直しも確かめる）（2026-11-02。`src/sync.ts`。偽の Supabase と本物の DB の両方で、本物の流れを通して確かめた）　ブランチ: `feature/sync-flow`
      - [x] ログインと起動の流れ（ログインした直後・ログアウト・戻ったときの読み直しを確かめる）（2026-11-02。`src/auth.ts`・`src/supa.ts`。ブラウザでログイン・ログアウト・再ログイン・戻ったときの読み直しを確かめた）　ブランチ: `feature/auth-start`
    - [x] 画面を、状態と保存先を共有する機能のまとまりごとに `src/` に移す（`strict`。`window` に出す関数は画面ごとに一覧にする）。まとまりと順番は [D20](DECISIONS.md)（2026-11-02）
      - [x] 0. 画面を比べる道具（ローカルの Supabase・固定した時刻とデータで DOM の写しと画面の写真を比べる。CI でも）（2026-11-02。Playwright。`npm run test:screens`。DOM の写し 22・写真 11（Windows と Linux））　ブランチ: `feature/screen-compare`
      - [x] 1. 共通の補助と今日（2026-11-02。`src/dates.ts`・`src/palette.ts`。機能のお金の補助は、その機能の PR で移す）　ブランチ: `feature/common-helpers`
      - [x] 2. タスク（試しの1つめ）（2026-11-02。`src/screens/tasks.ts`。画面の部品 `src/ui.ts` も移した。移し方は D20 の「作り（2）」）　ブランチ: `feature/tasks-screen`
      - [x] 3. 書き出し・読み込み（2026-11-02。`src/screens/backup.ts`。`downloadJson` は `src/ui.ts` へ）　ブランチ: `feature/backup-screen`
      - [x] 4. 設定・カード・ATM（2026-11-03。`src/cards.ts`・`src/screens/settings.ts`・`cards.ts`・`atm.ts`。計算→設定→カード→ATM の順にコミット。カード見本の不要な push/pop は別コミットで削除）　ブランチ: `feature/settings-cards-atm-screen`
      - [x] 5. シフト・バイト先・給与の実績（2026-11-03。`src/shifts.ts`・`src/screens/shift.ts`。計算→画面の順に移した）　ブランチ: `feature/shift-screen`
      - [x] 6. 予定（2026-11-03。`src/plans.ts` に `getPlansForDay`・`planTimeOnDay`・`hm2min`、`src/screens/plans.ts` に入力画面）　ブランチ: `feature/plans-screen`
      - [x] 7. 家計簿・毎月のお金（2026-11-03。`src/ledger.ts`・`src/screens/ledger.ts`・`src/screens/monthly.ts`。`catChart`・`dayChart` も移した）　ブランチ: `feature/ledger-monthly-screen`
      - [x] 8. ホーム（`src/home.ts`・`src/screens/home.ts`。`renderBalanceChart`・`balChart` を含む）　ブランチ: `feature/home-screen`
      - [x] 9. カレンダー（`src/screens/calendar.ts`。月・週・日と日の詳細、祝日）　ブランチ: `feature/calendar-screen`
      - [x] 10. ナビゲーション・bootstrap・状態の互換の層の整理（2026-11-03。`src/navigation.ts`・`src/bootstrap.ts`。`js/` の実行ファイルと状態の getter・setter を削除。関数を `window` に出す層は手順5まで残す）　ブランチ: `feature/navigation-bootstrap-screen`
- [x] 5. `onclick` を少しずつイベントの登録に置き換える（移す間は、モジュールの関数を `window` に出す互換の層を置く）
  - [x] 固定のナビ・カレンダー・家計簿の表示切替と期間ボタン20か所（2026-11-03。`src/navigation.ts`・`src/screens/calendar.ts`・`ledger.ts`。不要になった関数10個の `window` 公開も削除）　ブランチ: `feature/events-navigation`
  - [x] タスクの固定 HTML にある15か所のイベントと起動時一覧のチェック（2026-11-03。`src/screens/tasks.ts`。タスク一覧の行はもともと DOM のイベント登録を使う）　ブランチ: `feature/events-tasks`
  - [x] データの書き出し・読み込みの固定イベント6か所（2026-11-03。`src/screens/backup.ts`。書き出したファイルを確認画面で開き、取り消すところまで確かめた）　ブランチ: `feature/events-backup`
  - [x] ホームの操作とログイン・ログアウトの固定イベント7か所（2026-11-03。`src/screens/home.ts`・`src/bootstrap.ts`。`LEGACY_HOME`・`LEGACY_AUTH` の `window` 公開を削除）　ブランチ: `feature/events-home-auth`
  - [x] カレンダーの固定ボタン5か所と、描画時に作るハンドラ13か所（2026-11-03。`src/screens/calendar.ts` の委譲イベント。`LEGACY_CALENDAR` の `window` 公開を削除）　ブランチ: `feature/events-calendar`
  - [x] ATM の数字キー・引き出し・履歴削除など15か所（2026-11-03。`src/screens/atm.ts` の委譲イベント。`LEGACY_ATM` の `window` 公開を削除）　ブランチ: `feature/events-atm`
  - [x] 家計簿の入力・編集・一覧と毎月のお金の編集など27か所（2026-11-03。`src/screens/ledger.ts`・`monthly.ts` の委譲イベント。画面比較と実際の操作を確認）　ブランチ: `feature/events-ledger-monthly`
  - [x] 設定のカテゴリとカードの入力・編集・実績など12か所（2026-11-03。`src/screens/settings.ts`・`cards.ts`。設定欄のイベント代入も起動時の登録に移した）　ブランチ: `feature/events-settings-cards`
  - [x] 予定の入力画面の期間・時刻・色・支払い・保存など9か所（2026-11-03。`src/screens/plans.ts`。期間入力のイベント代入も起動時の登録に移した）　ブランチ: `feature/events-plans`
  - [x] シフト・バイト先・給与実績の固定と描画時のハンドラ20か所（2026-11-03。`src/screens/shift.ts`。プレビュー入力のイベント代入も起動時の登録に移した）　ブランチ: `feature/events-shift`
  - [x] 固定 HTML と画面が組み立てる HTML のイベント属性を全て移し、起動時の `window` 公開を削除（2026-11-03。画面比較も UI 操作で開く。同期バナーの動的ボタンもイベント登録に変更）　ブランチ: `feature/events-compat-cleanup`
- [x] 6. ビルドしたファイルを元に、Service Worker の先読みの一覧と版を作る（2026-11-03。Vite の指紋付きファイルを含む全成果物から `scripts/finalize-sw.mjs` が作る）　ブランチ: `feature/sw-build-manifest`
- [ ] 長く続くブランチで main の変更を取り込む（練習8）
- [ ] 本番の前に確認できる環境を作る（練習9、D8）

## Phase 5: データを正規化したテーブルに移す

DB整備の方針は [PLAN.md](../archive/db-review/PLAN.md) で決め、2026-10-29 にすべて終えた。作業は Issue [#8](https://github.com/Keitaro0510/maney-app/issues/8)〜[#11](https://github.com/Keitaro0510/maney-app/issues/11) で進める。

- [x] 新しいテーブルを設計する（[db/TABLE_SPLIT.md](db/TABLE_SPLIT.md)、#21）
- [x] 移行スクリプト（JSONB → テーブル）と、元に戻す手順を用意する（#23・#24、[db/RESTORE.md](db/RESTORE.md)）
- [x] 差がないことを確かめてから切り替える（両方に書き込む代わりに、試験版 `next.html` と全項目の照らし合わせで確かめた。2026-10-29 に切り替え、#29）
- [ ] 問題が出たら `git revert` で戻す（練習7）

## gymapp との連携（D23。2026-11-05）

進め方と順番は [gymapp の PLAN](https://github.com/Keitaro0510/gymapp/blob/main/docs/PLAN.md)。ここでの作業は、DB と、maney-app 側の連携。

- [x] gym のテーブル（`gym_exercises`・`gym_workouts`・`gym_sets`）のマイグレーションと RLS のテスト。ローカルで通し、本番に適用した（2026-11-05。バージョン 20261105140000。Advisors に新しい指摘なし）
- [x] `docs/db/SCHEMA.md` に gym のテーブルを追記する（2026-11-05）
- [x] gymapp が DB につながった（2026-11-05。gymapp の PR #1〜#4。Vite・TypeScript への移行、Google ログイン（maney-app と共有）、同期、バックアップ JSON の取り込み）。本番の DB に、種目18・トレーニング40（2026-06-15〜11-04）・セット775が入り、7/4 のバックアップ（8回・256セット・合計 72,660 kg）と、同じ期間の分が一致した
- [x] 種目に部位（主1つ＋補助）を持たせる列を足した（D24。2026-11-05。gymapp の #10）
- [x] 種目に、やり方のメモと解説動画のリンクを持たせる列を足した（D25。2026-11-06。gymapp の #23）
- [ ] トレーニングに、所要時間の列を足す（D26。2026-11-07。gymapp のタイマー。本番への適用はこれから）
- [ ] カレンダーにトレーニングの日を出す
- [ ] ホームに今週のトレーニング回数を出す
- [ ] ジム代（毎月のお金）÷ 回数で、1回あたりを出す

## 使って見つかった改善（2026-11-03）

- [x] [#140 カレンダーの日・週表示をなくして月表示に絞る](https://github.com/Keitaro0510/maney-app/issues/140)。月表示と、日付を押したときの詳細は残す（2026-11-03）
- [x] [#138 月表示の「タスクN」を見直す](https://github.com/Keitaro0510/maney-app/issues/138)。日付の横の小さな丸に未完了件数を表示。期限切れは赤、すべて完了ならチェック。日の詳細には名前を残す（2026-11-03）
- [x] [#139 起動時のタスクのお知らせを中央に出す](https://github.com/Keitaro0510/maney-app/issues/139)。期限の範囲・完了・「今日は表示しない」は維持（2026-11-03）
- [x] [#137 タスクに用途別のタグを付ける](https://github.com/Keitaro0510/maney-app/issues/137)。「仕事」「就活」「お金」「デート」など。複数タグ・一覧での絞り込み・クラウド保存。色分けは今後必要なら決める（2026-11-03）
- [x] カードの確定額を、締め日を過ぎたら引き落とし前でも入力できるようにする（#148。2026-11-05）
- [x] 「使えるお金」をこの先90日の残高の最低点にし、「今月の収支見通し」を90日のお金の動きの一覧に置き換える（D22。2026-11-05）

**着手順**: 使いながら見つかった改善（#140・#138・#139・#137）は完了。次は予定にひもづくタスク（Phase 6）に着手する。

## Phase 6: お金・予定・タスクの連携

- [ ] 予定にひもづく準備のタスク
- [ ] 毎月くり返すタスク
- [ ] 引き落とし前に残高が足りなそうなら、タスクを自動で作る
- [ ] （任意）期限の通知（Web Push、D6）
