# user_data を前の版に戻す

`user_data` が更新・削除されるたびに、前の版が `private.user_data_history` に残る（#8）。誤って上書きしたときは、ここから戻す。

- 中身が変わらない保存は残さない
- ユーザーごとに直近500版まで残し、それより古い版は消える
- `private` スキーマはアプリの公開キーからは読めない。SQL は Supabase の SQL Editor（または Supabase MCP）で実行する
- 2026-10-29 時点の全行は `private.user_data_backup_20261029` にも複製してある

## 1. 自分のユーザーIDを調べる

```sql
select id, email, last_sign_in_at from auth.users order by last_sign_in_at desc;
```

## 2. 版の一覧を見る（新しい順）

```sql
select id, archived_at, updated_at, operation,
       pg_column_size(value) as bytes,
       jsonb_array_length(value->'ledger') as ledger_count,
       jsonb_array_length(value->'plans') as plan_count
from private.user_data_history
where user_id = '<ユーザーID>'
order by id desc
limit 20;
```

- `updated_at`: その版が保存された時刻（サーバーの時刻）
- `archived_at`: その版が上書きされた時刻
- 件数（`ledger_count` など）が急に減っている版の直前が、戻したい版のことが多い

## 3. 戻す

```sql
update public.user_data
set value = (select value from private.user_data_history where id = <戻したい版のid>)
where user_id = '<ユーザーID>';
```

戻す直前の版も履歴に残るので、間違えたらもう一度戻せる。

戻したあと、アプリを開いている端末は再読み込みする。

## 2026-10-29 のバックアップから戻す

```sql
update public.user_data u
set value = b.value
from private.user_data_backup_20261029 b
where b.id = u.id and u.user_id = '<ユーザーID>';
```
