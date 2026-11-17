-- カレンダーの共有（D39）のテスト: 申請・承認・解除と、見せる列だけが返ること
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- A＝持ち主、B＝見る人、C＝関係のない人
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com'),
  ('c0000000-0000-4000-8000-000000000001', 'c@example.com');

-- A の予定とシフト（予算・メモ・カードのある予定、時給のあるシフト）
insert into public.jobs (id, user_id, name, color, wage) values
  ('a0000000-0000-4000-8000-0000000009a1', 'a0000000-0000-4000-8000-000000000001', 'カフェ', 'blue', 1200);
insert into public.plans (user_id, title, start_date, end_date, start_time, end_time, budget, done, memo, color) values
  ('a0000000-0000-4000-8000-000000000001', '映画', '2026-11-20', '2026-11-20', '18:00', '20:00', 3000, true, '秘密のメモ', 'pink'),
  ('a0000000-0000-4000-8000-000000000001', '旅行', '2026-11-28', '2026-12-02', null, null, 50000, false, '', 'green'),
  ('a0000000-0000-4000-8000-000000000001', '遠い予定', '2027-03-01', '2027-03-01', null, null, 0, false, '', 'teal');
insert into public.shifts (user_id, date, job_id, start_time, end_time, wage, rest_minutes) values
  ('a0000000-0000-4000-8000-000000000001', '2026-11-22', 'a0000000-0000-4000-8000-0000000009a1', '10:00', '15:00', 1200, 30);
-- B 自身の予定
insert into public.plans (user_id, title, start_date, end_date, color) values
  ('b0000000-0000-4000-8000-000000000001', 'Bの予定', '2026-11-21', '2026-11-21', 'blue');

-- ============================================================
-- 構造（5）
-- ============================================================
select ok((select relrowsecurity from pg_class where oid = 'private.calendar_shares'::regclass), 'calendar_shares で RLS が有効');
select ok((select relrowsecurity from pg_class where oid = 'private.share_codes'::regclass), 'share_codes で RLS が有効');
select ok(
  not has_table_privilege('authenticated', 'private.calendar_shares', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'private.share_codes', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'private.calendar_shares', 'select'),
  '共有の表は、アプリのロールが直接触れない');
select ok(
  not has_function_privilege('anon', 'public.shared_calendar(uuid, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_share_code()', 'execute')
  and has_function_privilege('authenticated', 'public.shared_calendar(uuid, date, date)', 'execute'),
  'ログインしていない人は関数を呼べず、ログインした人は呼べる');
select throws_ok(
  $$ select public.get_my_share_code() $$, '28000', 'ログインが必要です', 'ログインしていないと、コードを作れない');

-- ============================================================
-- A: 共有コード（3）
-- ============================================================
create temp table codes (who text, code text);
create temp table share_id (id uuid);
create temp table cal (j jsonb);
grant all on codes, share_id, cal to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select matches(public.get_my_share_code(), '^[0-9a-f]{16}$', 'A のコードは16桁の16進数');
select is(public.get_my_share_code(), public.get_my_share_code(), '何度呼んでも同じコード');
select is((select count(*)::int from public.list_calendar_shares()), 0, 'はじめは共有がない');
insert into codes values ('a', public.get_my_share_code());

-- ============================================================
-- B: 申請（7）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_calendar_share('0000000000000000', '彼女') $$, 'P0002', 'コードが見つかりません', '知らないコードでは申請できない');
select throws_ok(
  $$ select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30') $$,
  '42501', '見る許可がありません', '申請前は、相手の予定を見られない');
select lives_ok(
  $$ select public.request_calendar_share(upper(substr((select code from codes where who = 'a'), 1, 4)) || '-' || substr((select code from codes where who = 'a'), 5), '彼女') $$,
  '大文字・区切り入りのコードでも申請できる');
select throws_ok(
  $$ select public.request_calendar_share((select code from codes where who = 'a'), '彼女') $$, '23505', 'すでに申請済みです', '同じ相手に2回は申請できない');
select throws_ok(
  $$ select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30') $$,
  '42501', '見る許可がありません', '承認されるまでは見られない');
select throws_ok(
  $$ select public.request_calendar_share(public.get_my_share_code(), 'じぶん') $$, '22023', '自分のコードは使えません', '自分のコードでは申請できない');
select is(
  (select row(direction, status, nickname)::text from public.list_calendar_shares()),
  '(viewing,pending,彼女)', 'B の一覧に、承認待ちの申請が出る');

-- ============================================================
-- A: 承認する（4）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select row(direction, status, other_email)::text from public.list_calendar_shares()),
  '(sharing,pending,b@example.com)', 'A の一覧に、B の申請が出る');
insert into share_id select id from public.list_calendar_shares();
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.respond_calendar_share((select id from share_id), true) $$, 'P0002', '申請が見つかりません', '関係のない人は承認できない');
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.respond_calendar_share((select id from share_id), true) $$, 'P0002', '申請が見つかりません', '見る側は自分で承認できない');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.respond_calendar_share((select id from share_id), true) $$, 'A は承認できる');

-- ============================================================
-- B: 相手のカレンダーを見る（7）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into cal select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30');
select is(jsonb_array_length((select j -> 'plans' from cal)), 2, '期間に重なる予定だけが返る（映画・旅行。遠い予定は返らない）');
select is((select j -> 'plans' -> 0 ->> 'title' from cal), '映画', '予定は日付と時刻の順');
select is(
  (select array_agg(k order by k) from cal, jsonb_object_keys(cal.j -> 'plans' -> 0) k),
  array['color', 'end_date', 'end_time', 'id', 'start_date', 'start_time', 'title'],
  '予定は見せる列だけ（予算・メモ・済み・カードは返らない）');
select is(
  (select array_agg(k order by k) from cal, jsonb_object_keys(cal.j -> 'shifts' -> 0) k),
  array['date', 'end_time', 'id', 'job', 'start_time'],
  'シフトは見せる列だけ（時給・休憩は返らない）');
select is((select j -> 'shifts' -> 0 ->> 'job' from cal), 'カフェ', 'シフトにバイト先の名前が付く');
select ok(not exists (select 1 from cal where j::text like '%秘密%' or j::text like '%50000%'), 'メモと予算の文字がどこにも出ない');
select throws_ok(
  $$ select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-01-01', '2026-12-31') $$,
  '22023', '期間が正しくありません（100日まで）', '長すぎる期間は断る');

-- ============================================================
-- 直接は読めない・他人・解除（4）
-- ============================================================
select is((select count(*)::int from public.plans where title = '映画'), 0,
  'B は、承認されても A の plans の表を直接は読めない（RLS）');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30') $$,
  '42501', '見る許可がありません', '関係のない人は、A の予定を見られない');
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.revoke_calendar_share((select id from share_id)) $$, 'B は自分から解除できる');
select throws_ok(
  $$ select public.shared_calendar('a0000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30') $$,
  '42501', '見る許可がありません', '解除したら見られない');

select * from finish();
rollback;
