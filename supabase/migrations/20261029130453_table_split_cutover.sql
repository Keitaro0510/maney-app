-- テーブル分割③ (#11): 切り替え。設計は docs/db/TABLE_SPLIT.md の「切り替えの手順」。
-- このマイグレーションを本番に適用した時点で、user_data への書き込みが止まる（手順の2と3）。
-- そのあと、移行し直して照らし合わせ（手順4）、private.cut_over で切り替え済みを記録する（手順5）。

-- ============================================================
-- user_data への書き込みを止める
-- ============================================================

-- 旧版のアプリの保存はエラーになり、届かない（旧版のアプリは「保存できませんでした」と出し、変更を端末に残す）。
-- 次の2つだけは通す:
-- - 旧版のアプリに戻すとき（private.restore_user_data_from_tables が maney.allow_user_data_write = on にする）
-- - アカウントの削除で、user_data の行が一緒に消えるとき
create function private.block_user_data_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('maney.allow_user_data_write', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'user_data には保存できません（2026-10-29 に新しいテーブルに切り替えました）。アプリを開き直してください'
    using hint = '旧版のアプリに戻すときは private.restore_user_data_from_tables を使う（docs/db/RESTORE.md）';
end;
$$;

revoke all on function private.block_user_data_writes() from public;

create trigger block_user_data_writes
before insert or update or delete on public.user_data
for each row execute function private.block_user_data_writes();

-- ============================================================
-- 最後のバックアップ（DB 内の複製）
-- ============================================================
create table private.user_data_backup_cutover as
  select id, user_id, value, updated_at, now() as backed_up_at
  from public.user_data;

alter table private.user_data_backup_cutover enable row level security;

-- ============================================================
-- 切り替え済みを記録する
-- ============================================================

-- 照らし合わせ（private.compare_migration）がすべて一致していることを確かめてから、
-- 切り替えのときの写し（private.snapshots の reason = 'cutover'）を取り、sync_state.cut_over_at に日時を入れる。
-- 以降、移行の関数（private.migrate_user_data）は実行を拒否する。返すのは写しの id。
create function private.cut_over(p_user_id uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_failed integer;
  v_cut_over_at timestamptz;
  v_snapshot bigint;
begin
  select s.cut_over_at into v_cut_over_at from public.sync_state s where s.user_id = p_user_id for update;
  if not found then
    raise exception 'まだ移行していません: %', p_user_id;
  end if;
  if v_cut_over_at is not null then
    raise exception '切り替え済みです（%）', v_cut_over_at;
  end if;

  select count(*) into v_failed from private.compare_migration(p_user_id) where not ok;
  if v_failed > 0 then
    raise exception '照らし合わせが一致していません（%項目）。切り替えません', v_failed;
  end if;

  v_snapshot := private.take_snapshot(p_user_id, 'cutover');
  update public.sync_state set cut_over_at = now() where user_id = p_user_id;
  return v_snapshot;
end;
$$;

revoke all on function private.cut_over(uuid) from public;
