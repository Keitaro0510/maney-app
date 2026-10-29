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

## 新しいテーブル（#11）を戻す

テーブル分割（#11）のあとの戻し方。関数はどれも `private` スキーマにあり、SQL Editor（または Supabase MCP）で実行する。
設計は [TABLE_SPLIT.md](TABLE_SPLIT.md) の「戻し方」。

### 1行だけ戻す

行の履歴（`private.row_history`、90日分）から、ある変更の前の状態に戻す。

```sql
-- 行の履歴を見る（新しい順）
select id, changed_at, table_name, action, op_id, old_row, new_row
from private.row_history
where user_id = '<ユーザーID>' and table_name = 'ledger_entries'
order by id desc
limit 20;

-- その変更の前の状態に戻す（追加の履歴なら行を消し、削除の履歴なら作り直す）
select private.restore_row(<履歴の id>);
```

### 1つの操作を取り消す

アプリの1回の操作（例: シフトの一括登録）を、まとめて取り消す。操作 ID は履歴の `op_id`。

```sql
select private.undo_op('<操作 ID>');
```

- その操作のあとに同じ行が変わっていたら、取り消さずに止まる。それでも戻すなら `private.undo_op('<操作 ID>', true)`
- 取り消しも1つの操作として履歴に残る。返ってきた操作 ID で、取り消しを取り消せる

### 全体を、ある時点に戻す

写し（`private.snapshots`）は毎日 3:20（日本時間）に取る。切り替えのときにも取る。

```sql
-- 写しの一覧
select id, reason, taken_at, jsonb_array_length(data -> 'ledger_entries') as ledger_count
from private.snapshots
where user_id = '<ユーザーID>'
order by id desc;

-- 今の状態を手で写しておく
select private.take_snapshot('<ユーザーID>', 'manual');

-- 写しの時点に戻す（全テーブルを1つのトランザクションで入れ替える）
select private.restore_snapshot(<写しの id>);
```

- 戻す直前の状態も写し（`before_restore`）に残る。返ってきた id で、戻したのを戻せる
- 毎日の写しと、戻す直前の写しは90日で消える。切り替えのときと、手で取った写しは残る

### 旧版のアプリに戻す

テーブルの内容を今の JSON の形に戻して、`user_data` に書く。切り替えたあとに記録した分も、旧版のアプリで見られる。

```sql
select private.restore_user_data_from_tables('<ユーザーID>');
```

`user_data` の前の版は `private.user_data_history` に残る。

切り替えたあと（2026-10-29〜）は、`user_data` への書き込みをトリガーで止めている。旧版のアプリを本当に使い続けるなら、次の3つも行う。

1. 書き込みを止めるトリガーを外す: `alter table public.user_data disable trigger block_user_data_writes;`
2. `index.html`・`sw.js` を切り替える前の版に戻す（切り替えの PR を `git revert` して PR にする。`sw.js` の `CACHE_NAME` は上げる）
3. 新しいテーブルに書いている端末がないことを確かめる（戻したあとに新しいテーブルに書かれた分は、旧版のアプリには出ない）
