-- テーブル分割① (#11): 新しいテーブル・制約・RLS・行の履歴。
-- 設計は docs/db/TABLE_SPLIT.md。アプリはまだ user_data を使っていて、ここで作るテーブルはまだ使わない。
--
-- どのテーブルにも id・user_id・created_at・updated_at がある。
-- - 参照は ID で行う。カード・バイト先・カテゴリは (user_id, id) で参照し、他人の行を参照できないようにする
-- - 一覧の並び順は position（今の配列の順番）。読み込みは position, id の順
-- - カード・バイト先・カテゴリの削除は deleted_at を入れる（過去の記録の表示と計算に使い続ける）

-- ============================================================
-- 共通: 登録日時・更新日時
-- ============================================================

-- 登録日時・更新日時はサーバーの時刻で入れる（アプリが送った値は使わない）。
-- updated_at は競合の判定に使うので、同じトランザクションの中でも毎回変わる clock_timestamp() を使う。
-- id と user_id はあとから変えられない。
-- 写しから戻すとき（DB の関数が maney.keep_created_at = on にする）だけ、元の登録日時を残す。
create function private.set_row_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('maney.keep_created_at', true) is distinct from 'on' or new.created_at is null then
      new.created_at := now();
    end if;
  else
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception '% の id と user_id は変えられません', tg_table_name;
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ============================================================
-- 共通: 行の履歴
-- ============================================================

-- 追加・更新・削除のたびに、変更の前と後の行を残す（1行だけ戻す・1つの操作を取り消すときに使う）。
-- op_id は apply_op（保存の関数）の操作 ID。それ以外の変更（移行など）は null。
-- private スキーマは API に公開していないので、アプリの公開キーからは読めない。
create table private.row_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  op_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz not null default now()
);
create index row_history_user_id_idx on private.row_history (user_id, id desc);
create index row_history_row_idx on private.row_history (table_name, row_id, id desc);
create index row_history_op_id_idx on private.row_history (op_id) where op_id is not null;
create index row_history_changed_at_idx on private.row_history (changed_at);
alter table private.row_history enable row level security;

-- アプリのロールは private スキーマに触れないので、security definer で書き込む。
-- - 中身が変わらない更新（updated_at だけが変わる）は残さない
-- - アカウントの削除で消える行は残さない（履歴もアカウントと一緒に消える）
-- - 移行の関数は maney.skip_history = on にして、履歴を残さずに入れ直す
create function private.keep_row_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_user_id uuid;
begin
  if current_setting('maney.skip_history', true) = 'on' then
    return null;
  end if;

  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (old_row - 'updated_at') = (new_row - 'updated_at') then
    return null;
  end if;

  row_user_id := (coalesce(new_row, old_row) ->> 'user_id')::uuid;
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = row_user_id) then
    return null;
  end if;

  insert into private.row_history (user_id, table_name, row_id, op_id, action, old_row, new_row)
  values (
    row_user_id,
    tg_table_name,
    (coalesce(new_row, old_row) ->> 'id')::uuid,
    nullif(current_setting('maney.op_id', true), '')::uuid,
    tg_op,
    old_row,
    new_row
  );
  return null;
end;
$$;

revoke all on function private.set_row_timestamps() from public;
revoke all on function private.keep_row_history() from public;

-- 履歴は90日で消す。毎日 3:00（日本時間）に実行する
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'purge-row-history',
  '0 18 * * *',
  $$delete from private.row_history where changed_at < now() - interval '90 days'$$
);

-- ============================================================
-- テーブル
-- ============================================================

