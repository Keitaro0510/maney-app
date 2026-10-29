-- テーブル分割③④ (#11): 切り替えたあとの user_data と、片付けのテスト
-- - user_data への書き込みは止まっている（旧版のアプリに戻す関数と、アカウントの削除だけは通す）
-- - 古い JSON の複製と履歴は private.archive_user_data にまとめ、移行のためだけの関数は消した
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- ============================================================
-- user_data への書き込みは止まっている
-- ============================================================
select throws_ok($$
  insert into public.user_data (user_id, value) values ('a0000000-0000-4000-8000-000000000001', '{}')
$$, 'P0001', null, 'user_data に追加できない');

select set_config('maney.allow_user_data_write', 'on', true);
insert into public.user_data (user_id, value) values ('a0000000-0000-4000-8000-000000000001', '{"budget": 1}');
select set_config('maney.allow_user_data_write', '', true);
select is((select count(*)::int from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'), 1,
  '許したときだけ、user_data に書ける');

select throws_ok($$
  update public.user_data set value = '{}' where user_id = 'a0000000-0000-4000-8000-000000000001'
$$, 'P0001', null, 'user_data を変えられない');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$
  update public.user_data set value = value || '{"budget": 2}' where user_id = 'a0000000-0000-4000-8000-000000000001'
$$, 'P0001', null, '旧版のアプリの保存はエラーになる');
reset role;

-- ============================================================
-- 旧版のアプリに戻す（テーブルの内容で user_data を作り直す）
-- ============================================================
insert into public.settings (user_id, base_date, budget) values ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 60000);
insert into public.cards (user_id, name, close_day, bill_day) values ('a0000000-0000-4000-8000-000000000001', 'Aカード', 31, 27);

select lives_ok($$ select private.restore_user_data_from_tables('a0000000-0000-4000-8000-000000000001') $$,
  '旧版のアプリに戻す関数は、user_data に書ける');
select is(
  (select value from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'),
  private.export_to_user_data('a0000000-0000-4000-8000-000000000001'),
  '作り直した user_data は、逆の変換の結果と同じ');
select is(
  (select value -> 'cards' -> 0 ->> 'name' from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'Aカード', '切り替えたあとに記録した内容も、旧版のアプリに戻せる');

-- ============================================================
-- 片付け
-- ============================================================
select has_table('private', 'archive_user_data', '古い JSON のアーカイブがある');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.archive_user_data'::regclass),
  'アーカイブは RLS が有効（アプリからは読めない）');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relname in ('user_data_history', 'user_data_backup_20261029', 'user_data_backup_cutover')),
  0, '古い複製と履歴のテーブルは、アーカイブにまとめて消した');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname in ('migrate_user_data', 'find_unmigratable', 'compare_migration', 'jsonb_diff', 'cut_over', 'user_data_keep_history')),
  0, '移行のためだけの関数は消した');
select hasnt_table('public', 'ai_insights', '使わない月次アドバイスのテーブルは消した');

-- ============================================================
-- アカウントの削除
-- ============================================================
select lives_ok($$ delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'アカウントを消すと、user_data も一緒に消える（止めない）');

select * from finish();
rollback;
