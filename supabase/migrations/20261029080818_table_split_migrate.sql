-- テーブル分割①-3 (#11): 移行の関数・逆の変換・照らし合わせ。
-- 設計は docs/db/TABLE_SPLIT.md の「今のデータの移し方」「照らし合わせ」。
-- どれも private スキーマにあり、アプリからは呼べない。SQL Editor（または Supabase MCP）で管理者が実行する。
--
--   select private.migrate_user_data('<ユーザーID>');                  -- user_data → テーブル
--   select private.export_to_user_data('<ユーザーID>');                -- テーブル → 今の JSON の形
--   select * from private.compare_migration('<ユーザーID>') where not ok;  -- 照らし合わせ（0行なら一致）

-- ============================================================
-- 移せない形の記録を探す
-- ============================================================

-- 移行の関数が推測で埋めないように、今のアプリが作る形だけを受け付ける。問題があれば、場所の一覧を返す。
create function private.find_unmigratable(v jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(problem order by problem), '{}')
  from (
    -- 家計簿: 支出は「現金」かカード（cardIdx と、そのカードの名前）。収入は pay が「現金」で、受け取り方法がある
    select format('ledger[%s]: 支払い方法の形が違う', o - 1) as problem
    from jsonb_array_elements(v -> 'ledger') with ordinality as e(l, o)
    where not coalesce(
      case l ->> 'type'
        when 'expense' then not l ? 'receive' and (
          (l ? 'cardIdx' and l ->> 'pay' = v -> 'cards' -> (l ->> 'cardIdx')::integer ->> 'name')
          or (not l ? 'cardIdx' and l ->> 'pay' = '現金'))
        when 'income' then not l ? 'cardIdx' and l ->> 'pay' = '現金' and l ->> 'receive' in ('口座振込', '現金')
        else false
      end, false)
    union all
    -- シフト: バイト先があり、休憩の項目がある
    select format('shifts[%s]: バイト先 %s がないか、休憩（rest）がない', o - 1, s ->> 'job')
    from jsonb_array_elements(v -> 'shifts') with ordinality as e(s, o)
    where not s ? 'rest'
       or not exists (select 1 from jsonb_array_elements(v -> 'jobs') j where j ->> 'name' = s ->> 'job')
    union all
    -- 予定: カード払いならそのカードがある
    select format('plans[%s]: カード %s がない', o - 1, p ->> 'planCardIdx')
    from jsonb_array_elements(v -> 'plans') with ordinality as e(p, o)
    where p ? 'planCardIdx' and v -> 'cards' -> (p ->> 'planCardIdx')::integer is null
    union all
    -- 固定費: 入金は pay が income。引き落としは bank・cash・card-<番号>（そのカードがある）
    select format('fixedCosts[%s]: 支払い方法 %s の形が違う', o - 1, f ->> 'pay')
    from jsonb_array_elements(v -> 'fixedCosts') with ordinality as e(f, o)
    where not coalesce(
      case f ->> 'type'
        when 'income' then f ->> 'pay' = 'income'
        when 'expense' then
          case
            when f ->> 'pay' in ('bank', 'cash') then true
            when f ->> 'pay' ~ '^card-[0-9]+$' then v -> 'cards' -> substr(f ->> 'pay', 6)::integer is not null
            else false
          end
        else false
      end, false)
    union all
    -- 実績: カードは cardKey が cardIdx・billY・billM と合う。給与は salaryKey が「バイト先|支払月」で、そのバイト先がある
    select format('actualInputs[%s]: 形が違う', o - 1)
    from jsonb_array_elements(v -> 'actualInputs') with ordinality as e(a, o)
    where not coalesce(
      case a ->> 'type'
        when 'card' then v -> 'cards' -> (a ->> 'cardIdx')::integer is not null
          and a ->> 'cardKey' = format('card-%s-%s-%s', a ->> 'cardIdx', a ->> 'billY', lpad(((a ->> 'billM')::integer + 1)::text, 2, '0'))
        when 'shift' then a ->> 'salaryKey' ~ '\|[0-9]{4}-[0-9]{2}$'
          and a ->> 'salaryKey' = (a ->> 'job') || '|' || right(a ->> 'salaryKey', 7)
          and exists (select 1 from jsonb_array_elements(v -> 'jobs') j where j ->> 'name' = a ->> 'job')
        else false
      end, false)
  ) as problems
$$;

-- ============================================================
-- 移行（user_data → テーブル）
-- ============================================================

-- 切り替える前は何度でも流し直せる（そのユーザーの行を消してから入れ直す）。流すたびに移行の番号を上げる。
-- 切り替え済み（sync_state.cut_over_at がある）なら実行しない。
create function private.migrate_user_data(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb;
  v_cut_over_at timestamptz;
  v_problems text[];
  v_epoch integer;
begin
  select u.value into v from public.user_data u where u.user_id = p_user_id;
  if v is null then
    raise exception 'user_data がありません: %', p_user_id;
  end if;

  select s.cut_over_at into v_cut_over_at from public.sync_state s where s.user_id = p_user_id for update;
  if v_cut_over_at is not null then
    raise exception '切り替え済み（%）なので、移行し直せません', v_cut_over_at;
  end if;

  v_problems := private.find_unmigratable(v);
  if cardinality(v_problems) > 0 then
    raise exception '移せない形の記録があります（%件）: %', cardinality(v_problems), array_to_string(v_problems, '、');
  end if;

  -- 入れ直す行は履歴に残さない
  perform set_config('maney.skip_history', 'on', true);

  -- そのユーザーの行を消す（参照する側から）
  delete from public.salary_actuals where user_id = p_user_id;
  delete from public.card_bill_actuals where user_id = p_user_id;
  delete from public.ledger_entries where user_id = p_user_id;
  delete from public.shifts where user_id = p_user_id;
  delete from public.plans where user_id = p_user_id;
  delete from public.fixed_costs where user_id = p_user_id;
  delete from public.fixed_incomes where user_id = p_user_id;
  delete from public.withdrawals where user_id = p_user_id;
  delete from public.categories where user_id = p_user_id;
  delete from public.jobs where user_id = p_user_id;
  delete from public.cards where user_id = p_user_id;
  delete from public.settings where user_id = p_user_id;
  delete from public.applied_ops where user_id = p_user_id;

  -- 設定
  insert into public.settings (
    user_id, acct_base, base_date, budget, other_income, shift_close_day, shift_pay_day, fuyou_limit)
  values (
    p_user_id, (v ->> 'acctBase')::integer, (v ->> 'baseDate')::date, (v ->> 'budget')::integer,
    (v ->> 'otherIncome')::integer, (v ->> 'shiftCloseDay')::smallint, (v ->> 'shiftPayDay')::smallint,
    v ->> 'fuyouLimit');

  -- カード（配列の番号 = position。記録からはこの番号で探す）
  insert into public.cards (user_id, name, close_day, bill_day, position)
  select p_user_id, c ->> 'name', (c ->> 'closeDay')::smallint, (c ->> 'billDay')::smallint, (o - 1)::integer
  from jsonb_array_elements(v -> 'cards') with ordinality as e(c, o);

  -- バイト先（記録からは名前で探す）
  insert into public.jobs (
    user_id, name, color, wage, night_start, night_rate, transport, close_day, pay_day, position)
  select p_user_id, j ->> 'name', j ->> 'color', (j ->> 'wage')::integer, (j ->> 'nightStart')::time,
    (j ->> 'nightRate')::integer, (j ->> 'transport')::integer, (j ->> 'closeDay')::smallint,
    (j ->> 'payDay')::smallint, (o - 1)::integer
  from jsonb_array_elements(v -> 'jobs') with ordinality as e(j, o);

  -- カテゴリ（catExp・catInc の並び）
  insert into public.categories (user_id, kind, name, position)
  select p_user_id, 'expense', c #>> '{}', (o - 1)::integer
  from jsonb_array_elements(v -> 'catExp') with ordinality as e(c, o)
  union all
  select p_user_id, 'income', c #>> '{}', (o - 1)::integer
  from jsonb_array_elements(v -> 'catInc') with ordinality as e(c, o);

  -- 一覧から消したが、記録には名前が残っているカテゴリは「削除済み」として作る
  insert into public.categories (user_id, kind, name, position, deleted_at)
  select p_user_id, x.kind, x.name,
    (select coalesce(max(c.position), -1) from public.categories c where c.user_id = p_user_id and c.kind = x.kind)
      + row_number() over (partition by x.kind order by x.name),
    now()
  from (
    select distinct l ->> 'type' as kind, l ->> 'cat' as name
    from jsonb_array_elements(v -> 'ledger') l
  ) as x
  where not exists (
    select 1 from public.categories c where c.user_id = p_user_id and c.kind = x.kind and c.name = x.name);

  -- 家計簿
  insert into public.ledger_entries (
    user_id, date, kind, amount, name, memo, category_id, payment_method, card_id, position)
  select p_user_id, (l ->> 'date')::date, l ->> 'type', (l ->> 'amount')::integer, l ->> 'name', l ->> 'memo',
    (select c.id from public.categories c
     where c.user_id = p_user_id and c.kind = l ->> 'type' and c.name = l ->> 'cat'),
    case
      when l ? 'cardIdx' then 'card'
      when l ->> 'receive' = '口座振込' then 'bank'
      else 'cash'
    end,
    (select k.id from public.cards k where k.user_id = p_user_id and k.position = (l ->> 'cardIdx')::integer),
    (o - 1)::integer
  from jsonb_array_elements(v -> 'ledger') with ordinality as e(l, o);

  -- シフト
  insert into public.shifts (user_id, date, job_id, start_time, end_time, wage, rest_minutes, position)
  select p_user_id, (s ->> 'date')::date,
    (select j.id from public.jobs j where j.user_id = p_user_id and j.name = s ->> 'job'),
    (s ->> 'start')::time, (s ->> 'end')::time, (s ->> 'wage')::integer, (s ->> 'rest')::integer, (o - 1)::integer
  from jsonb_array_elements(v -> 'shifts') with ordinality as e(s, o);

  -- 予定（date は dateStart と同じなので持たない。時刻の '' は終日）
  insert into public.plans (
    user_id, title, start_date, end_date, start_time, end_time, budget, done, memo, color, card_id, legacy_id, position)
  select p_user_id, p ->> 'title', (p ->> 'dateStart')::date, (p ->> 'dateEnd')::date,
    nullif(p ->> 'timeStart', '')::time, nullif(p ->> 'timeEnd', '')::time,
    (p ->> 'budget')::integer, (p ->> 'done')::boolean, p ->> 'memo', p ->> 'color',
    (select k.id from public.cards k where k.user_id = p_user_id and k.position = (p ->> 'planCardIdx')::integer),
    (p ->> 'id')::bigint, (o - 1)::integer
  from jsonb_array_elements(v -> 'plans') with ordinality as e(p, o);

  -- 固定費（pay: bank・cash・card-<番号>・income）
  insert into public.fixed_costs (
    user_id, name, amount, day, kind, payment_method, card_id, legacy_id, position)
  select p_user_id, f ->> 'name', (f ->> 'amount')::integer, (f ->> 'day')::smallint, f ->> 'type',
    case when f ->> 'pay' = 'income' then null when f ->> 'pay' like 'card-%' then 'card' else f ->> 'pay' end,
    case when f ->> 'pay' like 'card-%' then
      (select k.id from public.cards k where k.user_id = p_user_id and k.position = substr(f ->> 'pay', 6)::integer)
    end,
    (f ->> 'id')::bigint, (o - 1)::integer
  from jsonb_array_elements(v -> 'fixedCosts') with ordinality as e(f, o);

  -- 固定収入（今のアプリは金額と日を文字列で保存している）
  insert into public.fixed_incomes (user_id, name, amount, day, position)
  select p_user_id, f ->> 'name', (f ->> 'amount')::integer, (f ->> 'day')::smallint, (o - 1)::integer
  from jsonb_array_elements(v -> 'fixedIncs') with ordinality as e(f, o);

  -- ATM の引き出し
  insert into public.withdrawals (user_id, date, amount, position)
  select p_user_id, (w ->> 'date')::date, (w ->> 'amount')::integer, (o - 1)::integer
  from jsonb_array_elements(v -> 'wds') with ordinality as e(w, o);

  -- 実績（2つのテーブルで position を共通にして、今の配列の順番を残す）
  insert into public.card_bill_actuals (user_id, card_id, bill_month, actual_amount, estimated_amount, position)
  select p_user_id,
    (select k.id from public.cards k where k.user_id = p_user_id and k.position = (a ->> 'cardIdx')::integer),
    make_date((a ->> 'billY')::integer, (a ->> 'billM')::integer + 1, 1),
    (a ->> 'actualAmount')::integer, (a ->> 'estimatedAmount')::integer, (o - 1)::integer
  from jsonb_array_elements(v -> 'actualInputs') with ordinality as e(a, o)
  where a ->> 'type' = 'card';

  insert into public.salary_actuals (
    user_id, job_id, pay_month, paid_on, actual_amount, estimated_amount, position)
  select p_user_id,
    (select j.id from public.jobs j where j.user_id = p_user_id and j.name = a ->> 'job'),
    (right(a ->> 'salaryKey', 7) || '-01')::date, (a ->> 'date')::date,
    (a ->> 'actualAmount')::integer, (a ->> 'estimatedAmount')::integer, (o - 1)::integer
  from jsonb_array_elements(v -> 'actualInputs') with ordinality as e(a, o)
  where a ->> 'type' = 'shift';

  perform set_config('maney.skip_history', '', true);

  -- 移行の番号を上げる（行がなければ 2。アプリの既定の 1 と違う番号にする）
  insert into public.sync_state (user_id, epoch, migrated_at) values (p_user_id, 2, now())
  on conflict (user_id) do update set epoch = public.sync_state.epoch + 1, migrated_at = excluded.migrated_at
  returning epoch into v_epoch;

  return jsonb_build_object(
    'epoch', v_epoch,
    'cards', (select count(*) from public.cards where user_id = p_user_id),
    'jobs', (select count(*) from public.jobs where user_id = p_user_id),
    'categories', (select count(*) from public.categories where user_id = p_user_id),
    'ledger_entries', (select count(*) from public.ledger_entries where user_id = p_user_id),
    'shifts', (select count(*) from public.shifts where user_id = p_user_id),
    'plans', (select count(*) from public.plans where user_id = p_user_id),
    'fixed_costs', (select count(*) from public.fixed_costs where user_id = p_user_id),
    'fixed_incomes', (select count(*) from public.fixed_incomes where user_id = p_user_id),
    'withdrawals', (select count(*) from public.withdrawals where user_id = p_user_id),
    'salary_actuals', (select count(*) from public.salary_actuals where user_id = p_user_id),
    'card_bill_actuals', (select count(*) from public.card_bill_actuals where user_id = p_user_id));
end;
$$;

-- ============================================================
-- 逆の変換（テーブル → 今の JSON の形）
-- ============================================================

-- 旧版のアプリに戻すとき（user_data を作り直す）と、照らし合わせに使う。
-- - カード・バイト先は削除済みのものも含める（記録が参照しているため。旧版のアプリには「削除済み」がない）
-- - カテゴリの一覧（catExp・catInc）には削除済みのものを含めない（記録には名前だけが残る。旧版のアプリと同じ）
-- - 予定と固定費の id は、移した行は元の数値（legacy_id）、新しい行は登録日時（ミリ秒）
create function private.export_to_user_data(p_user_id uuid)
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

    -- 今のアプリは固定収入の金額と日を文字列で保存している
    'fixedIncs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', f.name, 'amount', f.amount::text, 'day', f.day::text) order by f.position, f.id)
      from public.fixed_incomes f where f.user_id = p_user_id), '[]'),

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
-- 照らし合わせ
-- ============================================================

