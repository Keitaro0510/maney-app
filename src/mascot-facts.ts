// キリンのセリフの材料（D34）。家計のデータから「給料日まで」「予算のペース」「曜日の傾向」を取り出し、セリフの文にする。
// 画面を使わない関数だけ置く（テストできるように）。文は、責めずに一緒に見る言い方にする（D33）。
import { weekdayAverages, weekdayRangeStart } from './analysis.ts';
import { DAYS } from './dates.ts';
import type { StLedger } from './compat.ts';

export type BudgetPace = 'over' | 'fast' | 'ok' | 'slow';
export type MascotFacts = {
  /** 次の給料日まで何日か（今日が給料日なら 0。給料日の登録がなければ null） */
  daysToPayday: number | null;
  /** 今月の予算に対する、ここまでの支出 */
  budget: { pct: number; pace: BudgetPace | null } | null;
  /** 今日の曜日が、ふだんより使いがちか・控えめか（記録が少ないときは null） */
  weekday: { label: string; trend: 'high' | 'low' } | null;
};

const parse = (ds: string): [number, number, number] => { const [y, m, d] = ds.split('-').map(Number); return [y, m, d]; };
const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate(); // m は 1 から

/** 次の給料日まで何日か。payDays は日にち（1〜31）。その月に日がなければ月末にする。登録がなければ null */
export function daysToPayday(today: string, payDays: number[]): number | null {
  const [y, m, d] = parse(today);
  const days = payDays.filter(p => p >= 1 && p <= 31);
  if (!days.length) return null;
  const nowMs = Date.UTC(y, m - 1, d);
  let best: number | null = null;
  for (const p of days) {
    for (const offset of [0, 1]) {
      const mm = m - 1 + offset;
      const dim = daysInMonth(y + Math.floor(mm / 12), (mm % 12) + 1);
      const ms = Date.UTC(y, mm, Math.min(p, dim));
      if (ms >= nowMs) { const diff = Math.round((ms - nowMs) / 86400000); if (best === null || diff < best) best = diff; break; }
    }
  }
  return best;
}

/** 今月の予算のペース。予算が0以下なら null。ペースは「使った割合 ÷ 月の経過の割合」。月の初め（7日まで）は、まだ分からないので null */
export function budgetFact(spent: number, budget: number, today: string): MascotFacts['budget'] {
  if (!(budget > 0)) return null;
  const [y, m, d] = parse(today);
  const pct = Math.round((spent / budget) * 100);
  if (spent >= budget) return { pct, pace: 'over' };
  if (d < 8) return { pct, pace: null };
  const ratio = (spent / budget) / (d / daysInMonth(y, m));
  return { pct, pace: ratio <= 0.8 ? 'slow' : ratio >= 1.2 ? 'fast' : 'ok' };
}

/** 曜日の傾向を言えるのに必要な、記録の期間（日）。どの曜日も8回以上あるように、8週間 */
export const WEEKDAY_MIN_SPAN_DAYS = 56;

/** 今日の曜日の、1日あたりの支出が、全体の平均より多いか少ないか（直近6か月。記録を付けはじめた日より前は数えない）。
 *  記録の期間が8週間に満たない・支出がないときは、あてにならないので null */
export function weekdayFact(ledger: StLedger[], today: string): MascotFacts['weekday'] {
  const first = weekdayRangeStart(ledger, 'all', today); // いちばん古い支出の日
  const sixMonths = weekdayRangeStart(ledger, '6m', today);
  if (!first || !sixMonths) return null;
  const start = first > sixMonths ? first : sixMonths;
  const [sy, sm, sd] = parse(start), [y, m, d] = parse(today);
  if (Math.round((Date.UTC(y, m - 1, d) - Date.UTC(sy, sm - 1, sd)) / 86400000) < WEEKDAY_MIN_SPAN_DAYS) return null;
  const list = weekdayAverages(ledger, start, today);
  const me = list[new Date(y, m - 1, d).getDay()];
  const totalDays = list.reduce((a, w) => a + w.days, 0), total = list.reduce((a, w) => a + w.total, 0);
  if (!total) return null;
  const ratio = me.total / me.days / (total / totalDays);
  return ratio >= 1.3 ? { label: DAYS[me.dow], trend: 'high' } : ratio <= 0.7 ? { label: DAYS[me.dow], trend: 'low' } : null;
}

export type FactsInput = { ledger: StLedger[]; payDays: number[]; budget: number; today: string };

/** セリフの材料をまとめる。今月の支出は、家計簿の記録だけ（ホームの予算バーと同じ） */
export function mascotFacts(i: FactsInput): MascotFacts {
  const month = i.today.slice(0, 7);
  const spent = i.ledger.filter(l => l.type === 'expense' && l.date.startsWith(month)).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return { daysToPayday: daysToPayday(i.today, i.payDays), budget: budgetFact(spent, i.budget, i.today), weekday: weekdayFact(i.ledger, i.today) };
}

/** 材料から、言えることを文にする（言えないものは入らない）。給料日は7日前から */
export function factLines(f: MascotFacts): string[] {
  const out: string[] = [];
  if (f.daysToPayday !== null && f.daysToPayday <= 7) {
    out.push(f.daysToPayday === 0 ? '今日は給料日だね！おつかれさま' : f.daysToPayday === 1 ? '明日は給料日！あと少しだね' : `給料日まであと${f.daysToPayday}日だよ`);
  }
  if (f.budget) {
    const p = f.budget.pct;
    switch (f.budget.pace) {
      case 'over': out.push('今月の予算を使いきったね。残りの日は一緒に様子を見よう'); break;
      case 'fast': out.push(`今月は予算の${p}%。ペースが少し早めかも。ゆっくり行こうね`); break;
      case 'slow': out.push(`今月は予算の${p}%。いいペース！`); break;
      case 'ok': out.push(`今月は予算の${p}%。ちょうどいいペースだよ`); break;
      default: break;
    }
  }
  if (f.weekday) {
    out.push(f.weekday.trend === 'high'
      ? `${f.weekday.label}曜日は、いつもちょっと使いがちな日みたい。ゆっくり選ぼうね`
      : `${f.weekday.label}曜日は、いつも落ち着いて過ごせてる日だね`);
  }
  return out;
}
