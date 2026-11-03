// ホームで使う残高と今月の見込み（D20 の 8）。表示は screens/home.ts。
import { state } from './state.ts';
import { currentRows } from './sync.ts';
import { getToday, gY, gM, gD, toDS, monthDay, addM, ds2d } from './dates.ts';
import * as money from './money.ts';

export function estimateAcct(): number {
  return state.server ? money.balanceAt(currentRows(), getToday()) : (parseInt(String(state.st.acctBase)) || 0);
}

export function buildBalanceSeries(): { labels: string[]; balances: number[] } {
  const series = money.balanceSeries(currentRows(), getToday(), 90);
  return {
    labels: series.map((point, i) => {
      const date = ds2d(point.date);
      return i === 0 ? '今日' : `${date.getMonth() + 1}/${date.getDate()}`;
    }),
    balances: series.map(point => Math.round(point.balance)),
  };
}

export function upcomingIncome(): { total: number; parts: { label: string; amount: number }[] } {
  const mdl = money.model(currentRows()), y = gY(), m = gM(), d = gD();
  const parts: { label: string; amount: number }[] = [];
  mdl.fixedCosts.filter(fc => fc.kind === 'income' && money.activeInMonth(fc, y, m)).forEach(fc => {
    if (monthDay(y, m, fc.day) > d) parts.push({ label: fc.name, amount: fc.amount });
  });
  mdl.jobs.forEach(job => {
    const pay = monthDay(y, m, money.payDayOf(mdl, job)) > d ? { y, m } : addM(y, m, 1);
    const work = addM(pay.y, pay.m, -1);
    const salary = money.salary(mdl, job, pay.y, pay.m);
    if (salary.amount > 0) parts.push({ label: `${job.name}（${work.m + 1}月分）`, amount: salary.amount });
  });
  return { total: parts.reduce((sum, part) => sum + part.amount, 0), parts };
}

export function upcomingFixed(): number {
  const mdl = money.model(currentRows()), y = gY(), m = gM(), d = gD(), today = getToday();
  const monthEnd = toDS(y, m, new Date(y, m + 1, 0).getDate());
  let total = 0;
  mdl.cards.forEach(card => {
    const cycle = money.cardCycleMonths(card, today).confirmed;
    if (toDS(cycle.y, cycle.m, monthDay(cycle.y, cycle.m, card.bill_day)) > today)
      total += money.cardBill(mdl, card, cycle.y, cycle.m).amount;
  });
  mdl.fixedCosts.filter(fc => fc.kind === 'expense' && fc.payment_method === 'bank' && money.activeInMonth(fc, y, m)).forEach(fc => {
    if (monthDay(y, m, fc.day) > d) total += fc.amount;
  });
  mdl.ledger.filter(entry => entry.kind === 'expense' && entry.payment_method === 'bank' && entry.date > today && entry.date <= monthEnd).forEach(entry => {
    total += entry.amount;
  });
  return total;
}

export function thisMonthPlanBudget(): number {
  const y = gY(), m = gM();
  const start = toDS(y, m, 1), end = toDS(y, m, new Date(y, m + 1, 0).getDate());
  return state.st.plans.filter(plan => {
    if (plan.done || !plan.budget || plan.planCardIdx != null) return false;
    const from = plan.dateStart || plan.date, to = plan.dateEnd || plan.date;
    return from <= end && to >= start;
  }).reduce((sum, plan) => sum + (plan.budget || 0), 0);
}
