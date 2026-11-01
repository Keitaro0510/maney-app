// 毎月のお金の画面（D14）。計算は src/monthly.ts（MoneyMonthly）、部品は js/ui.js（MoneyUI）。
// 固定費（fixed_costs）の行を、互換の st を通さずに直接読み書きする（D1 と同じ。保存は saveRows）。
// js/app.js の次のものを使う（呼ばれたときに読む）: currentRows・saveRows・server・TODAY・sw・ldgTab・renderCurrentSection
// - 家計簿のタブの「毎月のお金」: 一覧と、1つを押したときの画面（来月から金額を変える・やめる・削除）
// - 記録の画面の「毎月くり返す」から作る（saveMonthlyFromLedger）
// - カレンダー・今日のお知らせ・日の詳細が使う、その月に数えるもの（monthlyRowsIn）

// 今の毎月のお金の行（サーバーの写しに、送信待ちを重ねたもの）
function monthlyRows(){ return server ? (currentRows().fixed_costs || []) : []; }
const findMonthly = id => monthlyRows().find(r => r.id === id);
// その月に数えるもの（期間の外の月は数えない。D14）
function monthlyRowsIn(y, m){ return monthlyRows().filter(r => MoneyCalc.activeInMonth(r, y, m)); }

// 払い方の文字
function monthlyPayLabel(r){
  if(r.kind === 'income') return '口座に入金';
  if(r.payment_method === 'bank') return '口座から引き落とし';
  if(r.payment_method === 'cash') return '現金で払う';
  const card = (currentRows().cards || []).find(c => c.id === r.card_id);
  return `${card ? card.name : 'カード'}で払う`;
}
const monthlyYen = (r, amount = r.amount) => `${r.kind === 'income' ? '+' : '-'}¥${amount.toLocaleString()}`;

function openMonthlyTab(){ sw('ledger'); ldgTab('monthly'); }

// ---------- 家計簿のタブの「毎月のお金」 ----------
function renderMonthlyTab(){
  const { el } = MoneyUI;
  const box = document.getElementById('monthly-list');
  const rows = monthlyRows();
  if(!rows.length){
    box.replaceChildren(el('div', { className: 'card monthly-empty' }, [
      el('div', { className: 'monthly-empty-title', textContent: '毎月のお金はまだありません' }),
      el('div', { textContent: '上のボタンか、支出・収入を記録するときの「毎月くり返す」から入れられます。' }),
    ]));
    return;
  }
  const g = MoneyMonthly.groups(rows, TODAY);
  const section = (title, list) => el('section', { className: 'card monthly-section' }, [
    el('h2', { className: 'monthly-section-title', textContent: title }),
    ...list.map(monthlyRow),
  ]);
  const cards = [];
  if(g.active.length) cards.push(section('続いているもの', g.active));
  if(g.future.length) cards.push(section('これから始まるもの', g.future));
  if(g.ended.length){
    cards.push(el('details', { className: 'card monthly-section monthly-ended' }, [
      el('summary', { textContent: `やめたもの（${g.ended.length}件）` }),
      el('div', { className: 'monthly-note', textContent: 'やめる前の月の分は、残高の計算に入ったままです' }),
      ...g.ended.map(monthlyRow),
    ]));
  }
  box.replaceChildren(...cards);
}

// 一覧の1行。押すと、その1つの画面を開く
function monthlyRow(r){
  const { el } = MoneyUI;
  const sub = [`毎月${r.day}日`, monthlyPayLabel(r), MoneyMonthly.periodLabel(r)].filter(Boolean).join('・');
  const btn = el('button', { type: 'button', className: 'monthly-row' }, [
    el('span', { className: 'monthly-body' }, [
      el('span', { className: 'monthly-name', textContent: r.name }),
      el('span', { className: 'monthly-sub', textContent: sub }),
    ]),
    el('span', { className: `monthly-amount ${r.kind === 'income' ? 'in' : 'out'}`, textContent: monthlyYen(r) }),
  ]);
  btn.addEventListener('click', () => openMonthlySheet(r.id, btn));
  return btn;
}

// ---------- 1つを押したときの画面 ----------
let monthlyEditId = null;
let closeMonthlySheetFn = null;

