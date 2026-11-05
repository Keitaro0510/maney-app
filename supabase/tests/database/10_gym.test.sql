-- ジムの記録（gym_exercises・gym_workouts・gym_sets、D23）のテスト:
-- 構造・RLS・制約・apply_op・行の履歴・写しと復元・読み込み（import_backup）から外れていること
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- テスト用の2人（A と B）
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

-- ============================================================
-- 構造
-- ============================================================
select has_table('public', 'gym_exercises', 'gym_exercises がある');
select has_table('public', 'gym_workouts', 'gym_workouts がある');
select has_table('public', 'gym_sets', 'gym_sets がある');
select is(
  (select count(*)::int from pg_class where oid in ('public.gym_exercises'::regclass, 'public.gym_workouts'::regclass, 'public.gym_sets'::regclass) and relrowsecurity),
  3, '3つとも RLS が有効');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and left(tablename, 4) = 'gym_' and policyname = '本人の行だけ'),
  3, '3つとも「本人の行だけ」のポリシーがある');
select ok(
  not has_table_privilege('anon', 'public.gym_sets', 'select, insert, update, delete, truncate')
  and not has_table_privilege('anon', 'public.gym_workouts', 'select, insert, update, delete, truncate')
  and not has_table_privilege('anon', 'public.gym_exercises', 'select, insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.gym_sets', 'truncate'),
  'anon は触れず、authenticated は TRUNCATE できない');
select is(
  (select count(*)::int from pg_trigger
   where tgrelid in ('public.gym_exercises'::regclass, 'public.gym_workouts'::regclass, 'public.gym_sets'::regclass)
     and tgname in ('set_row_timestamps', 'keep_row_history')),
  6, '3つとも、登録日時・更新日時と行の履歴のトリガーがある');
select ok(private.snapshot_tables() @> array['gym_exercises', 'gym_workouts', 'gym_sets'], '毎日の写しに、ジムの3つが入る');
select ok(not (private.import_tables() && array['gym_exercises', 'gym_workouts', 'gym_sets']), '読み込む（インポート）テーブルには、ジムは入らない');
select ok(
  array_position(private.snapshot_tables(), 'gym_exercises') < array_position(private.snapshot_tables(), 'gym_sets')
  and array_position(private.snapshot_tables(), 'gym_workouts') < array_position(private.snapshot_tables(), 'gym_sets'),
  '写しの順番は、参照される側（種目・トレーニング）が先');

-- ============================================================
-- A がアプリから保存する（apply_op）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000001001", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e1", "row": {"name": "ベンチプレス", "position": 0}},
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e2",
     "row": {"name": "スクワット", "position": 1, "user_id": "b0000000-0000-4000-8000-000000000001"}},
    {"table": "gym_workouts", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010a1",
     "row": {"performed_at": "2026-11-05T19:30:00+09:00", "date": "2026-11-05", "note": "胸の日"}},
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b1",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010e1", "kg": 62.5, "reps": 8, "position": 0}},
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b2",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010e1", "kg": 65, "reps": 6, "rpe": 8.5, "note": "きつい", "position": 1}}
  ]}$$) ->> 'status',
  'applied', 'A は apply_op で、種目・トレーニング・セットをまとめて追加できる');
select is((select count(*)::int from public.gym_exercises), 2, 'A には自分の種目が2つ見える');
select is(
  (select user_id from public.gym_exercises where id = 'a0000000-0000-4000-8000-0000000010e2'),
  'a0000000-0000-4000-8000-000000000001'::uuid, '送ってきた user_id は使わず、本人の行になる');
select is((select kg from public.gym_sets where id = 'a0000000-0000-4000-8000-0000000010b1'), 62.5::numeric, '重量は小数（62.5kg）で入る');
select ok((select rpe is null from public.gym_sets where id = 'a0000000-0000-4000-8000-0000000010b1'), 'RPE は空でもよい');
select is((select rpe from public.gym_sets where id = 'a0000000-0000-4000-8000-0000000010b2'), 8.5::numeric, 'RPE は小数（8.5）で入る');
select ok(
  (select created_at > '2020-01-01' from public.gym_workouts where id = 'a0000000-0000-4000-8000-0000000010a1'),
  '登録日時はサーバーの時刻になる');

