-- ジムの種目に、やり方のメモと、解説動画のリンクを持たせる（D25。gymapp の #23）。
-- gym_exercises に、notes（やり方・フォーム・意識すること。なければ空の文字）と video_url（解説動画の URL。空でもよい）を足す。
-- 既存の種目は、メモなし・リンクなし。値は gymapp が設定する。
-- video_url は http:// か https:// で始まるものだけ（javascript: などの、開くと動いてしまう書き方を入れさせない）。長さの上限も見張る。
-- テーブルを足すわけではないので、写し・apply_op・復元は変えない（どれも列を名前で扱う。古い写しから戻すときは、足りない列は既定値になる）。

alter table public.gym_exercises
  add column notes text not null default '',
  add column video_url text;

alter table public.gym_exercises
  add constraint gym_exercises_notes_length_check check (char_length(notes) <= 5000),
  add constraint gym_exercises_video_url_check check (
    video_url is null or (char_length(video_url) <= 2000 and video_url ~* '^https?://[^[:space:]]+$'));

comment on column public.gym_exercises.notes is 'やり方・フォーム・意識することのメモ（D25）。5000文字まで';
comment on column public.gym_exercises.video_url is '解説動画の URL（D25）。http:// か https:// のみ。空は未設定';
