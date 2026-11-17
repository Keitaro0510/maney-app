-- Issue #189・D36: iPhone などに Web Push の通知を送るための、端末ごとの購読情報。
-- endpoint は端末（ブラウザ）ごとに決まる送り先で、p256dh・auth は暗号化の鍵。人に見せる情報ではないが、本人の行だけ読める。
-- 端末に結び付いた情報なので、毎日の写し・読み込み・行の履歴には入れない（バックアップに含めない。戻すときは、端末で登録し直す）。
-- 送る側（Edge Function）は service_role で読む。アプリは、登録を関数（register_push_subscription）で行い、やめるときは自分の行を消す。

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) between 80 and 120), -- 公開鍵（65 バイトの base64url）
  auth text not null check (char_length(auth) between 20 and 30), -- 16 バイトの base64url
  user_agent text not null default '' check (char_length(user_agent) <= 300), -- どの端末か見分けるための参考
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
comment on table public.push_subscriptions is '通知（Web Push）の購読情報。端末ごとに1行。写し・履歴には入れない';

create trigger set_row_timestamps before insert or update on public.push_subscriptions
  for each row execute function private.set_row_timestamps();

alter table public.push_subscriptions enable row level security;
create policy "本人の行だけ読める" on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "本人の行だけ消せる" on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.push_subscriptions from anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

-- 登録する。同じ端末（endpoint）が別の人の名前で残っていたら、その行を消して、今ログインしている人のものにする
-- （端末でアカウントを切り替えたとき、前の人に通知が届き続けないように）。RLS を通らないので security definer
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ログインが必要です' using errcode = '28000'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300));
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