-- DB が見張っていること
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001002", "epoch": 1, "changes": [
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b9",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010e1", "kg": 60, "reps": 0}}]}')
$$, '23514', null, '回数が0のセットは入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001003", "epoch": 1, "changes": [
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b9",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010e1", "kg": -5, "reps": 5}}]}')
$$, '23514', null, '重量がマイナスのセットは入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001004", "epoch": 1, "changes": [
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b9",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010e1", "kg": 60, "reps": 5, "rpe": 11}}]}')
$$, '23514', null, 'RPE は1〜10の範囲');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001005", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e9", "row": {"name": "  "}}]}')
$$, '23514', null, '空白だけの種目名は入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001006", "epoch": 1, "changes": [
    {"table": "gym_sets", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010b9",
     "row": {"workout_id": "a0000000-0000-4000-8000-0000000010a1", "exercise_id": "a0000000-0000-4000-8000-0000000010f0", "kg": 60, "reps": 5}}]}')
$$, '23503', null, '存在しない種目を指すセットは入らない');

-- 同じ名前の種目（消していないもの）は、競合として返る。相手の行もわかる
select is(
  (select c ->> 'reason' from jsonb_array_elements(public.apply_op($${"id": "0e000000-0000-4000-8000-000000001007", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e8", "row": {"name": "ベンチプレス"}}
  ]}$$) -> 'conflicts') as c),
  'duplicate', '消していない同じ名前の種目は、競合（duplicate）になる');
select is(
  (select c -> 'server' ->> 'id' from jsonb_array_elements(public.apply_op($${"id": "0e000000-0000-4000-8000-000000001008", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e8", "row": {"name": "ベンチプレス"}}
  ]}$$) -> 'conflicts') as c),
  'a0000000-0000-4000-8000-0000000010e1', '競合に、すでにある種目の行が入る');

-- 種目を消した（deleted_at）あとは、同じ名前を作り直せる
select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000001009', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'gym_exercises', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000010e2',
      'base', (select updated_at from public.gym_exercises where id = 'a0000000-0000-4000-8000-0000000010e2'),
      'row', jsonb_build_object('deleted_at', '2026-11-05T20:00:00+09:00'))))) ->> 'status',
  'applied', '種目を削除済みにできる');
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-00000000100a", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000010e3", "row": {"name": "スクワット"}}
  ]}$$) ->> 'status',
  'applied', '削除済みの種目と同じ名前を、作り直せる');

-- セットが残っているトレーニングは消せない
select throws_ok($$
  select public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-00000000100b', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'gym_workouts', 'action', 'delete', 'id', 'a0000000-0000-4000-8000-0000000010a1',
      'base', (select updated_at from public.gym_workouts where id = 'a0000000-0000-4000-8000-0000000010a1')))))
$$, '23503', null, 'セットが残っているトレーニングだけを消そうとすると止まる');
select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-00000000100c', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'gym_sets', 'action', 'delete', 'id', 'a0000000-0000-4000-8000-0000000010b2',
      'base', (select updated_at from public.gym_sets where id = 'a0000000-0000-4000-8000-0000000010b2'))))) ->> 'status',
  'applied', 'セットを1つ消せる');
reset role;

-- ============================================================
-- 行の履歴と、操作の取り消し
-- ============================================================
select is(
  (select count(*)::int from private.row_history where table_name = 'gym_sets' and row_id = 'a0000000-0000-4000-8000-0000000010b2' and op_id is not null),
  2, 'セットの追加と削除が、操作 ID つきで履歴に残る');
