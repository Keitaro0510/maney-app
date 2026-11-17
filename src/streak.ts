// 記録の連続日数（ホームのマスコットが使う）。画面を使わない関数だけ置く（テストできるように）。
// もとは実績バッジ（D30）の計算だったが、バッジは消した（D30 を参照）。
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
