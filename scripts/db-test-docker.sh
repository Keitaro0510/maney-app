#!/usr/bin/env bash
# DB のテストを、Supabase の CLI を使わずに Docker だけで流す（docs/db/LOCAL.md）。
# Windows のアプリケーション制御で supabase.exe が動かないときに使う。npx supabase test db と同じテストを流す。
#
#   bash scripts/db-test-docker.sh            # 全部のマイグレーションを流してから、全部のテストを流す
#   bash scripts/db-test-docker.sh 05_tasks   # 名前に 05_tasks を含むテストだけ流す
#
# 使うもの: Docker Desktop（動いていること）。Supabase と同じ Postgres のイメージを使う（なければ落としてくる）。
# 終わったら、作ったコンテナは消す。本番の DB には触れない。
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${POSTGRES_IMAGE:-public.ecr.aws/supabase/postgres:17.11.0.006}"
NAME="maney-db-test"
FILTER="${1:-}"

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

echo "Postgres を起動します（$IMAGE）"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5 # 最初の準備（イメージの初期化のスクリプト）が終わるのを待つ

psql_in() { docker exec -i "$NAME" psql -d postgres -v ON_ERROR_STOP=1 "$@"; }

# イメージの auth.uid() などは古い書き方（request.jwt.claim.sub だけを読む）。
# 本物の Supabase では、認証のサービス（GoTrue）が起動するときに request.jwt.claims も読む形に作り直すので、同じにする
psql_in -U supabase_admin -q <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
SQL

echo "マイグレーションを流します"
for f in supabase/migrations/*.sql; do
  if ! out=$(psql_in -U postgres --single-transaction -q < "$f" 2>&1); then
    echo "失敗: $f"; echo "$out" | tail -10; exit 1
  fi
  echo "  ok  $(basename "$f")"
done

echo "テストを流します"
failed=0
for f in supabase/tests/database/*.test.sql; do
  [[ -n "$FILTER" && "$f" != *"$FILTER"* ]] && continue
  out=$(psql_in -U postgres -At < "$f" 2>&1 || true)
  plan=$(echo "$out" | grep -m1 '^1\.\.' | cut -d. -f3 || true)
  ok=$(echo "$out" | grep -c '^ok ' || true)
  bad=$(echo "$out" | grep -c '^not ok' || true)
  if [[ -z "$plan" || "$ok" != "$plan" || "$bad" != 0 ]]; then
    failed=1
    echo "  NG  $(basename "$f")（予定 ${plan:-?} 件、通った $ok 件、落ちた $bad 件）"
    echo "$out" | grep -E '^not ok|^# |ERROR|psql:' | head -20 | sed 's/^/      /'
  else
    echo "  ok  $(basename "$f")（$ok 件）"
  fi
done

if [[ $failed != 0 ]]; then echo "落ちたテストがあります"; exit 1; fi
echo "すべて通りました"
