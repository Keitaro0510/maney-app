-- 空になった固定収入の表（fixed_incomes）を消す（D14 の片付け）。
-- 固定収入は段4（20261031081741_merge_fixed_incomes_into_fixed_costs.sql）で、固定費の「収入」（fixed_costs の kind = 'income'）にまとめた。
-- 2026-11-01 に本番を確かめた: 表は0行、行の履歴にも0件、写しの fixed_incomes の欄はすべて空。消しても失うデータはない。
--
-- 表の名前を並べている所から外す:
-- - 写しのテーブル（private.snapshot_tables）。前の写しに残っている空の fixed_incomes の欄は、戻すときに読まない
-- - 読み込みのテーブル（private.import_tables）は、写しのテーブルと同じになる
-- - 保存の関数（apply_op）で保存できるテーブル
-- - 旧版のアプリに戻す変換（export_to_user_data）は、fixedIncs を空にする
-- 移し替えの関数（merge_fixed_incomes_to_costs）は、もう使わないので消す。
-- 1行だけ戻す（put_row）の、fixed_incomes を fixed_costs に変える部分は残す（その表に触れないので、表がなくても動く）

drop function private.merge_fixed_incomes_to_costs(uuid);

-- ============================================================
-- 写しと読み込みのテーブル
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
    'fixed_costs', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks']
$$;

-- 書き出したファイルから読み込むテーブル（D13）。写しのテーブルと同じ。アプリの MoneyData.TABLES と同じ
create or replace function private.import_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select private.snapshot_tables()
$$;

-- ============================================================
-- 旧版のアプリに戻す変換（20261029080818_table_split_migrate.sql と同じ。fixedIncs を空にしただけ）
-- ============================================================

