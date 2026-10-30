// 「今日」を扱う部品。
// iPhone のホーム画面アプリは閉じずに裏に残るので、起動したときの日付のままにすると、
// 翌朝に開いても「今日」が昨日のままになる。日付が変わったかを見張り、変わったら知らせる。
// 日付は、その端末の時刻で決める。
(function (root) {
  'use strict';

  // その端末の時刻での日付の文字列 'YYYY-MM-DD'
  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 次の日の0時になるまでのミリ秒
  function msUntilNextDay(date) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return next.getTime() - date.getTime();
  }

  // 日付が変わったかを見張る。now は今の時刻を返す関数。
  // check() を呼ぶたびに今の日付を確かめ、変わっていれば onChange(今の時刻, 前の日付の文字列) を1回だけ呼ぶ
  function createDayWatcher(now, onChange) {
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
  function followMonth(view, prev, now) {
    if (view.y === prev.getFullYear() && view.m === prev.getMonth()) {
      return { y: now.getFullYear(), m: now.getMonth() };
    }
    return view;
  }

  const MoneyClock = { dayKey, msUntilNextDay, createDayWatcher, followMonth };
  root.MoneyClock = MoneyClock;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyClock;
})(typeof globalThis !== 'undefined' ? globalThis : this);
