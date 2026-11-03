// 毎月のお金の画面（D20 の 7）。行は DB の形で読み書きする。
import { state } from '../state.ts';
import { currentRows, saveRows } from '../sync.ts';
import { getToday } from '../dates.ts';
import { activeInMonth } from '../money.ts';
import * as monthly from '../monthly.ts';
import * as ui from '../ui.ts';
import { sw, ldgTab, renderCurrentSection } from '../js-bridge.ts';
import type { MonthlyRow } from '../monthly.ts';
export function monthlyRows(): MonthlyRow[] { return state.server ? (currentRows().fixed_costs || []) as unknown as MonthlyRow[] : []; }
const findMonthly = (id: string | null): MonthlyRow | undefined => monthlyRows().find(r => r.id === id);
// その月に数えるもの（期間の外の月は数えない。D14）
export function monthlyRowsIn(y: number, m: number): MonthlyRow[]{ return monthlyRows().filter(r => activeInMonth(r, y, m)); }

// 払い方の文字
export function monthlyPayLabel(r: MonthlyRow): string{
  if(r.kind === 'income') return '口座に入金';
  if(r.payment_method === 'bank') return '口座から引き落とし';
  if(r.payment_method === 'cash') return '現金で払う';
  const card = (currentRows().cards || []).find(c => c.id === r.card_id);
  return `${card ? card.name : 'カード'}で払う`;
}
const monthlyYen = (r: MonthlyRow, amount = r.amount): string => `${r.kind === 'income' ? '+' : '-'}¥${amount.toLocaleString()}`;

export function openMonthlyTab(): void{ sw('ledger'); ldgTab('monthly'); }

