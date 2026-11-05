-- ジムの種目の部位（gym_exercises.primary_muscle・secondary_muscles、D24）のテスト
-- 実行: npx supabase test db（または bash scripts/db-test-docker.sh 11_gym_muscles）
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- ============================================================
-- 構造
-- ============================================================
select has_column('public', 'gym_exercises', 'primary_muscle', '主の部位の列がある');
select has_column('public', 'gym_exercises', 'secondary_muscles', '補助の部位の列がある');

-- 部位を指定しない種目（今までの保存のしかた）は、部位なしで入る
insert into public.gym_exercises (id, user_id, name) values
  ('a0000000-0000-4000-8000-0000000011e1', 'a0000000-0000-4000-8000-000000000001', 'ベンチプレス');
select ok((select primary_muscle is null and secondary_muscles = '{}'::text[] from public.gym_exercises where name = 'ベンチプレス'),
  '部位を指定しなければ、主は空・補助は空の配列');

-- ============================================================
-- A がアプリから保存する（apply_op）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000001101", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e2",
     "row": {"name": "スクワット", "position": 1, "primary_muscle": "quads", "secondary_muscles": ["glutes", "hamstrings"]}}]}$$::jsonb) ->> 'status',
  'applied', '種目を、主・補助の部位つきで追加できる');
select is((select primary_muscle from public.gym_exercises where name = 'スクワット'), 'quads', '主の部位が入る');
select is((select secondary_muscles from public.gym_exercises where name = 'スクワット'), array['glutes', 'hamstrings']::text[], '補助の部位（複数）が入る');

-- 既存の種目に、あとから部位を設定する（update）
select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000001102', 'epoch', 1, 'changes', jsonb_build_array(jsonb_build_object(
    'table', 'gym_exercises', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000011e1',
    'base', (select updated_at from public.gym_exercises where id = 'a0000000-0000-4000-8000-0000000011e1'),
    'row', jsonb_build_object('primary_muscle', 'chest', 'secondary_muscles', jsonb_build_array('delt_front', 'triceps')))))) ->> 'status',
  'applied', '今ある種目に、あとから部位を設定できる');
select is((select primary_muscle from public.gym_exercises where name = 'ベンチプレス'), 'chest', '設定した主の部位が入る');

-- ============================================================
-- DB が見張っていること
-- ============================================================
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001103", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e3", "row": {"name": "x", "primary_muscle": "legs"}}]}')
$$, '23514', null, '一覧にない主の部位は入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001104", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e4", "row": {"name": "y", "primary_muscle": "chest", "secondary_muscles": ["chest"]}}]}')
$$, '23514', null, '主の部位を、補助にも入れることはできない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001105", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e5", "row": {"name": "z", "secondary_muscles": ["biceps", "wing"]}}]}')
$$, '23514', null, '一覧にない補助の部位は入らない');
select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001106", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e6", "row": {"name": "腹の種目", "primary_muscle": "abs", "secondary_muscles": []}}]}')
$$, '補助が空の配列でもよい');
select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001107", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000011e7", "row": {"name": "部位なしの種目"}}]}')
$$, '部位なし（未設定）の種目も入る');
reset role;

-- ============================================================
-- 件数
-- ============================================================
select ok(
  (select count(*) from public.gym_exercises where primary_muscle is not null) = 3,
  '部位つきの種目が3つある（ベンチプレス・スクワット・腹の種目）');
select * from finish();
rollback;
