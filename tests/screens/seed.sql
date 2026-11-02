-- 画面を比べる道具（D20 の 0）の架空のデータ。今日を 2026-11-12（木）10:00（日本時間）に固定して見る前提。
-- tests/screens/global-setup.mjs が、テスト用のユーザーを作り直してから流す（psql の変数 uid にそのユーザーの id を入れる）。
-- 毎回まったく同じ画面になるように、id と日時をすべて固定する。本番のデータは使わない（リポジトリは公開している）。
-- 画面に出るものをひととおり含める: 削除済みのカード・バイト先・カテゴリ、カード・現金・口座の支出、入金、
-- 終日・時刻つき・複数日の予定、期間のある毎月のお金、ATM、カードと給与の実績、期限切れ・今日・先の・終えたタスク
\set ON_ERROR_STOP on
begin;

insert into public.settings (id, user_id, acct_base, base_date, budget, other_income, shift_close_day, shift_pay_day, fuyou_limit) values
  ('c0000000-0000-4000-8000-000000000001', :'uid', 120000, '2026-10-01', 80000, 0, 31, 10, '1300000');

-- カード（Cカードは削除済み。予定が参照したまま）
insert into public.cards (id, user_id, name, close_day, bill_day, position, deleted_at) values
  ('c0000000-0000-4000-8000-0000000000c1', :'uid', 'Aカード', 31, 27, 0, null),
  ('c0000000-0000-4000-8000-0000000000c2', :'uid', 'Bカード', 15, 10, 1, null),
  ('c0000000-0000-4000-8000-0000000000c3', :'uid', 'Cカード', 31, 27, 2, '2026-11-01 09:00+09');

-- バイト先（塾は削除済み。シフトと実績が参照したまま）
insert into public.jobs (id, user_id, name, color, wage, night_start, night_rate, transport, close_day, pay_day, position, deleted_at) values
  ('c0000000-0000-4000-8000-0000000000b1', :'uid', 'カフェ', 'blue', 1300, '22:00', 25, 200, 31, 25, 0, null),
  ('c0000000-0000-4000-8000-0000000000b2', :'uid', '塾', 'purple', 1500, '22:00', 25, 500, 31, 25, 1, '2026-11-01 09:00+09');

-- カテゴリ（娯楽は削除済み。記録には名前が残る）
insert into public.categories (id, user_id, kind, name, position, deleted_at) values
  ('c0000000-0000-4000-8000-0000000000e1', :'uid', 'expense', '食費', 0, null),
  ('c0000000-0000-4000-8000-0000000000e2', :'uid', 'expense', '交通費', 1, null),
  ('c0000000-0000-4000-8000-0000000000e3', :'uid', 'expense', 'その他', 2, null),
  ('c0000000-0000-4000-8000-0000000000e4', :'uid', 'expense', '娯楽', 3, '2026-11-01 09:00+09'),
  ('c0000000-0000-4000-8000-0000000000f1', :'uid', 'income', '給与', 0, null),
  ('c0000000-0000-4000-8000-0000000000f2', :'uid', 'income', 'その他', 1, null);

-- 家計簿（カード払い・現金・口座・入金。先月と今月と今日）
insert into public.ledger_entries (id, user_id, date, kind, amount, name, memo, category_id, payment_method, card_id, position) values
  ('c0000000-0000-4000-8000-000000000101', :'uid', '2026-10-03', 'expense', 1200, 'ランチ', '', 'c0000000-0000-4000-8000-0000000000e1', 'card', 'c0000000-0000-4000-8000-0000000000c2', 0),
  ('c0000000-0000-4000-8000-000000000102', :'uid', '2026-10-05', 'expense', 500, '電車', 'メモ', 'c0000000-0000-4000-8000-0000000000e2', 'cash', null, 1),
  ('c0000000-0000-4000-8000-000000000103', :'uid', '2026-10-20', 'expense', 3000, '本', '', 'c0000000-0000-4000-8000-0000000000e4', 'card', 'c0000000-0000-4000-8000-0000000000c1', 2),
  ('c0000000-0000-4000-8000-000000000104', :'uid', '2026-10-25', 'income', 98000, '給料', '', 'c0000000-0000-4000-8000-0000000000f1', 'bank', null, 3),
  ('c0000000-0000-4000-8000-000000000105', :'uid', '2026-11-01', 'income', 5000, 'お祝い', '', 'c0000000-0000-4000-8000-0000000000f2', 'cash', null, 4),
  ('c0000000-0000-4000-8000-000000000106', :'uid', '2026-11-04', 'expense', 1500, 'ランチ', '', 'c0000000-0000-4000-8000-0000000000e1', 'card', 'c0000000-0000-4000-8000-0000000000c2', 5),
  ('c0000000-0000-4000-8000-000000000107', :'uid', '2026-11-08', 'expense', 6000, '振込', '口座から', 'c0000000-0000-4000-8000-0000000000e3', 'bank', null, 6),
  ('c0000000-0000-4000-8000-000000000108', :'uid', '2026-11-12', 'expense', 800, 'コンビニ', '', 'c0000000-0000-4000-8000-0000000000e1', 'cash', null, 7);

-- シフト（先月・今月・来月。夜の時間を含む）
insert into public.shifts (id, user_id, date, job_id, start_time, end_time, wage, rest_minutes, position) values
  ('c0000000-0000-4000-8000-000000000201', :'uid', '2026-10-10', 'c0000000-0000-4000-8000-0000000000b1', '10:00', '15:00', 1300, 0, 0),
  ('c0000000-0000-4000-8000-000000000202', :'uid', '2026-11-07', 'c0000000-0000-4000-8000-0000000000b1', '17:00', '23:00', 1300, 60, 1),
  ('c0000000-0000-4000-8000-000000000203', :'uid', '2026-11-14', 'c0000000-0000-4000-8000-0000000000b1', '09:00', '13:00', 1300, 0, 2),
  ('c0000000-0000-4000-8000-000000000204', :'uid', '2026-12-05', 'c0000000-0000-4000-8000-0000000000b2', '17:00', '22:30', 1500, 60, 3);