create temp table undone on commit drop as select private.undo_op('0e000000-0000-4000-8000-00000000100c') as id;
select ok(
  exists (select 1 from public.gym_sets where id = 'a0000000-0000-4000-8000-0000000010b2' and kg = 65 and reps = 6 and rpe = 8.5),
  '消したセットを、操作の取り消しで戻せる');

-- ============================================================
-- B から
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.gym_exercises) + (select count(*)::int from public.gym_workouts) + (select count(*)::int from public.gym_sets),
  0, 'B には A のジムの記録が見えない');
select throws_ok($$
  insert into public.gym_workouts (user_id, performed_at, date) values ('a0000000-0000-4000-8000-000000000001', now(), current_date)
$$, '42501', null, 'B は A のトレーニングを作れない');
select throws_ok($$
  insert into public.gym_sets (user_id, workout_id, exercise_id, kg, reps)
  values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000010a1', 'a0000000-0000-4000-8000-0000000010e1', 50, 5)
$$, '23503', null, 'B は A のトレーニング・種目を指すセットを作れない');
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-00000000100d", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "update", "id": "a0000000-0000-4000-8000-0000000010e1",
     "base": "2026-01-01T00:00:00Z", "row": {"name": "B が書き換え"}}
  ]}$$) ->> 'status',
  'conflict', 'B は A の種目を変えられない（見えないので競合になる）');
reset role;

-- ============================================================
-- 写しと復元
-- ============================================================
create temp table snap on commit drop as
  select private.take_snapshot('a0000000-0000-4000-8000-000000000001', 'manual') as id;
select is(
  (select jsonb_array_length(data -> 'gym_sets') from private.snapshots where id = (select id from snap)),
  2, '写しにジムのセットが入る');
select is(
  (select jsonb_array_length(data -> 'gym_workouts') from private.snapshots where id = (select id from snap)),
  1, '写しにジムのトレーニングが入る');

delete from public.gym_sets where user_id = 'a0000000-0000-4000-8000-000000000001';
delete from public.gym_workouts where user_id = 'a0000000-0000-4000-8000-000000000001';
create temp table restored on commit drop as select private.restore_snapshot((select id from snap)) as id;
select is(
  (select count(*)::int from public.gym_sets where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2, '写しから戻すと、ジムのセットも戻る');
select ok(
  exists (select 1 from public.gym_workouts where id = 'a0000000-0000-4000-8000-0000000010a1' and note = '胸の日'),
  '写しから戻すと、ジムのトレーニングも戻る');

-- ジムを足す前の写し（gym_ の鍵がない）から戻しても、ジムの記録は消えない
create temp table old_snap on commit drop as
  with s as (
    insert into private.snapshots (user_id, reason, data)
    select user_id, 'manual', data - 'gym_exercises' - 'gym_workouts' - 'gym_sets' from private.snapshots where id = (select id from snap)
    returning id
  ) select id from s;
create temp table restored_old on commit drop as select private.restore_snapshot((select id from old_snap)) as id;
select is(
  (select count(*)::int from public.gym_sets where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2, 'ジムを足す前の写しから戻しても、ジムの記録は消えない');

-- ============================================================
-- 読み込み（import_backup）で、ジムの記録が消えない
-- ============================================================
select set_config('test.file', (
  select jsonb_build_object('format', 'maney-export', 'version', 1, 'tables', jsonb_object_agg(t,
    case when t = 'settings' then jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-4000-8000-0000000010c1')) else '[]'::jsonb end))::text
  from unnest(private.import_tables()) as t), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.import_backup(current_setting('test.file')::jsonb) ->> 'status', 'imported', 'お金・予定・タスクだけのファイルを読み込める');
select is(
  (select count(*)::int from public.gym_sets) + (select count(*)::int from public.gym_workouts) + (select count(*)::int from public.gym_exercises),
  2 + 1 + 3, '読み込んでも、ジムの種目・トレーニング・セットは消えない');
select throws_ok(
  $$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,gym_sets}', '[]'::jsonb)) $$,
  '22023', null, 'ジムのテーブルが入ったファイルは、読み込めない');
reset role;

select * from finish();
rollback;
