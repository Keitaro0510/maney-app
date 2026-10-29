-- 互換層のテスト（tests/compat.test.mjs）のデータを作る。
-- ローカルの Supabase（docs/db/LOCAL.md）で、今のアプリが作る形をひととおり含む架空の行を入れ、
-- 「テーブルの行（Supabase の API が返す形）」と「DB の逆の変換（private.export_to_user_data）の結果」を1つの JSON にして出す。
-- 何も残さない（最後に rollback する）。
--
--   docker exec -i supabase_db_maney-app psql -U postgres -q -At -v ON_ERROR_STOP=1 < tests/fixtures/compat_fixture.sql > tests/fixtures/compat-fixture.json
--
-- 切り替える前（〜2026-10-29）は、user_data の JSON を移行の関数で移して作っていた。その関数は片付けで消したので、行を直接入れる。
begin;
set local client_min_messages = warning;

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000001', 'a@example.com');

insert into public.settings (user_id, acct_base, base_date, budget, other_income, shift_close_day, shift_pay_day, fuyou_limit) values
  ('a0000000-0000-4000-8000-000000000001', 2022, '2026-08-28', 80000, 0, 31, 10, '1300000');

-- カード（Cカードは削除済み。予定が参照したまま）
insert into public.cards (id, user_id, name, close_day, bill_day, position, deleted_at) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'Aカード', 31, 27, 0, null),
  ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000001', 'Bカード', 15, 10, 1, null),
  ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-000000000001', 'Cカード', 31, 27, 2, now());

-- バイト先（カフェは締め日・給料日が空。塾は削除済み。シフトと実績が参照したまま）
insert into public.jobs (id, user_id, name, color, wage, night_start, night_rate, transport, close_day, pay_day, position, deleted_at) values
  ('a0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000001', 'カフェ', 'blue', 1300, '22:00', 25, 200, null, null, 0, null),
  ('a0000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-000000000001', '塾', 'purple', 1500, '22:00', 25, 500, 31, 25, 1, now());

-- カテゴリ（娯楽は削除済み。記録には名前が残る）
insert into public.categories (id, user_id, kind, name, position, deleted_at) values
  ('a0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000001', 'expense', '食費', 0, null),
  ('a0000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', 'expense', '交通費', 1, null),
  ('a0000000-0000-4000-8000-0000000000e3', 'a0000000-0000-4000-8000-000000000001', 'expense', 'その他', 2, null),
  ('a0000000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000001', 'expense', '娯楽', 3, now()),
  ('a0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', 'income', '給与', 0, null),
  ('a0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-000000000001', 'income', 'その他', 1, null);

-- 家計簿（カード払い・現金・口座振込・現金の受け取り）
insert into public.ledger_entries (user_id, date, kind, amount, name, memo, category_id, payment_method, card_id, position) values
  ('a0000000-0000-4000-8000-000000000001', '2026-09-01', 'expense', 1200, 'ランチ', '', 'a0000000-0000-4000-8000-0000000000e1', 'card', 'a0000000-0000-4000-8000-0000000000c2', 0),
  ('a0000000-0000-4000-8000-000000000001', '2026-09-02', 'expense', 500, '電車', 'メモ', 'a0000000-0000-4000-8000-0000000000e2', 'cash', null, 1),
  ('a0000000-0000-4000-8000-000000000001', '2026-09-03', 'expense', 3000, '本', '', 'a0000000-0000-4000-8000-0000000000e4', 'card', 'a0000000-0000-4000-8000-0000000000c1', 2),
  ('a0000000-0000-4000-8000-000000000001', '2026-09-25', 'income', 100000, '給料', '', 'a0000000-0000-4000-8000-0000000000f1', 'bank', null, 3),
  ('a0000000-0000-4000-8000-000000000001', '2026-10-01', 'income', 5000, 'お祝い', '', 'a0000000-0000-4000-8000-0000000000f2', 'cash', null, 4),
  ('a0000000-0000-4000-8000-000000000001', '2026-10-02', 'expense', 1200, 'ランチ', '', 'a0000000-0000-4000-8000-0000000000e1', 'card', 'a0000000-0000-4000-8000-0000000000c2', 5);

