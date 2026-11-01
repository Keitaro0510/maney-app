// 日付を扱う部品。
// - 「今日」: iPhone のホーム画面アプリは閉じずに裏に残るので、起動したときの日付のままにすると、
//   翌朝に開いても「今日」が昨日のままになる。日付が変わったかを見張り、変わったら知らせる
// - 「毎月○日」: 固定費・給料日・引き落とし日の「31日」などを、その月にある日にする
// - 時刻: シフトの退勤が出勤より後か（日をまたぐシフトは登録しない）
// 日付は、その端末の時刻で決める。月（m）は 0 が1月。
// js/ の画面からは window.MoneyClock で使う（src/main.ts。D17）

/** 年と月（m は 0 が1月） */
export interface YearMonth {
  y: number;
  m: number;
}

/** 日付が変わったかを見張るもの（createDayWatcher） */
export interface DayWatcher {
  readonly key: string;
  check(): boolean;
}

// その端末の時刻での日付の文字列 'YYYY-MM-DD'
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 次の日の0時になるまでのミリ秒
export function msUntilNextDay(date: Date): number {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next.getTime() - date.getTime();
}

// 日付が変わったかを見張る。now は今の時刻を返す関数。
// check() を呼ぶたびに今の日付を確かめ、変わっていれば onChange(今の時刻, 前の日付の文字列) を1回だけ呼ぶ
export function createDayWatcher(now: () => Date, onChange: (date: Date, prevKey: string) => void): DayWatcher {
  let current = dayKey(now());
  return {
    get key() { return current; },
    check() {
      const date = now();
      const key = dayKey(date);
      if (key === current) return false;
      const prev = current;
      current = key;
      onChange(date, prev);
      return true;
    },
  };
}

// 画面で見ている月（{ y, m }。m は 0 が1月）を、日付が変わったときにどうするか。
// 前の「今月」を見ていたら新しい今月にする。ほかの月を見ていたら、そのままにする
export function followMonth(view: YearMonth, prev: Date, now: Date): YearMonth {
  if (view.y === prev.getFullYear() && view.m === prev.getMonth()) {
    return { y: now.getFullYear(), m: now.getMonth() };
  }
  return view;
}

// その月の日数
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// 「毎月○日」の日を、その月にある日にする。月にない日（30日までの月の31日など）は月末にする。
// new Date(y, m, 31) のままだと、30日までの月では翌月1日になってしまう
export function monthDay(y: number, m: number, day: number): number {
  return Math.min(day, daysInMonth(y, m));
}

// 'HH:MM'（'HH:MM:SS' でもよい）を、0時からの分にする。形が違えば NaN
export function minutesOf(time: unknown): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(time));
  if (!m) return NaN;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

// シフトの退勤が出勤より後か。同じ時刻・日をまたぐ（退勤が出勤より前）は false
export function endsAfterStart(start: unknown, end: unknown): boolean {
  return minutesOf(end) > minutesOf(start);
}
