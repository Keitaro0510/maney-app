-- 書き出した JSON のファイルで全部を置き換える（import_backup、D13）のテスト:
-- 権限・置き換え・写し・epoch・確かめ方・失敗したときに何も残らないこと・写しから戻せること
-- 実行: npx supabase test db（または bash scripts/db-test-docker.sh 08_import）
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- テスト用の2人（A と B）と、今のデータ（A と B に1件ずつの記録）
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');
insert into public.settings (id, user_id) values
  ('a0000000-0000-4000-8000-000000000801', 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000801', 'b0000000-0000-4000-8000-000000000001');
insert into public.categories (id, user_id, kind, name) values
  ('a0000000-0000-4000-8000-000000000802', 'a0000000-0000-4000-8000-000000000001', 'expense', '食費'),
  ('b0000000-0000-4000-8000-000000000802', 'b0000000-0000-4000-8000-000000000001', 'expense', '食費');
insert into public.ledger_entries (id, user_id, date, kind, amount, name, category_id, payment_method) values
  ('a0000000-0000-4000-8000-000000000803', 'a0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 300, '古い記録', 'a0000000-0000-4000-8000-000000000802', 'cash'),
  ('b0000000-0000-4000-8000-000000000803', 'b0000000-0000-4000-8000-000000000001', '2026-10-01', 'expense', 700, 'B の記録', 'b0000000-0000-4000-8000-000000000802', 'cash');

-- A が読み込むファイル。settings には、使わないはずの user_id（B）と created_at を入れておく。
-- 削除済みのカード（0912）も入れ、記録（0932）から指す
select set_config('test.file', $${
  "format": "maney-export", "version": 1, "exported_at": "2026-10-31T12:00:00.000Z",
  "tables": {
    "settings": [{"id": "a0000000-0000-4000-8000-000000000901", "acct_base": 120000, "base_date": "2026-10-01", "budget": 50000,
      "other_income": 0, "shift_close_day": 31, "shift_pay_day": 10, "fuyou_limit": "1300000",
      "user_id": "b0000000-0000-4000-8000-000000000001", "created_at": "2000-01-01T00:00:00Z"}],
    "cards": [
      {"id": "a0000000-0000-4000-8000-000000000911", "name": "楽天", "close_day": 15, "bill_day": 27, "position": 0, "deleted_at": null},
      {"id": "a0000000-0000-4000-8000-000000000912", "name": "古いカード", "close_day": 31, "bill_day": 10, "position": 1, "deleted_at": "2026-05-01T00:00:00Z"}],
    "jobs": [],
    "categories": [{"id": "a0000000-0000-4000-8000-000000000921", "kind": "expense", "name": "食費", "position": 0, "deleted_at": null}],
    "ledger_entries": [
      {"id": "a0000000-0000-4000-8000-000000000931", "date": "2026-10-30", "kind": "expense", "amount": 500, "name": "コンビニ",
       "memo": "", "category_id": "a0000000-0000-4000-8000-000000000921", "payment_method": "cash", "card_id": null, "position": 0},
      {"id": "a0000000-0000-4000-8000-000000000932", "date": "2026-04-20", "kind": "expense", "amount": 1200, "name": "ランチ",
       "memo": "", "category_id": "a0000000-0000-4000-8000-000000000921", "payment_method": "card",
       "card_id": "a0000000-0000-4000-8000-000000000912", "position": 1}],
    "shifts": [],
    "plans": [],
    "fixed_costs": [{"id": "a0000000-0000-4000-8000-000000000951", "name": "家賃", "amount": 50000, "day": 27, "kind": "expense",
      "payment_method": "bank", "card_id": null, "start_month": null, "end_month": null, "legacy_id": null, "position": 0}],
    "withdrawals": [],
    "salary_actuals": [],
    "card_bill_actuals": [],
    "tasks": [{"id": "a0000000-0000-4000-8000-000000000941", "title": "レポートを出す", "due_date": "2026-11-05",
      "completed_at": null, "memo": "", "position": 0}]
  }
}$$, true);

-- ============================================================
-- 構造と権限（5）
-- ============================================================
select has_function('public', 'import_backup', array['jsonb'], 'import_backup がある');
select ok(not has_function_privilege('anon', 'public.import_backup(jsonb)', 'execute'), 'ログインしていない人（anon）は呼べない');
select ok(has_function_privilege('authenticated', 'public.import_backup(jsonb)', 'execute'), 'ログインした人は呼べる');
select is(private.import_tables(), array[
  'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
  'fixed_costs', 'withdrawals', 'salary_actuals', 'card_bill_actuals', 'tasks'],
  '読み込むテーブルは、写しのテーブルと同じ（アプリの MoneyData.TABLES と同じ）');
select ok(
  (select command like '%before_import%' from cron.job where jobname = 'purge-snapshots'),
  '読み込む直前の写しも、90日で消す');

-- ============================================================
-- A が読み込む（8）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  set_config('test.result', public.import_backup(current_setting('test.file')::jsonb)::text, true)::jsonb ->> 'status',
  'imported', 'A はファイルを読み込める');
select is(
  (select array_agg(id::text order by id) from public.ledger_entries),
  array['a0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000932'],
  '記録はファイルの2件だけになる（前の記録は消える）');
select ok(
  (select user_id = 'a0000000-0000-4000-8000-000000000001' and created_at > '2020-01-01' and acct_base = 120000
   from public.settings where id = 'a0000000-0000-4000-8000-000000000901'),
  'ファイルの user_id・created_at は使わず、本人の行とサーバーの時刻になる');
select is(
  (select deleted_at from public.cards where id = 'a0000000-0000-4000-8000-000000000912'),
  '2026-05-01T00:00:00Z'::timestamptz, '削除済みのカードは、削除済みのまま入る');
select is((select title from public.tasks), 'レポートを出す', 'タスクも入る');
select is(
  current_setting('test.result')::jsonb -> 'counts',
  '{"settings": 1, "cards": 2, "jobs": 0, "categories": 1, "ledger_entries": 2, "shifts": 0, "plans": 0,
    "fixed_costs": 1, "withdrawals": 0, "salary_actuals": 0, "card_bill_actuals": 0, "tasks": 1}'::jsonb,
  'テーブルごとの件数を返す');
