// 分析の計算（D28）。画面を使わない関数だけ置く（テストできるように）。
import { addM, toDS, DAYS } from './dates.ts';
import type { StLedger, StJob, StPlan, StShift } from './compat.ts';

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

export type IncomeSummary = {
  /** 今年、ここまでに受け取った額（振り込まれた分と、実績として入れた分。バイト以外の給与を含む） */
  received: number;
  /** これから、シフト通りに受け取る予定の額 */
  upcoming: number;
  /** 今年の合計（シフト通りなら） */
  total: number;
};

/** 今年の収入（確定申告のための数字。D38）。confirmed＝受け取った額、estimated＝シフト通りなら今年受け取る合計。
 *  estimated が confirmed より小さくなる（実績が予想を上回ったなど）ときも、これからは 0 未満にしない */
export function incomeSummary(confirmed: number, estimated: number): IncomeSummary {
  return { received: confirmed, upcoming: Math.max(0, estimated - confirmed), total: Math.max(confirmed, estimated) };
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

export type WeekdayAvg = { dow: number; label: string; total: number; days: number; avg: number };
export type WeekdayRange = 'all' | '3m' | '6m' | '12m';

/** 期間の最初の日（'YYYY-MM-DD'）。3m・6m・12m は today から 3・6・12 か月さかのぼった日の翌日（今日を含めて 3・6 か月分）。
 *  all は支出の記録でいちばん古い日。支出が1件もなければ null */
export function weekdayRangeStart(ledger: StLedger[], range: WeekdayRange, today: string): string | null {
  if (range !== 'all') {
    const months = Number.parseInt(range, 10); // '3m'・'6m'・'12m'
    const [y, m, d] = today.split('-').map(Number);
    const dim = new Date(y, m - months, 0).getDate(); // さかのぼった月の日数。同じ日が無ければ月末に寄せる（5/31 の3か月前 → 2/28）
    const s = new Date(y, m - 1 - months, Math.min(d, dim) + 1);
    return toDS(s.getFullYear(), s.getMonth(), s.getDate());
  }
  let first: string | null = null;
  for (const l of ledger) if (l.type === 'expense' && l.date <= today && (first === null || l.date < first)) first = l.date;
  return first;
}

/** 曜日ごとの支出の平均（1日あたり）。start〜end（'YYYY-MM-DD'。両端を含む）の、支出の記録がない日も 0 円として日数に数える。
 *  日曜が先頭（dow = 0）。期間の外の記録は数えない */
export function weekdayAverages(ledger: StLedger[], start: string, end: string): WeekdayAvg[] {
  const list: WeekdayAvg[] = DAYS.map((label, dow) => ({ dow, label, total: 0, days: 0, avg: 0 }));
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed).getTime();
  for (let t = new Date(sy, sm - 1, sd); t.getTime() <= last; t.setDate(t.getDate() + 1)) list[t.getDay()].days += 1;
  for (const l of ledger) {
    if (l.type !== 'expense' || l.date < start || l.date > end) continue;
    const [y, m, d] = l.date.split('-').map(Number);
    list[new Date(y, m - 1, d).getDay()].total += Number(l.amount) || 0;
  }
  for (const w of list) w.avg = w.days ? Math.round(w.total / w.days) : 0;
  return list;
}

/** いちばん平均が多い曜日（支出が全くなければ null。同額なら日曜に近いほう） */
export function topWeekday(list: WeekdayAvg[]): WeekdayAvg | null {
  let top: WeekdayAvg | null = null;
  for (const w of list) if (w.avg > 0 && (top === null || w.avg > top.avg)) top = w;
  return top;
}

export type CatSeries = { cat: string; amounts: number[]; total: number };
export type CategoryTrend = { labels: string[]; series: CatSeries[]; monthTotals: number[] };
export const OTHER_CAT = 'その他';

/** 支出のカテゴリ別の月推移。endY・endM（m は 0 から）で終わる直近 months か月。
 *  期間の合計が多い上位 topN 個のカテゴリを別々に、残りは「その他」にまとめる（積み上げ棒にして見やすいように）。
 *  並びは、合計の多い順（同額ならカテゴリ名順）で、「その他」は最後。記録のない月は 0 */
