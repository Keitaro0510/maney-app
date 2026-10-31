# 戻し方

データを誤って変えた・消したときに、前の状態に戻す手順。データの構造は [SCHEMA.md](SCHEMA.md)、戻し方の設計は [TABLE_SPLIT.md](TABLE_SPLIT.md) の「戻し方」。

- 関数はどれも `private` スキーマにあり、アプリの公開キーからは呼べない。SQL は Supabase の SQL Editor（または Supabase MCP）で実行する
- 戻したあと、アプリを開いている端末は開き直す（戻した行は `updated_at` が新しくなるので、送れていない変更があれば競合として知らせる）

## 自分のユーザーIDを調べる

```sql
select id, email, last_sign_in_at from auth.users order by last_sign_in_at desc;
```

## 1行だけ戻す

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

## 1つの操作を取り消す

アプリの1回の操作（例: シフトの一括登録）を、まとめて取り消す。操作 ID は履歴の `op_id`。

```sql
select private.undo_op('<操作 ID>');
```

- その操作のあとに同じ行が変わっていたら、取り消さずに止まる。それでも戻すなら `private.undo_op('<操作 ID>', true)`
- 取り消しも1つの操作として履歴に残る。返ってきた操作 ID で、取り消しを取り消せる

## 全体を、ある時点に戻す

写し（`private.snapshots`）は毎日 3:20（日本時間）に取る。切り替えのとき（2026-10-29 22:10、id 5）の写しもある。

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
- 写しに入っていないテーブルは、消さずにそのままにする。`tasks` は 2026-10-31 に写しに入れ始めたので、それより前の写しから戻しても、タスクは今のまま残る
- 毎日の写しと、戻す直前・読み込む直前の写しは90日で消える。切り替えのときと、手で取った写しは残る

## 書き出したファイル（JSON）から戻す

アプリの設定の「データの書き出し・読み込み」で書き出したファイル（`maney-export-YYYY-MM-DD.json`）があれば、SQL を使わずにアプリから戻せる（D13）。

1. 設定の「ファイルから読み込む」でファイルを選ぶ
2. 確かめの画面で、書き出した日時と、テーブルごとの件数（ファイルと今）を見る。ファイルのほうが少ない所は赤くなる
3. 「置き換える」を押す。今のデータは、すべてファイルの中身に置き換わる

- 置き換えは1つのトランザクションで行う（DB の `public.import_backup`）。途中で止まったら、何も変わらない
- 読み込む直前の状態は、写し（`before_import`）に残る。終わったときの知らせに出る番号（`#123` など）で、読み込む前に戻せる: `select private.restore_snapshot(<その番号>);`
- 移行の番号（epoch）が上がるので、ほかの端末で送れていなかった変更は保存できなくなる（「サーバーのデータが移し直された」と出る）。ほかの端末は開き直す
- ファイルの `user_id`・`created_at`・`updated_at` は使わない（書き出すときにも入れない）。登録日時は、読み込んだ時刻になる

```sql
-- 読み込む直前の写し
select id, taken_at, jsonb_array_length(data -> 'ledger_entries') as ledger_count
from private.snapshots
where user_id = '<ユーザーID>' and reason = 'before_import'
order by id desc;
```

## 旧版のアプリ（切り替える前の版）に戻す

新しい版に大きな問題が見つかったときの、最後の手段。切り替えたあとに記録した分も、旧版のアプリで見られる。

1. テーブルの内容を、切り替える前の JSON の形にして `user_data` に書く

   ```sql
   select private.restore_user_data_from_tables('<ユーザーID>');
   ```

2. `user_data` への書き込みを止めているトリガーを外す（旧版のアプリが保存できるように）

   ```sql
   alter table public.user_data disable trigger block_user_data_writes;
   ```

3. `index.html`・`sw.js`・`js/` を切り替える前の版に戻す。切り替えの PR（#29）を `git revert` して PR にする。`sw.js` の `CACHE_NAME` は上げる
4. 新しいテーブルに書いている端末がないことを確かめる（戻したあとに新しいテーブルに書かれた分は、旧版のアプリには出ない）

`user_data` は、片付けの2回目（問題がなければ1〜2週間後）で消す予定。消したあとは、1の前に `user_data` のテーブルを作り直す（[`supabase/migrations/20260101000000_user_data_baseline.sql`](../../supabase/migrations/20260101000000_user_data_baseline.sql)）。

## 切り替える前の古い JSON

切り替える前の `user_data` の複製と履歴は、`private.archive_user_data` にまとめてある（2026-10-29）。手元にも JSON のファイル（`maney-user_data-before-cutover-2026-10-29.json`）を保存した。

| `source` | 中身 |
|---|---|
| `backup_20261029` | DB整備①（#8）で取った複製（2026-10-29 の朝） |
| `user_data_history` | 上書き・削除される前の版（#8 から切り替えまで） |
| `backup_cutover` | 切り替えの直前に取った複製（最後の版） |

```sql
-- 版の一覧（新しい順）
select id, source, recorded_at, updated_at,
       jsonb_array_length(value -> 'ledger') as ledger_count,
       jsonb_array_length(value -> 'plans') as plan_count
from private.archive_user_data
where user_id = '<ユーザーID>'
order by recorded_at desc;
```

旧版のアプリに戻すときに、テーブルの内容ではなく、ある版の JSON を使いたいなら、`user_data` に入れる（書き込みを止めているので、そのトランザクションでだけ許す）。

```sql
begin;
select set_config('maney.allow_user_data_write', 'on', true);
update public.user_data
set value = (select value from private.archive_user_data where id = <版の id>)
where user_id = '<ユーザーID>';
commit;
```
