-- ジムのトレーニングに、所要時間（秒）を持たせる（D26。gymapp のタイマー）。
-- gym_workouts に duration_sec（最初のセットを追加してから保存するまでの秒数。空でもよい）を足す。
-- 既存のトレーニングは空（測っていない）。値は gymapp が設定する。
-- 0 〜 24時間（86400秒）の整数だけ。範囲外は DB が断る。
-- テーブルを足すわけではないので、写し・apply_op・復元は変えない（どれも列を名前で扱う。古い写しから戻すときは、足りない列は空になる）。

alter table public.gym_workouts
  add column duration_sec integer;

alter table public.gym_workouts
  add constraint gym_workouts_duration_sec_check check (duration_sec is null or (duration_sec >= 0 and duration_sec <= 86400));

comment on column public.gym_workouts.duration_sec is '所要時間（秒）（D26）。最初のセットを追加してから保存するまで。空は未計測（今までの記録）';
