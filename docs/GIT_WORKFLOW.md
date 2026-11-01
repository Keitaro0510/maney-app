# ブランチとPRの流れ

## なぜブランチを使うのか

このリポジトリは **main ブランチがそのまま GitHub Pages の本番**になっている。main に push した瞬間に、毎日使っているアプリが変わる。
作業の途中の壊れた状態を本番に出さないために、作業は必ずブランチで行い、確認してから main に取り込む。

## 用語

| 用語 | 意味 |
|---|---|
| ブランチ | 作業用の分かれ道。main を変えずに変更を積み重ねられる |
| コミット | 変更の記録の単位 |
| push | 手元のコミットを GitHub に送ること |
| プルリクエスト（PR） | 「このブランチを main に取り込みたい」という依頼。差分の確認・CI・レビューをする場所 |
| マージ | ブランチの変更を main に取り込むこと |
| コンフリクト | 2つのブランチが同じ箇所を別々に変えたときに起きる衝突 |

## 基本の流れ（GitHub Flow）

```mermaid
gitGraph
  commit id: "main"
  branch feature/tasks-mvp
  checkout feature/tasks-mvp
  commit id: "save tasks"
  commit id: "show on home"
  checkout main
  merge feature/tasks-mvp id: "merge PR"
```

```bash
# 1. main を最新にする
git switch main
git pull

# 2. 作業用のブランチを作って移る
git switch -c feature/tasks-mvp

# 3. 変更して、小さくコミットする
git add -p          # 変更を1か所ずつ確認しながら選ぶ（VS Codeのソース管理画面でもできる）
git commit -m "Add task list to home"

# 4. GitHub に送って PR を作る
git push -u origin feature/tasks-mvp
gh pr create --fill # GitHub の画面から作ってもよい

# 5. PR の差分を自分で見直し、CI のテストが通る（PR の画面に緑のチェックが付く）のを確かめてからマージする
gh pr checks         # CI の結果を見る
gh pr merge --squash --delete-branch

# 6. 手元を片付ける
git switch main
git pull
git branch -d feature/tasks-mvp
```

**公開は自動**: main に入ると、GitHub Actions（`.github/workflows/deploy.yml`）がテストを通してから GitHub Pages に出す。`sw.js` の `CACHE_NAME` は、そのときに公開するファイルの中身から自動で決まるので、手で上げなくてよい（2026-11-01 から。D15）。公開の様子は GitHub の Actions の「公開」で見られる。

## ブランチ名の付け方

| 接頭辞 | 用途 | 例 |
|---|---|---|
| `feature/` | 新しい機能 | `feature/tasks-mvp` |
| `fix/` | 不具合の修正 | `fix/balance-chart` |
| `refactor/` | 動きを変えずに中身を整理 | `refactor/split-calendar` |
| `docs/` | ドキュメントだけの変更 | `docs/add-plan` |
| `chore/` | 設定や依存関係 | `chore/add-vitest` |

## 練習メニュー（上から順に）

1. [ ] **最初のPR（`docs/add-plan`: この計画の追加）を、自分でレビューしてマージする**
   - GitHub の PR を開き、「Files changed」で差分を見る。気になる行にコメントを書いてみる
   - 「Squash and merge」でマージし、ブランチを削除する
   - 手元で `git switch main`、`git pull`、`git branch -d docs/add-plan`
2. [ ] 小さな変更を、自分で ブランチ → PR → マージ までやってみる（例: 動かなくなった機能の画面を片付ける）
3. [ ] わざとコンフリクトを起こして解決する
   - `practice/a` と `practice/b` の2つのブランチで、README の同じ行を別々に書き換える
   - a を先にマージすると、b の PR でコンフリクトが出る → 手で直してマージする（終わったら両方消す）
4. [x] main を保護する（GitHub の Settings → Rules → Rulesets で、「main への直接の push を禁止」「マージには PR を必須」にする）
   - 2026-11-01 にルールセット「main を守る」を作った（ユーザーに頼まれて Claude が設定。`gh api` の rulesets）。中身は次の4つ
     - PR を通さないと main に入れない（直接の push は断られる）。承認の人数は0（1人で使うので、自分でマージしてよい）
     - テスト（`Node のテスト`）が通らないとマージできない
     - 強制 push（`git push --force`）で main の履歴を書き換えられない
     - main を消せない
   - 管理者でも、ルールを飛ばす設定（bypass）は付けていない。どうしても直接直したいときは、Settings → Rules → Rulesets でルールを一時的に止める（止めたら、終わったら戻す）
5. [x] CI を入れて、テストが通らないとマージできないようにする（Phase 2）
   - CI は 2026-10-31 に入れた（`.github/workflows/test.yml`）。PR を出すと、GitHub が自動でテストを動かす
   - 2026-11-01 に、4 のルールセットで「テストが通ること」（`Node のテスト`）をマージの条件にした。テストが終わるまで PR の「Merge」は押せず、落ちたらマージできない
   - 「main の最新を取り込んでからでないとマージできない」（strict）は付けていない。PR を2つ同時に出すことがほぼないため
6. [x] 動いているバージョンにタグを付ける（`git tag v1.0.0`、`git push origin v1.0.0`）。GitHub の Releases に変更点を書く
   - 2026-10-31 に `v1.0.0` を付けた（Claude が実行）。`git tag -a v1.0.0 -m "…"` の注釈付きタグにした（メッセージ・付けた人・日時が残る）。Releases は `gh release create v1.0.0 --notes-file …`
   - 付けたタグは動かさない。直したら、新しい番号（`v1.0.1` など）を付ける
7. [ ] マージした変更で不具合が出たら、`git revert` で打ち消す PR を作って戻す（履歴を消さずに戻す方法）
8. [ ] 長く続く作業（Phase 4 のファイル分割）の途中で main に入った変更を取り込む。`git merge main` と `git rebase main` の違いを試す
9. [ ] 本番の前に確認できる環境を作る（[D8](DECISIONS.md)）

## つまずいたとき

- **main のまま作業してしまった**: コミット前なら `git switch -c 新しいブランチ名` で、変更ごと新しいブランチに移れる
- **コミットのメッセージを間違えた（push 前）**: `git commit --amend`
- **履歴を書き換える操作**（amend、rebase、force push）は、push した後なら「自分しか使っていないブランチ」でだけ行う。main では絶対にしない
- **消してしまった・戻したい**: `git reflog` で過去の状態を探せる
