-- テーブル分割①-3 (#11): 移行の関数・逆の変換・照らし合わせのテスト
-- 実行: npx supabase test db
-- リポジトリは公開しているので、本番のデータは使わない。本番と同じ形の架空のデータで試す。
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- 切り替え（③）のあとは user_data への書き込みが止まっているので、テストのデータを入れるときだけ許す
select set_config('maney.allow_user_data_write', 'on', true);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'a@example.com'),
  ('b0000000-0000-4000-8000-000000000001', 'b@example.com');

-- 今のアプリが保存する形を、ひととおり含める
insert into public.user_data (user_id, value) values ('a0000000-0000-4000-8000-000000000001', $json$
{
  "_updatedAt": 1793255361587,
  "acctBase": 2022, "baseDate": "2026-08-28", "budget": 80000, "otherIncome": 0,
  "shiftCloseDay": 31, "shiftPayDay": 10, "fuyouLimit": "1300000",
  "cards": [
    {"name": "Aカード", "billDay": "27", "closeDay": "31"},
    {"name": "Bカード", "billDay": "10", "closeDay": "15"},
    {"name": "Cカード", "billDay": "27", "closeDay": "31"}
  ],
  "jobs": [
    {"name": "カフェ", "wage": 1300, "color": "blue", "nightRate": 25, "transport": 200, "nightStart": "22:00"},
    {"name": "塾", "wage": 1500, "color": "purple", "payDay": 25, "closeDay": 31, "nightRate": 25, "transport": 500, "nightStart": "22:00"}
  ],
  "catExp": ["食費", "交通費", "その他"],
  "catInc": ["給与", "その他"],
  "ledger": [
    {"date": "2026-09-01", "amount": 1200, "name": "ランチ", "cat": "食費", "type": "expense", "pay": "Bカード", "memo": "", "cardIdx": 1},
    {"date": "2026-09-02", "amount": 500, "name": "電車", "cat": "交通費", "type": "expense", "pay": "現金", "memo": "メモ"},
    {"date": "2026-09-03", "amount": 3000, "name": "本", "cat": "娯楽", "type": "expense", "pay": "Aカード", "memo": "", "cardIdx": 0, "src": "card", "txId": "tx-1"},
    {"date": "2026-09-25", "amount": 100000, "name": "給料", "cat": "給与", "type": "income", "pay": "現金", "memo": "", "receive": "口座振込"},
    {"date": "2026-10-01", "amount": 5000, "name": "お祝い", "cat": "その他", "type": "income", "pay": "現金", "memo": "", "receive": "現金"},
    {"date": "2026-10-02", "amount": 1200, "name": "ランチ", "cat": "食費", "type": "expense", "pay": "Bカード", "memo": "", "cardIdx": 1}
  ],
  "shifts": [
    {"job": "カフェ", "date": "2026-09-05", "start": "10:00", "end": "15:00", "rest": 0, "wage": 1300},
    {"job": "塾", "date": "2026-12-06", "start": "17:00", "end": "22:30", "rest": 60, "wage": 1500}
  ],
  "plans": [
    {"id": 1775104268944, "title": "旅行", "date": "2026-11-01", "dateStart": "2026-11-01", "dateEnd": "2026-11-03",
     "timeStart": "", "timeEnd": "", "budget": 30000, "memo": "", "color": "green", "done": false, "planCardIdx": 2},
    {"id": 1775104268945, "title": "歯医者", "date": "2026-11-05", "dateStart": "2026-11-05", "dateEnd": "2026-11-05",
     "timeStart": "13:00", "timeEnd": "", "budget": 0, "memo": "メモ", "color": "pink", "done": true},
    {"id": 1775104268946, "title": "飲み会", "date": "2026-11-06", "dateStart": "2026-11-06", "dateEnd": "2026-11-06",
     "timeStart": "19:00", "timeEnd": "21:30", "budget": 4000, "memo": "", "color": "orange", "done": false}
  ],
  "fixedCosts": [
    {"id": 1775104510857, "name": "音楽", "amount": 980, "day": 2, "type": "expense", "pay": "card-0"},
    {"id": 1775104510858, "name": "家賃", "amount": 50000, "day": 27, "type": "expense", "pay": "bank"},
    {"id": 1775104510859, "name": "ジム", "amount": 7700, "day": 13, "type": "expense", "pay": "cash"},
    {"id": 1775104510860, "name": "奨学金", "amount": 20000, "day": 11, "type": "income", "pay": "income"}
  ],
  "fixedIncs": [{"name": "仕送り", "amount": "30000", "day": "25"}],
  "wds": [{"date": "2026-09-10", "amount": 9000}, {"date": "2026-09-10", "amount": 9000}],
  "actualInputs": [
    {"type": "card", "billM": 8, "billY": 2026, "cardIdx": 1, "cardKey": "card-1-2026-09", "actualAmount": 51165, "estimatedAmount": 51000},
    {"type": "shift", "job": "カフェ", "date": "2026-10-10", "salaryKey": "カフェ|2026-10", "actualAmount": 79340, "estimatedAmount": 0},
    {"type": "card", "billM": 9, "billY": 2026, "cardIdx": 0, "cardKey": "card-0-2026-10", "actualAmount": 46921, "estimatedAmount": 46921},
    {"type": "shift", "job": "塾", "date": "2027-01-25", "salaryKey": "塾|2027-01", "actualAmount": 120000, "estimatedAmount": 118000}
  ]
}
$json$);

