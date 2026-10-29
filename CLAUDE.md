# CLAUDE.md

応答は日本語で行う。

## 役割分担

- 設計の判断（`docs/DECISIONS.md`）はユーザーが決める。Claudeは選択肢とトレードオフを示すまでにとどめ、勝手に決めない。決まったら DECISIONS.md に「決定」と「理由」を書く
- ユーザーが「自分で書く」と言った部分は、Claudeはコードを書かず、ヒントとレビューにとどめる
- 作業が終わったら `docs/ROADMAP.md` のチェックボックスを更新する

## 本番アプリとしてのルール

- **main ブランチがそのまま GitHub Pages の本番**（ユーザーが毎日使っている）。main で直接作業しない。変更は必ずブランチを切り、PR にする（`docs/GIT_WORKFLOW.md`）
- PR のマージは Claude が行ってよい（2026-10-29 にユーザーが許可）
- ユーザーはブランチの運用を学んでいる。Git の操作をするときは、何をなぜするのかを短く説明する
- `index.html` か `js/` を変えたら `sw.js` の `CACHE_NAME` を上げる（自動化するまで）
- データの構造は `docs/db/SCHEMA.md`。テーブルを変えるときはマイグレーション（`supabase/migrations/`）とテストを書き、ローカルの Supabase で通してから本番に適用する（`docs/db/LOCAL.md`）。保存データの形を変える前に、戻す手段（`docs/db/RESTORE.md`）を確かめる