-- 設定（1人1行）。今の st の acctBase・baseDate・budget・otherIncome・shiftCloseDay・shiftPayDay・fuyouLimit
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  acct_base integer not null default 0,
  base_date date not null default current_date,
  budget integer not null default 0 check (budget >= 0),
  other_income integer not null default 0 check (other_income >= 0),
  shift_close_day smallint not null default 31 check (shift_close_day between 1 and 31),
  shift_pay_day smallint not null default 10 check (shift_pay_day between 1 and 31),
  fuyou_limit text not null default '1300000' check (fuyou_limit in ('1030000', '1300000', 'both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.settings is '設定（1人1行）。口座残高と基準日・予算・その他収入・シフトの締め日と給料日・扶養の上限';

-- カード。締め日が28以上なら月末として扱う（今のアプリと同じ）
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name <> ''),
  close_day smallint not null check (close_day between 1 and 31),
  bill_day smallint not null check (bill_day between 1 and 31),
  position integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create unique index cards_name_active_key on public.cards (user_id, name) where deleted_at is null;
comment on table public.cards is 'カード。削除は deleted_at を入れる（過去の記録の表示と、引き落としの計算に使い続ける）';

-- バイト先。締め日・給料日が空なら、設定の締め日・給料日を使う（今のアプリと同じ）
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name <> ''),
  color text not null check (color in ('pink', 'blue', 'green', 'orange', 'purple', 'teal')),
  wage integer not null check (wage >= 1),
  night_start time not null default '22:00',
  night_rate integer not null default 25 check (night_rate >= 0),
  transport integer not null default 0 check (transport >= 0),
  close_day smallint check (close_day between 1 and 31),
  pay_day smallint check (pay_day between 1 and 31),
  position integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create unique index jobs_name_active_key on public.jobs (user_id, name) where deleted_at is null;
comment on table public.jobs is 'バイト先。night_rate は深夜の割増率（%）、transport は片道の交通費。削除は deleted_at を入れる';

-- 家計簿のカテゴリ（支出・収入）
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (name <> ''),
  position integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 家計簿の記録から (user_id, id, kind) で参照し、支出の記録に収入のカテゴリを付けられないようにする
  unique (user_id, id, kind)
);
create unique index categories_name_active_key on public.categories (user_id, kind, name) where deleted_at is null;
comment on table public.categories is '家計簿のカテゴリ。削除は deleted_at を入れる（過去の記録は正しい名前で表示する）';

-- 家計簿の記録
-- 支払い方法: 支出は現金（cash）かカード（card）、収入は現金（cash）か口座（bank）。カードのときだけ card_id がある
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('expense', 'income')),
  amount integer not null check (amount >= 0),
  name text not null,
  memo text not null default '',
  category_id uuid not null,
  payment_method text not null check (payment_method in ('cash', 'card', 'bank')),
  card_id uuid,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, category_id, kind) references public.categories (user_id, id, kind),
  foreign key (user_id, card_id) references public.cards (user_id, id),
  check ((payment_method = 'card') = (card_id is not null)),
  check (case kind when 'expense' then payment_method in ('cash', 'card') else payment_method in ('cash', 'bank') end)
);
comment on table public.ledger_entries is '家計簿の記録。支出は cash/card、収入は cash/bank。カード払いのときだけ card_id がある';

-- シフト。wage はその日の時点の時給（記録として残すだけで、給与の計算にはバイト先の今の時給を使う）
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  job_id uuid not null,
  start_time time not null,
  end_time time not null,
  wage integer not null check (wage >= 0),
  rest_minutes integer not null default 0 check (rest_minutes >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, job_id) references public.jobs (user_id, id)
);
comment on table public.shifts is 'シフト。wage はその日の時点の時給で、給与の計算には使わない（今のアプリと同じく、バイト先の今の時給で計算する）';

-- 予定。時刻が空なら終日。終了時刻は開始時刻があるときだけ。card_id が空なら現金・口座払い
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (title <> ''),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  budget integer not null default 0 check (budget >= 0),
  done boolean not null default false,
  memo text not null default '',
  color text not null check (color in ('pink', 'blue', 'green', 'orange', 'purple', 'teal')),
  card_id uuid,
  legacy_id bigint,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, card_id) references public.cards (user_id, id),
  check (end_date >= start_date),
  check (end_time is null or start_time is not null)
);
comment on table public.plans is '予定。legacy_id は今の JSON の id（逆の変換で元に戻すために残す）';

