-- 空になった固定収入の表（fixed_incomes）を消したあと（20261101013510_drop_fixed_incomes.sql）のテスト:
-- 表と移し替えの関数がない・写しと読み込みのテーブルから外れた・保存の関数は断る・旧版に戻す変換と、前の写しから戻すのは動く
-- 実行: npx supabase test db（または bash scripts/db-test-docker.sh 09_drop）
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');
insert into public.settings (user_id) values ('a0000000-0000-4000-8000-000000000001');
insert into public.fixed_costs (id, user_id, name, amount, day, kind, payment_method, position) values
  ('a0000000-0000-4000-8000-0000000009c1', 'a0000000-0000-4000-8000-000000000001', '家賃', 50000, 27, 'expense', 'bank', 0),
  ('a0000000-0000-4000-8000-0000000009c2', 'a0000000-0000-4000-8000-000000000001', '仕送り', 30000, 25, 'income', null, 1);

-- ============================================================
-- なくなったもの（4）
-- ============================================================
select hasnt_table('public', 'fixed_incomes', '固定収入の表はない');
select hasnt_function('private', 'merge_fixed_incomes_to_costs', array['uuid'], '移し替えの関数はない');
select ok(not ('fixed_incomes' = any (private.snapshot_tables())), '写しのテーブルに固定収入は入らない');
select is(private.import_tables(), private.snapshot_tables(), '読み込むテーブルは、写しのテーブルと同じ');

-- ============================================================
-- 保存の関数（2）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000901", "epoch": 1, "changes": [
    {"table": "fixed_incomes", "action": "insert", "id": "a0000000-0000-4000-8000-000000000911",
     "row": {"name": "古い端末から", "amount": 1000, "day": 1}}]}'::jsonb)
$$, '22023', '変更 1: テーブル fixed_incomes には保存できません', '保存の関数は、固定収入の表への保存を断る');
select is(
  public.apply_op('{"id": "0e000000-0000-4000-8000-000000000902", "epoch": 1, "changes": [
    {"table": "fixed_costs", "action": "insert", "id": "a0000000-0000-4000-8000-0000000009c3",
     "row": {"name": "動画", "amount": 990, "day": 5, "kind": "expense", "payment_method": "cash"}}]}'::jsonb) ->> 'status',
  'applied', 'ほかのテーブルは今までどおり保存できる');

reset role;

-- ============================================================
-- 旧版のアプリに戻す変換（2）
-- ============================================================
select is(private.export_to_user_data('a0000000-0000-4000-8000-000000000001') -> 'fixedIncs', '[]'::jsonb,
  '旧版に戻す変換の固定収入は空');
select ok(
  private.export_to_user_data('a0000000-0000-4000-8000-000000000001') -> 'fixedCosts'
    @> '[{"name": "仕送り", "type": "income", "pay": "income"}]'::jsonb,
  '毎月の収入は、固定費の収入として旧版に渡る');

-- ============================================================
-- 写し（2）
-- ============================================================
-- 写しを作る文と読む文は分ける（同じ文の中では、作ったばかりの写しが見えない）
select private.take_snapshot('a0000000-0000-4000-8000-000000000001', 'manual') as new_id \gset
select ok(
  (select not (data ? 'fixed_incomes') and data ? 'fixed_costs' from private.snapshots where id = :new_id),
  '新しい写しに固定収入の欄はない');

-- 前の写しには、空の fixed_incomes の欄が残っている。戻すときは読まない
insert into private.snapshots (user_id, reason, data) values (
  'a0000000-0000-4000-8000-000000000001', 'manual',
  jsonb_build_object(
    'settings', jsonb_build_array(to_jsonb((select s from public.settings s where s.user_id = 'a0000000-0000-4000-8000-000000000001'))),
    'fixed_costs', jsonb_build_array(to_jsonb((select c from public.fixed_costs c where c.id = 'a0000000-0000-4000-8000-0000000009c1'))),
    'fixed_incomes', '[]'::jsonb
  )
) returning id as old_id \gset
select lives_ok(format('select private.restore_snapshot(%s)', :'old_id'), '空の固定収入の欄がある前の写しから戻せる');

select * from finish();
rollback;
