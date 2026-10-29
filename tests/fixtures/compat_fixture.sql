-- 互換層のテスト（tests/compat.test.mjs）のデータを作る。
-- ローカルの Supabase（docs/db/LOCAL.md）で、架空のデータを移行し、
-- 「テーブルの行（Supabase の API が返す形）」と「DB の逆の変換（private.export_to_user_data）の結果」を1つの JSON にして出す。
-- 何も残さない（最後に rollback する）。
--
--   docker exec -i supabase_db_maney-app psql -U postgres -q -At -v ON_ERROR_STOP=1 < tests/fixtures/compat_fixture.sql > tests/fixtures/compat-fixture.json
begin;
set local client_min_messages = warning;
-- 切り替え（③）のあとは user_data への書き込みが止まっているので、テストのデータを入れるときだけ許す
select set_config('maney.allow_user_data_write', 'on', true) \g /dev/null

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

-- supabase/tests/database/03_migrate.test.sql と同じ、今のアプリが保存する形をひととおり含むデータ
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

select private.migrate_user_data('a0000000-0000-4000-8000-000000000001') \g /dev/null

-- 移行のあとに、新しいアプリで起きること
-- カードとバイト先を削除済みにする（記録が参照したまま）
update public.cards set deleted_at = now()
where user_id = 'a0000000-0000-4000-8000-000000000001' and name = 'Cカード';
update public.jobs set deleted_at = now()
where user_id = 'a0000000-0000-4000-8000-000000000001' and name = '塾';
-- 新しいアプリで作った予定と固定費（legacy_id がない）
insert into public.plans (user_id, title, start_date, end_date, start_time, color, position) values
  ('a0000000-0000-4000-8000-000000000001', '新しい予定', '2026-12-01', '2026-12-02', '09:30', 'teal', 3);
insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, card_id, position)
select 'a0000000-0000-4000-8000-000000000001', '新しい固定費', 1200, 5, 'expense', 'card', k.id, 4
from public.cards k where k.user_id = 'a0000000-0000-4000-8000-000000000001' and k.name = 'Bカード';

select jsonb_build_object(
  'rows', (
    select jsonb_object_agg(t, rows) from (
      select 'settings' as t, (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.settings x) as rows
      union all select 'cards', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.cards x)
      union all select 'jobs', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.jobs x)
      union all select 'categories', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.categories x)
      union all select 'ledger_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.ledger_entries x)
      union all select 'shifts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.shifts x)
      union all select 'plans', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.plans x)
      union all select 'fixed_costs', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.fixed_costs x)
      union all select 'fixed_incomes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.fixed_incomes x)
      union all select 'withdrawals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.withdrawals x)
      union all select 'salary_actuals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.salary_actuals x)
      union all select 'card_bill_actuals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]') from public.card_bill_actuals x)
    ) as tables),
  'export', private.export_to_user_data('a0000000-0000-4000-8000-000000000001'));

rollback;
