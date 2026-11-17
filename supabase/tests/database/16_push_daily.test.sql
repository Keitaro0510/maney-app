-- 朝の通知の定期実行（Issue #189・D36）のテスト: 合言葉・url が空なら送らない・毎朝8:00（日本時間）の予定
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table('private', 'push_cron', 'push_cron がある');
select is((select count(*)::int from private.push_cron), 1, '設定は1行だけ');
select ok((select relrowsecurity from pg_class where oid = 'private.push_cron'::regclass), 'push_cron で RLS が有効');
select ok(
  not has_table_privilege('authenticated', 'private.push_cron', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'private.push_cron', 'select'),
  'アプリのロールは、合言葉を読めない');
select ok((select char_length(secret) >= 60 from private.push_cron), '合言葉は十分に長いランダムな文字');
select ok((select url is null from private.push_cron), '送り先の URL は、マイグレーションでは入れない（手元・CI は何も送らない）');

-- 合言葉を確かめる関数は、service_role だけ
select ok(
  has_function_privilege('service_role', 'public.verify_push_cron_secret(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.verify_push_cron_secret(text)', 'execute')
  and not has_function_privilege('anon', 'public.verify_push_cron_secret(text)', 'execute'),
  '合言葉の確認は service_role だけが呼べる');
select ok(public.verify_push_cron_secret((select secret from private.push_cron)), '正しい合言葉は通る');
select ok(
  not public.verify_push_cron_secret('違う合言葉') and not public.verify_push_cron_secret('') and not public.verify_push_cron_secret(null),
  '違う・空・null の合言葉は通らない');

-- url が空なら、何も送らずに終わる（エラーにならない）
select lives_ok($$ select private.run_push_daily() $$, 'url が空なら、何もせず終わる');
select is(
  (select schedule from cron.job where jobname = 'push-daily'),
  '0 23 * * *', '毎日 23:00 UTC（日本時間の朝8:00）に動く');

select * from finish();
rollback;