export function categoryTrend(ledger: StLedger[], endY: number, endM: number, months = 6, topN = 5): CategoryTrend {
  const keys: string[] = [], labels: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { y, m } = addM(endY, endM, -i);
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    labels.push(`${m + 1}月`);
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  const byCat = new Map<string, number[]>();
  for (const l of ledger) {
    if (l.type !== 'expense') continue;
    const i = index.get(l.date.slice(0, 7));
    if (i === undefined) continue;
    const row = byCat.get(l.cat) ?? new Array<number>(months).fill(0);
    row[i] += Number(l.amount) || 0;
    byCat.set(l.cat, row);
  }
  const all: CatSeries[] = [...byCat.entries()]
    .map(([cat, amounts]) => ({ cat, amounts, total: amounts.reduce((a, v) => a + v, 0) }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total || (a.cat < b.cat ? -1 : 1));
  const series = all.slice(0, topN);
  const rest = all.slice(topN);
  if (rest.length) {
    const amounts = new Array<number>(months).fill(0);
    for (const s of rest) s.amounts.forEach((v, i) => { amounts[i] += v; });
    series.push({ cat: OTHER_CAT, amounts, total: amounts.reduce((a, v) => a + v, 0) });
  }
  const monthTotals = keys.map((_, i) => all.reduce((a, s) => a + s.amounts[i], 0));
  return { labels, series, monthTotals };
}

export type DayOfMonthAvg = { day: number; total: number; days: number; avg: number };

/** 月の中の日にち（1〜31日）ごとの支出の平均（1日あたり）。start〜end（両端を含む）で、その日にちが何回あったかで割る
 *  （記録のない日は 0 円。29〜31日は、その日がある月だけ数える）。給料日・締め日の前後の傾向を見るため */
export function dayOfMonthAverages(ledger: StLedger[], start: string, end: string): DayOfMonthAvg[] {
  const list: DayOfMonthAvg[] = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, total: 0, days: 0, avg: 0 }));
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed).getTime();
  for (let t = new Date(sy, sm - 1, sd); t.getTime() <= last; t.setDate(t.getDate() + 1)) list[t.getDate() - 1].days += 1;
  for (const l of ledger) {
    if (l.type !== 'expense' || l.date < start || l.date > end) continue;
    const cell = list[Number(l.date.slice(8, 10)) - 1];
    if (cell) cell.total += Number(l.amount) || 0;
  }
  for (const c of list) c.avg = c.days ? Math.round(c.total / c.days) : 0;
  return list;
}

/** 日にちのうち、days に入っているものの1日あたりの平均（合計 ÷ 日数。該当の日が期間になければ null） */
export function averageOnDays(list: DayOfMonthAvg[], days: number[]): number | null {
  const pick = list.filter(c => days.includes(c.day));
  const n = pick.reduce((a, c) => a + c.days, 0);
  return n ? Math.round(pick.reduce((a, c) => a + c.total, 0) / n) : null;
}

export type DayGroup = { days: number; total: number; avg: number };
export type EventCompare = { withEvent: DayGroup; without: DayGroup };

/** 予定のある日・シフトのある日の集まり（'YYYY-MM-DD'）。予定は、はじめの日から終わりの日までの全日（削除済みは除く）。
 *  シフトはその日。長すぎる（1年を超える）予定は、入力の間違いとみなして1年で止める */
export function eventDaySet(plans: StPlan[], shifts: StShift[]): Set<string> {
  const set = new Set<string>();
  for (const p of plans) {
    if (p._deleted) continue;
    const start = p.dateStart || p.date;
    if (!start) continue;
    const end = p.dateEnd && p.dateEnd >= start ? p.dateEnd : start;
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    const last = new Date(ey, em - 1, ed).getTime();
    let n = 0;
    for (let t = new Date(sy, sm - 1, sd); t.getTime() <= last && n < 366; t.setDate(t.getDate() + 1), n++) set.add(toDS(t.getFullYear(), t.getMonth(), t.getDate()));
  }
  for (const s of shifts) if (!s._deleted && s.date) set.add(s.date);
  return set;
}

/** start〜end（両端を含む）の毎日を、「予定かシフトのある日」とない日に分けて、1日あたりの平均支出を出す。記録のない日は 0 円 */
export function compareEventDays(ledger: StLedger[], events: Set<string>, start: string, end: string): EventCompare {
  const withEvent = { days: 0, total: 0, avg: 0 }, without = { days: 0, total: 0, avg: 0 };
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed).getTime();
  for (let t = new Date(sy, sm - 1, sd); t.getTime() <= last; t.setDate(t.getDate() + 1)) {
    (events.has(toDS(t.getFullYear(), t.getMonth(), t.getDate())) ? withEvent : without).days += 1;
  }
  for (const l of ledger) {
    if (l.type !== 'expense' || l.date < start || l.date > end) continue;
    (events.has(l.date) ? withEvent : without).total += Number(l.amount) || 0;
  }
  for (const g of [withEvent, without]) g.avg = g.days ? Math.round(g.total / g.days) : 0;
  return { withEvent, without };
}
