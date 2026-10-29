-- Rakuten card mail import was removed on 2026-10-24; all 539 rows were already imported into user_data.ledger.
-- 本番では `drop table public.card_tx;` として適用した。card_tx を作ったマイグレーションはないので、
-- まっさらな DB でも流せるように if exists を付けている。
drop table if exists public.card_tx;
