-- テーブル分割①-4 (#11): 戻し方（1行・1つの操作・全体の写し・旧版のアプリ）のテスト
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- A がアプリから保存する（apply_op）
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.apply_op($${"id": "0e000000-0000-4000-8000-000000000001", "epoch": 1, "changes": [
  {"table": "settings", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000a1", "row": {"base_date": "2026-10-01"}},
  {"table": "cards", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000c1",
   "row": {"name": "Aカード", "close_day": 31, "bill_day": 27}},
  {"table": "categories", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000e1",
   "row": {"kind": "expense", "name": "食費"}},
  {"table": "ledger_entries", "action": "insert", "id": "a0000000-0000-4000-8000-000000000101",
   "row": {"date": "2026-10-01", "kind": "expense", "amount": 1000, "name": "ランチ",
           "category_id": "a0000000-0000-4000-8000-0000000000e1", "payment_method": "cash", "position": 0}},
  {"table": "ledger_entries", "action": "insert", "id": "a0000000-0000-4000-8000-000000000102",
   "row": {"date": "2026-10-02", "kind": "expense", "amount": 2000, "name": "夕食",
           "category_id": "a0000000-0000-4000-8000-0000000000e1", "payment_method": "card",
           "card_id": "a0000000-0000-4000-8000-0000000000c1", "position": 1}}
]}$$);
reset role;

create temp table original on commit drop as
  select id, created_at from public.ledger_entries where user_id = 'a0000000-0000-4000-8000-000000000001';
grant select on original to authenticated;

-- 1つ目を変え、2つ目を消す
set local role authenticated;
select public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000002', 'epoch', 1, 'changes', jsonb_build_array(
  jsonb_build_object('table', 'ledger_entries', 'action', 'update', 'id', 'a0000000-0000-4000-8000-000000000101',
    'base', (select updated_at from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101'),
    'row', jsonb_build_object('amount', 1500)),
  jsonb_build_object('table', 'ledger_entries', 'action', 'delete', 'id', 'a0000000-0000-4000-8000-000000000102',
    'base', (select updated_at from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000102')))));
reset role;

-- ============================================================
-- 1つの操作を取り消す
-- ============================================================
create temp table undo1 on commit drop as select private.undo_op('0e000000-0000-4000-8000-000000000002') as op_id;

select is(
  (select amount from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101'),
  1000, '操作を取り消すと、変えた行が元に戻る');
select is(
  (select amount from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000102'),
  2000, '操作を取り消すと、消した行が戻る');
select ok(
  (select l.created_at = o.created_at from public.ledger_entries l join original o on o.id = l.id
   where l.id = 'a0000000-0000-4000-8000-000000000102'),
  '消した行を戻すと、登録日時は元のまま');
select is(
  (select count(*)::int from private.row_history where op_id = (select op_id from undo1)),
  2, '取り消しも、1つの操作として履歴に残る');

-- 取り消しを取り消す
select private.undo_op((select op_id from undo1));
select is(
  (select count(*)::int from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000102'),
  0, '取り消しを取り消すと、もう一度消える');
select is(
  (select amount from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101'),
  1500, '取り消しを取り消すと、変えた値に戻る');

-- あとで変わった行がある操作は、取り消さない
select throws_ok($$ select private.undo_op('0e000000-0000-4000-8000-000000000001') $$,
  'P0001', null, 'その操作のあとに変わった行があれば、取り消さない');
select throws_ok($$ select private.undo_op('0e000000-0000-4000-8000-000000000099') $$,
  'P0001', null, '履歴のない操作 ID はエラー');

-- ============================================================
-- 1行だけ戻す
-- ============================================================
select private.restore_row((
  select id from private.row_history
  where row_id = 'a0000000-0000-4000-8000-000000000101' and action = 'UPDATE' and op_id = '0e000000-0000-4000-8000-000000000002'));
select is(
  (select amount from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101'),
  1000, '履歴の1件の、変更する前の状態に戻せる');
select ok(
  (select l.created_at = o.created_at from public.ledger_entries l join original o on o.id = l.id
   where l.id = 'a0000000-0000-4000-8000-000000000101'),
  '1行だけ戻しても、登録日時は変わらない');

-- ============================================================
-- 全体の写し
-- ============================================================
create temp table snap on commit drop as
  select private.take_snapshot('a0000000-0000-4000-8000-000000000001', 'manual') as id;
select is(
  (select jsonb_array_length(data -> 'ledger_entries') from private.snapshots where id = (select id from snap)),
  1, '写しに、全テーブルの行が入る');

-- 写しのあとに変える
insert into public.withdrawals (user_id, date, amount) values ('a0000000-0000-4000-8000-000000000001', '2026-10-05', 3000);
update public.cards set name = '変えた' where id = 'a0000000-0000-4000-8000-0000000000c1';
delete from public.ledger_entries where id = 'a0000000-0000-4000-8000-000000000101';

create temp table before_restore on commit drop as select private.restore_snapshot((select id from snap)) as id;
select is((select count(*)::int from public.withdrawals where user_id = 'a0000000-0000-4000-8000-000000000001'), 0, '全体を戻すと、写しのあとに追加した行は消える');
select is((select name from public.cards where id = 'a0000000-0000-4000-8000-0000000000c1'), 'Aカード',
  '全体を戻すと、写しのあとに変えた行は元に戻る');
select ok(
  (select l.created_at = o.created_at from public.ledger_entries l join original o on o.id = l.id
   where l.id = 'a0000000-0000-4000-8000-000000000101'),
  '全体を戻すと、写しのあとに消した行が、元の登録日時で戻る');
select is(
  (select reason from private.snapshots where id = (select id from before_restore)),
  'before_restore', '戻す直前の状態も写しに残る');
select is(
  (select jsonb_array_length(data -> 'withdrawals') from private.snapshots where id = (select id from before_restore)),
  1, '戻す直前の写しには、消えた行も入っている');

select is(private.take_daily_snapshots(), (select count(*)::int from public.settings), '毎日の写しは、新しいテーブルを使っている人の分だけ取る');
select is(
  (select count(*)::int from cron.job where jobname in ('daily-snapshots', 'purge-snapshots')),
  2, '毎日の写しと、古い写しを消す cron がある');

-- ============================================================
-- 旧版のアプリに戻す
-- ============================================================
select ok(private.restore_user_data_from_tables('a0000000-0000-4000-8000-000000000001') is not null,
  'テーブルの内容から user_data を作り直せる');
select is(
  (select value from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'),
  private.export_to_user_data('a0000000-0000-4000-8000-000000000001'),
  '作り直した user_data は、逆の変換の結果と同じ');

-- ============================================================
-- アプリからは呼べない
-- ============================================================
set local role authenticated;
select throws_ok($$ select private.take_snapshot('a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'ログインした人も、戻し方の関数は呼べない');
reset role;

select * from finish();
rollback;