-- ============================================================
-- 移す
-- ============================================================
select is(
  private.find_unmigratable((select value from public.user_data where user_id = 'a0000000-0000-4000-8000-000000000001')),
  '{}'::text[], '今のアプリが作る形は、すべて移せる');

create temp table first_run on commit drop as
  select private.migrate_user_data('a0000000-0000-4000-8000-000000000001') as result;

select is((select result ->> 'epoch' from first_run), '2', '初めての移行で、移行の番号が 2 になる');
select is(
  (select result - 'epoch' from first_run),
  '{"cards": 3, "jobs": 2, "categories": 6, "ledger_entries": 6, "shifts": 2, "plans": 3, "fixed_costs": 4,
    "fixed_incomes": 1, "withdrawals": 2, "salary_actuals": 2, "card_bill_actuals": 2}'::jsonb,
  '種類ごとの件数');

select is(
  (select coalesce(string_agg(item || ': ' || coalesce(expected, '') || ' → ' || coalesce(actual, ''), ' / '), '')
   from private.compare_migration('a0000000-0000-4000-8000-000000000001') where not ok),
  '', '照らし合わせ（全項目・件数・合計）で違いがない');

select is(
  (select count(*)::int from private.compare_migration('a0000000-0000-4000-8000-000000000001')
   where item like '%の合計' or item like '%件数と%'),
  8, '月ごとの収支と、カードごと・バイト先ごとの合計を比べている');

-- ============================================================
-- 移し方の細部
-- ============================================================
select ok(
  (select deleted_at is not null from public.categories
   where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'expense' and name = '娯楽'),
  '一覧にないが記録に名前が残るカテゴリは、削除済みとして作る');

select is(
  (select count(*)::int from public.ledger_entries l join public.cards k on k.id = l.card_id
   where l.user_id = 'a0000000-0000-4000-8000-000000000001' and k.name = 'Bカード'),
  2, '家計簿のカードを、配列の番号からカードの ID に変える');

select is(
  (select l.payment_method from public.ledger_entries l
   where l.user_id = 'a0000000-0000-4000-8000-000000000001' and l.name = '給料'),
  'bank', '口座振込の収入は、支払い方法が bank になる');

select is(
  (select s.pay_month from public.salary_actuals s join public.jobs j on j.id = s.job_id
   where s.user_id = 'a0000000-0000-4000-8000-000000000001' and j.name = '塾'),
  '2027-01-01'::date, '年をまたぐ給与の実績（12月のシフト → 1月の支払い）の支払月');

select results_eq($$
  select p.start_time, p.end_time from public.plans p
  where p.user_id = 'a0000000-0000-4000-8000-000000000001' order by p.position
$$, $$ values (null::time, null::time), ('13:00'::time, null::time), ('19:00'::time, '21:30'::time) $$,
  '予定の時刻: 空の文字列は null（終日・終了時刻なし）');

select is(
  (select f.card_id = k.id from public.fixed_costs f, public.cards k
   where f.user_id = 'a0000000-0000-4000-8000-000000000001' and f.name = '音楽'
     and k.user_id = f.user_id and k.name = 'Aカード'),
  true, '固定費の card-0 を、カードの ID に変える');