function openMonthlySheet(id, opener){
  const r = findMonthly(id);
  if(!r) return renderCurrentSection();
  monthlyEditId = id;
  const status = MoneyMonthly.status(r, TODAY);
  const now = MoneyMonthly.monthOf(TODAY), next = MoneyMonthly.addMonths(now, 1), last = MoneyMonthly.addMonths(now, -1);
  const label = MoneyMonthly.monthLabel;

  document.getElementById('monthly-sheet-title').textContent = r.name;
  const info = document.getElementById('monthly-sheet-info');
  const { el } = MoneyUI;
  info.replaceChildren(
    el('div', { className: `monthly-info-amount ${r.kind === 'income' ? 'in' : 'out'}`, textContent: monthlyYen(r) }),
    el('div', { textContent: [`毎月${r.day}日`, monthlyPayLabel(r)].join('・') }),
    el('div', { textContent: MoneyMonthly.periodLabel(r) || '前から続いています' }),
  );

  // 来月から金額を変える（来月も数えるものだけ）
  const canChange = MoneyMonthly.canChangeAmount(r, TODAY);
  document.getElementById('monthly-amount-part').hidden = !canChange;
  MoneyUI.inputById('monthly-new-amount').value = '';
  document.getElementById('monthly-amount-err').hidden = true;
  document.getElementById('monthly-amount-title').textContent = status === 'future'
    ? '金額を変える' : `来月（${label(next).replace(/^\d+年/, '')}）から金額を変える`;
  document.getElementById('monthly-amount-hint').textContent = status === 'future'
    ? 'まだ始まっていないので、そのまま金額を直します'
    : '今月までは、今の金額のまま数えます';

  // やめる（今月まで・先月まで）。始まる月より前にはできない
  const stopThis = MoneyMonthly.stopMonth(r, TODAY, 'this'), stopLast = MoneyMonthly.stopMonth(r, TODAY, 'last');
  const stopPart = document.getElementById('monthly-stop-part');
  stopPart.hidden = status !== 'active';
  const bThis = /** @type {HTMLButtonElement} */ (document.getElementById('monthly-stop-this')), bLast = /** @type {HTMLButtonElement} */ (document.getElementById('monthly-stop-last'));
  bThis.textContent = `今月（${label(now).replace(/^\d+年/, '')}）まで`;
  bLast.textContent = `先月（${label(last).replace(/^\d+年/, '')}）まで`;
  bThis.disabled = !stopThis || r.end_month === stopThis;
  bLast.disabled = !stopLast;
  document.getElementById('monthly-stop-hint').textContent = !stopLast
    ? '今月から始めたので、先月までにはできません。まちがえて作ったときは、下の「削除」を使ってください'
    : 'やめても、それまでの月の分は数えたままです';

  // 終わったもの・これから始まるものの説明
  const state = document.getElementById('monthly-state');
  state.hidden = status === 'active';
  state.textContent = status === 'ended' ? `${label(r.end_month)}でやめました。`
    : status === 'future' ? `${label(r.start_month)}から数えます。` : '';

  closeMonthlySheetFn = MoneyUI.openSheet(MoneyUI.dialogById('monthly-sheet'), opener);
}
function closeMonthlySheet(){ if(closeMonthlySheetFn) closeMonthlySheetFn(); }

// 保存して、画面を描き直す。できたら true
function saveMonthly(changes){
  if(!saveRows(changes)) return false;
  renderCurrentSection();
  return true;
}

function changeMonthlyAmount(){
  const r = findMonthly(monthlyEditId);
  if(!r){ closeMonthlySheet(); return renderCurrentSection(); }
  const input = MoneyUI.inputById('monthly-new-amount');
  const amount = parseInt(input.value, 10);
  if(!(amount > 0)){
    document.getElementById('monthly-amount-err').hidden = false;
    input.focus();
    return;
  }
  const newId = crypto.randomUUID();
  const changes = MoneyMonthly.changeAmountChanges(r, TODAY, amount,
    { newId: () => newId, position: MoneyMonthly.nextPosition(monthlyRows()) });
  closeMonthlySheet();
  if(!saveMonthly(changes)) return;
  // 元に戻す: 作った行を消し、元の行を戻す
  const undo = changes.length === 1
    ? [{ table: 'fixed_costs', action: 'update', id: r.id, row: { amount: r.amount } }]
    : [{ table: 'fixed_costs', action: 'delete', id: newId }, { table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: r.end_month } }];
  MoneyUI.toast(`「${r.name}」を ¥${amount.toLocaleString()} にしました`, {
    actionLabel: '元に戻す', onAction: () => saveMonthly(undo),
  });
}

function stopMonthly(which){
  const r = findMonthly(monthlyEditId);
  if(!r){ closeMonthlySheet(); return renderCurrentSection(); }
  const end = MoneyMonthly.stopMonth(r, TODAY, which);
  if(!end) return;
  closeMonthlySheet();
  if(!saveMonthly([{ table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: end } }])) return;
  MoneyUI.toast(`「${r.name}」を${MoneyMonthly.monthLabel(end).replace(/^\d+年/, '')}までにしました`, {
    actionLabel: '元に戻す', onAction: () => saveMonthly([{ table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: r.end_month } }]),
  });
}

// 削除（まちがえて作ったとき。前の月の分も消える）。消したあと数秒「元に戻す」を出す（D14）
function deleteMonthly(){
  const r = findMonthly(monthlyEditId);
  closeMonthlySheet();
  if(!r) return renderCurrentSection();
  if(!saveMonthly([{ table: 'fixed_costs', action: 'delete', id: r.id }])) return;
  MoneyUI.toast(`「${r.name}」を消しました`, {
    actionLabel: '元に戻す',
    onAction: () => { if(!findMonthly(r.id)) saveMonthly([{ table: 'fixed_costs', action: 'insert', id: r.id, row: MoneyMonthly.restoreRow(r) }]); },
  });
}

// ---------- 記録の画面の「毎月くり返す」 ----------
// rule: { name, amount, dateKey, kind, payment_method, card_id }。保存できたら true
function saveMonthlyFromLedger(rule){
  const ok = saveRows([{ table: 'fixed_costs', action: 'insert', id: crypto.randomUUID(),
    row: MoneyMonthly.newRule(rule, MoneyMonthly.nextPosition(monthlyRows())) }]);
  if(!ok) return false;
  MoneyUI.toast(`「${rule.name}」を毎月のお金に入れました`, { actionLabel: '見る', onAction: openMonthlyTab });
  return true;
}

// カードを消したとき: そのカードで払う毎月のお金は、来月から口座からの引き落としにする（今月まではカードのまま）
function moveMonthlyOffCard(cardId){
  if(!cardId) return;
  let position = MoneyMonthly.nextPosition(monthlyRows());
  const changes = monthlyRows()
    .filter(r => r.card_id === cardId && MoneyMonthly.canChangeAmount(r, TODAY))
    .flatMap(r => MoneyMonthly.changeFromNextMonthChanges(r, TODAY, { payment_method: 'bank', card_id: null },
      { newId: () => crypto.randomUUID(), position: position++ }));
  if(changes.length) saveRows(changes);
}
