-- テーブル分割①-2 (#11): 保存の関数 apply_op のテスト
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

-- 操作の結果を取っておく表（ログインしたユーザーからも書けるようにする）
create temp table results (name text primary key, result jsonb) on commit drop;
grant all on results to authenticated, anon;

-- ============================================================
-- A が保存する
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- カード・カテゴリ・記録を1つの操作で登録する
insert into results select 'op1', public.apply_op($${
  "id": "0e000000-0000-4000-8000-000000000001", "epoch": 1,
  "changes": [
    {"table": "cards", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000c1",
     "row": {"name": "楽天カード", "close_day": 31, "bill_day": 27, "position": 0}},
    {"table": "categories", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000e1",
     "row": {"kind": "expense", "name": "食費", "position": 0}},
    {"table": "ledger_entries", "action": "insert", "id": "a0000000-0000-4000-8000-000000000101",
     "row": {"date": "2026-10-01", "kind": "expense", "amount": 1200, "name": "ランチ",
             "category_id": "a0000000-0000-4000-8000-0000000000e1", "payment_method": "card",
             "card_id": "a0000000-0000-4000-8000-0000000000c1", "position": 0}}
  ]}$$);

select is((select result ->> 'status' from results where name = 'op1'), 'applied', '1つの操作で複数の行を保存できる');
select is((select jsonb_array_length(result -> 'rows') from results where name = 'op1'), 3, '保存した行ごとに結果を返す');
select ok(
  (select bool_and(r ->> 'updated_at' is not null) from results, jsonb_array_elements(result -> 'rows') r where name = 'op1'),
  '保存した行の updated_at を返す');

-- 同じ操作の再送
select is(
  public.apply_op((select '{"id": "0e000000-0000-4000-8000-000000000001", "epoch": 1, "changes": [{"table": "cards", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000c1", "row": {"name": "楽天カード", "close_day": 31, "bill_day": 27}}]}'::jsonb)),
  (select result from results where name = 'op1'),
  '同じ操作 ID が再送されたら、前回の結果を返す');
select is((select count(*)::int from public.cards), 1, '再送しても二重に保存しない');

-- 移行の番号が違う
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000002", "epoch": 2,
    "changes": [{"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000201",
                 "row": {"date": "2026-10-01", "amount": 3000}}]}$$),
  '{"status": "stale_epoch", "epoch": 1}'::jsonb,
  '移行の番号が違う操作は受け付けない');

-- 更新（読み込んだときの updated_at が今と同じ）
insert into results select 'op2', public.apply_op(jsonb_build_object(
  'id', '0e000000-0000-4000-8000-000000000003', 'epoch', 1,
  'changes', jsonb_build_array(jsonb_build_object(
    'table', 'cards', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000000c1',
    'base', (select result -> 'rows' -> 0 ->> 'updated_at' from results where name = 'op1'),
    'row', jsonb_build_object('name', '楽天カード', 'close_day', 31, 'bill_day', 26, 'position', 0)))));
select is((select result ->> 'status' from results where name = 'op2'), 'applied', '読み込んだあとに変わっていなければ更新できる');
select is((select bill_day::int from public.cards where id = 'a0000000-0000-4000-8000-0000000000c1'), 26, '更新した値が入る');

-- 競合: 読み込んだあとに、別の端末が変えた（古い updated_at で送る）。同じ操作のほかの変更も保存しない
insert into results select 'op3', public.apply_op(jsonb_build_object(
  'id', '0e000000-0000-4000-8000-000000000004', 'epoch', 1,
  'changes', jsonb_build_array(
    jsonb_build_object('table', 'withdrawals', 'action', 'insert', 'id', 'a0000000-0000-4000-8000-000000000201',
      'row', jsonb_build_object('date', '2026-10-01', 'amount', 3000)),
    jsonb_build_object('table', 'cards', 'action', 'update', 'id', 'a0000000-0000-4000-8000-0000000000c1',
      'base', (select result -> 'rows' -> 0 ->> 'updated_at' from results where name = 'op1'),
      'row', jsonb_build_object('bill_day', 10)))));
