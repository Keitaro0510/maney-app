-- D39: 相手とカレンダーを見せ合う（読み取り専用）。
-- 共有コードを渡す → 相手が申請 → 持ち主が承認、の流れ。承認された相手には、予定とシフトの「見せる列だけ」を返す。
-- plans・shifts の RLS はゆるめない。表は private に置き、アプリからは下の関数だけを通す（security definer）。
-- 返さないもの: 予算・カード・メモ・済み・時給・休憩（plans・shifts のほかの列、ほかのテーブルすべて）

-- ============================================================
-- 表（private。アプリのロールは直接触れない）
-- ============================================================
create table private.share_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[0-9a-f]{16}$'),
  created_at timestamptz not null default now()
);
comment on table private.share_codes is '共有コード（1人1つ。16桁の16進数。作り直すと前のコードでは申請できない）';

create table private.calendar_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade, -- 見せる側（カレンダーの持ち主）
  viewer_id uuid not null references auth.users (id) on delete cascade, -- 見る側
  status text not null default 'pending' check (status in ('pending', 'approved')),
  nickname text not null default '' check (char_length(nickname) <= 20), -- 見る側が、持ち主を呼ぶ名前（切り替えに出る）
  created_at timestamptz not null default now(),
  unique (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index calendar_shares_viewer_idx on private.calendar_shares (viewer_id);
comment on table private.calendar_shares is 'カレンダーの共有。owner が approved にしたときだけ、viewer が owner の予定とシフトを見られる';

alter table private.share_codes enable row level security;
alter table private.calendar_shares enable row level security;
-- ポリシーは作らない（アプリのロールからは、関数を通さないと何も読めない・書けない）

-- ============================================================
-- 自分の共有コード
-- ============================================================
create or replace function public.get_my_share_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c text;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  select code into c from private.share_codes where user_id = uid;
  if c is null then
    c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    insert into private.share_codes (user_id, code) values (uid, c)
      on conflict (user_id) do nothing;
    select code into c from private.share_codes where user_id = uid;
  end if;
  return c;
end;
$$;

-- 作り直す（コードが漏れたとき）。すでに承認した相手はそのまま。承認前の申請は、コードを知っていた人のものなので消す
create or replace function public.reset_my_share_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  insert into private.share_codes (user_id, code) values (uid, c)
    on conflict (user_id) do update set code = excluded.code, created_at = now();
  delete from private.calendar_shares where owner_id = uid and status = 'pending';
  return c;
end;
$$;

-- ============================================================
-- 申請・承認・解除
-- ============================================================
-- 相手のコードで、見せてほしいと申請する
create or replace function public.request_calendar_share(p_code text, p_nickname text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  code_norm text := lower(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  owner uuid;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  select user_id into owner from private.share_codes where code = code_norm;
  if owner is null then raise exception 'コードが見つかりません' using errcode = 'P0002'; end if;
  if owner = uid then raise exception '自分のコードは使えません' using errcode = '22023'; end if;
  begin
    insert into private.calendar_shares (owner_id, viewer_id, nickname)
    values (owner, uid, left(btrim(coalesce(p_nickname, '')), 20));
  exception when unique_violation then
    raise exception 'すでに申請済みです' using errcode = '23505';
  end;
end;
$$;

-- 一覧。direction: 'viewing'＝自分が見る側（持ち主の名前は nickname） / 'sharing'＝自分が見せる側（相手のメールを出す）
create or replace function public.list_calendar_shares()
returns table (id uuid, direction text, status text, nickname text, other_email text, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  return query
    select s.id, 'viewing'::text, s.status, s.nickname, ''::text, s.owner_id
      from private.calendar_shares s where s.viewer_id = uid
    union all
    select s.id, 'sharing'::text, s.status, ''::text, coalesce(u.email, '')::text, s.owner_id
      from private.calendar_shares s join auth.users u on u.id = s.viewer_id
      where s.owner_id = uid
    order by 3, 1;
end;
$$;

-- 持ち主が、申請を承認する／断る
create or replace function public.respond_calendar_share(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  if p_approve then
    update private.calendar_shares set status = 'approved'
      where id = p_id and owner_id = uid;
  else
    delete from private.calendar_shares where id = p_id and owner_id = uid and status = 'pending';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception '申請が見つかりません' using errcode = 'P0002'; end if;
end;
$$;

-- 解除（見せる側も見る側も、いつでも）。申請の取り消しも、これ
create or replace function public.revoke_calendar_share(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  delete from private.calendar_shares where id = p_id and (owner_id = uid or viewer_id = uid);
  get diagnostics n = row_count;
  if n = 0 then raise exception '共有が見つかりません' using errcode = 'P0002'; end if;
end;
$$;

-- ============================================================
-- 相手のカレンダー（承認済みのときだけ。見せる列だけ）
-- ============================================================
create or replace function public.shared_calendar(p_owner uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 100 then
    raise exception '期間が正しくありません（100日まで）' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.calendar_shares
    where owner_id = p_owner and viewer_id = uid and status = 'approved'
  ) then
    raise exception '見る許可がありません' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'start_date', p.start_date, 'end_date', p.end_date,
        'start_time', p.start_time, 'end_time', p.end_time, 'color', p.color
      ) order by p.start_date, p.start_time nulls first, p.id)
      from public.plans p
      where p.user_id = p_owner and p.start_date <= p_to and p.end_date >= p_from
    ), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time, 'job', j.name
      ) order by s.date, s.start_time, s.id)
      from public.shifts s
      join public.jobs j on j.user_id = s.user_id and j.id = s.job_id
      where s.user_id = p_owner and s.date between p_from and p_to
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- 権限（ログインした人だけが関数を呼べる。表は誰も直接触れない）
-- ============================================================
revoke all on table private.share_codes, private.calendar_shares from public, anon, authenticated;
revoke all on function public.get_my_share_code() from public, anon;
revoke all on function public.reset_my_share_code() from public, anon;
revoke all on function public.request_calendar_share(text, text) from public, anon;
revoke all on function public.list_calendar_shares() from public, anon;
revoke all on function public.respond_calendar_share(uuid, boolean) from public, anon;
revoke all on function public.revoke_calendar_share(uuid) from public, anon;
revoke all on function public.shared_calendar(uuid, date, date) from public, anon;
grant execute on function public.get_my_share_code() to authenticated;
grant execute on function public.reset_my_share_code() to authenticated;
grant execute on function public.request_calendar_share(text, text) to authenticated;
grant execute on function public.list_calendar_shares() to authenticated;
grant execute on function public.respond_calendar_share(uuid, boolean) to authenticated;
grant execute on function public.revoke_calendar_share(uuid) to authenticated;
grant execute on function public.shared_calendar(uuid, date, date) to authenticated;
