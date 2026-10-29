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

## テストの書き方

- `supabase/tests/database/*.test.sql` に pgTAP で書く。1つのファイルは `begin;` で始めて `rollback;` で終わるので、テストのデータは残らない
- ログインしたユーザーとして動かすときは、`set local role authenticated;` と `request.jwt.claims` を設定する（`01_tables.test.sql` を参照）
- リポジトリは公開しているので、本番のデータはテストに使わない。架空のデータを作る

## 本番に適用する

テストが通ったマイグレーションだけを、本番に適用する。今は Supabase MCP の `apply_migration` を使っている。

- `apply_migration` は、実行した時刻をバージョンとして記録する。適用したら、`supabase_migrations.schema_migrations` の `version` をファイル名の数字に直す（リポジトリと本番の記録を合わせる）
- 本番に適用したマイグレーションのファイルは、あとから書き換えない。直すときは新しいマイグレーションを足す
- 適用したら、Supabase の Advisors（セキュリティ・パフォーマンス）を確かめる
