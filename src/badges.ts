// 実績バッジの計算（D30）。画面を使わない関数だけ置く（テストできるように）。
// バッジは、記録から毎回計算して決める（どこにも保存しない）。記録を消すと、バッジが減ることがある。
import type { StLedger } from './compat.ts';

export type BadgeKind = 'streak' | 'budget' | 'surplus' | 'tasks';

/** バッジの段階（ブロンズ・シルバー・ゴールド）に必要な値 */
export const THRESHOLDS: Record<BadgeKind, [number, number, number]> = {
  streak: [7, 30, 100], // 記録を付けた日が、何日つづいたか
  budget: [1, 3, 6], // 予算内だった月が、何か月か
  surplus: [2, 3, 6], // 黒字の月が、何か月つづいたか
  tasks: [10, 50, 100], // 完了したタスクが、何個か
};

export type Tier = 0 | 1 | 2 | 3;
export type BadgeProgress = {
  value: number;
  /** 0＝まだ、1＝ブロンズ、2＝シルバー、3＝ゴールド */
  tier: Tier;
  /** 次の段階に必要な値（ゴールドなら null）。あといくつかは next - value */
  next: number | null;
};

/** 値 value が、段階の目安 thresholds のどこまで来たか */
export function badgeProgress(value: number, thresholds: [number, number, number]): BadgeProgress {
  const tier = thresholds.filter(t => value >= t).length as Tier; // 超えた段階の数
  return { value, tier, next: tier === 3 ? null : thresholds[tier] };
}

const DAY = 86400000;
// 'YYYY-MM-DD' を、時刻のずれのない通し日（1970-01-01 からの日数）にする
const dayNo = (ds: string): number => { const [y, m, d] = ds.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };

/** 記録を付けた日（重複なし）から、いちばん長い連続日数と、今の連続日数を出す。
 *  今の連続は、最後に記録した日が today か、その前の日のときだけ数える（今日まだ付けていなくても、昨日までつづいていれば切れていない） */
export function recordStreak(dates: string[], today: string): { best: number; current: number } {
  const days = [...new Set(dates.map(dayNo))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const d of days) { run = d === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const last = days[days.length - 1];
  const current = days.length && last >= dayNo(today) - 1 && last <= dayNo(today) ? run : 0;
  return { best, current };
}

type MonthSum = { income: number; expense: number };
/** 家計簿の記録を、月（'YYYY-MM'）ごとの収入・支出にする。記録のない月は入らない */
export function monthSums(ledger: StLedger[]): Map<string, MonthSum> {
  const map = new Map<string, MonthSum>();
  for (const l of ledger) {
    if (l.type !== 'income' && l.type !== 'expense') continue;
    const key = l.date.slice(0, 7);
    const s = map.get(key) || { income: 0, expense: 0 };
    s[l.type] += Number(l.amount) || 0;
    map.set(key, s);
  }
  return map;
}

const monthNo = (key: string): number => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1); };

/** 終わった月（今の月より前）だけの一覧。今の月は途中なので数えない */
function finishedMonths(map: Map<string, MonthSum>, today: string): [string, MonthSum][] {
  const current = today.slice(0, 7);
  return [...map.entries()].filter(([k]) => k < current).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** 予算内だった月の数（終わった月で、記録があり、支出が予算以下）。予算が0以下（未設定）なら null */
export function budgetMonths(map: Map<string, MonthSum>, budget: number, today: string): number | null {
  if (!(budget > 0)) return null;
  return finishedMonths(map, today).filter(([, s]) => s.expense <= budget).length;
}

/** 黒字（収入が支出より多い）の月が、いちばん長くつづいた月数（終わった月だけ。記録のない月でつづきは切れる） */
export function surplusRun(map: Map<string, MonthSum>, today: string): number {
  let best = 0, run = 0, prev = NaN;
  for (const [k, s] of finishedMonths(map, today)) {
    if (s.income > s.expense) { run = monthNo(k) === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = monthNo(k); }
    else { run = 0; prev = NaN; }
  }
  return best;
}

/** 完了したタスクの数 */
export const completedTasks = (tasks: { completed_at?: string | null }[]): number => tasks.filter(t => t.completed_at).length;
