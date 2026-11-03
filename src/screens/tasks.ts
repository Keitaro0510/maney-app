// タスクの画面（D3・D10）。js/tasks-ui.js から移した（D20 の 2）。計算は src/tasks.ts、部品は src/ui.ts。
// - タスクのタブ（#sec-task）: 追加・編集・完了・削除。完了したものは横線で残し、7日たったらいちばん下にたたむ
// - 開いたときの一覧（#task-startup）: 期限切れ・今日・2週間以内。開くたびに出し、「今日は表示しない」で止める
// - ホームの1行（#home-tasks）
// 完了できるのは、タブと開いたときの一覧の2か所だけ（D10）。
// まだ js/ と index.html が名前で呼ぶものは、src/main.ts が LEGACY_TASKS を window に出す（期限付きの互換の層。D20）
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { currentRows, saveRows, userKey } from '../sync.ts';
import { getToday } from '../dates.ts';
import { dayKey } from '../clock.ts';
import * as calc from '../tasks.ts';
import type { TaskRow } from '../tasks.ts';
import { el, checkRow, inputById, textareaById, dialogById, elementById, openSheet, toast } from '../ui.ts';
import { sw } from '../navigation.ts';

/** 今のタスクの行（サーバーの写しに、送信待ちを重ねたもの） */
export function taskRows(): TaskRow[] {
  return state.server ? ((currentRows().tasks || []) as unknown as TaskRow[]) : [];
}
const findTask = (id: string | null): TaskRow | undefined => taskRows().find(t => t.id === id);

/** 必ずある子の要素 */
function child<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`要素が見つかりません: ${selector}`);
  return node;
}

/** 画面を描き直す（タブ・ホームの1行と、開いていれば開いたときの一覧） */
function refreshTaskViews(): void {
  if (elementById('sec-task').classList.contains('active')) renderTaskTab();
  if (elementById('sec-home').classList.contains('active')) renderHomeTasks();
  if (dialogById('task-startup').open) renderStartupTasks();
}

const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/** 一覧の1行。チェックで完了（D3）。右の「>」か名前を押すと編集の画面を開く */
function taskRow(t: TaskRow): HTMLDivElement {
  const today = getToday();
  const overdue = !t.completed_at && t.due_date && calc.daysBetween(today, t.due_date) < 0;
  const memo = (t.memo || '').split('\n')[0];
  const sub = [calc.dueLabel(t.due_date, today, !!t.completed_at), memo].filter(Boolean).join('　');
  const edit = el('button', { type: 'button', className: 'icon-btn task-edit', 'aria-label': `「${t.title}」を編集` });
  edit.innerHTML = ICON_MORE;
  edit.addEventListener('click', () => openTaskSheet(t.id, edit));
  const row = checkRow({ title: t.title, sub, done: !!t.completed_at, onChange: done => setTaskDone(t.id, done), end: edit });
  if (overdue) row.classList.add('overdue');
  child(row, '.check-body').addEventListener('click', () => openTaskSheet(t.id, edit)); // 閉じたら「>」に戻す
  return row;
}

// ---------- タスクのタブ ----------
let taskAddDue: string | null = null; // 追加するときの期限（'YYYY-MM-DD' か null）

export function renderTaskTab(): void {
  renderTaskAddDue();
  const box = elementById('task-list');
  const tasks = taskRows();
  if (!tasks.length) {
    box.replaceChildren(el('div', { className: 'card task-empty' }, [
      el('div', { className: 'task-empty-title', textContent: 'タスクはまだありません' }),
      el('div', { textContent: '上の欄に、やることを入れて「追加」を押してください。期限は、あとから付けられます。' }),
    ]));
    return;
  }
  const { sections, folded } = calc.groupForTab(tasks, getToday(), new Date());
  const cards: HTMLElement[] = sections.map(s => {
    const left = s.tasks.filter(t => !t.completed_at).length;
    return el('section', { className: `card task-section task-${s.key}` }, [
      el('h2', { className: 'task-section-title' }, [
        el('span', { textContent: s.title }),
        el('span', { className: 'task-count', textContent: left ? `${left}件` : '済み' }),
      ]),
      ...s.tasks.map(taskRow),
    ]);
  });
  if (folded.length) {
    cards.push(el('details', { className: 'card task-folded' }, [
      el('summary', { textContent: `完了したタスク（${folded.length}件）` }),
      el('div', { className: 'task-folded-note', textContent: '完了して7日たったタスクです' }),
      ...folded.map(taskRow),
    ]));
  }
  box.replaceChildren(...cards);
}

/** 明日の日付（今日の次の日） */
function tomorrowKey(): string {
  const [y, m, d] = getToday().split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
}

