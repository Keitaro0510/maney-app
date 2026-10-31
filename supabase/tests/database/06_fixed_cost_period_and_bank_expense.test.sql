-- 手順8の段1（D11・D14）のテスト: 固定費の期間と、支出の払い方の「口座」
-- 実行: npx supabase test db（Supabase の CLI が動かないときは bash scripts/db-test-docker.sh）
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000801", "epoch": 1, "changes": [
    {"table": "cards", "action": "insert", "id": "a0000000-0000-4000-8000-0000000008c1",
     "row": {"name": "Aカード", "close_day": 31, "bill_day": 27}},
    {"table": "categories", "action": "insert", "id": "a0000000-0000-4000-8000-0000000008e1", "row": {"kind": "expense", "name": "住まい"}},
    {"table": "categories", "action": "insert", "id": "a0000000-0000-4000-8000-0000000008e2", "row": {"kind": "income", "name": "給与"}}
  ]}$$) ->> 'status',
  'applied', '準備: カードとカテゴリ');

-- ============================================================
-- 固定費の期間（7）
-- ============================================================
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000802", "epoch": 1, "changes": [
    {"table": "fixed_costs", "action": "insert", "id": "a0000000-0000-4000-8000-0000000008f1",
     "row": {"name": "家賃", "amount": 50000, "day": 27, "kind": "expense", "payment_method": "bank"}}
  ]}$$) ->> 'status',
  'applied', '期間を入れない固定費は、今までどおり入る');
select ok(
  (select start_month is null and end_month is null from public.fixed_costs where id = 'a0000000-0000-4000-8000-0000000008f1'),
  '期間を入れなければ空（前から続いていて、やめていない）');

select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000803", "epoch": 1, "changes": [
    {"table": "fixed_costs", "action": "insert", "id": "a0000000-0000-4000-8000-0000000008f2",
     "row": {"name": "動画のサブスク", "amount": 990, "day": 15, "kind": "expense", "payment_method": "card",
             "card_id": "a0000000-0000-4000-8000-0000000008c1", "start_month": "2026-06-01", "end_month": "2026-10-01"}}
  ]}$$) ->> 'status',
  'applied', 'いつから・いつまでを入れられる');

select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000804', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'fixed_costs', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000008f1',
      'base', (select updated_at from public.fixed_costs where id = 'a0000000-0000-4000-8000-0000000008f1'),
      'row', jsonb_build_object('end_month', '2026-11-01'))))) ->> 'status',
  'applied', '「やめる」: いつまでだけを入れられる');

select throws_ok($$
  insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, start_month)
  values ('a0000000-0000-4000-8000-000000000001', 'x', 1, 1, 'expense', 'bank', '2026-06-15')
$$, '23514', null, 'いつからは月の1日だけ');
select throws_ok($$
  insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, end_month)
  values ('a0000000-0000-4000-8000-000000000001', 'x', 1, 1, 'expense', 'bank', '2026-06-30')
$$, '23514', null, 'いつまでは月の1日だけ');
select throws_ok($$
  insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, start_month, end_month)
  values ('a0000000-0000-4000-8000-000000000001', 'x', 1, 1, 'expense', 'bank', '2026-07-01', '2026-06-01')
$$, '23514', null, 'いつまでは、いつから より前にできない');

-- ============================================================
-- 支出の払い方に「口座」（5）
-- ============================================================
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000805", "epoch": 1, "changes": [
    {"table": "ledger_entries", "action": "insert", "id": "a0000000-0000-4000-8000-000000000881",
     "row": {"date": "2026-10-27", "kind": "expense", "amount": 50000, "name": "家賃（振込）",
             "category_id": "a0000000-0000-4000-8000-0000000008e1", "payment_method": "bank"}}
  ]}$$) ->> 'status',
  'applied', '支出を口座払いで記録できる');

select lives_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method)
  values ('a0000000-0000-4000-8000-000000000001', '2026-10-28', 'expense', 500, 'ランチ', 'a0000000-0000-4000-8000-0000000008e1', 'cash')
$$, '支出の現金払いは、今までどおり入る');

select lives_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method)
  values ('a0000000-0000-4000-8000-000000000001', '2026-10-25', 'income', 80000, '給料', 'a0000000-0000-4000-8000-0000000008e2', 'bank')
$$, '収入の口座振込は、今までどおり入る');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method, card_id)
  values ('a0000000-0000-4000-8000-000000000001', '2026-10-25', 'income', 100, '返金', 'a0000000-0000-4000-8000-0000000008e2', 'card',
          'a0000000-0000-4000-8000-0000000008c1')
$$, '23514', null, '収入はカード払いにできない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method)
  values ('a0000000-0000-4000-8000-000000000001', '2026-10-25', 'expense', 100, 'x', 'a0000000-0000-4000-8000-0000000008e1', 'card')
$$, '23514', null, 'カード払いなのにカードがない支出は、今までどおり入らない');
reset role;

select * from finish();
rollback;