-- 2つの JSON の違う場所を、パス（例: .ledger[12].memo）ごとに返す
create function private.jsonb_diff(a jsonb, b jsonb, path text default '')
returns table (diff_path text, expected jsonb, actual jsonb)
language plpgsql
stable
set search_path = ''
as $$
begin
  if a is not distinct from b then
    return;
  end if;
  if jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    return query
      select d.*
      from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) as keys,
        lateral private.jsonb_diff(a -> keys.k, b -> keys.k, path || '.' || keys.k) as d;
  elsif jsonb_typeof(a) = 'array' and jsonb_typeof(b) = 'array' then
    return query
      select d.*
      from generate_series(0, greatest(jsonb_array_length(a), jsonb_array_length(b)) - 1) as i,
        lateral private.jsonb_diff(a -> i, b -> i, path || '[' || i || ']') as d;
  else
    return query select path, a, b;
  end if;
end;
$$;

-- 移行した結果を、元の user_data と比べる。ok が false の行があれば、どこかが違う。
-- 1. 全項目: 逆の変換で戻した JSON が、捨てると決めた項目（_updatedAt・家計簿の src と txId・予定の date）以外、元と完全に一致する
-- 2. 種類ごとの件数
-- 3. 月ごとの収支の合計、カードごと・バイト先ごとの件数と合計
create function private.compare_migration(p_user_id uuid)
returns table (item text, expected text, actual text, ok boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_original jsonb;
  v_exported jsonb;
  v_diff_count integer;
begin
  select u.value into v_original from public.user_data u where u.user_id = p_user_id;

  -- 捨てると決めた項目を除く
  v_original := v_original - '_updatedAt';
  v_original := jsonb_set(v_original, '{ledger}', coalesce((
    select jsonb_agg(l - 'src' - 'txId' order by o)
    from jsonb_array_elements(v_original -> 'ledger') with ordinality as e(l, o)), '[]'));
  v_original := jsonb_set(v_original, '{plans}', coalesce((
    select jsonb_agg(p - 'date' order by o)
    from jsonb_array_elements(v_original -> 'plans') with ordinality as e(p, o)), '[]'));

  v_exported := private.export_to_user_data(p_user_id);
  v_exported := jsonb_set(v_exported, '{plans}', coalesce((
    select jsonb_agg(p - 'date' order by o)
    from jsonb_array_elements(v_exported -> 'plans') with ordinality as e(p, o)), '[]'));

  -- 1. 全項目
  select count(*) into v_diff_count from private.jsonb_diff(v_original, v_exported);
  return query select '全項目（違う場所の数）'::text, '0'::text, v_diff_count::text, v_diff_count = 0;
  return query
    select '違う場所: '::text || d.diff_path, d.expected::text, d.actual::text, false
    from private.jsonb_diff(v_original, v_exported) as d
    order by d.diff_path
    limit 100;

  -- 2. 種類ごとの件数
  return query
    select x.label::text || 'の件数', x.json_count::text, x.table_count::text, x.json_count = x.table_count
    from (values
      ('カード', jsonb_array_length(v_original -> 'cards'),
        (select count(*)::integer from public.cards where user_id = p_user_id)),
      ('バイト先', jsonb_array_length(v_original -> 'jobs'),
        (select count(*)::integer from public.jobs where user_id = p_user_id)),
      ('支出のカテゴリ', jsonb_array_length(v_original -> 'catExp'),
        (select count(*)::integer from public.categories where user_id = p_user_id and kind = 'expense' and deleted_at is null)),
      ('収入のカテゴリ', jsonb_array_length(v_original -> 'catInc'),
        (select count(*)::integer from public.categories where user_id = p_user_id and kind = 'income' and deleted_at is null)),
      ('家計簿', jsonb_array_length(v_original -> 'ledger'),
        (select count(*)::integer from public.ledger_entries where user_id = p_user_id)),
      ('シフト', jsonb_array_length(v_original -> 'shifts'),
        (select count(*)::integer from public.shifts where user_id = p_user_id)),
      ('予定', jsonb_array_length(v_original -> 'plans'),
        (select count(*)::integer from public.plans where user_id = p_user_id)),
      ('固定費', jsonb_array_length(v_original -> 'fixedCosts'),
        (select count(*)::integer from public.fixed_costs where user_id = p_user_id)),
      ('固定収入', jsonb_array_length(v_original -> 'fixedIncs'),
        (select count(*)::integer from public.fixed_incomes where user_id = p_user_id)),
      ('引き出し', jsonb_array_length(v_original -> 'wds'),
        (select count(*)::integer from public.withdrawals where user_id = p_user_id)),
      ('カードの実績', (select count(*)::integer from jsonb_array_elements(v_original -> 'actualInputs') a where a ->> 'type' = 'card'),
        (select count(*)::integer from public.card_bill_actuals where user_id = p_user_id)),
      ('給与の実績', (select count(*)::integer from jsonb_array_elements(v_original -> 'actualInputs') a where a ->> 'type' = 'shift'),
        (select count(*)::integer from public.salary_actuals where user_id = p_user_id))
    ) as x(label, json_count, table_count);

  -- 3. 月ごとの収支の合計
  return query
    with from_json as (
      select left(l ->> 'date', 7) as month, l ->> 'type' as kind, sum((l ->> 'amount')::bigint) as total
      from jsonb_array_elements(v_original -> 'ledger') l group by 1, 2
    ), from_table as (
      select to_char(l.date, 'YYYY-MM') as month, l.kind, sum(l.amount)::bigint as total
      from public.ledger_entries l where l.user_id = p_user_id group by 1, 2
    )
    select format('%s の%s の合計', coalesce(j.month, t.month), case coalesce(j.kind, t.kind) when 'expense' then '支出' else '収入' end),
      j.total::text, t.total::text, j.total is not distinct from t.total
    from from_json j full join from_table t on t.month = j.month and t.kind = j.kind
    order by 1;

  -- 3. カードごとの件数と合計（家計簿のカード払い）
  return query
    with from_json as (
      select v_original -> 'cards' -> (l ->> 'cardIdx')::integer ->> 'name' as card,
        count(*) as n, sum((l ->> 'amount')::bigint) as total
      from jsonb_array_elements(v_original -> 'ledger') l where l ? 'cardIdx' group by 1
    ), from_table as (
      select k.name as card, count(*) as n, sum(l.amount)::bigint as total
      from public.ledger_entries l join public.cards k on k.id = l.card_id
      where l.user_id = p_user_id group by 1
    )
    select format('カード %s の件数と合計', coalesce(j.card, t.card)),
      format('%s件 %s円', j.n, j.total), format('%s件 %s円', t.n, t.total),
      j.n is not distinct from t.n and j.total is not distinct from t.total
    from from_json j full join from_table t on t.card = j.card
    order by 1;

  -- 3. バイト先ごとのシフトの件数と時給の合計
  return query
    with from_json as (
      select s ->> 'job' as job, count(*) as n, sum((s ->> 'wage')::bigint) as total
      from jsonb_array_elements(v_original -> 'shifts') s group by 1
    ), from_table as (
      select j.name as job, count(*) as n, sum(s.wage)::bigint as total
      from public.shifts s join public.jobs j on j.id = s.job_id
      where s.user_id = p_user_id group by 1
    )
    select format('バイト先 %s のシフトの件数と時給の合計', coalesce(j.job, t.job)),
      format('%s件 %s円', j.n, j.total), format('%s件 %s円', t.n, t.total),
      j.n is not distinct from t.n and j.total is not distinct from t.total
    from from_json j full join from_table t on t.job = j.job
    order by 1;
end;
$$;

revoke all on function private.find_unmigratable(jsonb) from public;
revoke all on function private.migrate_user_data(uuid) from public;
revoke all on function private.export_to_user_data(uuid) from public;
revoke all on function private.jsonb_diff(jsonb, jsonb, text) from public;
revoke all on function private.compare_migration(uuid) from public;
