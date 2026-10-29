-- テーブル分割①-4 (#11): 戻し方（1行・1つの操作・全体の写し・旧版のアプリ）。
-- 設計は docs/db/TABLE_SPLIT.md の「戻し方」。手順は docs/db/RESTORE.md。
-- どれも private スキーマにあり、アプリからは呼べない。SQL Editor（または Supabase MCP）で管理者が実行する。

-- ============================================================
-- 共通: 行を、ある状態に戻す
-- ============================================================

-- p_row が null なら行を消す。あれば、その内容で入れる（なければ追加、あれば上書き）。
-- 登録日時は元の値を残す。更新日時はサーバーの今の時刻になる（アプリが「変わった」と気付けるように）。
create function private.put_row(p_table text, p_row_id uuid, p_row jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_columns text;
  v_updates text;
begin
  if p_row is null then
    execute format('delete from public.%I where id = $1', p_table) using p_row_id;
    return;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
           filter (where a.attname not in ('id', 'user_id', 'created_at', 'updated_at'))
  into v_columns, v_updates
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
    and p_row ? a.attname;

  perform set_config('maney.keep_created_at', 'on', true);
  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) '
    'on conflict (id) do update set %s',
    p_table, v_columns, v_columns, p_table, v_updates)
    using p_row;
  perform set_config('maney.keep_created_at', '', true);
end;
$$;

-- ============================================================
-- 1行だけ戻す
-- ============================================================

-- 履歴の1件（private.row_history の id）の、変更する前の状態に戻す。
-- 追加の履歴なら行を消し、削除の履歴なら行を作り直す。戻した変更も履歴に残る（操作 ID が付くので、取り消せる）。
create function private.restore_row(p_history_id bigint)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  h private.row_history;
  v_op_id uuid := gen_random_uuid();
begin
  select * into h from private.row_history where id = p_history_id;
  if not found then
    raise exception '履歴 % がありません', p_history_id;
  end if;

  perform set_config('maney.op_id', v_op_id::text, true);
  perform private.put_row(h.table_name, h.row_id, h.old_row);
  perform set_config('maney.op_id', '', true);
  return v_op_id;
end;
$$;

-- ============================================================
-- 1つの操作を取り消す
-- ============================================================

-- 操作 ID の変更を、新しいものから順に、変更する前の状態に戻す。
-- その操作のあとに同じ行が変わっていたら、取り消さずに止まる（p_force = true なら、それでも戻す）。
-- 取り消しも1つの操作として履歴に残る（返した操作 ID で、取り消しを取り消せる）。
create function private.undo_op(p_op_id uuid, p_force boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  h record;
  v_changed text[];
  v_undo_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from private.row_history where op_id = p_op_id) then
    raise exception '操作 % の履歴がありません（90日より前か、操作 ID が違う）', p_op_id;
  end if;

  -- その操作のあとに変わった行（今の行が、その操作の直後の状態と違う）
  select array_agg(format('%s %s', x.table_name, x.row_id)) into v_changed
  from (
    select distinct on (r.table_name, r.row_id) r.table_name, r.row_id, r.new_row
    from private.row_history r
    where r.op_id = p_op_id
    order by r.table_name, r.row_id, r.id desc
  ) as x
  where exists (
    select 1 from private.row_history later
    where later.table_name = x.table_name and later.row_id = x.row_id
      and later.id > (select max(r2.id) from private.row_history r2 where r2.op_id = p_op_id
                      and r2.table_name = x.table_name and r2.row_id = x.row_id));

  if v_changed is not null and not p_force then
    raise exception 'この操作のあとに変わった行があります: %', array_to_string(v_changed, '、')
      using hint = 'それでも戻すなら private.undo_op(操作 ID, true)';
  end if;

  perform set_config('maney.op_id', v_undo_id::text, true);
  for h in
    select r.table_name, r.row_id, r.old_row from private.row_history r
    where r.op_id = p_op_id
    order by r.id desc
  loop
    perform private.put_row(h.table_name, h.row_id, h.old_row);
  end loop;
  perform set_config('maney.op_id', '', true);
  return v_undo_id;
end;
$$;

-- ============================================================
-- 全体の写し
-- ============================================================

-- ユーザーの全テーブルの行を、1つの JSON にまとめて残す。
-- 毎日（daily）と、切り替えのとき（cutover）、全体を戻す直前（before_restore）、手で取ったとき（manual）。
create table private.snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('daily', 'cutover', 'before_restore', 'manual')),
  data jsonb not null,
  taken_at timestamptz not null default now()
);
create index snapshots_user_id_idx on private.snapshots (user_id, id desc);
alter table private.snapshots enable row level security;

