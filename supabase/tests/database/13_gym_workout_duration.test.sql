-- ジムのトレーニングの所要時間（gym_workouts.duration_sec、D26）のテスト
-- 実行: npx supabase test db（または bash scripts/db-test-docker.sh 13_gym_workout_duration）
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- ============================================================
-- 構造
-- ============================================================
select has_column('public', 'gym_workouts', 'duration_sec', '所要時間の列がある');

-- 指定しないトレーニング（今までの保存のしかた）は、所要時間が空で入る
insert into public.gym_workouts (id, user_id, performed_at, date) values
  ('a0000000-0000-4000-8000-0000000013a1', 'a0000000-0000-4000-8000-000000000001', '2026-11-07T10:00:00+09', '2026-11-07');
select ok((select duration_sec is null from public.gym_workouts where id = 'a0000000-0000-4000-8000-0000000013a1'),
  '指定しなければ、所要時間は空');

-- ============================================================
-- A がアプリから保存する（apply_op）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001301", "epoch": 1, "changes": [
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000013a2",
     "row": {"performed_at": "2026-11-07T11:00:00+09", "date": "2026-11-07", "duration_sec": 3600}}]}')
$$, '所要時間つきでトレーニングを追加できる');
select is((select duration_sec from public.gym_workouts where id = 'a0000000-0000-4000-8000-0000000013a2'), 3600, '所要時間が入る');

select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001302", "epoch": 1, "changes": [
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000013a3",
     "row": {"performed_at": "2026-11-07T12:00:00+09", "date": "2026-11-07", "duration_sec": null}}]}')
$$, '所要時間が null（未計測）でも追加できる');

-- ============================================================
-- DB が見張っていること
-- ============================================================
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001303", "epoch": 1, "changes": [
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000013a4",
     "row": {"performed_at": "2026-11-07T13:00:00+09", "date": "2026-11-07", "duration_sec": -1}}]}')
$$, '23514', null, '負の所要時間は入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001304", "epoch": 1, "changes": [
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000013a5",
     "row": {"performed_at": "2026-11-07T14:00:00+09", "date": "2026-11-07", "duration_sec": 86401}}]}')
$$, '23514', null, '24時間を超える所要時間は入らない');
select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001305", "epoch": 1, "changes": [
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000013a6",
     "row": {"performed_at": "2026-11-07T15:00:00+09", "date": "2026-11-07", "duration_sec": 86400}}]}')
$$, '24時間ちょうどは入る');
reset role;

select * from finish();
rollback;
