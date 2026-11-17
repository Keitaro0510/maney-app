// 予定を日ごとに読む補助（D20 の 6）。ホームとカレンダーも使う。
import { state } from './state.ts';
import type { StPlan } from './compat.ts';

export function getPlansForDay(ds: string): StPlan[] {
  return state.st.plans.filter(p => { const s = p.dateStart || p.date, e = p.dateEnd || p.date; return ds >= s && ds <= e; });
}

// 'HH:MM' → 分（時刻なしは -1）
export const hm2min = (t: string): number => { if (!t) return -1; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// 期間予定は初日が開始時刻、最終日が終了時刻、中日は終日。
export function planTimeOnDay(p: Pick<StPlan, 'date' | 'dateStart' | 'dateEnd' | 'timeStart' | 'timeEnd'>, ds: string): { start: string; end: string; min: number } {
  const s = p.dateStart || p.date, e = p.dateEnd || p.date;
  if (!p.timeStart) return { start: '', end: '', min: -1 };
  if (s === e) return { start: p.timeStart, end: p.timeEnd || '', min: hm2min(p.timeStart) };
  if (ds === s) return { start: p.timeStart, end: '', min: hm2min(p.timeStart) };
  if (ds === e) return { start: '', end: p.timeEnd || '', min: p.timeEnd ? hm2min(p.timeEnd) : -1 };
  return { start: '', end: '', min: -1 };
}

/** 選んだ日それぞれの「1日の予定」にするときの、日ごとの予算。日付の順に並べ、重なりは1つにする。
 *  予算は最初の日だけに入れる（ほかの日は0。合計は入れた額のまま。D40） */
export function budgetsForDays(days: Iterable<string>, budget: number): { date: string; budget: number }[] {
  return [...new Set(days)].sort().map((date, i) => ({ date, budget: i === 0 ? budget : 0 }));
}

export const LEGACY_PLANS = { getPlansForDay, planTimeOnDay, hm2min };