insert into public.shifts (user_id, date, job_id, start_time, end_time, wage, rest_minutes, position) values
  ('a0000000-0000-4000-8000-000000000001', '2026-09-05', 'a0000000-0000-4000-8000-0000000000b1', '10:00', '15:00', 1300, 0, 0),
  ('a0000000-0000-4000-8000-000000000001', '2026-12-06', 'a0000000-0000-4000-8000-0000000000b2', '17:00', '22:30', 1500, 60, 1);

-- 予定（終日・開始時刻だけ・開始と終了・新しい予定は legacy_id がない）
insert into public.plans (user_id, title, start_date, end_date, start_time, end_time, budget, done, memo, color, card_id, legacy_id, position) values
  ('a0000000-0000-4000-8000-000000000001', '旅行', '2026-11-01', '2026-11-03', null, null, 30000, false, '', 'green', 'a0000000-0000-4000-8000-0000000000c3', 1775104268944, 0),
  ('a0000000-0000-4000-8000-000000000001', '歯医者', '2026-11-05', '2026-11-05', '13:00', null, 0, true, 'メモ', 'pink', null, 1775104268945, 1),
  ('a0000000-0000-4000-8000-000000000001', '飲み会', '2026-11-06', '2026-11-06', '19:00', '21:30', 4000, false, '', 'orange', null, 1775104268946, 2),
  ('a0000000-0000-4000-8000-000000000001', '新しい予定', '2026-12-01', '2026-12-02', '09:30', null, 0, false, '', 'teal', null, null, 3);

-- 固定費（カード・口座・現金・入金・新しい固定費は legacy_id がない）
insert into public.fixed_costs (user_id, name, amount, day, kind, payment_method, card_id, legacy_id, position) values
  ('a0000000-0000-4000-8000-000000000001', '音楽', 980, 2, 'expense', 'card', 'a0000000-0000-4000-8000-0000000000c1', 1775104510857, 0),
  ('a0000000-0000-4000-8000-000000000001', '家賃', 50000, 27, 'expense', 'bank', null, 1775104510858, 1),
  ('a0000000-0000-4000-8000-000000000001', 'ジム', 7700, 13, 'expense', 'cash', null, 1775104510859, 2),
  ('a0000000-0000-4000-8000-000000000001', '奨学金', 20000, 11, 'income', null, null, 1775104510860, 3),
  ('a0000000-0000-4000-8000-000000000001', '新しい固定費', 1200, 5, 'expense', 'card', 'a0000000-0000-4000-8000-0000000000c2', null, 4);

insert into public.fixed_incomes (user_id, name, amount, day, position) values
  ('a0000000-0000-4000-8000-000000000001', '仕送り', 30000, 25, 0);

insert into public.withdrawals (user_id, date, amount, position) values
  ('a0000000-0000-4000-8000-000000000001', '2026-09-10', 9000, 0),
  ('a0000000-0000-4000-8000-000000000001', '2026-09-10', 9000, 1);

-- 実績（2つのテーブルで position を共通にし、交互に並ぶ。年をまたぐ給与の実績を含む）
insert into public.card_bill_actuals (user_id, card_id, bill_month, actual_amount, estimated_amount, position) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c2', '2026-09-01', 51165, 51000, 0),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c1', '2026-10-01', 46921, 46921, 2);
insert into public.salary_actuals (user_id, job_id, pay_month, paid_on, actual_amount, estimated_amount, position) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000b1', '2026-10-01', '2026-10-10', 79340, 0, 1),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000b2', '2027-01-01', '2027-01-25', 120000, 118000, 3);

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
