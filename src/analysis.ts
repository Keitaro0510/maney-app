// 分析の計算（D28）。画面を使わない関数だけ置く（テストできるように）。
import { addM } from './dates.ts';
import type { StLedger, StJob } from './compat.ts';

export type MonthTotal = { y: number; m: number; label: string; income: number; expense: number; net: number };

/** 家計簿の記録から、y 年 m 月（m は 0 から）で終わる直近 months か月の、月ごとの収入・支出・収支を出す。記録のない月は 0 */
export function monthlyTotals(ledger: StLedger[], endY: number, endM: number, months = 12): MonthTotal[] {
  const list: MonthTotal[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { y, m } = addM(endY, endM, -i);
    list.push({ y, m, label: `${m + 1}月`, income: 0, expense: 0, net: 0 });
  }
  const byKey = new Map(list.map(t => [`${t.y}-${String(t.m + 1).padStart(2, '0')}`, t]));
  for (const l of ledger) {
    const t = byKey.get(l.date.slice(0, 7)); // 日付の文字列の「年-月」。時刻のずれを避ける
    if (!t) continue;
    const amount = Number(l.amount) || 0;
    if (l.type === 'income') t.income += amount;
    else if (l.type === 'expense') t.expense += amount;
  }
  for (const t of list) t.net = t.income - t.expense;
  return list;
}

export type FuyouLevel = 'ok' | 'warn' | 'danger' | 'over';
export type FuyouGauge = {
  limit: number; confirmed: number; estimated: number;
  /** 確定・予想が限度額の何%か（0〜100。それ以上は100で止める。描くため） */
  confirmedPct: number; estimatedPct: number;
  /** 限度額から確定を引いた残り（超えたらマイナス）。予想で引いた余裕も */
  remaining: number; margin: number;
  /** 確定の進み具合: ok（70%未満）・warn（70%以上）・danger（90%以上）・over（超えた） */
  level: FuyouLevel;
};

/** 扶養の限度額 limit に対して、今年の確定した収入 confirmed と、シフトの予想 estimated がどこまで来ているか */
export function fuyouGauge(limit: number, confirmed: number, estimated: number): FuyouGauge {
  const pct = (v: number): number => Math.max(0, Math.min(100, (v / limit) * 100));
  const raw = (confirmed / limit) * 100;
  const level: FuyouLevel = confirmed >= limit ? 'over' : raw >= 90 ? 'danger' : raw >= 70 ? 'warn' : 'ok';
  return { limit, confirmed, estimated, confirmedPct: pct(confirmed), estimatedPct: pct(estimated), remaining: limit - confirmed, margin: limit - estimated, level };
}

/** 設定（fuyouLimit: '1030000'・'1300000'・'both'）で出す限度額 */
export function fuyouLimits(setting: string): { label: string; amount: number }[] {
  const all = [{ label: '103万円の壁', amount: 1030000 }, { label: '130万円の壁', amount: 1300000 }];
  return all.filter(l => setting === 'both' || String(l.amount) === setting);
}

export type DayCell = { day: number; amount: number; count: number; level: 0 | 1 | 2 | 3 | 4 };
export type MonthHeat = {
  y: number; m: number;
  /** その月の1日の曜日（日曜が0）。カレンダーの最初の空きマスの数 */
  offset: number;
  cells: DayCell[]; total: number;
  /** いちばん支出の多い日（支出がなければ null。同じ金額なら早い日） */
  maxDay: number | null;
};

/** y 年 m 月（m は 0 から）の、日ごとの支出。level は、その月でいちばん多い日を基準にした濃さ（0＝使っていない、4＝最多に近い） */
export function dailyExpenseHeat(ledger: StLedger[], y: number, m: number): MonthHeat {
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: DayCell[] = Array.from({ length: dim }, (_, i) => ({ day: i + 1, amount: 0, count: 0, level: 0 }));
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  for (const l of ledger) {
    if (l.type !== 'expense' || !l.date.startsWith(prefix)) continue;
    const cell = cells[Number(l.date.slice(8, 10)) - 1];
    if (!cell) continue;
    cell.amount += Number(l.amount) || 0;
    cell.count += 1;
  }
  const max = Math.max(0, ...cells.map(c => c.amount));
  for (const c of cells) {
    const r = max ? c.amount / max : 0;
    c.level = c.amount <= 0 ? 0 : r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
  }
  const maxCell = max ? cells.find(c => c.amount === max) : undefined;
  return { y, m, offset: new Date(y, m, 1).getDay(), cells, total: cells.reduce((a, c) => a + c.amount, 0), maxDay: maxCell ? maxCell.day : null };
}

/** バイト先の時給の平均（削除済み・時給のないものは除く）。登録がなければ null */
export function averageWage(jobs: StJob[]): number | null {
  const wages = jobs.filter(j => !j._deleted).map(j => Number(j.wage) || 0).filter(w => w > 0);
  return wages.length ? Math.round(wages.reduce((a, w) => a + w, 0) / wages.length) : null;
}

/** 金額 amount が、時給 wage で何時間分か（小数のまま） */
export const workHours = (amount: number, wage: number): number => (wage > 0 ? amount / wage : 0);

/** 時間の見せ方。10時間未満は小数1桁（2.5）、それ以上は整数（70） */
export const fmtHours = (h: number): string => (h < 10 ? String(Math.round(h * 10) / 10) : String(Math.round(h)));

export type CatSpend = { cat: string; amount: number; hours: number };
export type SpendPeriod = { total: number; hours: number; top: CatSpend[] };

/** 期間の支出の合計・時間・支出の多いカテゴリ上位 n 個。m が null なら y 年ぜんぶ、数字ならその月（m は 0 から）。wage が null なら時間は 0 */
export function spendInWork(ledger: StLedger[], y: number, m: number | null, wage: number | null, n = 3): SpendPeriod {
  const prefix = m === null ? `${y}-` : `${y}-${String(m + 1).padStart(2, '0')}-`;
  const byCat = new Map<string, number>();
  let total = 0;
  for (const l of ledger) {
    if (l.type !== 'expense' || !l.date.startsWith(prefix)) continue;
    const amount = Number(l.amount) || 0;
    total += amount;
    byCat.set(l.cat, (byCat.get(l.cat) || 0) + amount);
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([cat, amount]) => ({ cat, amount, hours: wage ? workHours(amount, wage) : 0 }));
  return { total, hours: wage ? workHours(total, wage) : 0, top };
}