select is((select result ->> 'status' from results where name = 'op3'), 'conflict', '別の端末が変えた行を更新すると競合になる');
select is((select result -> 'conflicts' -> 0 ->> 'reason' from results where name = 'op3'), 'changed', '競合の理由は changed');
select is((select (result -> 'conflicts' -> 0 -> 'server' ->> 'bill_day')::int from results where name = 'op3'), 26, '競合のときはサーバーの今の行を返す');
select is((select count(*)::int from public.withdrawals), 0, '競合した操作は、ほかの変更も保存しない');

-- 競合: 別の端末が消した行を編集した
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000005", "epoch": 1,
    "changes": [{"table": "withdrawals", "action": "update", "id": "a0000000-0000-4000-8000-000000000299",
                 "base": "2026-10-01T00:00:00Z", "row": {"amount": 1}}]}$$) -> 'conflicts' -> 0 ->> 'reason',
  'missing', '消えた行を編集すると競合になる（理由は missing）');

-- すでに消えている行を消すのは成功
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000006", "epoch": 1,
    "changes": [{"table": "withdrawals", "action": "delete", "id": "a0000000-0000-4000-8000-000000000299",
                 "base": "2026-10-01T00:00:00Z"}]}$$) ->> 'status',
  'applied', 'すでに消えている行を消すのは成功');

-- 競合: 別の端末が変えた行を消す
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000007", "epoch": 1,
    "changes": [{"table": "cards", "action": "delete", "id": "a0000000-0000-4000-8000-0000000000c1",
                 "base": "2026-10-01T00:00:00Z"}]}$$) -> 'conflicts' -> 0 ->> 'reason',
  'changed', '別の端末が変えた行を消すと競合になる');

-- 競合: 同じ id の行がすでにある
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000008", "epoch": 1,
    "changes": [{"table": "cards", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000c1",
                 "row": {"name": "別のカード", "close_day": 15, "bill_day": 10}}]}$$) -> 'conflicts' -> 0 ->> 'reason',
  'exists', '同じ id の行がすでにあると競合になる');

-- 競合: 同じ月の給与の実績を、2台が別々に新しく登録した
insert into results select 'op9', public.apply_op($${"id": "0e000000-0000-4000-8000-000000000009", "epoch": 1,
  "changes": [
    {"table": "jobs", "action": "insert", "id": "a0000000-0000-4000-8000-0000000000b1",
     "row": {"name": "カフェ", "color": "blue", "wage": 1300}},
    {"table": "salary_actuals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000301",
     "row": {"job_id": "a0000000-0000-4000-8000-0000000000b1", "pay_month": "2026-11-01", "paid_on": "2026-11-10",
             "actual_amount": 50000, "estimated_amount": 48000}}]}$$);
insert into results select 'op10', public.apply_op($${"id": "0e000000-0000-4000-8000-000000000010", "epoch": 1,
  "changes": [
    {"table": "salary_actuals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000302",
     "row": {"job_id": "a0000000-0000-4000-8000-0000000000b1", "pay_month": "2026-11-01", "paid_on": "2026-11-10",
             "actual_amount": 51000, "estimated_amount": 48000}}]}$$);
select is((select result -> 'conflicts' -> 0 ->> 'reason' from results where name = 'op10'), 'duplicate',
  '同じバイト先・同じ月の給与の実績を別々に登録すると競合になる（理由は duplicate）');
select is((select result -> 'conflicts' -> 0 -> 'server' ->> 'id' from results where name = 'op10'),
  'a0000000-0000-4000-8000-000000000301', '競合のときは、サーバーにある行を返す');

-- 制約に違反したら、操作全体を保存しない
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000011", "epoch": 1, "changes": [
    {"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000202", "row": {"date": "2026-10-01", "amount": 3000}},
    {"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000203", "row": {"date": "2026-10-01", "amount": -1}}]}')
$$, '23514', null, '制約に違反した操作はエラーになる');
select is((select count(*)::int from public.withdrawals), 0, 'エラーになった操作は、ほかの変更も保存しない');

-- 入力の誤り
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000012", "epoch": 1, "changes": [
    {"table": "user_data", "action": "insert", "id": "a0000000-0000-4000-8000-000000000204", "row": {"value": {}}}]}')
$$, '22023', null, '決まったテーブル以外には保存できない');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000013", "epoch": 1, "changes": [
    {"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000205", "row": {"date": "2026-10-01", "amount": 1, "amount_typo": 1}}]}')
