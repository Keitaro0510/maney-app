-- タスク（D1・D3。ROADMAP の「進める順番」の5）: tasks テーブルと、保存・履歴・写し・復元への追加。
-- アプリは互換の st を通さず、データの層（js/data.js）で直接読み書きする（D1）。
-- テーブルの名前を並べている所（トリガー・RLS・権限、apply_op、写し）に、すべて tasks を足す（D1 の「作るときの注意」）。

-- ============================================================
-- tasks
-- ============================================================

-- タスク。期限は日付だけで、なくてもよい。completed_at が空なら、まだ終えていない（D3）。
-- 並べ方は期限の順（アプリで決める。手で並べ替えはしない）。position は、読み込みの順番（position, id）をほかのテーブルとそろえるために持つ。
-- 予定とはつながらない（D2）。予定とのひもづけ（plan_id）は Phase 6 で足す。
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  due_date date,
  completed_at timestamptz,
  memo text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tasks is 'タスク（D1・D3）。due_date は期限（なくてもよい）、completed_at は終えた日時（空なら未完了）';

-- 読み込みの順番（position, id）と、本人の行の絞り込み（RLS）に使う
create index tasks_user_position_idx on public.tasks (user_id, position, id);

-- ほかのテーブルと同じ: 登録日時・更新日時、行の履歴、本人の行だけ、ログインした人の必要な操作だけ
create trigger set_row_timestamps before insert or update on public.tasks
  for each row execute function private.set_row_timestamps();
create trigger keep_row_history after insert or update or delete on public.tasks
  for each row execute function private.keep_row_history();

alter table public.tasks enable row level security;
create policy "本人の行だけ" on public.tasks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on table public.tasks from anon, authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

-- ============================================================
-- 写しと復元
-- ============================================================

-- 写しに入れるテーブル。参照される側が先（戻すときはこの順番で入れ、逆の順番で消す）
create or replace function private.snapshot_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'fixed_incomes', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks']
$$;

-- 写しの時点に、ユーザーの全テーブルを1つのトランザクションで戻す。
-- 戻す直前の状態も写しに残す（返した id で、戻したのを戻せる）。
-- 写しに入っていないテーブルは、消さずにそのままにする（tasks を足す前の写しから戻しても、タスクは消えない）。
create or replace function private.restore_snapshot(p_snapshot_id bigint)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  s private.snapshots;
  t text;
  v_before bigint;
  v_tables text[];
  v_row jsonb;
begin
  select * into s from private.snapshots where id = p_snapshot_id;
  if not found then
    raise exception '写し % がありません', p_snapshot_id;
  end if;

  -- 写しに入っているテーブルだけを、snapshot_tables の順番で
  select array_agg(u.name order by u.ord) into v_tables
  from unnest(private.snapshot_tables()) with ordinality as u(name, ord)
  where s.data ? u.name;

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

-- ============================================================
-- apply_op（保存の関数）
-- ============================================================

