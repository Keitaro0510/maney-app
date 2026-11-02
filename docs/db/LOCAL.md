# ローカルで DB を動かす

本番の DB（Supabase）を触らずに、PC の中に同じ構成の Supabase を立てて、マイグレーションとテストを試す。
設定は `supabase/config.toml`、マイグレーションは `supabase/migrations/`、テストは `supabase/tests/` にある。

## 準備（1回だけ）

1. WSL を入れる。管理者の PowerShell で次を実行し、PC を再起動する

   ```powershell
   wsl --install --no-distribution
   ```

2. Docker Desktop を起動する（タスクバーにクジラのアイコンが出て、「Engine running」になるまで待つ）

Supabase の CLI は `npx` で動かすので、インストールはいらない。初回の `start` は数GBのダウンロードがあり、時間がかかる。

## 使い方

```bash
# 起動（Docker Desktop が動いている状態で）
npx supabase start

# マイグレーションを最初から流し直す（DB を空にしてから、supabase/migrations/ を順に適用する）
npx supabase db reset

# テストを実行する
npx supabase test db

# 止める
npx supabase stop
```

`start` のあとに表示される `Studio URL`（http://127.0.0.1:54323）をブラウザで開くと、テーブルの中身を見られる。

## CLI が動かないとき（Docker だけで DB のテストを流す）

2026-10-31 に、Windows のアプリケーション制御（スマート アプリ コントロールなど）が `supabase.exe` を止めるようになり、`npx supabase start` が `spawn UNKNOWN` で失敗した（PowerShell では「アプリケーション制御ポリシーによってこのファイルがブロックされました」）。パソコンのセキュリティの設定なので、変えずに次のやり方を使う。

```bash
# Docker Desktop が動いている状態で（Git Bash などの bash から）
bash scripts/db-test-docker.sh            # 全部のマイグレーションを流してから、全部のテストを流す
bash scripts/db-test-docker.sh 05_tasks   # 名前に 05_tasks を含むテストだけ
```

- Supabase と同じ Postgres のイメージ（`public.ecr.aws/supabase/postgres`）を Docker で立て、`supabase/migrations/` を古い順に流し、`supabase/tests/database/` のテストを `psql` で流す。終わったらコンテナを消す
- イメージの `auth.uid()` は古い書き方なので、本物の Supabase（認証のサービスが作り直したあと）と同じ形に置き換えてから流す
- DB の中だけを試すので、API（PostgREST・認証）が要る `tests/integration` は流せない

- `supabase/tests/database/*.test.sql` に pgTAP で書く。1つのファイルは `begin;` で始めて `rollback;` で終わるので、テストのデータは残らない
- ログインしたユーザーとして動かすときは、`set local role authenticated;` と `request.jwt.claims` を設定する（`01_tables.test.sql` を参照）
- リポジトリは公開しているので、本番のデータはテストに使わない。架空のデータを作る

## アプリのテスト（Node）

`src/` のデータの層（`data.ts`）・互換層（`compat.ts`）・計算は、Node だけでテストできる。Node は `.ts` の型を消してそのまま読む（D17）ので、Node.js 24 が要る（22.18 より古いと読めない）。

```bash
node --test "tests/*.test.mjs"
```

このテストは、PR を出したときと main に入ったときに、GitHub Actions でも自動で動く（[`.github/workflows/test.yml`](../../.github/workflows/test.yml)）。ローカルの Supabase が要るテストは、まだ CI では動かさない。

互換層のテストは、DB の逆の変換（`private.export_to_user_data`）の結果と比べる。DB の変換を変えたら、ローカルの Supabase でテストのデータを作り直す。

```bash
docker exec -i supabase_db_maney-app psql -U postgres -q -At -v ON_ERROR_STOP=1 < tests/fixtures/compat_fixture.sql > tests/fixtures/compat-fixture.json
```

## 結合テスト（保存を本物の DB に通す）

保存の流れを、ローカルの Supabase で実際に通すテスト（2台の端末の競合など）もある。ローカルの Supabase を起動してから実行する（起動していなければ、環境変数がないので飛ばす）。

```bash
eval "$(npx supabase status -o env | sed 's/^/export MANEY_LOCAL_/')"
node --test "tests/integration/*.test.mjs"
```

- API（PostgREST・認証）が要るので、`npx supabase start` で立てた Supabase が要る。上の「CLI が動かないとき」の Docker だけのやり方（`scripts/db-test-docker.sh`）では流せない
- **Windows の PC では `supabase.exe` がアプリケーション制御で止まる（2026-10-31〜）ので、今はこのテストを流せない。** 流すには、別のやり方（WSL に Linux を入れてその中で動かす、Docker の入った別の PC で動かす、など）を決める必要がある（2026-11-02 時点で未決定）
- `data`・`compat` を `src/` の TypeScript に移したあと（#92・#93）は、まだ流していない（docs/ROADMAP.md）

## 本番に適用する

テストが通ったマイグレーションだけを、本番に適用する。今は Supabase MCP の `apply_migration` を使っている。

- `apply_migration` は、実行した時刻をバージョンとして記録する。適用したら、`supabase_migrations.schema_migrations` の `version` をファイル名の数字に直す（リポジトリと本番の記録を合わせる）
- 本番に適用したマイグレーションのファイルは、あとから書き換えない。直すときは新しいマイグレーションを足す
- 適用したら、Supabase の Advisors（セキュリティ・パフォーマンス）を確かめる
