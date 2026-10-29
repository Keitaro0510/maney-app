-- ai_features: 月次アドバイス用のスキーマ
--
-- 設計方針（docs/design.md「拡張: AI機能」節参照）:
--   「GASがINSERTし、PWAはSELECTのみ」の書き手分離にする
--   （user_dataへの直接追記はLost Updateを起こすため）。
--
-- Supabase の SQL Editor で実行する（実行済み）。
-- 楽天カード取り込み用の card_tx テーブルと ai_suggested_cat カラムは、
-- 取り込み機能の削除(2026-10-24)に合わせてこのファイルから外した
-- （Supabase上の card_tx テーブルも 2026-10-24 に削除済み）。

-- 月次支出アドバイス。GASが月1回生成してINSERTし、PWAは最新1件をSELECTして表示する
create table if not exists ai_insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  kind          text not null default 'monthly_advice',  -- 将来他の分析結果も入れられるように
  period        text,                                     -- 対象月 'YYYY-MM'
  message       text not null,                            -- Geminiが生成した助言本文

  created_at    timestamptz default now()
);

create index if not exists ai_insights_user_kind_idx on ai_insights (user_id, kind, created_at desc);
