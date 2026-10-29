-- テーブル分割 (#11): 家計簿のカテゴリの外部キー (user_id, category_id, kind) を、インデックスがすべて覆うようにする。
-- Performance Advisor: unindexed_foreign_keys
drop index public.ledger_entries_category_idx;
create index ledger_entries_category_idx on public.ledger_entries (user_id, category_id, kind);
