-- テーブル分割③ (#11): 切り替え（user_data への書き込みを止める・切り替え済みを記録する）のテスト
-- 実行: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- ============================================================
-- user_data への書き込みを止める
-- ============================================================
select throws_ok($$
  insert into public.user_data (user_id, value) values ('a0000000-0000-4000-8000-000000000001', '{}')
$$, 'P0001', null, 'user_data に追加できない');

-- テストのデータを入れる（旧版のアプリに戻すときと同じく、許したときだけ書ける）
select set_config('maney.allow_user_data_write', 'on', true);
insert into public.user_data (user_id, value) values ('a0000000-0000-4000-8000-000000000001', $json$
{
  "acctBase": 1000, "baseDate": "2026-10-01", "budget": 50000, "otherIncome": 0,
  "shiftCloseDay": 31, "shiftPayDay": 10, "fuyouLimit": "1300000",
  "cards": [{"name": "Aカード", "billDay": "27", "closeDay": "31"}],
  "jobs": [{"name": "カフェ", "wage": 1300, "color": "blue", "nightRate": 25, "transport": 200, "nightStart": "22:00"}],
  "catExp": ["食費"], "catInc": ["給与"],
  "ledger": [{"date": "2026-10-01", "amount": 1200, "name": "ランチ", "cat": "食費", "type": "expense", "pay": "Aカード", "memo": "", "cardIdx": 0}],
  "shifts": [{"job": "カフェ", "date": "2026-10-02", "start": "10:00", "end": "15:00", "rest": 0, "wage": 1300}],
  "plans": [], "fixedCosts": [], "fixedIncs": [], "wds": [], "actualInputs": []
}
$json$);
select set_config('maney.allow_user_data_write', '', true);
select is((select count(*)::int from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'), 1, '許したときだけ、user_data に書ける');

select throws_ok($$
  update public.user_data set value = '{}' where user_id = 'a0000000-0000-4000-8000-000000000001'
$$, 'P0001', null, 'user_data を変えられない');

-- 旧版のアプリ（ログインしたユーザー）の保存も届かない
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$
  update public.user_data set value = value || '{"budget": 1}' where user_id = 'a0000000-0000-4000-8000-000000000001'
$$, 'P0001', null, '旧版のアプリの保存はエラーになる');
reset role;

-- ============================================================
-- 移行し直して、切り替え済みを記録する
-- ============================================================
select lives_ok($$ select private.migrate_user_data('a0000000-0000-4000-8000-000000000001') $$,
  '書き込みを止めたあとも、移行し直せる（user_data を読むだけ）');

-- 照らし合わせが一致していなければ、切り替えない
update public.ledger_entries set memo = '変えた' where user_id = 'a0000000-0000-4000-8000-000000000001';
select throws_ok($$ select private.cut_over('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', null, '照らし合わせが一致していなければ、切り替えない');
update public.ledger_entries set memo = '' where user_id = 'a0000000-0000-4000-8000-000000000001';

create temp table cut on commit drop as select private.cut_over('a0000000-0000-4000-8000-000000000001') as snapshot_id;
select ok(
  (select cut_over_at is not null from public.sync_state where user_id = 'a0000000-0000-4000-8000-000000000001'),
  '切り替え済みの日時が入る');
select is(
  (select reason from private.snapshots where id = (select snapshot_id from cut)),
  'cutover', '切り替えのときの写しを取る');
select is(
  (select jsonb_array_length(data -> 'ledger_entries') from private.snapshots where id = (select snapshot_id from cut)),
  1, '写しに、切り替えたときの行が入る');

select throws_ok($$ select private.migrate_user_data('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', null, '切り替えたあとは、移行し直せない（新しいテーブルの記録を消さない）');
select throws_ok($$ select private.cut_over('a0000000-0000-4000-8000-000000000001') $$,
  'P0001', null, '2回は切り替えない');

-- ============================================================
-- 旧版のアプリに戻す・アカウントを消す
-- ============================================================
update public.settings set budget = 60000 where user_id = 'a0000000-0000-4000-8000-000000000001';
select lives_ok($$ select private.restore_user_data_from_tables('a0000000-0000-4000-8000-000000000001') $$,
  '旧版のアプリに戻す関数は、user_data に書ける');
select is(
  (select (value ->> 'budget')::int from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001'),
  60000, '切り替えたあとに変えた内容も、旧版のアプリに戻せる');

select lives_ok($$ delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001' $$,
  'アカウントを消すと、user_data も一緒に消える（止めない）');

select * from finish();
rollback;
