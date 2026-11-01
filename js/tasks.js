// タスクの計算（D3・D10）。画面は index.html の「タスク」。ここは画面を使わないので、Node でテストできる。
// 日付は 'YYYY-MM-DD' の文字列（端末の時刻での日付）。completed_at は ISO の日時。
(function (root) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const FOLD_DAYS = 7;   // 完了して7日たったら「完了したタスク」にたたむ（D3）
  const SOON_DAYS = 14;  // 開いたときの一覧は、今日から2週間以内（D10）
  const RESUME_GAP = 60 * 60 * 1000; // ほかのアプリから戻ってきたときは、前に出してから1時間以上たっていたら出す（D10）

  // 'YYYY-MM-DD' を、その日の0時（端末の時刻）にする
  const toDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  // a から b まで何日か（同じ日なら 0、b が明日なら 1、昨日なら -1）
  const daysBetween = (a, b) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

  // 期限の早い順。期限のないものは下。同じなら、先に作ったものが上
  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date < b.due_date ? -1 : 1;
      }
      return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));
    });
  }

  // 完了して7日たったか（たたむか）
  function isFolded(task, now) {
    if (!task.completed_at) return false;
    return now - new Date(task.completed_at).getTime() >= FOLD_DAYS * DAY;
  }

  // タスクのタブの区切り。期限で分け、完了して7日たったものは「完了したタスク」にたたむ。
  // 完了して7日たっていないものは、その場（期限の区切りの中）に残す（D3）
  const SECTIONS = [
    { key: 'overdue', title: '期限切れ' },
    { key: 'today', title: '今日' },
    { key: 'tomorrow', title: '明日' },
    { key: 'soon', title: '2週間以内' },
    { key: 'later', title: 'もっと先' },
    { key: 'none', title: '期限なし' },
  ];
  function sectionOf(task, today) {
    if (!task.due_date) return 'none';
    const d = daysBetween(today, task.due_date);
    if (d < 0) return 'overdue'; // 完了しても、その場に残す（D3）
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d <= SOON_DAYS) return 'soon';
    return 'later';
  }
  function groupForTab(tasks, today, now) {
    const groups = Object.fromEntries(SECTIONS.map(s => [s.key, []]));
    const folded = [];
    for (const t of sortTasks(tasks)) {
      if (isFolded(t, now)) folded.push(t);
      else groups[sectionOf(t, today)].push(t);
    }
    folded.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
    return {
      sections: SECTIONS.map(s => ({ ...s, tasks: groups[s.key] })).filter(s => s.tasks.length),
      folded,
    };
  }

  // 開いたときの一覧（D10）: 期限切れ → 今日 → 2週間以内。期限のないもの・終えたものは出さない
  function startupGroups(tasks, today) {
    const open = sortTasks(tasks).filter(t => !t.completed_at && t.due_date);
    const groups = [
      { key: 'overdue', title: '期限切れ', tasks: open.filter(t => daysBetween(today, t.due_date) < 0) },
      { key: 'today', title: '今日', tasks: open.filter(t => daysBetween(today, t.due_date) === 0) },
      { key: 'soon', title: '2週間以内', tasks: open.filter(t => { const d = daysBetween(today, t.due_date); return d >= 1 && d <= SOON_DAYS; }) },
    ];
    return groups.filter(g => g.tasks.length);
  }

  // 開いたときの一覧を出すか（D10。2026-10-31 に「ゲームのお知らせのように開くたび」に書き直した）
  // - 出すタスク（期限切れ・今日・2週間以内）がなければ出さない
  // - 「今日は表示しない」にした日（hideDay が今日）は出さない
  // - ほかのアプリから戻ってきたとき（resume）は、前に出してから1時間以上たっていれば出す。起動したとき・日付が変わったときは出す
  // lastShownAt・now はミリ秒（Date.now()）。lastShownAt がなければ、まだ出していない
  function shouldShowStartup({ tasks, today, hideDay = null, resume = false, lastShownAt = null, now = Date.now() }) {
    if (hideDay === today) return false;
    if (!startupGroups(tasks, today).length) return false;
    if (resume && lastShownAt != null && now - lastShownAt < RESUME_GAP) return false;
    return true;
  }

  // 期限の短い説明（一覧の行の下に出す）。done: 完了したタスク（期限を過ぎても「すぎています」と出さない）
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  function dueLabel(due, today, done = false) {
    if (!due) return '';
    const d = daysBetween(today, due);
    const date = toDate(due);
    const md = `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）`;
    if (d < 0) return done ? `${md}まで` : `${md}まで・${-d}日すぎています`;
    if (d === 0) return '今日まで';
    if (d === 1) return '明日まで';
    return `${md}まで`;
  }

  // 新しいタスクの並び（position）。今の最後のあと
  const nextPosition = tasks => tasks.reduce((max, t) => Math.max(max, t.position || 0), -1) + 1;

  // カレンダー用（D10）: その日が期限のタスク（並べ方は sortTasks と同じ）
  function tasksOnDay(tasks, day) {
    return sortTasks(tasks.filter(t => t.due_date === day));
  }

  // カレンダーのセル用（D10）: 期限の日ごとの件数。open は終えていないもの、done は終えたもの
  function countByDay(tasks) {
    const counts = new Map();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const c = counts.get(t.due_date) || { open: 0, done: 0 };
      if (t.completed_at) c.done++; else c.open++;
      counts.set(t.due_date, c);
    }
    return counts;
  }

  // ホームの1行用（D10）: 終えていないタスクのうち、今日が期限のものと、期限切れのものの件数
  function homeSummary(tasks, today) {
    let todayCount = 0, overdue = 0;
    for (const t of tasks) {
      if (t.completed_at || !t.due_date) continue;
      const d = daysBetween(today, t.due_date);
      if (d === 0) todayCount++;
      else if (d < 0) overdue++;
    }
    return { today: todayCount, overdue };
  }

  const MoneyTasks = {
    FOLD_DAYS, SOON_DAYS, SECTIONS, daysBetween, sortTasks, isFolded, sectionOf, groupForTab, startupGroups,
    shouldShowStartup, dueLabel, nextPosition, tasksOnDay, countByDay, homeSummary,
  };
  root.MoneyTasks = MoneyTasks;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyTasks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
