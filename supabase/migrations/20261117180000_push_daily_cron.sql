-- Issue #189・D36: 毎朝8:00（日本時間）に、Edge Function `push`（action=daily）を呼んで、朝の通知を送る。
-- 呼び出しは pg_cron → pg_net。合言葉（secret）と送り先の URL は private.push_cron に持つ。
-- - 合言葉は、このマイグレーションを当てた DB ごとにランダムに作る（リポジトリには入らない）。関数は verify_push_cron_secret で確かめる
-- - 送り先の URL は、ここでは入れない（本番だけ、あとから入れる）。空のあいだは何も送らない（手元・CI の DB が、本番を呼ばないように）

create extension if not exists pg_net with schema extensions;

create table private.push_cron (
  id boolean primary key default true check (id), -- 1行だけ
  url text check (url is null or url ~ '^https://'),
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into private.push_cron default values;
comment on table private.push_cron is '朝の通知を呼ぶ設定（1行）。url が空なら送らない。secret は push 関数との合言葉';
alter table private.push_cron enable row level security;
revoke all on table private.push_cron from public, anon, authenticated;

-- push 関数（service_role）が、呼び出しの合言葉を確かめる
create or replace function public.verify_push_cron_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(p_secret, '') <> '' and exists (select 1 from private.push_cron where secret = p_secret)
$$;
revoke all on function public.verify_push_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_push_cron_secret(text) to service_role;

-- pg_cron が呼ぶ。url が空なら何もしない
create or replace function private.run_push_daily()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c record;
begin
  select url, secret into c from private.push_cron;
  if c.url is null then return; end if;
  perform net.http_post(
    url := c.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.secret),
    body := '{"action":"daily"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.run_push_daily() from public;

-- 毎日 23:00 UTC ＝ 朝 8:00（日本時間）
select cron.schedule('push-daily', '0 23 * * *', $$select private.run_push_daily()$$);
