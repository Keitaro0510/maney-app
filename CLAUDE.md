# CLAUDE.md

## 引き継ぎ

- 作業を始める前に `git fetch origin main`・`gh pr list --state open`・`gh issue list --state open` で GitHub の最新を確認し、[README.md](README.md) の現在地と [docs/ROADMAP.md](docs/ROADMAP.md) の未チェック項目を読む
- [docs/ROADMAP.md](docs/ROADMAP.md) のチェックボックスが作業の進捗、[docs/DECISIONS.md](docs/DECISIONS.md) が設計判断の履歴。D20・D18・Service Worker のビルド連動は完了。古い作業ツリーや `js/` の歴史的な記載を、現行の未完了作業とみなさない

## 言葉

- 応答はすべて日本語で書く。作業の途中の報告だけでなく、**最後のまとめ（完了の報告）も日本語で書く**。英語で書かない
- コードの識別子・コマンド・ファイル名はそのままでよい。説明の文は日本語にする
- コミットメッセージ・PR・Issue のコメント・ドキュメント・コードのコメントも日本語で書く

## 役割分担

- 設計の判断（`docs/DECISIONS.md`）はユーザーが決める。Claudeは選択肢とトレードオフを示すまでにとどめ、勝手に決めない。決まったら DECISIONS.md に「決定」と「理由」を書く
- ユーザーが「自分で書く」と言った部分は、Claudeはコードを書かず、ヒントとレビューにとどめる
- 作業が終わったら `docs/ROADMAP.md` のチェックボックスを更新する

## 本番アプリとしてのルール

- **main ブランチがそのまま GitHub Pages の本番**（ユーザーが毎日使っている）。main で直接作業しない。変更は必ずブランチを切り、PR にする（`docs/GIT_WORKFLOW.md`）
- PR のマージは Claude が行ってよい（2026-10-29 にユーザーが許可）
- ユーザーはブランチの運用を学んでいる。Git の操作をするときは、何をなぜするのかを短く説明する
- `sw.js` の `CACHE_NAME` と先読み一覧は、公開するときにビルド成果物から自動で作る（D4 の手順6。`scripts/finalize-sw.mjs`）。リポジトリの `'money-app-dev'` は手で変えない。静的ファイルを足したら `vite.config.mjs` の `STATIC_FILES` も確かめる
- 手元で動かすときは `npm install`（初回だけ）のあと `npm run dev`（http://127.0.0.1:8765/）。Vite を使っている（D4）。`css/` は `vite-ignore` の付いた固定の CSS 参照で、ビルド時にその中身を先読み一覧へ入れる
- 型の検査は `npm run typecheck`（`src/` の TypeScript。CI でも動く）。必ずある入力欄などは `MoneyUI.inputById` などで取る（D16）
- `.ts` は `src/`（ES モジュール・`strict`）。データと同期の状態は `src/state.ts` を import して使う。保存・送信・読み込みは `src/sync.ts`、ログインは `src/auth.ts`、Supabase のクライアントは `src/supa.ts`、ナビと画面への入口は `src/navigation.ts`、起動は `src/bootstrap.ts`。画面には `UiPort`・`AuthUi` を通して頼む。イベントは各画面の起動時に登録し、`src/main.ts` は関数を `window` に出さない。Vite が作る指紋付きファイルは、ビルド時に `sw.js` の先読み一覧へ入れる
- 接続先は `MANEY_TARGET`（`prod`・`local`）で決まり、ビルドは指定しないと止まる（D19）。保存の流れをブラウザで確かめるときはローカルの Supabase（`npm run preview:local`。`docs/db/LOCAL.md`）を使う。画面比較は `npm run test:screens`（CI でも動く）。D20 の画面とナビの移行、D18 のイベント登録は完了。画面は `src/screens/<機能>.ts` にある
- データの構造は `docs/db/SCHEMA.md`。テーブルを変えるときはマイグレーション（`supabase/migrations/`）とテストを書き、ローカルの Supabase で通してから本番に適用する（`docs/db/LOCAL.md`）。保存データの形を変える前に、戻す手段（`docs/db/RESTORE.md`）を確かめる