-- 20261029080421_table_split_apply_op.sql と同じ。保存できるテーブル（allowed_tables）に tasks を足しただけ。
create or replace function public.apply_op(op jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allowed_tables constant text[] := array[
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'fixed_incomes', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks'];
  -- サーバーが決める列。アプリが送ってきても使わない
  server_columns constant text[] := array['id', 'user_id', 'created_at', 'updated_at'];

  v_uid uuid := auth.uid();
  v_op_id uuid;
  v_epoch integer;
  v_current_epoch integer;
  v_stored jsonb;
  v_change jsonb;
  v_index bigint;
  v_table text;
  v_action text;
  v_row_id uuid;
  v_row jsonb;
  v_seen text[] := '{}'::text[];
  v_bad_columns text;
  v_columns text;
  v_server_row jsonb;
  v_server_updated_at timestamptz;
  v_updated_at timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_writing bigint;
  v_constraint text;
  v_where text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;

  -- ---------- 操作の形を確かめる ----------
  if jsonb_typeof(op) is distinct from 'object' or jsonb_typeof(op -> 'changes') is distinct from 'array' then
    raise exception '操作の形が正しくありません' using errcode = '22023';
  end if;
  v_op_id := (op ->> 'id')::uuid;
  v_epoch := (op ->> 'epoch')::integer;
  if v_op_id is null or v_epoch is null then
    raise exception '操作に id と epoch がありません' using errcode = '22023';
  end if;
  if jsonb_array_length(op -> 'changes') not between 1 and 500 then
    raise exception '1つの操作の変更は1〜500件にしてください' using errcode = '22023';
  end if;

  -- 同じユーザーの操作は1つずつ処理する（再送と元の操作が同時に届いても、片方だけが保存される）
  perform pg_advisory_xact_lock(hashtextextended('maney.apply_op:' || v_uid::text, 0));

  -- ---------- 移行の番号 ----------
  v_current_epoch := coalesce((select s.epoch from public.sync_state s where s.user_id = v_uid), 1);
  if v_epoch <> v_current_epoch then
    return jsonb_build_object('status', 'stale_epoch', 'epoch', v_current_epoch);
  end if;

  -- ---------- 再送なら、前回の結果を返す ----------
  select a.result into v_stored from public.applied_ops a where a.user_id = v_uid and a.op_id = v_op_id;
  if v_stored is not null then
    return v_stored;
  end if;

  -- ---------- 変更を確かめ、競合を探す（まだ何も書かない） ----------
  for v_change, v_index in
    select e.value, e.ordinality from jsonb_array_elements(op -> 'changes') with ordinality as e
  loop
    v_table := v_change ->> 'table';
    v_action := v_change ->> 'action';
    v_row_id := (v_change ->> 'id')::uuid;

    if v_table is null or not (v_table = any (allowed_tables)) then
      raise exception '変更 %: テーブル % には保存できません', v_index, v_table using errcode = '22023';
    end if;
    if v_action is null or v_action not in ('insert', 'update', 'delete') then
      raise exception '変更 %: action は insert・update・delete のどれかにしてください', v_index using errcode = '22023';
    end if;
    if v_row_id is null then
      raise exception '変更 %: 行の id がありません', v_index using errcode = '22023';
    end if;
    if v_action in ('insert', 'update') and jsonb_typeof(v_change -> 'row') is distinct from 'object' then
      raise exception '変更 %: row がありません', v_index using errcode = '22023';
    end if;
    if v_action in ('update', 'delete') and v_change ->> 'base' is null then
      raise exception '変更 %: base（読み込んだときの updated_at）がありません', v_index using errcode = '22023';
    end if;
    if (v_table || ':' || v_row_id) = any (v_seen) then
      raise exception '変更 %: 同じ行を1つの操作で2回変えています', v_index using errcode = '22023';
    end if;
    v_seen := v_seen || (v_table || ':' || v_row_id);

    if v_action <> 'delete' then
      select string_agg(k, ', ') into v_bad_columns
      from jsonb_object_keys(v_change -> 'row') as k
      where not (k = any (server_columns))
        and not exists (
          select 1 from pg_catalog.pg_attribute a
          where a.attrelid = ('public.' || v_table)::regclass
            and a.attname = k and a.attnum > 0 and not a.attisdropped);
      if v_bad_columns is not null then
        raise exception '変更 %: % に列 % はありません', v_index, v_table, v_bad_columns using errcode = '22023';
      end if;
    end if;

    -- 今のサーバーの行（RLS があるので本人の行だけ）。書き込むまで、ほかの操作に変えられないようにロックする
    v_server_row := null;
    v_server_updated_at := null;
    execute format('select to_jsonb(t), t.updated_at from public.%I t where t.id = $1 for update', v_table)
      into v_server_row, v_server_updated_at
      using v_row_id;

    if v_action = 'insert' then
      if v_server_row is not null then
        v_conflicts := v_conflicts || jsonb_build_object(
          'index', v_index, 'table', v_table, 'id', v_row_id, 'reason', 'exists', 'server', v_server_row);
      end if;
    elsif v_server_row is null then
      -- 別の端末が消した行の編集は競合。すでに消えている行を消すのは成功
      if v_action = 'update' then
        v_conflicts := v_conflicts || jsonb_build_object(
          'index', v_index, 'table', v_table, 'id', v_row_id, 'reason', 'missing', 'server', null);
      end if;
    elsif v_server_updated_at <> (v_change ->> 'base')::timestamptz then
      -- 読み込んだあとに、別の端末が変えた
      v_conflicts := v_conflicts || jsonb_build_object(
        'index', v_index, 'table', v_table, 'id', v_row_id, 'reason', 'changed', 'server', v_server_row);
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object('status', 'conflict', 'conflicts', v_conflicts);
  end if;

  -- ---------- 書き込む ----------
  -- 行の履歴（private.row_history）に操作 ID を残す
  perform set_config('maney.op_id', v_op_id::text, true);

  begin
    for v_change, v_index in
      select e.value, e.ordinality from jsonb_array_elements(op -> 'changes') with ordinality as e
    loop
      v_writing := v_index;
      v_table := v_change ->> 'table';
      v_action := v_change ->> 'action';
      v_row_id := (v_change ->> 'id')::uuid;
      v_updated_at := null;

      if v_action = 'insert' then
        v_row := (v_change -> 'row') - server_columns || jsonb_build_object('id', v_row_id, 'user_id', v_uid);
        select string_agg(quote_ident(k), ', ') into v_columns from jsonb_object_keys(v_row) as k;
        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning updated_at',
          v_table, v_columns, v_columns, v_table)
          into v_updated_at
          using v_row;
      elsif v_action = 'update' then
        v_row := (v_change -> 'row') - server_columns;
        if v_row = '{}'::jsonb then
          execute format('select t.updated_at from public.%I t where t.id = $1', v_table)
            into v_updated_at
            using v_row_id;
        else
          select string_agg(quote_ident(k), ', ') into v_columns from jsonb_object_keys(v_row) as k;
          execute format(
            'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) '
            'where t.id = $2 returning t.updated_at',
            v_table, v_columns, v_columns, v_table)
            into v_updated_at
            using v_row, v_row_id;
        end if;
      else
        execute format('delete from public.%I t where t.id = $1', v_table) using v_row_id;
      end if;

      v_rows := v_rows || jsonb_build_object(
        'table', v_table, 'id', v_row_id, 'action', v_action, 'updated_at', v_updated_at);
    end loop;
  exception when unique_violation then
    -- 一意制約に当たった（例: 同じ月の給与の実績を、2台が別々に新しく登録した）。ここまでの書き込みは取り消される
    get stacked diagnostics v_constraint = constraint_name;
    v_change := op -> 'changes' -> (v_writing - 1)::integer;
    v_table := v_change ->> 'table';
    v_row_id := (v_change ->> 'id')::uuid;
    v_row := coalesce(v_change -> 'row', '{}');
    v_where := case v_table
      when 'settings' then 'true'
      when 'salary_actuals' then 't.job_id = ($1 ->> ''job_id'')::uuid and t.pay_month = ($1 ->> ''pay_month'')::date'
      when 'card_bill_actuals' then 't.card_id = ($1 ->> ''card_id'')::uuid and t.bill_month = ($1 ->> ''bill_month'')::date'
      when 'cards' then 't.name = $1 ->> ''name'' and t.deleted_at is null'
      when 'jobs' then 't.name = $1 ->> ''name'' and t.deleted_at is null'
      when 'categories' then 't.kind = $1 ->> ''kind'' and t.name = $1 ->> ''name'' and t.deleted_at is null'
      else 'false'
    end;
    v_server_row := null;
    execute format('select to_jsonb(t) from public.%I t where t.id <> $2 and %s limit 1', v_table, v_where)
      into v_server_row
      using v_row, v_row_id;
    return jsonb_build_object('status', 'conflict', 'conflicts', jsonb_build_array(jsonb_build_object(
      'index', v_writing, 'table', v_table, 'id', v_row_id, 'reason', 'duplicate',
      'constraint', v_constraint, 'server', v_server_row)));
  end;

  v_result := jsonb_build_object('status', 'applied', 'op_id', v_op_id, 'rows', v_rows);
  insert into public.applied_ops (user_id, op_id, result) values (v_uid, v_op_id, v_result);
  return v_result;
end;
$$;

comment on function public.apply_op(jsonb) is '1つの操作（複数の行の追加・更新・削除）を1つのトランザクションで保存する。docs/db/TABLE_SPLIT.md';
