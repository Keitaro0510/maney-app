-- 通知の購読情報（push_subscriptions、Issue #189・D36）のテスト: 構造・RLS・登録の関数・端末の付け替え
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

-- ============================================================
-- 構造（6）
-- ============================================================
select has_table('public', 'push_subscriptions', 'push_subscriptions がある');
select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'RLS が有効');
select ok(
  not has_table_privilege('anon', 'public.push_subscriptions', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'insert, update, truncate')
  and has_table_privilege('authenticated', 'public.push_subscriptions', 'select, delete'),
  'anon は触れず、ログインした人は読む・消すだけ（直接は書けない）');
select ok(not ('push_subscriptions' = any (private.snapshot_tables())), '毎日の写しには入らない');
select ok(not ('push_subscriptions' = any (private.import_tables())), '読み込む（インポート）対象にも入らない');
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.push_subscriptions'::regclass and tgname = 'keep_row_history'),
  0, '行の履歴（鍵が残る）は取らない');

-- ============================================================
-- A が登録する（5）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.register_push_subscription('https://web.push.apple.com/abc123', repeat('p', 87), repeat('a', 22), 'iPhone') $$,
  'A は登録できる');
select is((select count(*)::int from public.push_subscriptions), 1, 'A に自分の購読が1件見える');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('a0000000-0000-4000-8000-000000000001', 'https://x.example/1', repeat('p', 87), repeat('a', 22)) $$,
  '42501', null, '表に直接は書けない（登録は関数だけ）');
select throws_ok(
  $$ select public.register_push_subscription('http://insecure.example/1', repeat('p', 87), repeat('a', 22)) $$,
  '23514', null, 'https でない送り先は登録できない');
select throws_ok(
  $$ select public.register_push_subscription('https://web.push.apple.com/zzz', 'short', repeat('a', 22)) $$,
  '23514', null, '鍵が短すぎるものは登録できない');

-- ============================================================
-- B（他人）は見えない・消せない。端末の付け替え（5）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.push_subscriptions), 0, 'B には A の購読が見えない');
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/abc123';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.push_subscriptions), 1, 'B は A の購読を消せない');

-- 同じ端末で、B がログインして登録すると、A の行は消えて B のものになる
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.register_push_subscription('https://web.push.apple.com/abc123', repeat('q', 87), repeat('b', 22), 'iPhone') $$,
  '同じ端末を B が登録できる');
select is((select count(*)::int from public.push_subscriptions), 1, 'B に1件見える');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.push_subscriptions), 0, 'A の行は付け替えられて、A には見えなくなった');

-- ============================================================
-- 自分の購読を消す・ログインなし（2）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/abc123';
select is((select count(*)::int from public.push_subscriptions), 0, 'B は自分の購読を消せる');
reset role;
set local role anon;
select throws_ok(
  $$ select public.register_push_subscription('https://web.push.apple.com/zz', repeat('p', 87), repeat('a', 22)) $$,
  '42501', null, 'ログインしていない人は登録の関数を呼べない');

select * from finish();
rollback;
