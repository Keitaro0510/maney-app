// 棒人間のセリフの材料（D34）。家計のデータから「給料日まで」「予算のペース」「曜日の傾向」を取り出し、セリフの文にする。
// 画面を使わない関数だけ置く（テストできるように）。文は、責めずに一緒に見る言い方にする（D33）。
import { weekdayAverages, weekdayRangeStart } from './analysis.ts';
import { DAYS } from './dates.ts';
import type { StLedger, StPlan, StShift } from './compat.ts';

export type BudgetPace = 'over' | 'fast' | 'ok' | 'slow';
export type ShiftInfo = { job: string; start: string | null; end: string | null };
export type MascotFacts = {
  /** 次の給料日まで何日か（今日が給料日なら 0。給料日の登録がなければ null） */
  daysToPayday: number | null;
  /** 今月の予算に対する、ここまでの支出 */
  budget: { pct: number; pace: BudgetPace | null } | null;
  /** 今日の曜日が、ふだんより使いがちか・控えめか（記録が少ないときは null） */
  weekday: { label: string; trend: 'high' | 'low' } | null;
  // ---- 今日・明日のお知らせと、先月との比べ（D35）。なくても動くよう、省けるようにしてある ----
  /** 今日の祝日の名前 */
  holiday?: string | null;
  /** 今日のシフト（いちばん早いもの）と、今月で何日目のバイトか */
  todayShift?: (ShiftInfo & { nth: number }) | null;
  /** 明日のシフト（いちばん早いもの） */
  tomorrowShift?: ShiftInfo | null;
  /** 今日の予定（済みにしたものは除く）。time は、はじめの日だけ入る 'HH:MM'（なければ空） */
  todayPlans?: { title: string; time: string }[];
  /** 先月との比べ。saved は先月の収支が黒字だったときの額。compare は先月の同じ日までとの支出の差（今月 − 先月。差が小さいときは null） */
  lastMonth?: { saved: number | null; compare: { diff: number } | null } | null;
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

export type FactsInput = {
  ledger: StLedger[]; payDays: number[]; budget: number; today: string;
  plans?: StPlan[]; shifts?: StShift[]; holiday?: string | null;
};

const dsOf = (ms: number): string => { const t = new Date(ms); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
/** 明日の日付（'YYYY-MM-DD'） */
export function tomorrowOf(today: string): string { const [y, m, d] = parse(today); return dsOf(Date.UTC(y, m - 1, d + 1)); }
/** 先月の月（'YYYY-MM'） */
const prevMonthKey = (today: string): string => { const [y, m] = parse(today); return dsOf(Date.UTC(y, m - 2, 1)).slice(0, 7); };

const startKey = (s: StShift): string => s.start || '99:99';
const byStart = (a: StShift, b: StShift): number => (startKey(a) < startKey(b) ? -1 : startKey(a) > startKey(b) ? 1 : 0);
const shiftInfo = (s: StShift): ShiftInfo => ({ job: s.job, start: s.start || null, end: s.end || null });

/** 今日のシフト（いちばん早いもの）と、今月で何日目のバイトか（今日までのシフトの日の数。同じ日に2つあっても1日） */
export function todayShiftFact(shifts: StShift[], today: string): MascotFacts['todayShift'] {
  const live = shifts.filter(s => !s._deleted && s.date);
  const mine = live.filter(s => s.date === today).sort(byStart);
  if (!mine.length) return null;
  const month = today.slice(0, 7);
  const nth = new Set(live.filter(s => s.date.startsWith(month) && s.date <= today).map(s => s.date)).size;
  return { ...shiftInfo(mine[0]), nth };
}

/** 明日のシフト（いちばん早いもの） */
export function tomorrowShiftFact(shifts: StShift[], today: string): MascotFacts['tomorrowShift'] {
  const t = tomorrowOf(today);
  const mine = shifts.filter(s => !s._deleted && s.date === t).sort(byStart);
  return mine.length ? shiftInfo(mine[0]) : null;
}

/** 今日の予定（削除・済みにしたものは除く）。時刻は、はじめの日のものだけ */
export function todayPlansFact(plans: StPlan[], today: string): { title: string; time: string }[] {
  const key = (t: string): string => t || '99:99';
  return plans
    .filter(p => !p._deleted && !p.done && (p.dateStart || p.date) <= today && today <= (p.dateEnd || p.dateStart || p.date))
    .map(p => ({ title: p.title, time: (p.dateStart || p.date) === today ? p.timeStart || '' : '' }))
    .sort((a, b) => (key(a.time) < key(b.time) ? -1 : key(a.time) > key(b.time) ? 1 : 0));
}

/** 先月との比べ。先月の収支が黒字なら saved。先月の同じ日までの支出（3000円以上のとき）と比べて、差が1000円以上かつ15%以上なら compare。
 *  月の初め（7日まで）は、比べるものが少ないので compare は null */
export function lastMonthFact(ledger: StLedger[], today: string): MascotFacts['lastMonth'] {
  const [, , d] = parse(today);
  const thisKey = today.slice(0, 7), lastKey = prevMonthKey(today);
  let lastIncome = 0, lastExpense = 0, lastSame = 0, thisSoFar = 0;
  for (const l of ledger) {
    const amount = Number(l.amount) || 0;
    if (l.date.startsWith(lastKey)) {
      if (l.type === 'income') lastIncome += amount;
      else if (l.type === 'expense') { lastExpense += amount; if (Number(l.date.slice(8, 10)) <= d) lastSame += amount; }
    } else if (l.date.startsWith(thisKey) && l.type === 'expense' && l.date <= today) thisSoFar += amount;
  }
  const net = lastIncome - lastExpense;
  const saved = lastIncome > 0 && net > 0 ? net : null;
  const diff = thisSoFar - lastSame;
  const compare = d >= 8 && lastSame >= 3000 && Math.abs(diff) >= 1000 && Math.abs(diff) / lastSame >= 0.15 ? { diff } : null;
  return saved === null && compare === null ? null : { saved, compare };
}

/** セリフの材料をまとめる。今月の支出は、家計簿の記録だけ（ホームの予算バーと同じ） */
export function mascotFacts(i: FactsInput): MascotFacts {
  const month = i.today.slice(0, 7);
  const spent = i.ledger.filter(l => l.type === 'expense' && l.date.startsWith(month)).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return {
    daysToPayday: daysToPayday(i.today, i.payDays), budget: budgetFact(spent, i.budget, i.today), weekday: weekdayFact(i.ledger, i.today),
    holiday: i.holiday || null,
    todayShift: todayShiftFact(i.shifts || [], i.today), tomorrowShift: tomorrowShiftFact(i.shifts || [], i.today),
    todayPlans: todayPlansFact(i.plans || [], i.today), lastMonth: lastMonthFact(i.ledger, i.today),
  };
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

// ---------------- 今日のお知らせ・ひとこと（D35） ----------------

/** 時刻の言い方: '09:00' → '9時'、'09:30' → '9時30分' */
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return m ? `${h}時${m}分` : `${h}時`;
}

/** 今の時間帯。5〜9時＝朝、10〜16時＝昼、17〜20時＝夕方、21〜4時＝夜 */
export type Period = 'morning' | 'day' | 'evening' | 'night';
export const periodOf = (hour: number): Period => (hour >= 5 && hour < 10 ? 'morning' : hour >= 10 && hour < 17 ? 'day' : hour >= 17 && hour < 21 ? 'evening' : 'night');

/** 夜（この時刻から）に、明日のシフトを知らせる */
export const NIGHT_NOTICE_HOUR = 21;

/** 今日のお知らせ。urgent＝夜おそいときの、明日のシフト（いちばん大事）。today＝今日のシフト・予定・祝日（あるものだけ） */
export function noticeLines(f: MascotFacts, hour: number): { urgent: string | null; today: string[] } {
  let urgent: string | null = null;
  const tm = f.tomorrowShift;
  if (tm && hour >= NIGHT_NOTICE_HOUR) urgent = tm.start ? `明日は${fmtTime(tm.start)}から${tm.job}だよ！早めに休もうね` : `明日は${tm.job}のシフトがあるよ。早めに休もうね`;
  const today: string[] = [];
  const sh = f.todayShift;
  if (sh) today.push(`今日は${sh.job}の日！今月${sh.nth}日目のバイトだよ${sh.start && sh.end ? `（${fmtTime(sh.start)}〜${fmtTime(sh.end)}）` : ''}`);
  const pl = f.todayPlans || [];
  if (pl.length === 1) today.push(pl[0].time ? `今日は${fmtTime(pl[0].time)}から「${pl[0].title}」だよ` : `今日は「${pl[0].title}」の予定があるよ`);
  else if (pl.length > 1) today.push(`今日は「${pl[0].title}」ほか${pl.length - 1}件の予定があるよ`);
  if (f.holiday) today.push(`今日は${f.holiday}だよ`);
  return { urgent, today };
}

const MONTH_LINES = [
  '新しい年だね。今年もよろしく！', '寒い日がつづくね。あったかくしてね', '春が近づいてきたね。年度末、おつかれさま', '新年度のはじまり！一緒にがんばろうね',
  'いい季節だね。のんびりいこうね', '雨の季節だね。濡れないように気をつけてね', '暑くなってきたね。水分とってね', '夏まっさかり！暑さに気をつけてね',
  '涼しくなってきたね。秋のはじまりだ', '秋だね。過ごしやすい季節だよ', '冷える日が増えてきたね。あったかくしてね', '年末だね。今年も一年おつかれさま',
];

/** 先月との比べ・貯まった額・季節のひとこと。month は 1〜12、day は今日の日（1〜31）。貯まった額は、月の初めの10日間だけ言う */
export function ambientLines(f: MascotFacts | undefined, month: number, day: number): string[] {
  const out: string[] = [];
  const lm = f?.lastMonth;
  if (lm?.saved && day <= 10) out.push(`先月は ¥${lm.saved.toLocaleString()} 貯まったよ！`);
  if (lm?.compare) {
    const n = Math.abs(lm.compare.diff).toLocaleString();
    out.push(lm.compare.diff < 0 ? `先月の今ごろより、支出が ¥${n} 少ないよ。いい調子！` : `先月の今ごろより、支出が ¥${n} 多め。ゆっくり行こうね`);
  }
  out.push(MONTH_LINES[month - 1]);
  return out;
}
