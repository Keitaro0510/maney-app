-- DB整備② (#9)
-- user_id には常にログイン中のユーザーIDが入るので、NULL を許さない（2026-10-29 時点で NULL の行は0件）。
alter table public.user_data alter column user_id set not null;

-- auth.uid() を行ごとではなく、問い合わせごとに1回だけ評価する（Performance Advisor: auth_rls_initplan）。
-- 対象のロール（public）と、ALL の USING が WITH CHECK にも使われることは変えない。
alter policy "自分のデータのみ" on public.user_data
  using ((select auth.uid()) = user_id);
