# 現在地と引き継ぎ

最終確認: **2026-11-03（JST）**。この文書は確認時点の記録。作業を再開するときは GitHub の最新状態を取り直す。

## 何を進めてきたか

毎日使う家計・予定・シフト・タスクの PWA を、小さなブランチと PR で安全に改修してきた。基本のタスク管理と DB のテーブル分割は済んでいる。直近の作業は既存機能の TypeScript への移行、HTML のインラインイベントの整理、ビルド成果物に合わせた Service Worker の更新だった。新しいタスク連携機能はまだ作っていない。

## GitHub の確認済み状態

- `origin/main`: `e7d8a04`（[PR #133](https://github.com/Keitaro0510/maney-app/pull/133) のマージ）。公開用 GitHub Pages の直近の実行は成功。確認時点で開いている PR は 0 件。
- [ROADMAP](ROADMAP.md) の D20 の 0〜10（画面・ナビ・起動の移行）、D18 のイベント登録、Phase 4 の手順6（Service Worker の先読み一覧と版の生成）は完了。実行する JavaScript は `src/` の TypeScript からビルドし、`js/` には `.gitkeep` だけが残る。
- PR ごとの Node テスト・型検査・結合テスト・画面比較を CI で実行する。`main` へのマージで GitHub Pages を自動公開する。
- データは 2026-10-29 に JSON 1 行からテーブルへ移行済み（[SCHEMA.md](db/SCHEMA.md)、[TABLE_SPLIT.md](db/TABLE_SPLIT.md)）。基本のタスク管理は [ROADMAP の Phase 3](ROADMAP.md#phase-3-タスク管理最小版) のとおり実装済み。

## 残作業

1. **具体的な修正候補**: [Issue #113](https://github.com/Keitaro0510/maney-app/issues/113) のカード名の HTML エスケープ。`src/screens/cards.ts` の一覧表示を修正し、特殊文字を含む名前で確かめる。D20 の移行はやり直さず、独立した PR にする。
2. **Git の練習・環境**: [ROADMAP の Phase 4](ROADMAP.md#phase-4-ファイルの分割とtypescript) に残る練習8（長く続くブランチへの `main` の取り込み）と練習9（本番前の確認環境）。練習9の設計は [D8](DECISIONS.md) に沿って選択肢を出し、ユーザーの判断を受けて進める。
3. **新機能**: [ROADMAP の Phase 6](ROADMAP.md#phase-6-お金予定タスクの連携) に、予定にひもづく準備タスク、毎月くり返すタスク、残高不足の予測から作るタスクが残る。Web Push は任意。仕様が未決の部分は [DECISIONS.md](DECISIONS.md) に選択肢と判断を記録する。
4. **古い練習・資料**: Phase 0 の `st` の構造図、Phase 1 の練習1〜3、Phase 5 の問題発生時の `git revert` 練習は未チェック。`st` は現在の保存先ではなく互換の履歴にあたるため、図を作る場合は現行 DB と混同しない。
5. **Issue の整理**: [Issue #11](https://github.com/Keitaro0510/maney-app/issues/11) は GitHub では開いたまま。一方、実装と ROADMAP はテーブル移行を完了と記録している。Issue 本文の古いチェック項目と完了記録を照合し、残作業の有無を確認してから状態を整理する。開いていることだけで DB 移行の再実装を始めない。

次にコードを直すなら、対象と確認方法が明確な #113 が着手しやすい。学習の練習8・9と Phase 6 は別の目的なので、それぞれ独立した作業として扱う。

## 次の担当者が始める手順

1. `git fetch origin main`、`gh pr list --state open`、`gh issue list --state open` で GitHub の最新を確認する。`git status --short --branch` で手元の未コミット変更も確認する。上の SHA や Issue 状態は固定の真実として扱わない。
2. 最新の `main` から、1 件の変更につき 1 ブランチ・1 PR を作る。複数の作業ツリーがある PC では、作業ツリーとブランチの対応を `git worktree list` で確かめる。2026-11-03 時点の `maney-app` は古い文書ブランチ、`maney-app-home-pr` が最新 `main` からの作業場所だった。過去の home / calendar / final の作業ブランチを、現在の `main` への未マージ作業とみなさない。
3. [ROADMAP](ROADMAP.md) の未チェック項目と Issue を選ぶ。[DECISIONS.md](DECISIONS.md) は設計判断の履歴。[SCREENS.md](SCREENS.md) は現在の画面とコードの対応。古い `js/` のファイル名が履歴の中にあっても、現行の実装場所は `src/`。
4. Node.js 24 で `npm install`、`npm run typecheck`、`npm test` を実行する。画面・保存・DB を変えるなら [LOCAL.md](db/LOCAL.md) に従いローカルの Supabase を起動して `npm run test:screens`・`npm run test:integration` も実行する。公開形の確認は `MANEY_TARGET=prod bash scripts/build-pages.sh`。
5. PR の CI を確認してマージする。`main` が本番なので直接変更しない。マージの許可は [CLAUDE.md](../CLAUDE.md) に記録済み。公開を伴う変更では GitHub Pages の実行結果も確認する。

