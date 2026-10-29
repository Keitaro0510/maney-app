-- DB整備① (#8): user_data の今の状態を DB 内に複製する。
-- private スキーマは API（PostgREST）に公開していないので、アプリの公開キーからは読めない。
create schema if not exists private;
revoke all on schema private from public;

create table private.user_data_backup_20261029 as
  select id, user_id, value, updated_at, now() as backed_up_at
  from public.user_data;

alter table private.user_data_backup_20261029 enable row level security;