/** 追加の欄の期限のボタン（期限なし・今日・明日・日付を選ぶ）。選んでいるものに色を付ける */
function renderTaskAddDue(): void {
  const today = getToday();
  const tomorrow = tomorrowKey();
  const picked = !!taskAddDue && taskAddDue !== today && taskAddDue !== tomorrow;
  document.querySelectorAll<HTMLButtonElement>('#task-add-due button[data-due]').forEach(b => {
    const v = b.dataset.due;
    b.setAttribute('aria-pressed', String(v === 'none' ? !taskAddDue : v === 'today' ? taskAddDue === today : taskAddDue === tomorrow));
  });
  // 「日付…」は中に日付の入力欄があるので、文字の部分（span）だけを書き換える
  const pick = child<HTMLElement>(document, '#task-add-due [data-due="pick"]');
  pick.classList.toggle('on', picked);
  child(pick, '.task-chip-text').textContent = picked && taskAddDue ? calc.dueLabel(taskAddDue, today).replace(/まで.*$/, '') : '日付…';
  child<HTMLInputElement>(pick, 'input').value = picked && taskAddDue ? taskAddDue : '';
}
export function setTaskAddDue(kind: string): void {
  if (kind === 'none') taskAddDue = null;
  else if (kind === 'today') taskAddDue = getToday();
  else if (kind === 'tomorrow') taskAddDue = tomorrowKey();
  renderTaskAddDue();
}
export function pickTaskAddDue(value: string): void { taskAddDue = value || null; renderTaskAddDue(); }

/** 上の欄から追加する（名前と期限だけ。メモはあとから編集で） */
export function addTaskQuick(): void {
  const input = inputById('task-add-title');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const ok = saveRows([{ table: 'tasks', action: 'insert', id: crypto.randomUUID(), row: {
    title, due_date: taskAddDue, completed_at: null, memo: '', position: calc.nextPosition(taskRows()),
  } }]);
  if (!ok) return;
  input.value = '';
  input.focus(); // 続けて入れられるように
  renderTaskTab();
}

/** 完了・完了の取り消し（取り消すと completed_at を空に戻す。D3） */
function setTaskDone(id: string, done: boolean): void {
  if (!findTask(id)) return refreshTaskViews();
  saveRows([{ table: 'tasks', action: 'update', id, row: { completed_at: done ? new Date().toISOString() : null } }]);
  refreshTaskViews();
}

// ---------- 編集の画面 ----------
let taskEditId: string | null = null;
let closeTaskSheetFn: (() => void) | null = null;

export function openTaskSheet(id: string | null, opener?: HTMLElement | null): void {
  const t = findTask(id);
  if (!t) return refreshTaskViews();
  taskEditId = t.id;
  inputById('task-title').value = t.title;
  inputById('task-due').value = t.due_date || '';
  textareaById('task-memo').value = t.memo || '';
  elementById('task-title-err').hidden = true;
  closeTaskSheetFn = openSheet(dialogById('task-sheet'), opener);
}
export function closeTaskSheet(): void { if (closeTaskSheetFn) closeTaskSheetFn(); }

export function setTaskSheetDue(kind: string): void {
  inputById('task-due').value = kind === 'today' ? getToday() : kind === 'tomorrow' ? tomorrowKey() : '';
}

export function saveTaskSheet(): void {
  const title = inputById('task-title').value.trim();
  if (!title) {
    elementById('task-title-err').hidden = false;
    elementById('task-title').focus();
    return;
  }
  if (!findTask(taskEditId) || !taskEditId) { closeTaskSheet(); return refreshTaskViews(); }
  const ok = saveRows([{ table: 'tasks', action: 'update', id: taskEditId, row: {
    title, due_date: inputById('task-due').value || null, memo: textareaById('task-memo').value.trim(),
  } }]);
  if (!ok) return;
  closeTaskSheet();
  refreshTaskViews();
}

/** 削除（本当に消す）。消したあと数秒「元に戻す」を出す（D3） */
export function deleteTaskFromSheet(): void {
  const t = findTask(taskEditId);
  closeTaskSheet();
  if (!t) return refreshTaskViews();
  if (!saveRows([{ table: 'tasks', action: 'delete', id: t.id }])) return;
  refreshTaskViews();
  const { title, due_date, completed_at, memo, position } = t;
  toast(`「${title}」を消しました`, {
    actionLabel: '元に戻す',
    onAction: () => {
      if (findTask(t.id)) return;
      saveRows([{ table: 'tasks', action: 'insert', id: t.id, row: { title, due_date, completed_at, memo, position } }]);
      refreshTaskViews();
    },
  });
}

// ---------- 開いたときの一覧（D10。ゲームのお知らせのように、開くたびに出す） ----------
/** 開いたときに出すと決めたタスク（閉じるまで同じものを出す。完了にしても、横線で残す） */
let startupGroups: { key: string; title: string; ids: string[] }[] = [];
let closeStartupFn: (() => void) | null = null;
// 端末に覚えること: 最後に自動で出した時刻（tasksShownAt、ミリ秒）と、「今日は表示しない」にした日（tasksHideDay）
function readStartup(name: string): string | null { try { return localStorage.getItem(userKey(name)); } catch { return null; } }
function writeStartup(name: string, value: string | null): void {
  try { if (value == null) localStorage.removeItem(userKey(name)); else localStorage.setItem(userKey(name), value); } catch { /* 覚えられなくても続ける */ }
}

