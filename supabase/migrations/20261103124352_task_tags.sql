-- #137: 1つのタスクに複数の用途タグを付ける。既存のタスクはタグなし。
-- タグ名は利用者が決め、一覧の絞り込み候補は本人の tasks から作る。
alter table public.tasks
  add column tags text[] not null default '{}'::text[];
