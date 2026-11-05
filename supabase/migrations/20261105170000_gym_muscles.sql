-- ジムの種目に部位を持たせる（D24。gymapp の #10）。
-- gym_exercises に、主に使う部位（primary_muscle。1つ）と補助の部位（secondary_muscles。複数）を足す。
-- 既存の種目は部位なし（primary_muscle が空、secondary_muscles が空の配列）。値は gymapp が設定する。
-- 部位の一覧（14）: chest 胸 / delt_front 肩（前部）/ delt_side 肩（中部）/ delt_rear 肩（後部）/ lats 広背筋 /
--   upper_back 僧帽筋・菱形筋 / biceps 上腕二頭筋 / triceps 上腕三頭筋 / forearm 前腕 / abs 腹 /
--   glutes 臀部 / quads 大腿四頭筋 / hamstrings ハムストリング / calves ふくらはぎ
-- 一覧を増やすときは、新しいマイグレーションで check を作り直す（check は関数を呼ばず配列を直接書く。
-- ログインした人の権限で動く check から、private の関数は呼べないため）。
-- テーブルを足すわけではないので、写し・apply_op・復元は変えない（どれも列を名前で扱う。古い写しから戻すときは、足りない列は既定値になる）。

alter table public.gym_exercises
  add column primary_muscle text,
  add column secondary_muscles text[] not null default '{}'::text[];

alter table public.gym_exercises
  add constraint gym_exercises_primary_muscle_check check (
    primary_muscle is null or primary_muscle = any (array[
      'chest', 'delt_front', 'delt_side', 'delt_rear', 'lats', 'upper_back', 'biceps', 'triceps',
      'forearm', 'abs', 'glutes', 'quads', 'hamstrings', 'calves']::text[])),
  add constraint gym_exercises_secondary_muscles_check check (
    secondary_muscles <@ array[
      'chest', 'delt_front', 'delt_side', 'delt_rear', 'lats', 'upper_back', 'biceps', 'triceps',
      'forearm', 'abs', 'glutes', 'quads', 'hamstrings', 'calves']::text[]),
  -- 主の部位を、補助にも入れない（人体図で、同じ種目の同じ部位を二重に数えないため）
  add constraint gym_exercises_muscles_distinct_check check (
    primary_muscle is null or not (primary_muscle = any (secondary_muscles)));

comment on column public.gym_exercises.primary_muscle is '主に使う部位（D24）。空は未設定';
comment on column public.gym_exercises.secondary_muscles is '補助の部位（D24）。複数。主の部位は入れない';