select is(
  (select count(*)::int from private.row_history where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0, '移行で入れた行は、履歴に残さない');

-- ============================================================
-- 逆の変換
-- ============================================================
select is(
  private.export_to_user_data('a0000000-0000-4000-8000-000000000001') -> 'plans' -> 0 ->> 'date',
  '2026-11-01', '逆の変換で、予定の date（開始日と同じ）を作り直す');

select ok(
  not (private.export_to_user_data('a0000000-0000-4000-8000-000000000001') -> 'ledger' -> 2 ? 'src'),
  '取り込みの名残（src・txId）は、逆の変換に含まれない');

-- 新しいアプリで作った予定（legacy_id がない）も、逆の変換で数値の id を持つ
insert into public.plans (user_id, title, start_date, end_date, color, position) values
  ('a0000000-0000-4000-8000-000000000001', '新しい予定', '2026-12-01', '2026-12-01', 'teal', 3);
select is(
  jsonb_typeof(private.export_to_user_data('a0000000-0000-4000-8000-000000000001') -> 'plans' -> 3 -> 'id'),
  'number', '新しい予定の id は登録日時（ミリ秒）の数値');

-- ============================================================
-- 照らし合わせが違いを見つける
-- ============================================================
update public.ledger_entries set memo = '変えた'
where user_id = 'a0000000-0000-4000-8000-000000000001' and position = 1;
select ok(
  exists (select 1 from private.compare_migration('a0000000-0000-4000-8000-000000000001')
          where item = '違う場所: .ledger[1].memo' and not ok),
  '1か所でも違えば、その場所を返す');

-- ============================================================
-- 移行し直す
-- ============================================================
insert into public.applied_ops (user_id, op_id, result) values
  ('a0000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001', '{"status": "applied"}');

select is(
  private.migrate_user_data('a0000000-0000-4000-8000-000000000001') ->> 'epoch',
  '3', '移行し直すと、移行の番号が上がる');
select is(
  (select count(*)::int from public.plans where user_id = 'a0000000-0000-4000-8000-000000000001'),
  3, '移行し直すと、前の行を消してから入れ直す（二重にならない）');
select is(
  (select count(*)::int from private.compare_migration('a0000000-0000-4000-8000-000000000001') where not ok),
  0, '移行し直すと、テーブルで変えた内容は user_data の内容に戻る');
select is(
  (select count(*)::int from public.applied_ops where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0, '移行し直すと、操作の記録も消す');

-- ============================================================
-- 移せない形・切り替え済み
-- ============================================================
insert into public.user_data (user_id, value) values ('b0000000-0000-4000-8000-000000000001', $json$
{
  "acctBase": 0, "baseDate": "2026-10-01", "budget": 0, "otherIncome": 0,
  "shiftCloseDay": 31, "shiftPayDay": 10, "fuyouLimit": "1300000",
  "cards": [], "jobs": [{"name": "カフェ", "wage": 1300, "color": "blue", "nightRate": 25, "transport": 0, "nightStart": "22:00"}],
  "catExp": ["食費"], "catInc": ["その他"],
  "ledger": [{"date": "2026-04-21", "amount": 36000, "name": "旅行", "cat": "その他", "type": "income", "pay": "現金", "memo": ""}],
  "shifts": [{"job": "カフェ", "date": "2026-09-05", "start": "10:00", "end": "15:00", "wage": 1300}],
  "plans": [], "fixedCosts": [], "fixedIncs": [], "wds": [], "actualInputs": []
}
$json$);

select is(
  private.find_unmigratable((select value from public.user_data where user_id = 'b0000000-0000-4000-8000-000000000001')),
  array['ledger[0]: 支払い方法の形が違う', 'shifts[0]: バイト先 カフェ がないか、休憩（rest）がない'],
  '受け取り方法のない収入と、休憩のないシフトを見つける（移行の前に user_data を揃える）');
select throws_ok($$
  select private.migrate_user_data('b0000000-0000-4000-8000-000000000001')
$$, 'P0001', null, '移せない形の記録があると、移行しない');

update public.sync_state set cut_over_at = now() where user_id = 'a0000000-0000-4000-8000-000000000001';
select throws_ok($$
  select private.migrate_user_data('a0000000-0000-4000-8000-000000000001')
$$, 'P0001', null, '切り替え済みなら、移行し直さない');

-- ============================================================
-- アプリからは呼べない
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$
  select private.export_to_user_data('a0000000-0000-4000-8000-000000000001')
$$, '42501', null, 'ログインした人も、移行・逆の変換の関数は呼べない');
reset role;

select * from finish();
rollback;
