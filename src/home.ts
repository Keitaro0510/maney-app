// ホームで使う残高と今月の見込み（D20 の 8）。表示は screens/home.ts。
import { state } from './state.ts';
import { currentRows } from './sync.ts';
import { getToday, ds2d } from './dates.ts';
import * as money from './money.ts';

export function estimateAcct(): number {
  return state.server ? money.balanceAt(currentRows(), getToday()) : (parseInt(String(state.st.acctBase)) || 0);
}

// グラフ用。marks は日ごとの入出金（点を押したときに出す）、lowIndex は残高の最低点（D22）
export function buildBalanceSeries(): { labels: string[]; balances: number[]; marks: string[][]; lowIndex: number } {
  const rows = currentRows(), today = getToday();
  const series = money.balanceSeries(rows, today, money.SPENDABLE_DAYS);
  const marks: string[][] = series.map(() => []);
  const indexOf = new Map(series.map((point, i) => [point.date, i]));
  for (const e of money.upcoming(rows, today, money.SPENDABLE_DAYS)) {
    const i = indexOf.get(e.date);
    if (i !== undefined) marks[i].push(`${e.label} ${e.amount < 0 ? '-' : '+'}¥${Math.abs(e.amount).toLocaleString()}`);
  }
  const low = money.spendable(rows, today);
  return {
    labels: series.map((point, i) => {
      const date = ds2d(point.date);
      return i === 0 ? '今日' : `${date.getMonth() + 1}/${date.getDate()}`;
    }),
    balances: series.map(point => Math.round(point.balance)),
    marks,
    lowIndex: low.minDays,
  };
}