// ---------- 家計簿のタブの「毎月のお金」 ----------
export function renderMonthlyTab(): void{
  const { el } = ui;
  const box = ui.elementById('monthly-list');
  const rows = monthlyRows();
  if(!rows.length){
    box.replaceChildren(el('div', { className: 'card monthly-empty' }, [
      el('div', { className: 'monthly-empty-title', textContent: '毎月のお金はまだありません' }),
      el('div', { textContent: '上のボタンか、支出・収入を記録するときの「毎月くり返す」から入れられます。' }),
    ]));
    return;
  }
  const g = monthly.groups(rows, getToday());
  const section = (title: string, list: MonthlyRow[]) => el('section', { className: 'card monthly-section' }, [
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
export function monthlyRow(r: MonthlyRow): HTMLButtonElement{
  const { el } = ui;
  const sub = [`毎月${r.day}日`, monthlyPayLabel(r), monthly.periodLabel(r)].filter(Boolean).join('・');
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
let monthlyEditId: string | null = null;
let closeMonthlySheetFn: (() => void) | null = null;

export function openMonthlySheet(id: string | null, opener: HTMLElement): void{
  const r = findMonthly(id);
  if(!r) return renderCurrentSection();
  monthlyEditId = id;
  const status = monthly.status(r, getToday());
  const now = monthly.monthOf(getToday()), next = monthly.addMonths(now, 1), last = monthly.addMonths(now, -1);
  const label = monthly.monthLabel;

  ui.elementById('monthly-sheet-title').textContent = r.name;
  const info = ui.elementById('monthly-sheet-info');
  const { el } = ui;
  info.replaceChildren(
    el('div', { className: `monthly-info-amount ${r.kind === 'income' ? 'in' : 'out'}`, textContent: monthlyYen(r) }),
    el('div', { textContent: [`毎月${r.day}日`, monthlyPayLabel(r)].join('・') }),
    el('div', { textContent: monthly.periodLabel(r) || '前から続いています' }),
  );

  // 来月から金額を変える（来月も数えるものだけ）
  const canChange = monthly.canChangeAmount(r, getToday());
  ui.elementById('monthly-amount-part').hidden = !canChange;
  ui.inputById('monthly-new-amount').value = '';
  ui.elementById('monthly-amount-err').hidden = true;
  ui.elementById('monthly-amount-title').textContent = status === 'future'
    ? '金額を変える' : `来月（${label(next).replace(/^\d+年/, '')}）から金額を変える`;
  ui.elementById('monthly-amount-hint').textContent = status === 'future'
    ? 'まだ始まっていないので、そのまま金額を直します'
    : '今月までは、今の金額のまま数えます';

  // やめる（今月まで・先月まで）。始まる月より前にはできない
  const stopThis = monthly.stopMonth(r, getToday(), 'this'), stopLast = monthly.stopMonth(r, getToday(), 'last');
  const stopPart = ui.elementById('monthly-stop-part');
  stopPart.hidden = status !== 'active';
  const bThis = ui.elementById('monthly-stop-this') as HTMLButtonElement, bLast = ui.elementById('monthly-stop-last') as HTMLButtonElement;
  bThis.textContent = `今月（${label(now).replace(/^\d+年/, '')}）まで`;
  bLast.textContent = `先月（${label(last).replace(/^\d+年/, '')}）まで`;
  bThis.disabled = !stopThis || r.end_month === stopThis;
  bLast.disabled = !stopLast;
  ui.elementById('monthly-stop-hint').textContent = !stopLast
    ? '今月から始めたので、先月までにはできません。まちがえて作ったときは、下の「削除」を使ってください'
    : 'やめても、それまでの月の分は数えたままです';

  // 終わったもの・これから始まるものの説明
  const state = ui.elementById('monthly-state');
  state.hidden = status === 'active';
  state.textContent = status === 'ended' ? `${label(r.end_month!)}でやめました。`
    : status === 'future' ? `${label(r.start_month!)}から数えます。` : '';

  closeMonthlySheetFn = ui.openSheet(ui.dialogById('monthly-sheet'), opener);
}
export function closeMonthlySheet(): void{ if(closeMonthlySheetFn) closeMonthlySheetFn(); }

// 保存して、画面を描き直す。できたら true
export function saveMonthly(changes: unknown): boolean{
  if(!saveRows(changes)) return false;
  renderCurrentSection();
  return true;
}

export function changeMonthlyAmount(): void{
  const r = findMonthly(monthlyEditId);
  if(!r){ closeMonthlySheet(); return renderCurrentSection(); }
  const input = ui.inputById('monthly-new-amount');
  const amount = parseInt(input.value, 10);
  if(!(amount > 0)){
    ui.elementById('monthly-amount-err').hidden = false;
    input.focus();
    return;
  }
  const newId = crypto.randomUUID();
  const changes = monthly.changeAmountChanges(r, getToday(), amount,
    { newId: () => newId, position: monthly.nextPosition(monthlyRows()) });
  closeMonthlySheet();
  if(!saveMonthly(changes)) return;
  // 元に戻す: 作った行を消し、元の行を戻す
  const undo = changes.length === 1
    ? [{ table: 'fixed_costs', action: 'update', id: r.id, row: { amount: r.amount } }]
    : [{ table: 'fixed_costs', action: 'delete', id: newId }, { table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: r.end_month } }];
  ui.toast(`「${r.name}」を ¥${amount.toLocaleString()} にしました`, {
    actionLabel: '元に戻す', onAction: () => saveMonthly(undo),
  });
}

export function stopMonthly(which: 'this' | 'last'): void{
  const r = findMonthly(monthlyEditId);
  if(!r){ closeMonthlySheet(); return renderCurrentSection(); }
  const end = monthly.stopMonth(r, getToday(), which);
  if(!end) return;
  closeMonthlySheet();
  if(!saveMonthly([{ table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: end } }])) return;
  ui.toast(`「${r.name}」を${monthly.monthLabel(end).replace(/^\d+年/, '')}までにしました`, {
    actionLabel: '元に戻す', onAction: () => saveMonthly([{ table: 'fixed_costs', action: 'update', id: r.id, row: { end_month: r.end_month } }]),
  });
}

// 削除（まちがえて作ったとき。前の月の分も消える）。消したあと数秒「元に戻す」を出す（D14）
export function deleteMonthly(): void{
  const r = findMonthly(monthlyEditId);
  closeMonthlySheet();
  if(!r) return renderCurrentSection();
  if(!saveMonthly([{ table: 'fixed_costs', action: 'delete', id: r.id }])) return;
  ui.toast(`「${r.name}」を消しました`, {
    actionLabel: '元に戻す',
    onAction: () => { if(!findMonthly(r.id)) saveMonthly([{ table: 'fixed_costs', action: 'insert', id: r.id, row: monthly.restoreRow(r) }]); },
  });
}

// ---------- 記録の画面の「毎月くり返す」 ----------
// rule: { name, amount, dateKey, kind, payment_method, card_id }。保存できたら true
export function saveMonthlyFromLedger(rule: monthly.RuleInput): boolean{
  const ok = saveRows([{ table: 'fixed_costs', action: 'insert', id: crypto.randomUUID(),
    row: monthly.newRule(rule, monthly.nextPosition(monthlyRows())) }]);
  if(!ok) return false;
  ui.toast(`「${rule.name}」を毎月のお金に入れました`, { actionLabel: '見る', onAction: openMonthlyTab });
  return true;
}

// カードを消したとき: そのカードで払う毎月のお金は、来月から口座からの引き落としにする（今月まではカードのまま）
export function moveMonthlyOffCard(cardId: string | undefined): void{
  if(!cardId) return;
  let position = monthly.nextPosition(monthlyRows());
  const changes = monthlyRows()
    .filter(r => r.card_id === cardId && monthly.canChangeAmount(r, getToday()))
    .flatMap(r => monthly.changeFromNextMonthChanges(r, getToday(), { payment_method: 'bank', card_id: null },
      { newId: () => crypto.randomUUID(), position: position++ }));
  if(changes.length) saveRows(changes);
}

export const LEGACY_MONTHLY_SCREEN = { monthlyRowsIn, monthlyPayLabel, openMonthlyTab, renderMonthlyTab, monthlyRow, openMonthlySheet, closeMonthlySheet, saveMonthly, changeMonthlyAmount, stopMonthly, deleteMonthly, saveMonthlyFromLedger, moveMonthlyOffCard };

