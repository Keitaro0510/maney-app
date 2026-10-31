-- 手順8の段1（D11・D14）: 足すだけの変更。今のアプリの動きは変わらない。
-- - 固定費（fixed_costs）に「いつから」「いつまで」を足す。今ある行は空のまま（前から続いていて、やめていない）
-- - 家計簿の支出に、払い方の「口座」（振込・口座振込など）を許す
-- 固定収入（fixed_incomes）を固定費にまとめるのは、画面を作り直す段4で行う。

-- ============================================================
-- 固定費の期間（D14）
-- ============================================================

-- start_month: 数え始める月の1日。空なら「前から続いている」
-- end_month: 数える最後の月の1日。空なら「続いている」。やめても、過去の月は数え続ける
alter table public.fixed_costs
  add column start_month date check (start_month is null or extract(day from start_month) = 1),
  add column end_month date check (end_month is null or extract(day from end_month) = 1),
  add constraint fixed_costs_period_order check (start_month is null or end_month is null or end_month >= start_month);

comment on column public.fixed_costs.start_month is '数え始める月の1日。空なら前から続いている（D14）';
comment on column public.fixed_costs.end_month is '数える最後の月の1日。空なら続いている。やめても過去の月は数える（D14）';

-- ============================================================
-- 支出の払い方に「口座」（D11）
-- ============================================================

-- 今の決まり（名前なし）: 支出は cash・card、収入は cash・bank。中身で探して外す
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.ledger_entries'::regclass
    and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) like '%CASE kind%';
  if v_name is null then
    raise exception '支出と収入の払い方の決まりが見つかりません';
  end if;
  execute format('alter table public.ledger_entries drop constraint %I', v_name);
end;
$$;

-- 新しい決まり: カード払いは支出だけ。支出は cash・card・bank、収入は cash・bank
alter table public.ledger_entries
  add constraint ledger_entries_card_only_for_expense check (kind = 'expense' or payment_method in ('cash', 'bank'));

comment on table public.ledger_entries is '家計簿の記録。支出は cash/card/bank、収入は cash/bank。カード払いのときだけ card_id がある';