$$, '22023', null, 'ない列を送るとエラーになる');
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000014", "epoch": 1, "changes": [
    {"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000206", "row": {"date": "2026-10-01", "amount": 1}},
    {"table": "withdrawals", "action": "delete", "id": "a0000000-0000-4000-8000-000000000206", "base": "2026-10-01T00:00:00Z"}]}')
$$, '22023', null, '1つの操作で同じ行を2回変えるとエラーになる');

-- サーバーが決める列（user_id・created_at など）は、送っても使わない
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000015", "epoch": 1,
    "changes": [{"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000207",
                 "row": {"date": "2026-10-02", "amount": 500, "user_id": "b0000000-0000-4000-8000-000000000001",
                         "created_at": "2000-01-01T00:00:00Z"}}]}$$) ->> 'status',
  'applied', 'user_id などを送っても保存できる');
select ok(
  (select user_id = 'a0000000-0000-4000-8000-000000000001' and created_at > '2001-01-01'
   from public.withdrawals where id = 'a0000000-0000-4000-8000-000000000207'),
  '送ってきた user_id・created_at は使わない');

-- ============================================================
-- B から A の行に触れない
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.apply_op(jsonb_build_object('id', '0e000000-0000-4000-8000-000000000016', 'epoch', 1,
    'changes', jsonb_build_array(jsonb_build_object('table', 'cards', 'action', 'update',
      'id', 'a0000000-0000-4000-8000-0000000000c1',
      'base', (select result -> 'rows' -> 0 ->> 'updated_at' from results where name = 'op2'),
      'row', jsonb_build_object('name', '乗っ取り'))))) -> 'conflicts' -> 0 ->> 'reason',
  'missing', 'B が A の行を更新しようとしても、行がないことになる');

select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000017", "epoch": 1, "changes": [
    {"table": "categories", "action": "insert", "id": "b0000000-0000-4000-8000-0000000000e1", "row": {"kind": "expense", "name": "食費"}},
    {"table": "ledger_entries", "action": "insert", "id": "b0000000-0000-4000-8000-000000000101",
     "row": {"date": "2026-10-01", "kind": "expense", "amount": 100, "name": "x", "category_id": "b0000000-0000-4000-8000-0000000000e1",
             "payment_method": "card", "card_id": "a0000000-0000-4000-8000-0000000000c1"}}]}')
$$, '23503', null, 'B は A のカードを参照できない');

select is((select count(*)::int from public.applied_ops), 0, 'B には A の操作の記録が見えない');

select throws_ok($$
  insert into public.sync_state (user_id, epoch) values ('b0000000-0000-4000-8000-000000000001', 9)
$$, '42501', null, 'アプリから移行の番号は変えられない');

-- ============================================================
-- ログインしていない人
-- ============================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$
  select public.apply_op('{"id": "0e000000-0000-4000-8000-000000000018", "epoch": 1, "changes": []}')
$$, '42501', null, 'ログインしていない人は apply_op を呼べない');

-- ============================================================
-- 管理者として確かめる
-- ============================================================
reset role;

select is(
  (select count(*)::int from private.row_history where op_id = '0e000000-0000-4000-8000-000000000001'),
  3, '行の履歴に操作 ID が残る');
select is(
  (select name from public.cards where id = 'a0000000-0000-4000-8000-0000000000c1'),
  '楽天カード', 'B の操作で A のカードは変わっていない');
select is(
  (select count(*)::int from public.applied_ops where user_id = 'a0000000-0000-4000-8000-000000000001'),
  5, '保存できた操作だけを記録する（競合・移行の番号違い・エラーは記録しない）');

-- 移行し直した（epoch が上がった）あとは、古い番号の操作を受け付けない
insert into public.sync_state (user_id, epoch) values ('a0000000-0000-4000-8000-000000000001', 3);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  public.apply_op($${"id": "0e000000-0000-4000-8000-000000000019", "epoch": 1,
    "changes": [{"table": "withdrawals", "action": "insert", "id": "a0000000-0000-4000-8000-000000000208",
                 "row": {"date": "2026-10-01", "amount": 3000}}]}$$),
  '{"status": "stale_epoch", "epoch": 3}'::jsonb,
  '移行し直したあとは、古い番号の操作を受け付けず、今の番号を返す');
reset role;

select is(
  (select count(*)::int from cron.job where jobname = 'purge-applied-ops'),
  1, '操作の記録を90日で消す cron がある');

select * from finish();
rollback;
