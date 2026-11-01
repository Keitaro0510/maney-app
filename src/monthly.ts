// 毎月のお金（fixed_costs の行。D14）の計算。画面は js/monthly-ui.js。ここは画面を使わないので、Node でテストできる。
// 行は DB の形のまま: { id, name, amount, day, kind, payment_method, card_id, start_month, end_month, position }
// start_month・end_month は月の1日（'YYYY-MM-01'）。空なら「前から続いている」「やめていない」。日付は 'YYYY-MM-DD'（端末の時刻での日付）
// js/ の画面からは window.MoneyMonthly で使う（src/main.ts。D17）

/** fixed_costs の行（docs/db/SCHEMA.md）。position は DB で not null */
export interface MonthlyRow {
  id: string;
  name: string;
  amount: number;
  day: number;
  kind: string;
  payment_method: string | null;
  card_id: string | null;
  start_month: string | null;
  end_month: string | null;
  position: number;
  legacy_id?: number | null;
}

/** saveRows に渡す変更 */
export interface Change { table: string; action: 'update' | 'insert'; id: string; row: Record<string, unknown> }

export type MonthlyStatus = 'active' | 'future' | 'ended';

export const TABLE = 'fixed_costs';
const pad2 = (n: number): string => String(n).padStart(2, '0');

// 'YYYY-MM-DD' → その月の1日
export const monthOf = (key: string): string => `${key.slice(0, 7)}-01`;
// 月の1日から n か月ずらす
export function addMonths(first: string, n: number): string {
  const [y, m] = first.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}
// 'YYYY-MM-01' → 「2026年11月」
export const monthLabel = (first: string): string => `${Number(first.slice(0, 4))}年${Number(first.slice(5, 7))}月`;

// 状態: 'active'（今月も数える）・'future'（来月より先から始まる）・'ended'（先月までで終わった）
export function status(row: Pick<MonthlyRow, 'start_month' | 'end_month'>, todayKey: string): MonthlyStatus {
  const now = monthOf(todayKey);
  if (row.end_month && row.end_month < now) return 'ended';
  if (row.start_month && row.start_month > now) return 'future';
  return 'active';
}

// 期間の文字。前から続いていて、やめていなければ ''
export function periodLabel(row: Pick<MonthlyRow, 'start_month' | 'end_month'>): string {
  const { start_month: s, end_month: e } = row;
  if (s && e) return s === e ? `${monthLabel(s)}だけ` : `${monthLabel(s)}〜${monthLabel(e)}`;
  if (s) return `${monthLabel(s)}から`;
  if (e) return `${monthLabel(e)}まで`;
  return '';
}

// 「やめる」の月。which は 'this'（今月まで）か 'last'（先月まで）。
// 始まる月より前にはできない（そのときは null。まちがえて作ったなら削除を使う）
export function stopMonth(row: Pick<MonthlyRow, 'start_month'>, todayKey: string, which: 'this' | 'last'): string | null {
  const end = which === 'this' ? monthOf(todayKey) : addMonths(monthOf(todayKey), -1);
  if (row.start_month && end < row.start_month) return null;
  return end;
}

// 「来月から金額を変える」ができるか（来月も数えるものだけ）
export function canChangeAmount(row: Pick<MonthlyRow, 'end_month'>, todayKey: string): boolean {
  const next = addMonths(monthOf(todayKey), 1);
  return !(row.end_month && row.end_month < next);
}

/** 新しい行の id と並び */
export interface NewRowOptions { newId: () => string; position: number }

// 来月から中身を変える変更の列（saveRows に渡す形）。patch は変える列（金額・払い方など）。
// - 今月までに始まっているもの: 今のルールを今月までで終わらせ、来月からのルールを作る（過去の月は変わらない。D14）
// - 来月より先から始まるもの: まだ数えた月がないので、そのルールを直すだけ
// options: { newId: () => uuid, position: 新しい行の並び }
export function changeFromNextMonthChanges(row: MonthlyRow, todayKey: string, patch: Partial<MonthlyRow>, { newId, position }: NewRowOptions): Change[] {
  if (!canChangeAmount(row, todayKey)) throw new Error('もう終わっているので、来月から変えられません');
  const next = addMonths(monthOf(todayKey), 1);
  if (row.start_month && row.start_month >= next) {
    return [{ table: TABLE, action: 'update', id: row.id, row: { ...patch } }];
  }
  const { name, amount, day, kind, payment_method, card_id, end_month } = row;
  return [
    { table: TABLE, action: 'update', id: row.id, row: { end_month: monthOf(todayKey) } },
    { table: TABLE, action: 'insert', id: newId(), row: {
      name, amount, day, kind, payment_method, card_id, ...patch, start_month: next, end_month: end_month || null, position,
    } },
  ];
}
// 「来月から金額を変える」（D14）
export const changeAmountChanges = (row: MonthlyRow, todayKey: string, amount: number, options: NewRowOptions): Change[] =>
  changeFromNextMonthChanges(row, todayKey, { amount }, options);

// 消した行を、同じ id で戻すための中身（サーバーが決める列は入れない）
export function restoreRow(row: MonthlyRow): Omit<MonthlyRow, 'id'> {
  const { name, amount, day, kind, payment_method, card_id, start_month, end_month, legacy_id, position } = row;
  return { name, amount, day, kind, payment_method, card_id, start_month, end_month, legacy_id: legacy_id ?? null, position };
}

/** 記録の画面の「毎月くり返す」で入れたもの */
export interface RuleInput { name: string; amount: number; dateKey: string; kind: string; payment_method: string | null; card_id: string | null }

// 記録の画面の「毎月くり返す」から作る行。その日を毎月の日にして、その月から数える（D14）。
// 収入は口座に入るものとして数える（DB は収入の払い方を空にする決まり）
export function newRule({ name, amount, dateKey, kind, payment_method, card_id }: RuleInput, position: number): Omit<MonthlyRow, 'id'> {
  const expense = kind === 'expense';
  return {
    name, amount, day: Number(dateKey.slice(8, 10)), kind,
    payment_method: expense ? payment_method : null,
    card_id: expense && payment_method === 'card' ? card_id : null,
    start_month: monthOf(dateKey), end_month: null, position,
  };
}

// 一覧の分け方: 続いているもの（日の順）・これから始まるもの（始まる月の順）・終わったもの（終わった月の新しい順）
// future は start_month が、ended は end_month が必ずある（status で分けているので、その先の ! は空にならない）
export function groups<T extends MonthlyRow>(rows: T[], todayKey: string): Record<MonthlyStatus, T[]> {
  const byDay = (a: T, b: T): number => (a.day - b.day) || (a.position - b.position) || String(a.id).localeCompare(String(b.id));
  const out: Record<MonthlyStatus, T[]> = { active: [], future: [], ended: [] };
  for (const r of rows) out[status(r, todayKey)].push(r);
  out.active.sort(byDay);
  out.future.sort((a, b) => a.start_month!.localeCompare(b.start_month!) || byDay(a, b));
  out.ended.sort((a, b) => b.end_month!.localeCompare(a.end_month!) || byDay(a, b));
  return out;
}

export const nextPosition = (rows: { position?: number | null }[]): number => rows.reduce((max, r) => Math.max(max, r.position || 0), -1) + 1;
