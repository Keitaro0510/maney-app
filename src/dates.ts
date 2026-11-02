// 日付の補助と「今」（D20 の 1）。js/app-core.js から移した。
// - 今の日時（now）と今日の日付（today。'YYYY-MM-DD'）は、ここが持つ。日付が変わったら setNow で新しくする（呼ぶのは js/app-core.js の onDayChange）
// - まだ js/ の画面のために、src/main.ts が exposeLegacyDates で window に同じ名前を出す（期限付きの互換の層。D20）。
//   _now・TODAY は getter・setter（js/ は今までどおり名前で読む）。移した TS のモジュールは import で使う
import { dayKey, monthDay as clockMonthDay } from './clock.ts';

export const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

let nowValue = new Date();
let todayValue = dayKey(nowValue);

/** 今の日時。日付が変わったら setNow で新しくする */
export const getNow = (): Date => nowValue;
/** 今日の日付 'YYYY-MM-DD' */
export const getToday = (): string => todayValue;
/** 今の日時を新しくする（今日の日付も一緒に変わる） */
export function setNow(now: Date): void {
  nowValue = now;
  todayValue = dayKey(now);
}

export const gY = (): number => nowValue.getFullYear();
export const gM = (): number => nowValue.getMonth();
export const gD = (): number => nowValue.getDate();

/** 'YYYY-MM-DD'。m は 0 から始まる月 */
export const toDS = (y: number, m: number, d: number): string => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** 'M/D' */
export const fmtMD = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}`;
/** 月を n か月ずらす。m は 0 から始まる月 */
export function addM(y: number, m: number, n: number): { y: number; m: number } {
  let nm = m + n, ny = y;
  while (nm > 11) { nm -= 12; ny++; }
  while (nm < 0) { nm += 12; ny--; }
  return { y: ny, m: nm };
}
/** 'YYYY-MM-DD' を、その日の 0 時の Date にする（端末の時刻） */
export const ds2d = (ds: string): Date => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** 「毎月○日」（固定費・給料日・引き落とし日）の、その月の日と日付。月にない日（30日までの月の31日など）は月末にする */
export const monthDay = (y: number, m: number, day: number): number => clockMonthDay(y, m, day);
export const monthDate = (y: number, m: number, day: number): Date => new Date(y, m, monthDay(y, m, day));
/** 開始と終了の時刻（'HH:MM'）と休憩（分）から、働いた時間（時間）。マイナスにはしない */
export const calcH = (s: string, e: string, rest: unknown): number => {
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - sh * 60 - sm - (parseInt(String(rest)) || 0)) / 60);
};

/** まだ js/ が名前で使うもの（src/main.ts が window に出す。期限付きの互換の層。D20） */
export const LEGACY_DATES = { DAYS, gY, gM, gD, toDS, fmtMD, addM, ds2d, monthDay, monthDate, calcH };

/** 互換の層: _now・TODAY を getter・setter で、LEGACY_DATES の名前をそのまま、target（ふつうは window）に出す */
export function exposeLegacyDates(target: object): void {
  Object.defineProperty(target, '_now', { get: getNow, set: setNow, enumerable: true, configurable: false });
  Object.defineProperty(target, 'TODAY', { get: getToday, set: () => { throw new Error('TODAY は、_now を setNow で新しくして変える（src/dates.ts）'); }, enumerable: true, configurable: false });
  Object.assign(target, LEGACY_DATES);
}
