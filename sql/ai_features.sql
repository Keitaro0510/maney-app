-- ai_features: AI機能(カテゴリ自動判定・月次アドバイス)用の追加スキーマ
--
-- 設計方針（docs/design.md「拡張: AI機能」節参照）:
--   card_tx・ai_insightsとも「GASがINSERT/UPDATEし、PWAはSELECTのみ」の
--   書き手分離を踏襲する（user_dataへの直接追記はLost Updateを起こすため）。
--
-- Supabase の SQL Editor で実行する（card_tx.sql適用済みが前提）。

-- 楽天カード明細のAI分類結果（初見の店名のみGeminiが判定して書き込む。nullable）
alter table card_tx add column if not exists ai_suggested_cat text;

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
