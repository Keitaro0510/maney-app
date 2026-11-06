-- ジムの種目のメモと動画のリンク（gym_exercises.notes・video_url、D25）のテスト
-- 実行: npx supabase test db（または bash scripts/db-test-docker.sh 12_gym_exercise_notes）
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- ============================================================
-- 構造
-- ============================================================
select has_column('public', 'gym_exercises', 'notes', 'メモの列がある');
select has_column('public', 'gym_exercises', 'video_url', '動画のリンクの列がある');

-- 指定しない種目（今までの保存のしかた）は、メモなし・リンクなしで入る
insert into public.gym_exercises (id, user_id, name) values
  ('a0000000-0000-4000-8000-0000000012e1', 'a0000000-0000-4000-8000-000000000001', 'ベンチプレス');
select ok((select notes = '' and video_url is null from public.gym_exercises where name = 'ベンチプレス'),
  '指定しなければ、メモは空の文字・リンクは空');

-- ============================================================
-- A がアプリから保存する（apply_op）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000001201', 'epoch', 1, 'changes', jsonb_build_array(jsonb_build_object(
    'table', 'gym_exercises', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000012e1',
    'base', (select updated_at from public.gym_exercises where id = 'a0000000-0000-4000-8000-0000000012e1'),
    'row', jsonb_build_object('notes', E'肩甲骨を寄せる\n足で床を踏む', 'video_url', 'https://www.youtube.com/watch?v=abc123'))))) ->> 'status',
  'applied', '今ある種目に、メモと動画のリンクを設定できる');
select is((select notes from public.gym_exercises where name = 'ベンチプレス'), E'肩甲骨を寄せる\n足で床を踏む', '複数行のメモが入る');
select is((select video_url from public.gym_exercises where name = 'ベンチプレス'), 'https://www.youtube.com/watch?v=abc123', '動画のリンクが入る');
select lives_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001202", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e2",
     "row": {"name": "スクワット", "notes": "しゃがむ深さは太ももが平行まで", "video_url": "http://example.com/squat"}}]}')
$$, '種目を、メモとリンクつきで追加できる（http:// もよい）');

-- ============================================================
-- DB が見張っていること
-- ============================================================
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001203", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e3", "row": {"name": "x", "video_url": "javascript:alert(1)"}}]}')
$$, '23514', null, 'javascript: のリンクは入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001204", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e4", "row": {"name": "y", "video_url": "data:text/html,<script>1</script>"}}]}')
$$, '23514', null, 'data: のリンクは入らない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001205", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e5", "row": {"name": "z", "video_url": "https://example.com/a b"}}]}')
$$, '23514', null, '空白を含むリンクは入らない');
select throws_ok(
  format($f$select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001206", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e6", "row": {"name": "w", "video_url": "https://example.com/%s"}}]}')$f$, repeat('a', 2000)),
  '23514', null, '2000文字を超えるリンクは入らない');
select throws_ok(
  format($f$select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001207", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e7", "row": {"name": "v", "notes": "%s"}}]}')$f$, repeat('あ', 5001)),
  '23514', null, '5000文字を超えるメモは入らない');
select lives_ok(
  format($f$select public.apply_op('{"id": "0e000000-0000-4000-8000-000000001208", "epoch": 1, "changes": [
    {"table": "gym_exercises", "action": "insert", "id": "a0000000-0000-4000-8000-0000000012e8", "row": {"name": "u", "notes": "%s", "video_url": null}}]}')$f$, repeat('あ', 5000)),
  '5000文字のメモ・リンクなし（null）は入る');
reset role;

select ok((select count(*) from public.gym_exercises where video_url ~ '^https?://') = 2, 'リンクのある種目は2つ（ベンチプレス・スクワット）');
select * from finish();
rollback;
