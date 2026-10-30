-- タスク（tasks、D1・D3）のテスト: 構造・RLS・apply_op・行の履歴・写しと復元
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- テスト用の2人（A と B）
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

-- ============================================================
-- 構造（6）
-- ============================================================
select has_table('public', 'tasks', 'tasks がある');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks で RLS が有効');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = '本人の行だけ'),
  1, 'tasks に「本人の行だけ」のポリシーがある');
select ok(
  not has_table_privilege('anon', 'public.tasks', 'select, insert, update, delete, truncate')
  and not has_table_privilege('authenticated', 'public.tasks', 'truncate'),
  'anon は tasks に触れず、authenticated は TRUNCATE できない');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.tasks'::regclass and tgname in ('set_row_timestamps', 'keep_row_history')),
  2, 'tasks に、登録日時・更新日時と行の履歴のトリガーがある');
select ok('tasks' = any (private.snapshot_tables()), '毎日の写しに tasks が入る');

-- ============================================================
-- A がアプリから保存する（apply_op）（13）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 2つ目は、user_id と created_at を送ってくる（サーバーが決める列なので使わない）
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000701", "epoch": 1, "changes": [
    {"table": "tasks", "action": "insert", "id": "a0000000-0000-4000-8000-0000000007a1",
     "row": {"title": "レポートを出す", "due_date": "2026-11-05", "memo": "第3回"}},
    {"table": "tasks", "action": "insert", "id": "a0000000-0000-4000-8000-0000000007a2",
     "row": {"title": "部屋の片付け", "user_id": "b0000000-0000-4000-8000-000000000001", "created_at": "2000-01-01T00:00:00Z"}}
  ]}$$) ->> 'status',
  'applied', 'A は apply_op でタスクを追加できる');
select is((select count(*)::int from public.tasks), 2, 'A には自分のタスクが2つ見える');
select is(
  (select user_id from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a2'),
  'a0000000-0000-4000-8000-000000000001'::uuid, '送ってきた user_id は使わず、本人の行になる');
select ok(
  (select created_at > '2020-01-01' from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a2'),
  '登録日時はサーバーの時刻になる');
select ok(
  (select due_date is null and completed_at is null and memo = '' from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a2'),
  '期限・終えた日時・メモは、なくてもよい');

-- 完了にする・取り消す（D3: 取り消すと completed_at を空に戻す）
select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000702', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'tasks', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000007a1',
      'base', (select updated_at from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1'),
      'row', jsonb_build_object('completed_at', '2026-11-04T10:00:00+09:00'))))) ->> 'status',
  'applied', 'タスクを完了にできる');
select is(
  (select completed_at from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1'),
  '2026-11-04T10:00:00+09:00'::timestamptz, '終えた日時が入る');
select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000703', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'tasks', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000007a1',
      'base', (select updated_at from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1'),
      'row', jsonb_build_object('completed_at', null))))) ->> 'status',
  'applied', '完了を取り消せる');
select ok(
  (select completed_at is null from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1'),
  '取り消すと、終えた日時は空になる');

select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000704", "epoch": 1, "changes": [
    {"table": "tasks", "action": "insert", "id": "a0000000-0000-4000-8000-0000000007a9", "row": {"title": "  "}}]}')
$$, '23514', null, '空白だけのタイトルのタスクは入らない');

select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000705", "epoch": 1, "changes": [
    {"table": "tasks", "action": "update", "id": "a0000000-0000-4000-8000-0000000007a1",
     "base": "2000-01-01T00:00:00Z", "row": {"title": "古い画面からの変更"}}
  ]}$$) ->> 'status',
  'conflict', '読み込んだあとに変わったタスクを変えようとすると、競合になる');

select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000706', 'epoch', 1, 'changes', jsonb_build_array(
    jsonb_build_object('table', 'tasks', 'action', 'delete', 'id', 'a0000000-0000-4000-8000-0000000007a2',
      'base', (select updated_at from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a2'))))) ->> 'status',
  'applied', 'タスクを消せる');
select is((select count(*)::int from public.tasks), 1, '消したタスクは見えない');
reset role;

-- ============================================================
-- 行の履歴と、操作の取り消し（3）
-- ============================================================
select is(
  (select count(*)::int from private.row_history
   where table_name = 'tasks' and row_id = 'a0000000-0000-4000-8000-0000000007a1' and op_id is not null),
  3, 'タスクの追加・完了・取り消しが、操作 ID つきで履歴に残る');
select is(
  (select action from private.row_history
   where table_name = 'tasks' and row_id = 'a0000000-0000-4000-8000-0000000007a2' order by id desc limit 1),
  'DELETE', 'タスクを消すと、履歴に残る');
-- 戻す操作と、確かめる文は分ける（1つの文の中では、文が始まった時点の状態が見える）
create temp table undone on commit drop as select private.undo_op('0e000000-0000-4000-8000-000000000706') as id;
select ok(
  exists (select 1 from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a2' and title = '部屋の片付け'),
  '消したタスクを、操作の取り消しで戻せる');

-- ============================================================
-- B から（3）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.tasks), 0, 'B には A のタスクが見えない');
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000707", "epoch": 1, "changes": [
    {"table": "tasks", "action": "update", "id": "a0000000-0000-4000-8000-0000000007a1",
     "base": "2026-01-01T00:00:00Z", "row": {"title": "B が書き換え"}}
  ]}$$) ->> 'status',
  'conflict', 'B は A のタスクを変えられない（見えないので競合になる）');
select throws_ok($$
  insert into public.tasks (user_id, title) values ('a0000000-0000-4000-8000-000000000001', 'B が作った')
$$, '42501', null, 'B は A のタスクを作れない');
reset role;

-- ============================================================
-- 写しと復元（3）
-- ============================================================
create temp table snap on commit drop as
  select private.take_snapshot('a0000000-0000-4000-8000-000000000001', 'manual') as id;
select is(
  (select jsonb_array_length(data -> 'tasks') from private.snapshots where id = (select id from snap)),
  2, '写しにタスクが入る');

delete from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1';
create temp table restored on commit drop as select private.restore_snapshot((select id from snap)) as id;
select ok(
  exists (select 1 from public.tasks where id = 'a0000000-0000-4000-8000-0000000007a1'),
  '写しから戻すと、タスクも戻る');

-- tasks を足す前の写し（tasks の鍵がない）から戻しても、タスクは消えない
create temp table old_snap on commit drop as
  with s as (
    insert into private.snapshots (user_id, reason, data)
    select user_id, 'manual', data - 'tasks' from private.snapshots where id = (select id from snap)
    returning id
  ) select id from s;
create temp table restored_old on commit drop as select private.restore_snapshot((select id from old_snap)) as id;
select is(
  (select count(*)::int from public.tasks where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2, 'tasks を足す前の写しから戻しても、タスクは消えない');

select * from finish();
rollback;