create or replace function private.export_to_user_data(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  card_list as (
    select k.*, (row_number() over (order by k.position, k.id) - 1)::integer as idx
    from public.cards k where k.user_id = p_user_id
  ),
  actuals as (
    select a.position, 0 as kind_order, a.id, jsonb_build_object(
      'type', 'card',
      'cardKey', format('card-%s-%s', k.idx, to_char(a.bill_month, 'YYYY-MM')),
      'cardIdx', k.idx,
      'billY', extract(year from a.bill_month)::integer,
      'billM', extract(month from a.bill_month)::integer - 1,
      'actualAmount', a.actual_amount,
      'estimatedAmount', a.estimated_amount) as item
    from public.card_bill_actuals a join card_list k on k.id = a.card_id
    where a.user_id = p_user_id
    union all
    select a.position, 1, a.id, jsonb_build_object(
      'type', 'shift',
      'job', j.name,
      'salaryKey', j.name || '|' || to_char(a.pay_month, 'YYYY-MM'),
      'date', to_char(a.paid_on, 'YYYY-MM-DD'),
      'actualAmount', a.actual_amount,
      'estimatedAmount', a.estimated_amount)
    from public.salary_actuals a join public.jobs j on j.id = a.job_id
    where a.user_id = p_user_id
  )
  select jsonb_build_object(
    'acctBase', s.acct_base,
    'baseDate', to_char(s.base_date, 'YYYY-MM-DD'),
    'budget', s.budget,
    'otherIncome', s.other_income,
    'shiftCloseDay', s.shift_close_day,
    'shiftPayDay', s.shift_pay_day,
    'fuyouLimit', s.fuyou_limit,

    -- 今のアプリはカードの締め日・引き落とし日を文字列で保存している
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', k.name, 'closeDay', k.close_day::text, 'billDay', k.bill_day::text) order by k.idx)
      from card_list k), '[]'),

    'jobs', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', j.name, 'wage', j.wage, 'color', j.color,
        'nightStart', to_char(j.night_start, 'HH24:MI'), 'nightRate', j.night_rate, 'transport', j.transport,
        'closeDay', j.close_day, 'payDay', j.pay_day)) order by j.position, j.id)
      from public.jobs j where j.user_id = p_user_id), '[]'),

    'catExp', coalesce((
      select jsonb_agg(c.name order by c.position, c.id) from public.categories c
      where c.user_id = p_user_id and c.kind = 'expense' and c.deleted_at is null), '[]'),
    'catInc', coalesce((
      select jsonb_agg(c.name order by c.position, c.id) from public.categories c
      where c.user_id = p_user_id and c.kind = 'income' and c.deleted_at is null), '[]'),

    'ledger', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'date', to_char(l.date, 'YYYY-MM-DD'), 'amount', l.amount, 'name', l.name, 'cat', c.name, 'type', l.kind,
        'pay', case when l.payment_method = 'card' then k.name else '現金' end,
        'memo', l.memo,
        'cardIdx', k.idx,
        'receive', case when l.kind = 'income' then case l.payment_method when 'bank' then '口座振込' else '現金' end end
        )) order by l.position, l.id)
      from public.ledger_entries l
      join public.categories c on c.id = l.category_id
      left join card_list k on k.id = l.card_id
      where l.user_id = p_user_id), '[]'),

    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job', j.name, 'date', to_char(sh.date, 'YYYY-MM-DD'),
        'start', to_char(sh.start_time, 'HH24:MI'), 'end', to_char(sh.end_time, 'HH24:MI'),
        'rest', sh.rest_minutes, 'wage', sh.wage) order by sh.position, sh.id)
      from public.shifts sh join public.jobs j on j.id = sh.job_id
      where sh.user_id = p_user_id), '[]'),

    'plans', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', coalesce(p.legacy_id, (extract(epoch from p.created_at) * 1000)::bigint),
        'title', p.title,
        'date', to_char(p.start_date, 'YYYY-MM-DD'),
        'dateStart', to_char(p.start_date, 'YYYY-MM-DD'),
        'dateEnd', to_char(p.end_date, 'YYYY-MM-DD'),
        'timeStart', coalesce(to_char(p.start_time, 'HH24:MI'), ''),
        'timeEnd', coalesce(to_char(p.end_time, 'HH24:MI'), ''),
        'budget', p.budget, 'memo', p.memo, 'color', p.color, 'done', p.done,
        'planCardIdx', k.idx)) order by p.position, p.id)
      from public.plans p left join card_list k on k.id = p.card_id
      where p.user_id = p_user_id), '[]'),

    'fixedCosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', coalesce(f.legacy_id, (extract(epoch from f.created_at) * 1000)::bigint),
        'name', f.name, 'amount', f.amount, 'day', f.day, 'type', f.kind,
        'pay', case
          when f.kind = 'income' then 'income'
          when f.payment_method = 'card' then 'card-' || k.idx
          else f.payment_method
        end) order by f.position, f.id)
      from public.fixed_costs f left join card_list k on k.id = f.card_id
      where f.user_id = p_user_id), '[]'),

    -- 固定収入は固定費の「収入」（fixedCosts の type: income）にまとめたので、空にする（旧版のアプリも固定費の収入を読める）
    'fixedIncs', '[]'::jsonb,

    'wds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(w.date, 'YYYY-MM-DD'), 'amount', w.amount) order by w.position, w.id)
      from public.withdrawals w where w.user_id = p_user_id), '[]'),

    'actualInputs', coalesce((
      select jsonb_agg(a.item order by a.position, a.kind_order, a.id) from actuals a), '[]')
  )
  from public.settings s
  where s.user_id = p_user_id
$$;

-- ============================================================
-- apply_op（20261030170903_tasks.sql と同じ。保存できるテーブルから fixed_incomes を外しただけ）
-- ============================================================

create or replace function public.apply_op(op jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allowed_tables constant text[] := array[
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks'];
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

-- ============================================================
-- 表を消す（トリガー・RLS のポリシー・インデックスも一緒に消える）
-- ============================================================

drop table public.fixed_incomes;
