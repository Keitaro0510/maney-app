// タスクの画面（D3・D10）。計算は js/tasks.js（MoneyTasks）、部品は js/ui.js（MoneyUI）。
// index.html の次のものを使う（呼ばれたときに読む）: currentRows・saveRows・server・currentUser・TODAY・STORAGE_PREFIX・sw
// - タスクのタブ（#sec-task）: 追加・編集・完了・削除。完了したものは横線で残し、7日たったらいちばん下にたたむ
// - その日はじめて開いたときの一覧（#task-startup）: 期限切れ・今日・2週間以内
// 完了できるのは、この2か所だけ（D10）。

// 今のタスクの行（サーバーの写しに、送信待ちを重ねたもの）
function taskRows(){ return server ? (currentRows().tasks || []) : []; }
const findTask = id => taskRows().find(t => t.id === id);

// 画面を描き直す（タブと、開いていれば開いたときの一覧）
function refreshTaskViews(){
  if(document.getElementById('sec-task').classList.contains('active')) renderTaskTab();
  if(document.getElementById('task-startup').open) renderStartupTasks();
}

const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// 一覧の1行。チェックで完了（D3）。右の「>」か名前を押すと編集の画面を開く
function taskRow(t){
  const { el, checkRow } = MoneyUI;
  const overdue = !t.completed_at && t.due_date && MoneyTasks.daysBetween(TODAY, t.due_date) < 0;
  const memo = (t.memo || '').split('\n')[0];
  const sub = [MoneyTasks.dueLabel(t.due_date, TODAY), memo].filter(Boolean).join('　');
  const edit = el('button', { type: 'button', className: 'icon-btn task-edit', 'aria-label': `「${t.title}」を編集` });
  edit.innerHTML = ICON_MORE;
  edit.addEventListener('click', () => openTaskSheet(t.id));
  const row = checkRow({ title: t.title, sub, done: !!t.completed_at, onChange: done => setTaskDone(t.id, done), end: edit });
  if(overdue) row.classList.add('overdue');
  row.querySelector('.check-body').addEventListener('click', () => openTaskSheet(t.id));
  return row;
}

// ---------- タスクのタブ ----------
let taskAddDue = null; // 追加するときの期限（'YYYY-MM-DD' か null）

function renderTaskTab(){
  const { el } = MoneyUI;
  renderTaskAddDue();
  const box = document.getElementById('task-list');
  const tasks = taskRows();
  if(!tasks.length){
    box.replaceChildren(el('div', { className: 'card task-empty' }, [
      el('div', { className: 'task-empty-title', textContent: 'タスクはまだありません' }),
      el('div', { textContent: '上の欄に、やることを入れて「追加」を押してください。期限は、あとから付けられます。' }),
    ]));
    return;
  }
  const { sections, folded } = MoneyTasks.groupForTab(tasks, TODAY, new Date());
  const cards = sections.map(s => {
    const left = s.tasks.filter(t => !t.completed_at).length;
    return el('section', { className: `card task-section task-${s.key}` }, [
      el('h2', { className: 'task-section-title' }, [
        el('span', { textContent: s.title }),
        el('span', { className: 'task-count', textContent: left ? `${left}件` : '済み' }),
      ]),
      ...s.tasks.map(taskRow),
    ]);
  });
  if(folded.length){
    cards.push(el('details', { className: 'card task-folded' }, [
      el('summary', { textContent: `完了したタスク（${folded.length}件）` }),
      el('div', { className: 'task-folded-note', textContent: '完了して7日たったタスクです' }),
      ...folded.map(taskRow),
    ]));
  }
  box.replaceChildren(...cards);
}

// 追加の欄の期限のボタン（期限なし・今日・明日・日付を選ぶ）
function renderTaskAddDue(){
  const tomorrow = MoneyClock.dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const picked = taskAddDue && taskAddDue !== TODAY && taskAddDue !== tomorrow;
  document.querySelectorAll('#task-add-due [data-due]').forEach(b => {
    const v = b.dataset.due;
    const on = v === 'none' ? !taskAddDue : v === 'today' ? taskAddDue === TODAY : v === 'tomorrow' ? taskAddDue === tomorrow : picked;
    b.setAttribute('aria-pressed', String(on));
    if(v === 'pick') b.textContent = picked ? MoneyTasks.dueLabel(taskAddDue, TODAY).replace(/まで.*$/, '') : '日付…';
  });
}
function setTaskAddDue(kind){
  const tomorrow = MoneyClock.dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if(kind === 'none') taskAddDue = null;
  else if(kind === 'today') taskAddDue = TODAY;
  else if(kind === 'tomorrow') taskAddDue = tomorrow;
  renderTaskAddDue();
}
function pickTaskAddDue(value){ taskAddDue = value || null; renderTaskAddDue(); }