/**
 * 出すタスクがあれば出す。起動したとき・日付が変わったときと、ほかのアプリから戻ってきたとき（resume）に呼ぶ。
 * 戻ってきたときは、前に出してから1時間以上たっていれば出す（shouldShowStartup）
 */
export function maybeShowStartupTasks(resume = false): void {
  if (!state.currentUser || !state.server) return;
  if (document.querySelector('.mbg.open, dialog[open]')) return; // ほかの入力の画面が開いているときは出さない
  const shown = readStartup('tasksShownAt');
  const show = calc.shouldShowStartup({
    tasks: taskRows(), today: getToday(), hideDay: readStartup('tasksHideDay'),
    resume, lastShownAt: shown ? Number(shown) : null, now: Date.now(),
  });
  if (!show) return;
  writeStartup('tasksShownAt', String(Date.now()));
  openStartupTasks(undefined, { auto: true });
}

/**
 * 開いたときの一覧を開く（ホームの1行からも開く。opener はそのボタン）。出すタスクは、開いたときに決める。
 * auto: 自動で出したとき。下に「今日は表示しない」を出す。チェックしたら（その時に覚える）、その日はもう自動では出さない
 */
export function openStartupTasks(opener?: HTMLElement | null, { auto = false }: { auto?: boolean } = {}): void {
  const today = getToday();
  startupGroups = calc.startupGroups(taskRows(), today).map(g => ({ key: g.key, title: g.title, ids: g.tasks.map(t => t.id) }));
  renderStartupTasks();
  const hide = inputById('task-startup-hide');
  hide.checked = false;
  const label = hide.closest('label');
  if (label) label.hidden = !auto;
  hide.onchange = () => writeStartup('tasksHideDay', hide.checked ? today : null);
  closeStartupFn = openSheet(dialogById('task-startup'), opener);
}

// ---------- ホームの1行（D10） ----------
/** 「タスク　今日 2件　期限切れ 1件 ›」。押すと、開いたときと同じ一覧を開く。どちらも0件なら出さない */
export function renderHomeTasks(): void {
  const btn = document.getElementById('home-tasks');
  if (!btn) return;
  const { today, overdue } = calc.homeSummary(taskRows(), getToday());
  btn.hidden = !(today || overdue);
  if (btn.hidden) return;
  const parts = [today ? `今日 ${today}件` : '', overdue ? `期限切れ ${overdue}件` : ''].filter(Boolean);
  btn.replaceChildren(
    el('span', { className: 'home-tasks-label', textContent: 'タスク' }),
    el('span', { className: 'home-tasks-counts' }, [
      today ? el('span', { textContent: `今日 ${today}件` }) : null,
      overdue ? el('span', { className: 'overdue', textContent: `期限切れ ${overdue}件` }) : null,
    ]),
    el('span', { className: 'home-tasks-more', 'aria-hidden': 'true', textContent: '›' }),
  );
  btn.setAttribute('aria-label', `タスク: ${parts.join('、')}。一覧を開く`);
}

function renderStartupTasks(): void {
  const d = new Date();
  elementById('task-startup-date').textContent = `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const now = new Map(taskRows().map(t => [t.id, t]));
  const parts: HTMLElement[] = [];
  for (const g of startupGroups) {
    const rows = g.ids.map(id => now.get(id)).filter((t): t is TaskRow => !!t);
    if (!rows.length) continue;
    parts.push(el('h3', { className: `task-startup-group task-${g.key}`, textContent: `${g.title}（${rows.length}件）` }));
    parts.push(...rows.map(taskRow));
  }
  elementById('task-startup-list').replaceChildren(...parts);
}
export function closeStartupTasks(): void { if (closeStartupFn) closeStartupFn(); }
export function openTaskTabFromStartup(): void { closeStartupTasks(); sw('task'); }

/**
 * まだ js/ と index.html が名前で呼ぶもの（src/main.ts が window に出す。期限付きの互換の層。D20）。
 * HTML の onclick（手順5で置き換える）・ほかの画面（js/app-*.js）・画面を比べる道具（tests/screens）が使う
 */
export const LEGACY_TASKS = {
  // ほかの画面
  taskRows, renderTaskTab, renderHomeTasks, maybeShowStartupTasks,
  // index.html の onclick など
  setTaskAddDue, pickTaskAddDue, addTaskQuick, closeTaskSheet, setTaskSheetDue, saveTaskSheet, deleteTaskFromSheet,
  openStartupTasks, closeStartupTasks, openTaskTabFromStartup,
  // 画面を比べる道具
  openTaskSheet,
};