-- 予定（複数日・時刻だけ・開始と終了・済み・削除済みのカード）
insert into public.plans (id, user_id, title, start_date, end_date, start_time, end_time, budget, done, memo, color, card_id, legacy_id, position) values
  ('c0000000-0000-4000-8000-000000000301', :'uid', '旅行', '2026-11-21', '2026-11-23', null, null, 30000, false, '', 'green', 'c0000000-0000-4000-8000-0000000000c3', 1775104268944, 0),
  ('c0000000-0000-4000-8000-000000000302', :'uid', '歯医者', '2026-11-05', '2026-11-05', '13:00', null, 0, true, 'メモ', 'pink', null, 1775104268945, 1),
  ('c0000000-0000-4000-8000-000000000303', :'uid', '飲み会', '2026-11-12', '2026-11-12', '19:00', '21:30', 4000, false, '', 'orange', null, null, 2),
  ('c0000000-0000-4000-8000-000000000304', :'uid', '新しい予定', '2026-12-01', '2026-12-02', '09:30', null, 0, false, '', 'teal', null, null, 3);

-- 毎月のお金（カード・口座・現金・入金。期間のあるもの・やめたもの）
insert into public.fixed_costs (id, user_id, name, amount, day, kind, payment_method, card_id, legacy_id, position, start_month, end_month) values
  ('c0000000-0000-4000-8000-000000000401', :'uid', '音楽', 980, 2, 'expense', 'card', 'c0000000-0000-4000-8000-0000000000c1', 1775104510857, 0, null, null),
  ('c0000000-0000-4000-8000-000000000402', :'uid', '家賃', 50000, 27, 'expense', 'bank', null, 1775104510858, 1, null, null),
  ('c0000000-0000-4000-8000-000000000403', :'uid', 'ジム', 7700, 13, 'expense', 'cash', null, 1775104510859, 2, '2026-09-01', '2026-10-01'),
  ('c0000000-0000-4000-8000-000000000404', :'uid', '奨学金', 20000, 11, 'income', null, null, 1775104510860, 3, null, null),
  ('c0000000-0000-4000-8000-000000000405', :'uid', '仕送り', 30000, 25, 'income', null, null, null, 4, '2026-11-01', null),
  ('c0000000-0000-4000-8000-000000000406', :'uid', '新しい固定費', 1200, 5, 'expense', 'card', 'c0000000-0000-4000-8000-0000000000c2', null, 5, null, null);

insert into public.withdrawals (id, user_id, date, amount, position) values
  ('c0000000-0000-4000-8000-000000000501', :'uid', '2026-10-15', 10000, 0),
  ('c0000000-0000-4000-8000-000000000502', :'uid', '2026-11-09', 5000, 1);

-- 実績（2つのテーブルで position を共通にし、交互に並ぶ）
insert into public.card_bill_actuals (id, user_id, card_id, bill_month, actual_amount, estimated_amount, position) values
  ('c0000000-0000-4000-8000-000000000601', :'uid', 'c0000000-0000-4000-8000-0000000000c2', '2026-11-01', 2700, 2700, 0),
  ('c0000000-0000-4000-8000-000000000602', :'uid', 'c0000000-0000-4000-8000-0000000000c1', '2026-10-01', 4100, 3980, 2);
insert into public.salary_actuals (id, user_id, job_id, pay_month, paid_on, actual_amount, estimated_amount, position) values
  ('c0000000-0000-4000-8000-000000000701', :'uid', 'c0000000-0000-4000-8000-0000000000b1', '2026-10-01', '2026-10-25', 6700, 6500, 1),
  ('c0000000-0000-4000-8000-000000000702', :'uid', 'c0000000-0000-4000-8000-0000000000b2', '2027-01-01', '2027-01-25', 120000, 118000, 3);

-- タスク（期限切れ・今日・先・期限なし・終えたもの（最近・7日より前））
insert into public.tasks (id, user_id, title, due_date, completed_at, memo, position) values
  ('c0000000-0000-4000-8000-000000000801', :'uid', 'レポートを出す', '2026-11-10', null, '', 0),
  ('c0000000-0000-4000-8000-000000000802', :'uid', '家賃の振込', '2026-11-12', null, '口座から', 1),
  ('c0000000-0000-4000-8000-000000000803', :'uid', 'シフトの希望を出す', '2026-11-20', null, '', 2),
  ('c0000000-0000-4000-8000-000000000804', :'uid', '部屋の片付け', null, null, '', 3),
  ('c0000000-0000-4000-8000-000000000805', :'uid', '本を返す', '2026-11-11', '2026-11-11 20:00+09', '', 4),
  ('c0000000-0000-4000-8000-000000000806', :'uid', '古い用事', '2026-10-20', '2026-10-20 12:00+09', '', 5);

-- 作った日時・変えた日時をそろえる（予定の画面の id は作った日時から作るので、固定しないと毎回変わる）。
-- 行の日時を今にするトリガー（set_row_timestamps）が上書きしないように、この間だけトリガーを止める
set local session_replication_role = replica;
update public.settings set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.cards set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.jobs set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.categories set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.ledger_entries set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.shifts set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.plans set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.fixed_costs set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.withdrawals set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.card_bill_actuals set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.salary_actuals set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';
update public.tasks set created_at = '2026-11-01 09:00+09', updated_at = '2026-11-01 09:00+09' where user_id = :'uid';

commit;
