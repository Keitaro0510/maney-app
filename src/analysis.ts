// 分析の計算（D28）。画面を使わない関数だけ置く（テストできるように）。
import { addM } from './dates.ts';
import type { StLedger } from './compat.ts';

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
