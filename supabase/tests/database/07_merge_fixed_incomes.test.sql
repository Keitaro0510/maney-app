-- 手順8の段4（D14）: 固定収入を固定費の「収入」にまとめる。
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000091', 'monthly@example.com');

insert into public.fixed_costs (id, user_id, name, amount, day, kind, payment_method, position)
values ('a0000000-0000-4000-8000-0000000009c1', 'a0000000-0000-4000-8000-000000000091', '家賃', 50000, 27, 'expense', 'bank', 4);
insert into public.fixed_incomes (id, user_id, name, amount, day, position) values
  ('a0000000-0000-4000-8000-000000000911', 'a0000000-0000-4000-8000-000000000091', '仕送り', 30000, 25, 0),
  ('a0000000-0000-4000-8000-000000000912', 'a0000000-0000-4000-8000-000000000091', '奨学金', 20000, 11, 1);

select is(private.merge_fixed_incomes_to_costs('a0000000-0000-4000-8000-000000000091'), 2,
  '固定収入を2件、固定費へ移す');
select is((select count(*)::int from public.fixed_incomes where user_id = 'a0000000-0000-4000-8000-000000000091'), 0,
  '移したあとの固定収入の表は空');
select is((select count(*)::int from public.fixed_costs where user_id = 'a0000000-0000-4000-8000-000000000091'), 3,
  '前からの固定費を残し、収入を足す');
select ok((select kind = 'income' and payment_method is null and card_id is null and start_month is null and end_month is null
  from public.fixed_costs where id = 'a0000000-0000-4000-8000-000000000911'),
  '移した行は期間なしの毎月の収入になる');
select is((select position from public.fixed_costs where id = 'a0000000-0000-4000-8000-000000000911'), 5,
  '前からの固定費のあとへ並べる');
select is((select position from public.fixed_costs where id = 'a0000000-0000-4000-8000-000000000912'), 6,
  '固定収入どうしの並びも保つ');

-- 移行前の写し（fixed_incomes を持つもの）を、移行後に戻す場面。
insert into private.snapshots (user_id, reason, data) values (
  'a0000000-0000-4000-8000-000000000091', 'manual',
  jsonb_build_object(
    'fixed_costs', jsonb_build_array(to_jsonb((select c from public.fixed_costs c where c.id = 'a0000000-0000-4000-8000-0000000009c1'))),
    'fixed_incomes', jsonb_build_array(jsonb_build_object(
      'id', 'a0000000-0000-4000-8000-000000000911', 'user_id', 'a0000000-0000-4000-8000-000000000091',
      'name', '昔の仕送り', 'amount', 31000, 'day', 24, 'position', 0,
      'created_at', now(), 'updated_at', now()
    ))
  )
) returning id as id \gset

select lives_ok(format('select private.restore_snapshot(%s)', :'id'),
  '移行前の写しも戻せる');
select is((select count(*)::int from public.fixed_incomes where user_id = 'a0000000-0000-4000-8000-000000000091'), 0,
  '写しの固定収入を古い表へ戻さない');
select ok((select name = '昔の仕送り' and kind = 'income' and payment_method is null
  from public.fixed_costs where id = 'a0000000-0000-4000-8000-000000000911'),
  '写しの固定収入も固定費の収入として戻す');

select * from finish();
rollback;
