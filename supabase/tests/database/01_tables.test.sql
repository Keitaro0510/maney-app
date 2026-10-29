-- テーブル分割① (#11): テーブル・制約・RLS・行の履歴のテスト
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- テスト用の2人（A と B）
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

create temp table new_tables (name text) on commit drop;
insert into new_tables values
  ('settings'), ('cards'), ('jobs'), ('categories'), ('ledger_entries'), ('shifts'), ('plans'),
  ('fixed_costs'), ('fixed_incomes'), ('withdrawals'), ('salary_actuals'), ('card_bill_actuals');

-- ============================================================
-- 構造（16）
-- ============================================================
select has_table('public', name, name || ' がある') from new_tables;

select is(
  (select count(*)::int from pg_class c join new_tables t on t.name = c.relname
   where c.relnamespace = 'public'::regnamespace and c.relrowsecurity),
  12, 'すべてのテーブルで RLS が有効');

select is(
  (select count(*)::int from pg_policies p join new_tables t on t.name = p.tablename
   where p.schemaname = 'public' and p.policyname = '本人の行だけ'),
  12, 'すべてのテーブルに「本人の行だけ」のポリシーがある');

select is(
  (select count(*)::int from new_tables
   where has_table_privilege('anon', 'public.' || name, 'select, insert, update, delete, truncate')
      or has_table_privilege('authenticated', 'public.' || name, 'truncate')),
  0, 'anon はどのテーブルにも触れず、authenticated は TRUNCATE できない');

select is(
  (select count(*)::int from cron.job where jobname = 'purge-row-history'),
  1, '履歴を90日で消す cron がある');

-- ============================================================
-- A として登録する（18）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok($$
  insert into public.settings (user_id, base_date) values ('a0000000-0000-4000-8000-000000000001', '2026-10-01')
$$, 'A は設定を登録できる');

select throws_ok($$
  insert into public.settings (user_id, base_date) values ('a0000000-0000-4000-8000-000000000001', '2026-10-02')
$$, '23505', null, '設定は1人1行');

select lives_ok($$
  insert into public.cards (id, user_id, name, close_day, bill_day, position) values
    ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', '楽天カード', 31, 27, 0)
$$, 'A は自分のカードを登録できる');

select lives_ok($$
  insert into public.categories (id, user_id, kind, name, position) values
    ('a0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000001', 'expense', '食費', 0),
    ('a0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', 'income', '給与', 0)
$$, 'A は自分のカテゴリを登録できる');

select lives_ok($$
  insert into public.ledger_entries (id, user_id, date, kind, amount, name, category_id, payment_method, card_id) values
    ('a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 1200, 'ランチ',
     'a0000000-0000-4000-8000-0000000000e1', 'card', 'a0000000-0000-4000-8000-0000000000c1')
$$, 'A は自分のカードとカテゴリを使って記録できる');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method) values
    ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 100, 'x', 'a0000000-0000-4000-8000-0000000000e1', 'card')
$$, '23514', null, 'カード払いなのにカードがない記録は入らない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method, card_id) values
    ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 100, 'x', 'a0000000-0000-4000-8000-0000000000e1', 'cash',
     'a0000000-0000-4000-8000-0000000000c1')
$$, '23514', null, '現金払いなのにカードがある記録は入らない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method, card_id) values
    ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'income', 100, 'x', 'a0000000-0000-4000-8000-0000000000f1', 'card',
     'a0000000-0000-4000-8000-0000000000c1')
$$, '23514', null, '収入はカード払いにできない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method) values
    ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 100, 'x', 'a0000000-0000-4000-8000-0000000000f1', 'cash')
$$, '23503', null, '支出の記録に収入のカテゴリは付けられない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method) values
    ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', -1, 'x', 'a0000000-0000-4000-8000-0000000000e1', 'cash')
$$, '23514', null, '金額はマイナスにできない');

select throws_ok($$
  insert into public.cards (user_id, name, close_day, bill_day) values
    ('a0000000-0000-4000-8000-000000000001', '楽天カード', 15, 10)
$$, '23505', null, '削除していないカードの名前は重ならない');