select ok(
  (current_setting('test.result')::jsonb ->> 'epoch')::int = 2 and (select epoch from public.sync_state) = 2,
  '移行の番号（epoch）が上がる');
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000801", "epoch": 1, "changes": [
    {"table": "tasks", "action": "insert", "id": "a0000000-0000-4000-8000-0000000009a1", "row": {"title": "古い端末から"}}
  ]}$$) ->> 'status',
  'stale_epoch', '読み込む前の epoch のままの端末は、保存する前に止まる');

-- ============================================================
-- 写し・ほかの人・行の履歴（3）
-- ============================================================
reset role;
select ok(
  (select reason = 'before_import' and data -> 'ledger_entries' @> '[{"id": "a0000000-0000-4000-8000-000000000803"}]'
   from private.snapshots where id = (current_setting('test.result')::jsonb ->> 'snapshot_id')::bigint),
  '読み込む直前の状態が、写し（before_import）に残る');
select ok(
  (select count(*) = 1 from public.ledger_entries where user_id = 'b0000000-0000-4000-8000-000000000001')
  and exists (select 1 from public.settings where user_id = 'b0000000-0000-4000-8000-000000000001'),
  'B のデータは変わらない');
-- テストは1つのトランザクションなので時刻では分けられない。消した行の DELETE と、入れた行の履歴を数える
select is(
  (select count(*)::int from private.row_history
   where (row_id = 'a0000000-0000-4000-8000-000000000803' and action = 'DELETE')
      or row_id in ('a0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000932')),
  0, '置き換えでは、行ごとの履歴を増やさない（写しで戻せる）');

-- ============================================================
-- 正しくないファイルは、何も書かずに止める（13）
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{format}', '"other"')) $$,
  '22023', 'このアプリが書き出したファイルではありません', 'format が違うファイルは読まない');
select throws_ok($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{version}', '2')) $$,
  '22023', 'ファイルの版（2）は読み込めません', '知らない版のファイルは読まない');
select throws_ok($$ select public.import_backup(current_setting('test.file')::jsonb #- '{tables,tasks}') $$,
  '22023', 'ファイルにテーブル tasks がありません', 'テーブルが欠けていたら止める（欠けたテーブルを空にしない）');
select throws_ok($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,fixed_incomes}', '[]')) $$,
  '22023', 'ファイルに、読み込めないテーブルがあります: fixed_incomes', '知らないテーブルがあれば止める');
select throws_ok($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,tasks,0,color}', '"pink"')) $$,
  '22023', 'tasks の 1件目: 列 color はありません', 'テーブルにない列があれば止める');
select throws_ok($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,settings}', '[]')) $$,
  '22023', '設定（settings）の行は1つにしてください', '設定の行がなければ止める');
select throws_like($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,ledger_entries,1,card_id}',
    '"a0000000-0000-4000-8000-000000000999"')) $$,
  '%ないカード・バイト先・カテゴリを指している行があります%', 'ファイルにないカードを指す記録があれば止める');
select throws_like($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,ledger_entries,0,id}',
    '"b0000000-0000-4000-8000-000000000803"')) $$,
  '%重なっている行があります%', 'ほかの人の行と同じ id があれば止める（ほかの人の行は上書きしない）');
select throws_like($$ select public.import_backup(jsonb_set(current_setting('test.file')::jsonb, '{tables,ledger_entries,0,date}', '"2026-13-40"')) $$,
  '%読めない値があります%', '日付として読めない値があれば止める');
select throws_ok($$ select public.import_backup(current_setting('test.file')::jsonb #- '{tables,ledger_entries,0,name}') $$,
  '23502', 'ファイルの中に、name が空の行があります', '欠かせない列が空なら止める');
select is(
  (select array_agg(id::text order by id) from public.ledger_entries),
  array['a0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000932'],
  '止まったときは、何も変わらない');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.import_backup(current_setting('test.file')::jsonb) $$,
  '42501', 'ログインしていません', 'ログインしていなければ止める');

reset role;
select is(
  (select count(*)::int from private.snapshots where user_id = 'a0000000-0000-4000-8000-000000000001' and reason = 'before_import'),
  1, '止まったときは、写しも残らない（書き込みはすべて取り消される）');

-- ============================================================
-- 読み込む直前の写しから戻せる（2）
-- ============================================================
select ok(private.restore_snapshot((current_setting('test.result')::jsonb ->> 'snapshot_id')::bigint) > 0, '読み込む直前の写しから戻せる');
select is(
  (select array_agg(id::text order by id) from public.ledger_entries where user_id = 'a0000000-0000-4000-8000-000000000001'),
  array['a0000000-0000-4000-8000-000000000803'], '戻すと、読み込む前の記録になる');

select * from finish();
rollback;
