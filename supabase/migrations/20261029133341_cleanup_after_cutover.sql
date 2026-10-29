-- テーブル分割④ (#11): 片付け（1回目、2026-10-29）。
-- - 切り替える前の古い JSON の複製と履歴（3か所）を、1つのアーカイブ private.archive_user_data にまとめる
-- - 移行のためだけの関数を消す（切り替え済みなので、もう使わない）
-- - 使わないと決めた月次アドバイスの ai_insights テーブルを消す
-- user_data 本体は、旧版のアプリに戻す道として当面残す（書き込みは止めたまま）。
-- 問題がなければ、片付けの2回目で user_data もアーカイブにまとめて消す。

-- ============================================================
-- 古い JSON を1つのアーカイブにまとめる
-- ============================================================
create table private.archive_user_data (
  id bigint generated always as identity primary key,
  source text not null check (source in ('backup_20261029', 'user_data_history', 'backup_cutover')),
  user_data_id uuid,
  user_id uuid,
  value jsonb,
  updated_at timestamptz,     -- その版が保存された時刻
  recorded_at timestamptz,    -- 複製・履歴に入った時刻
  note text
);
comment on table private.archive_user_data is
  '切り替える前（テーブル分割 #11、2026-10-29）の user_data の複製と履歴をまとめたもの。戻し方は docs/db/RESTORE.md';
create index archive_user_data_user_id_idx on private.archive_user_data (user_id, recorded_at desc);
alter table private.archive_user_data enable row level security;

insert into private.archive_user_data (source, user_data_id, user_id, value, updated_at, recorded_at, note)
select 'backup_20261029', b.id, b.user_id, b.value, b.updated_at, b.backed_up_at, 'DB整備①（#8）で取った複製'
from private.user_data_backup_20261029 b
union all
select 'user_data_history', h.user_data_id, h.user_id, h.value, h.updated_at, h.archived_at, '上書き・削除される前の版（' || h.operation || '）'
from private.user_data_history h
union all
select 'backup_cutover', c.id, c.user_id, c.value, c.updated_at, c.backed_up_at, '切り替え（#11）の直前に取った複製'
from private.user_data_backup_cutover c;

drop trigger user_data_keep_history on public.user_data;
drop function private.user_data_keep_history();
drop table private.user_data_history;
drop table private.user_data_backup_20261029;
drop table private.user_data_backup_cutover;

-- ============================================================
-- 移行のためだけの関数（切り替え済みなので使わない。中身は Git の履歴に残っている）
-- 旧版のアプリに戻すための逆の変換（export_to_user_data・restore_user_data_from_tables）は残す
-- ============================================================
drop function private.cut_over(uuid);
drop function private.compare_migration(uuid);
drop function private.jsonb_diff(jsonb, jsonb, text);
drop function private.migrate_user_data(uuid);
drop function private.find_unmigratable(jsonb);

-- ============================================================
-- 月次アドバイス（使わないと決めた。docs/db/PLAN.md の「決まったこと」2）
-- ============================================================
drop table if exists public.ai_insights;
