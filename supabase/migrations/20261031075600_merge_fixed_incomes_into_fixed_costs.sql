-- 手順8の段4（D14）: 固定収入を、fixed_costs の kind = 'income' にまとめる。
--
-- 既存の行は同じ id・名前・金額・日を保つ。fixed_incomes は履歴と古い写しを
-- 読めるよう表だけは残すが、移行後の行は空にし、アプリは読まない。
-- データの意味が変わるので epoch を上げ、古い端末の送信待ちは保存前に止める。

-- fixed_incomes の行を fixed_costs に移す共通処理。
-- 過去の写しを戻すときにも使うので、移行本体とは分ける。
create function private.merge_fixed_incomes_to_costs(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with numbered as (
    select f.*, row_number() over (order by f.position, f.id) - 1 as offset
    from public.fixed_incomes f
    where f.user_id = p_user_id
  ), moved as (
    insert into public.fixed_costs (
      id, user_id, name, amount, day, kind, payment_method, card_id,
      start_month, end_month, legacy_id, position, created_at, updated_at
    )
    select n.id, n.user_id, n.name, n.amount, n.day, 'income', null, null,
      null, null, null,
      coalesce((select max(c.position) + 1 from public.fixed_costs c where c.user_id = p_user_id), 0) + n.offset,
      n.created_at, n.updated_at
    from numbered n
    returning id
  ), deleted as (
    delete from public.fixed_incomes f
    where f.id in (select id from moved)
    returning f.id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

-- 既に端末へ読み込んだ古い固定収入の操作を、変換後のデータへ重ねないようにする。
insert into public.sync_state (user_id, epoch, migrated_at)
select distinct f.user_id, 2, now()
from public.fixed_incomes f
on conflict (user_id) do update
set epoch = public.sync_state.epoch + 1,
    migrated_at = excluded.migrated_at;

-- 行の履歴・全体の写しを戻すとき、移行前の fixed_incomes を指定しても
-- 変換後の fixed_costs を戻す。過去90日間の「元に戻す」も使い続けられる。
create or replace function private.put_row(p_table text, p_row_id uuid, p_row jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_table text := p_table;
  v_row jsonb := p_row;
  v_columns text;
  v_updates text;
  v_position integer;
begin
  if p_table = 'fixed_incomes' then
    v_table := 'fixed_costs';
    if v_row is not null then
      select c.position into v_position from public.fixed_costs c where c.id = p_row_id;
      if v_position is null then
        select coalesce(max(c.position), -1) + 1 into v_position
        from public.fixed_costs c
        where c.user_id = (v_row ->> 'user_id')::uuid;
      end if;
      v_row := v_row || jsonb_build_object(
        'kind', 'income', 'payment_method', null, 'card_id', null,
        'start_month', null, 'end_month', null, 'legacy_id', null, 'position', v_position
      );
    end if;
  end if;

  if v_row is null then
    execute format('delete from public.%I where id = $1', v_table) using p_row_id;
    return;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
           filter (where a.attname not in ('id', 'user_id', 'created_at', 'updated_at'))
  into v_columns, v_updates
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || v_table)::regclass and a.attnum > 0 and not a.attisdropped
    and v_row ? a.attname;

  perform set_config('maney.keep_created_at', 'on', true);
  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) '
    'on conflict (id) do update set %s',
    v_table, v_columns, v_columns, v_table, v_updates)
    using v_row;
  perform set_config('maney.keep_created_at', '', true);
end;
$$;

-- 移行前の全体の写しを戻しても、fixed_incomes を fixed_costs に変換してから使う。
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

  select array_agg(u.name order by u.ord) into v_tables
  from unnest(private.snapshot_tables()) with ordinality as u(name, ord)
  where s.data ? u.name;

  v_before := private.take_snapshot(s.user_id, 'before_restore');
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

-- 移行そのものでは行ごとの履歴を増やさない。直前に手で取る全体の写しから戻せる。
do $$
declare
  v_user_id uuid;
begin
  perform set_config('maney.skip_history', 'on', true);
  for v_user_id in select distinct user_id from public.fixed_incomes loop
    perform private.merge_fixed_incomes_to_costs(v_user_id);
  end loop;
  perform set_config('maney.skip_history', '', true);
end;
$$;

revoke all on function private.merge_fixed_incomes_to_costs(uuid) from public;
