-- DB整備② (#9): user_data の元の定義。
-- テーブルはダッシュボードで手作業で作ったため、マイグレーションがなかった。
-- 2026-10-29 に本番の DB の定義をそのまま書き起こした。本番では実行せず、適用済みとして記録だけした。
-- バージョンの日付は、ほかのマイグレーションより前に流れるようにするための仮のもの。

create table public.user_data (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  value jsonb not null,
  updated_at timestamp with time zone default now(),
  constraint user_data_pkey primary key (id),
  constraint user_data_user_id_unique unique (user_id),
  constraint user_data_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

alter table public.user_data enable row level security;

create policy "自分のデータのみ" on public.user_data
  for all
  using (auth.uid() = user_id);
