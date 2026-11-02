// DB のテーブルの行の型（docs/db/SCHEMA.md・supabase/migrations/）。currentRows() の中身。
// 手元で重ねたばかりの行（送信待ち）は user_id がなく、updated_at が null のことがある（src/data.ts の applyChanges）。
// data.ts の汎用の行（Row）にもそのまま渡せるように、interface ではなく type で書く

type Base = { id: string; user_id?: string; created_at?: string; updated_at?: string | null };
/** 並び順のある一覧のテーブル（position は not null） */
type Listed = Base & { position: number };

export type SettingsRow = Base & {
  acct_base: number; base_date: string; budget: number; other_income: number;
  shift_close_day: number; shift_pay_day: number; fuyou_limit: string;
};
export type CardRow = Listed & { name: string; close_day: number; bill_day: number; deleted_at: string | null };
export type JobRow = Listed & {
  name: string; color: string; wage: number; night_start: string; night_rate: number; transport: number;
  close_day: number | null; pay_day: number | null; deleted_at: string | null;
};
export type CategoryRow = Listed & { kind: string; name: string; deleted_at: string | null };
export type LedgerEntryRow = Listed & {
  date: string; kind: string; amount: number; name: string; memo: string;
  category_id: string; payment_method: string; card_id: string | null;
};
export type ShiftRow = Listed & { date: string; job_id: string; start_time: string; end_time: string; wage: number; rest_minutes: number };
export type PlanRow = Listed & {
  title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null;
  budget: number; done: boolean; memo: string; color: string; card_id: string | null; legacy_id: number | null;
};
export type FixedCostRow = Listed & {
  name: string; amount: number; day: number; kind: string; payment_method: string | null; card_id: string | null;
  start_month: string | null; end_month: string | null; legacy_id: number | null;
};
export type WithdrawalRow = Listed & { date: string; amount: number };
export type SalaryActualRow = Listed & { job_id: string; pay_month: string; paid_on: string; actual_amount: number; estimated_amount: number };
export type CardBillActualRow = Listed & { card_id: string; bill_month: string; actual_amount: number; estimated_amount: number };
export type TaskRow = Listed & { title: string; due_date: string | null; completed_at: string | null; memo: string };

/** テーブルの名前 → 行の一覧（読み込む前は空） */
export type DbRows = {
  settings?: SettingsRow[]; cards?: CardRow[]; jobs?: JobRow[]; categories?: CategoryRow[];
  ledger_entries?: LedgerEntryRow[]; shifts?: ShiftRow[]; plans?: PlanRow[]; fixed_costs?: FixedCostRow[];
  withdrawals?: WithdrawalRow[]; salary_actuals?: SalaryActualRow[]; card_bill_actuals?: CardBillActualRow[]; tasks?: TaskRow[];
};
