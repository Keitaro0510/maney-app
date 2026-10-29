-- DB整備① (#8): user_data が更新・削除されるたびに、前の版を履歴に残す。
-- あわせて updated_at を端末ではなくサーバーの時刻で入れる。

create table private.user_data_history (
  id bigint generated always as identity primary key,
  user_data_id uuid not null,
  user_id uuid,
  value jsonb,
  updated_at timestamptz,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  archived_at timestamptz not null default now()
);
create index user_data_history_user_id_id_idx on private.user_data_history (user_id, id desc);
alter table private.user_data_history enable row level security;

-- 前の版を残す。中身が変わらない更新は残さない。ユーザーごとに直近500版まで残す。
-- アプリのロールは private スキーマに触れないので、security definer で書き込む。
create function private.user_data_keep_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep constant int := 500;
  oldest_kept bigint;
begin
  if tg_op = 'UPDATE' and old.value is not distinct from new.value then
    return null;
  end if;

  insert into private.user_data_history (user_data_id, user_id, value, updated_at, operation)
  values (old.id, old.user_id, old.value, old.updated_at, tg_op);

  select h.id into oldest_kept
  from private.user_data_history h
  where h.user_id = old.user_id
  order by h.id desc
  offset keep - 1 limit 1;

  if oldest_kept is not null then
    delete from private.user_data_history h
    where h.user_id = old.user_id and h.id < oldest_kept;
  end if;

  return null;
end;
$$;

create trigger user_data_keep_history
after update or delete on public.user_data
for each row execute function private.user_data_keep_history();

-- updated_at はサーバーの時刻で入れる（アプリが送った値は使わない）。
create function private.user_data_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_data_set_updated_at
before insert or update on public.user_data
for each row execute function private.user_data_set_updated_at();

revoke all on function private.user_data_keep_history() from public;
revoke all on function private.user_data_set_updated_at() from public;
