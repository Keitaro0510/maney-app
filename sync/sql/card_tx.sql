-- card_tx: 楽天カードの利用明細を自動取り込むための追記型テーブル
--
-- 設計方針（docs/design.md 参照）:
--   既存の user_data（st全体を1レコードjsonbでPWAのみが書く）とは書き手を分離する。
--   このテーブルは GAS が INSERT し、PWA は status を更新するだけ。
--   カテゴリ・カード紐付けはあえて持たせない（st.merchantRules / st.rakutenCardIdx 側で管理）。
--
-- Supabase の SQL Editor で実行する。

create table if not exists card_tx (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 重複防止
  dedupe_key    text not null,          -- '<gmailMessageId>#<blockIndex>'
  gmail_msg_id  text,                   -- 監査・再パース用
  source        text not null default 'rakuten_mail',

  -- メールから抽出（原文保持）
  section       text,                   -- 'ショッピングご利用分' 等（未知セクション検知用）
  used_on       date not null,          -- ■利用日
  merchant_raw  text not null,          -- ■利用先（原文そのまま、半角カナ含む）
  merchant_norm text,                   -- NFKC正規化 + ハイフン補正後
  user_type     text,                   -- ■利用者（本人/家族）
  pay_method    text,                   -- ■支払方法（1回/リボ/3回…）
  amount        integer not null,       -- ■利用金額（円・整数）
  bill_month    text,                   -- ■支払月 'YYYY-MM'

  -- PWA が書く
  status        text not null default 'pending',  -- pending / imported / ignored
  ledger_ref    text,                   -- 取り込み後に st.ledger 側の txId を記録

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  constraint card_tx_dedupe unique (user_id, dedupe_key)
);

create index if not exists card_tx_pending_idx on card_tx (user_id, status, used_on desc);

alter table card_tx enable row level security;

create policy "own rows" on card_tx
  for all using (auth.uid() = user_id);