-- 固定費（設定の「固定費」の画面。毎月の引き落としと、毎月の入金）
-- 支払い方法: 引き落とし（expense）は口座（bank）・現金（cash）・カード（card）。入金（income）は空
create table public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name <> ''),
  amount integer not null check (amount >= 0),
  day smallint not null check (day between 1 and 31),
  kind text not null check (kind in ('expense', 'income')),
  payment_method text check (payment_method in ('bank', 'cash', 'card')),
  card_id uuid,
  legacy_id bigint,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, card_id) references public.cards (user_id, id),
  check ((kind = 'income') = (payment_method is null)),
  check ((payment_method is not distinct from 'card') = (card_id is not null))
);
comment on table public.fixed_costs is '固定費（毎月の引き落としと入金）。legacy_id は今の JSON の id（逆の変換で元に戻すために残す）';

-- 固定収入（設定の「固定収入」の画面）
create table public.fixed_incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name <> ''),
  amount integer not null check (amount >= 0),
  day smallint not null check (day between 1 and 31),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.fixed_incomes is '固定収入';

-- ATM の引き出し
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  amount integer not null check (amount >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.withdrawals is 'ATM の引き出し';

-- 給与の実績。pay_month は支払月の1日（シフトの月の翌月。今の salaryKey の月）
-- position は card_bill_actuals と共通の並び（今の actualInputs は1つの配列で、2種類が混ざって並んでいるため）
create table public.salary_actuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  pay_month date not null check (extract(day from pay_month) = 1),
  paid_on date not null,
  actual_amount integer not null check (actual_amount >= 0),
  estimated_amount integer not null check (estimated_amount >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, job_id) references public.jobs (user_id, id),
  unique (user_id, job_id, pay_month)
);
comment on table public.salary_actuals is '給与の実績。pay_month は支払月の1日。position は card_bill_actuals と共通の並び';

-- カードの引き落としの実績。bill_month は引き落としの月の1日
create table public.card_bill_actuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  bill_month date not null check (extract(day from bill_month) = 1),
  actual_amount integer not null check (actual_amount >= 0),
  estimated_amount integer not null check (estimated_amount >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, card_id) references public.cards (user_id, id),
  unique (user_id, card_id, bill_month)
);
comment on table public.card_bill_actuals is 'カードの引き落としの実績。bill_month は引き落としの月の1日。position は salary_actuals と共通の並び';

-- ============================================================
-- インデックス
-- ============================================================

-- 読み込みの順番（position, id）と、本人の行の絞り込み（RLS）に使う
create index cards_user_position_idx on public.cards (user_id, position, id);
create index jobs_user_position_idx on public.jobs (user_id, position, id);
create index categories_user_position_idx on public.categories (user_id, position, id);
create index ledger_entries_user_position_idx on public.ledger_entries (user_id, position, id);
create index shifts_user_position_idx on public.shifts (user_id, position, id);
create index plans_user_position_idx on public.plans (user_id, position, id);
create index fixed_costs_user_position_idx on public.fixed_costs (user_id, position, id);
create index fixed_incomes_user_position_idx on public.fixed_incomes (user_id, position, id);
create index withdrawals_user_position_idx on public.withdrawals (user_id, position, id);
create index salary_actuals_user_position_idx on public.salary_actuals (user_id, position, id);
create index card_bill_actuals_user_position_idx on public.card_bill_actuals (user_id, position, id);

-- 参照先（カード・バイト先・カテゴリ）を消すときの確認に使う
create index ledger_entries_category_idx on public.ledger_entries (user_id, category_id);
create index ledger_entries_card_idx on public.ledger_entries (user_id, card_id);
create index shifts_job_idx on public.shifts (user_id, job_id);
create index plans_card_idx on public.plans (user_id, card_id);
create index fixed_costs_card_idx on public.fixed_costs (user_id, card_id);

-- ============================================================
-- トリガー・RLS・権限（12のテーブルすべてに同じものを付ける）
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'fixed_incomes', 'withdrawals', 'salary_actuals', 'card_bill_actuals'
  ] loop
    execute format(
      'create trigger set_row_timestamps before insert or update on public.%I '
      'for each row execute function private.set_row_timestamps()', t);
    execute format(
      'create trigger keep_row_history after insert or update or delete on public.%I '
      'for each row execute function private.keep_row_history()', t);

    -- 本人の行だけを読み書きできる
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "本人の行だけ" on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);

    -- ログインしていない人（anon）は触れない。ログインした人も必要な操作だけ
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end;
$$;