select lives_ok($$
  insert into public.jobs (id, user_id, name, color, wage, created_at, updated_at) values
    ('a0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000001', 'カフェ', 'blue', 1300,
     '2000-01-01', '2000-01-01')
$$, 'A は自分のバイト先を登録できる');

select ok(
  (select created_at > '2001-01-01' and updated_at > '2001-01-01' from public.jobs
   where id = 'a0000000-0000-4000-8000-0000000000b1'),
  '登録日時と更新日時はサーバーの時刻になる（アプリが送った値は使わない）');

select results_eq($$
  with before as (select updated_at from public.cards where id = 'a0000000-0000-4000-8000-0000000000c1'),
       changed as (update public.cards set bill_day = 26 where id = 'a0000000-0000-4000-8000-0000000000c1' returning updated_at)
  select (select updated_at from changed) > (select updated_at from before)
$$, $$ values (true) $$, '更新すると updated_at が新しくなる');

select throws_ok($$
  update public.cards set user_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a0000000-0000-4000-8000-0000000000c1'
$$, 'P0001', null, 'user_id は変えられない');

select throws_ok($$
  delete from public.cards where id = 'a0000000-0000-4000-8000-0000000000c1'
$$, '23503', null, '記録が使っているカードは消せない（削除済みにする）');

select lives_ok($$
  update public.cards set deleted_at = now() where id = 'a0000000-0000-4000-8000-0000000000c1'
$$, 'カードを削除済みにできる');

select lives_ok($$
  insert into public.cards (id, user_id, name, close_day, bill_day, position) values
    ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000001', '楽天カード', 31, 27, 1)
$$, '削除済みのカードと同じ名前のカードは作れる');

-- ============================================================
-- B から A の行に触れない（7）
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select (select count(*) from public.settings) + (select count(*) from public.cards)
        + (select count(*) from public.jobs) + (select count(*) from public.categories)
        + (select count(*) from public.ledger_entries))::int,
  0, 'B には A の行が見えない');

select results_eq($$
  with changed as (update public.cards set name = '乗っ取り' where id = 'a0000000-0000-4000-8000-0000000000c2' returning 1)
  select count(*)::int from changed
$$, $$ values (0) $$, 'B は A のカードを変えられない');

select results_eq($$
  with removed as (delete from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101' returning 1)
  select count(*)::int from removed
$$, $$ values (0) $$, 'B は A の記録を消せない');

select throws_ok($$
  insert into public.cards (user_id, name, close_day, bill_day) values
    ('a0000000-0000-4000-8000-000000000001', 'なりすまし', 31, 27)
$$, '42501', null, 'B は A の名前で登録できない');

select lives_ok($$
  insert into public.categories (id, user_id, kind, name) values
    ('b0000000-0000-4000-8000-0000000000e1', 'b0000000-0000-4000-8000-000000000001', 'expense', '食費')
$$, 'B は自分のカテゴリを登録できる（A と同じ名前でもよい）');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method, card_id) values
    ('b0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 100, 'x', 'b0000000-0000-4000-8000-0000000000e1', 'card',
     'a0000000-0000-4000-8000-0000000000c2')
$$, '23503', null, 'B は A のカードを参照できない');

select throws_ok($$
  insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method) values
    ('b0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 100, 'x', 'a0000000-0000-4000-8000-0000000000e1', 'cash')
$$, '23503', null, 'B は A のカテゴリを参照できない');

-- ============================================================
-- ログインしていない人（1）
-- ============================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.cards $$, '42501', null, 'ログインしていない人はテーブルを読めない');

-- ============================================================
-- 行の履歴（7）
-- ============================================================
reset role;

select results_eq($$
  select action from private.row_history where row_id = 'a0000000-0000-4000-8000-0000000000c1' order by id
$$, $$ values ('INSERT'), ('UPDATE'), ('UPDATE') $$,
  '追加と更新が履歴に残る（失敗した変更は残らない）');

select results_eq($$
  select old_row ->> 'bill_day', new_row ->> 'bill_day' from private.row_history
  where row_id = 'a0000000-0000-4000-8000-0000000000c1' and action = 'UPDATE' order by id limit 1
$$, $$ values ('27', '26') $$, '履歴に変更の前と後の行が残る');