// 上の欄から追加する（名前と期限だけ。メモはあとから編集で）
function addTaskQuick(){
  const input = document.getElementById('task-add-title');
  const title = input.value.trim();
  if(!title){ input.focus(); return; }
  const ok = saveRows([{ table: 'tasks', action: 'insert', id: crypto.randomUUID(), row: {
    title, due_date: taskAddDue, completed_at: null, memo: '', position: MoneyTasks.nextPosition(taskRows()),
  } }]);
  if(!ok) return;
  input.value = '';
  input.focus(); // 続けて入れられるように
  renderTaskTab();
}

// 完了・完了の取り消し（取り消すと completed_at を空に戻す。D3）
function setTaskDone(id, done){
  if(!findTask(id)) return refreshTaskViews();
  saveRows([{ table: 'tasks', action: 'update', id, row: { completed_at: done ? new Date().toISOString() : null } }]);
  refreshTaskViews();
}

// ---------- 編集の画面 ----------
let taskEditId = null;
let closeTaskSheetFn = null;

function openTaskSheet(id){
  const t = findTask(id);
  if(!t) return refreshTaskViews();
  taskEditId = id;
  document.getElementById('task-title').value = t.title;
  document.getElementById('task-due').value = t.due_date || '';
  document.getElementById('task-memo').value = t.memo || '';
  document.getElementById('task-title-err').hidden = true;
  closeTaskSheetFn = MoneyUI.openSheet(document.getElementById('task-sheet'));
}
function closeTaskSheet(){ if(closeTaskSheetFn) closeTaskSheetFn(); }

function setTaskSheetDue(kind){
  const tomorrow = MoneyClock.dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  document.getElementById('task-due').value = kind === 'today' ? TODAY : kind === 'tomorrow' ? tomorrow : '';
}

function saveTaskSheet(){
  const title = document.getElementById('task-title').value.trim();
  if(!title){
    document.getElementById('task-title-err').hidden = false;
    document.getElementById('task-title').focus();
    return;
  }
  if(!findTask(taskEditId)){ closeTaskSheet(); return refreshTaskViews(); }
  const ok = saveRows([{ table: 'tasks', action: 'update', id: taskEditId, row: {
    title, due_date: document.getElementById('task-due').value || null, memo: document.getElementById('task-memo').value.trim(),
  } }]);
  if(!ok) return;
  closeTaskSheet();
  refreshTaskViews();
}

// 削除（本当に消す）。消したあと数秒「元に戻す」を出す（D3）
function deleteTaskFromSheet(){
  const t = findTask(taskEditId);
  closeTaskSheet();
  if(!t) return refreshTaskViews();
  if(!saveRows([{ table: 'tasks', action: 'delete', id: t.id }])) return;
  refreshTaskViews();
  const { title, due_date, completed_at, memo, position } = t;
  MoneyUI.toast(`「${title}」を消しました`, {
    actionLabel: '元に戻す',
    onAction: () => {
      if(findTask(t.id)) return;
      saveRows([{ table: 'tasks', action: 'insert', id: t.id, row: { title, due_date, completed_at, memo, position } }]);
      refreshTaskViews();
    },
  });
}

// ---------- その日はじめて開いたときの一覧（D10） ----------
let startupGroups = []; // 開いたときに出すと決めたタスク（閉じるまで同じものを出す。完了にしても、横線で残す）
let closeStartupFn = null;
const startupKey = () => `${STORAGE_PREFIX}${currentUser.id}:tasksShownDay`;

// その日まだ出していなくて、出すタスクがあれば出す。起動したとき・日付が変わったときに呼ぶ
function maybeShowStartupTasks(){
  if(!currentUser || !server) return;
  if(document.querySelector('.mbg.open, dialog[open]')) return; // ほかの入力の画面が開いているときは出さない
  let last = null;
  try{ last = localStorage.getItem(startupKey()); }catch(e){}
  const tasks = taskRows();
  if(!MoneyTasks.shouldShowStartup(last, TODAY, tasks)) return;
  try{ localStorage.setItem(startupKey(), TODAY); }catch(e){}
  startupGroups = MoneyTasks.startupGroups(tasks, TODAY).map(g => ({ ...g, ids: g.tasks.map(t => t.id) }));
  renderStartupTasks();
  closeStartupFn = MoneyUI.openSheet(document.getElementById('task-startup'));
}

function renderStartupTasks(){
  const { el } = MoneyUI;
  const d = new Date();
  document.getElementById('task-startup-date').textContent =
    `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
  const now = new Map(taskRows().map(t => [t.id, t]));
  const parts = [];
  for(const g of startupGroups){
    const rows = g.ids.map(id => now.get(id)).filter(Boolean);
    if(!rows.length) continue;
    parts.push(el('h3', { className: `task-startup-group task-${g.key}`, textContent: `${g.title}（${rows.length}件）` }));
    parts.push(...rows.map(taskRow));
  }
  document.getElementById('task-startup-list').replaceChildren(...parts);
}
function closeStartupTasks(){ if(closeStartupFn) closeStartupFn(); }
function openTaskTabFromStartup(){ closeStartupTasks(); sw('task'); }