-- 参照される側が先（戻すときはこの順番で入れ、逆の順番で消す）
create function private.snapshot_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'fixed_incomes', 'withdrawals', 'salary_actuals', 'card_bill_actuals']
$$;

create function private.take_snapshot(p_user_id uuid, p_reason text default 'manual')
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  t text;
  v_rows jsonb;
  v_data jsonb := '{}'::jsonb;
  v_id bigint;
begin
  for t in select unnest(private.snapshot_tables()) loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) order by x.id), ''[]'') from public.%I x where x.user_id = $1', t)
      into v_rows
      using p_user_id;
    v_data := v_data || jsonb_build_object(t, v_rows);
  end loop;

  insert into private.snapshots (user_id, reason, data) values (p_user_id, p_reason, v_data)
  returning id into v_id;
  return v_id;
end;
$$;

-- 毎日の写し（新しいテーブルを使っている人だけ）
create function private.take_daily_snapshots()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_count integer := 0;
begin
  for v_user_id in select s.user_id from public.settings s loop
    perform private.take_snapshot(v_user_id, 'daily');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 写しの時点に、ユーザーの全テーブルを1つのトランザクションで戻す。
-- 戻す直前の状態も写しに残す（返した id で、戻したのを戻せる）。
create function private.restore_snapshot(p_snapshot_id bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  s private.snapshots;
  t text;
  v_before bigint;
  v_tables text[] := private.snapshot_tables();
  v_row jsonb;
begin
  select * into s from private.snapshots where id = p_snapshot_id;
  if not found then
    raise exception '写し % がありません', p_snapshot_id;
  end if;

  v_before := private.take_snapshot(s.user_id, 'before_restore');

  -- 全体を入れ替えるので、行ごとの履歴は残さない（直前の写しで戻せる）
  perform set_config('maney.skip_history', 'on', true);

  for i in reverse cardinality(v_tables) .. 1 loop
    execute format('delete from public.%I where user_id = $1', v_tables[i]) using s.user_id;
  end loop;

  foreach t in array v_tables loop
    for v_row in select r from jsonb_array_elements(s.data -> t) as r loop
      perform private.put_row(t, (v_row ->> 'id')::uuid, v_row);
    end loop;
  end loop;

  perform set_config('maney.skip_history', '', true);
  return v_before;
end;
$$;

select cron.schedule(
  'daily-snapshots',
  '20 18 * * *',
  $$select private.take_daily_snapshots()$$
);

-- 毎日の写しと、戻す直前の写しは90日で消す。切り替えのときと、手で取った写しは残す
select cron.schedule(
  'purge-snapshots',
  '30 18 * * *',
  $$delete from private.snapshots where reason in ('daily', 'before_restore') and taken_at < now() - interval '90 days'$$
);

-- ============================================================
-- 旧版のアプリに戻す
-- ============================================================

-- テーブルの内容を、逆の変換で今の JSON の形にして user_data に書く。切り替えたあとに記録した分も、旧版のアプリで見られる。
-- user_data の前の版は private.user_data_history に残る。
-- 切り替えのとき（段階③）に user_data への書き込みを止めるトリガーを入れるが、この関数は maney.allow_user_data_write = on で通す。
create function private.restore_user_data_from_tables(p_user_id uuid)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_value jsonb := private.export_to_user_data(p_user_id);
  v_updated_at timestamptz;
begin
  if v_value is null then
    raise exception '設定（settings）の行がないので、作り直せません: %', p_user_id;
  end if;

  perform set_config('maney.allow_user_data_write', 'on', true);
  insert into public.user_data (user_id, value) values (p_user_id, v_value)
  on conflict (user_id) do update set value = excluded.value
  returning updated_at into v_updated_at;
  perform set_config('maney.allow_user_data_write', '', true);
  return v_updated_at;
end;
$$;

revoke all on function private.put_row(text, uuid, jsonb) from public;
revoke all on function private.restore_row(bigint) from public;
revoke all on function private.undo_op(uuid, boolean) from public;
revoke all on function private.snapshot_tables() from public;
revoke all on function private.take_snapshot(uuid, text) from public;
revoke all on function private.take_daily_snapshots() from public;
revoke all on function private.restore_snapshot(bigint) from public;
revoke all on function private.restore_user_data_from_tables(uuid) from public;