update public.cards set name = name where id = 'a0000000-0000-4000-8000-0000000000c2';
select is(
  (select count(*)::int from private.row_history where row_id = 'a0000000-0000-4000-8000-0000000000c2'),
  1, '中身が変わらない更新は履歴に残さない');

select set_config('maney.op_id', 'dddddddd-0000-4000-8000-000000000001', true);
update public.cards set bill_day = 25 where id = 'a0000000-0000-4000-8000-0000000000c2';
select set_config('maney.op_id', '', true);
select is(
  (select op_id from private.row_history where row_id = 'a0000000-0000-4000-8000-0000000000c2' order by id desc limit 1),
  'dddddddd-0000-4000-8000-000000000001'::uuid, '操作 ID が履歴に残る');

select set_config('maney.skip_history', 'on', true);
insert into public.withdrawals (id, user_id, date, amount) values
  ('a0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-000000000001', '2026-10-01', 3000);
select set_config('maney.skip_history', '', true);
select is(
  (select count(*)::int from private.row_history where row_id = 'a0000000-0000-4000-8000-000000000201'),
  0, '移行のとき（maney.skip_history = on）は履歴を残さない');

delete from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101';
select results_eq($$
  select action, old_row ->> 'name', new_row is null from private.row_history
  where row_id = 'a0000000-0000-4000-8000-000000000101' order by id desc limit 1
$$, $$ values ('DELETE', 'ランチ', true) $$, '削除した行が履歴に残る');

select is(
  (select count(*)::int from private.row_history where user_id = 'b0000000-0000-4000-8000-000000000001'),
  1, 'B の履歴は B の行の分だけ');

-- ============================================================
-- アカウントの削除（3）
-- ============================================================
-- A のデータに、すべてのテーブルの行がある状態で消す
insert into public.ledger_entries (user_id, date, kind, amount, name, category_id, payment_method, card_id) values
  ('a0000000-0000-4000-8000-000000000001', '2026-10-02', 'expense', 800, 'コンビニ',
   'a0000000-0000-4000-8000-0000000000e1', 'card', 'a0000000-0000-4000-8000-0000000000c1');
insert into public.shifts (user_id, date, job_id, start_time, end_time, wage, rest_minutes) values
  ('a0000000-0000-4000-8000-000000000001', '2026-10-03', 'a0000000-0000-4000-8000-0000000000b1', '10:00', '15:00', 1300, 0);
insert into public.plans (user_id, title, start_date, end_date, color, card_id) values
  ('a0000000-0000-4000-8000-000000000001', '旅行', '2026-11-01', '2026-11-02', 'green', 'a0000000-0000-4000-8000-0000000000c1');
insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, card_id) values
  ('a0000000-0000-4000-8000-000000000001', '携帯', 3000, 15, 'expense', 'card', 'a0000000-0000-4000-8000-0000000000c1');
insert into public.fixed_incomes (user_id, name, amount, day) values
  ('a0000000-0000-4000-8000-000000000001', '仕送り', 30000, 25);
insert into public.salary_actuals (user_id, job_id, pay_month, paid_on, actual_amount, estimated_amount) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000b1', '2026-11-01', '2026-11-10', 50000, 48000);
insert into public.card_bill_actuals (user_id, card_id, bill_month, actual_amount, estimated_amount) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c1', '2026-11-01', 30000, 29000);

select lives_ok($$
  delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001'
$$, 'アカウントを消せる（カードなどを参照している記録があっても）');

select is(
  (select (select count(*) from public.settings where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.cards where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.jobs where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.categories where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.ledger_entries where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.shifts where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.plans where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.fixed_costs where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.fixed_incomes where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.withdrawals where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.salary_actuals where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.card_bill_actuals where user_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from private.row_history where user_id = 'a0000000-0000-4000-8000-000000000001'))::int,
  0, 'アカウントを消すと、データと履歴が一緒に消える');

select is(
  (select count(*)::int from public.categories where user_id = 'b0000000-0000-4000-8000-000000000001'),
  1, 'ほかの人のデータは残る');

select * from finish();
rollback;
