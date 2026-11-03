// カードの締め日・請求額・実績。画面とホーム・カレンダーで共有する（D20 の 4）。
import { state } from './state.ts';
import { currentRows } from './sync.ts';
import { getToday, ds2d } from './dates.ts';
import { cardCycle, cardCycleMonths } from './money.ts';
import type { StCard, StCardActual } from './compat.ts';
import type { CardRow } from './rows.ts';
type CardInput = Pick<StCard, 'name' | '_id'> & { closeDay: string | number; billDay: string | number };

export const cardActualKey = (ci: number, y: number, m: number): string => `card-${ci}-${y}-${String(m + 1).padStart(2, '0')}`;
export const getActualCard = (ci: number, y: number, m: number): StCardActual | undefined =>
  state.st.actualInputs.find((a): a is StCardActual => a.type === 'card' && a.cardKey === cardActualKey(ci, y, m));

export function setActualCard(ci: number, y: number, m: number, amount: number, estimated: number): void {
  const key = cardActualKey(ci, y, m);
  const ei = state.st.actualInputs.findIndex(a => a.type === 'card' && a.cardKey === key);
  const entry: StCardActual = { type: 'card', cardKey: key, cardIdx: ci, billY: y, billM: m, actualAmount: amount, estimatedAmount: estimated };
  if (ei >= 0) { entry._id = state.st.actualInputs[ei]._id; state.st.actualInputs[ei] = entry; }
  else state.st.actualInputs.push(entry);
}

export function cardRowOf(card: CardInput): CardRow {
  const row = card._id && currentRows().cards?.find(c => c.id === card._id);
  return (row as unknown as CardRow | undefined) || { id: '__preview__', name: card.name, close_day: parseInt(String(card.closeDay)), bill_day: parseInt(String(card.billDay)), position: 0, deleted_at: null };
}

export function cardCloseDay(card: CardInput, y: number, m: number): number {
  const cl = parseInt(String(card.closeDay));
  return cl >= 28 ? new Date(y, m + 1, 0).getDate() : cl;
}

export function cardCycleForBillMonth(card: CardInput, _ci: number, y: number, m: number) {
  const n = cardCycle(currentRows(), cardRowOf(card), y, m);
  return { cs: ds2d(n.cs), ce: ds2d(n.ce), billD: n.billD, amount: n.amount };
}

export function cycle(card: CardInput, idx: number) {
  const mo = cardCycleMonths(cardRowOf(card), getToday());
  const bm = idx === 0 ? mo.confirmed : mo.pending;
  const n = cardCycle(currentRows(), cardRowOf(card), bm.y, bm.m);
  return { label: idx === 0 ? '確定' : '集計中', cs: ds2d(n.cs), ce: ds2d(n.ce), billY: n.billY, billM: n.billM, billD: n.billD, amount: n.amount };
}

export const cardBillForGraphDate = (card: StCard, ci: number, y: number, m: number): number => cardCycleForBillMonth(card, ci, y, m).amount;
export const cardBillForDate = (card: StCard, y: number, m: number): number => cardBillForGraphDate(card, state.st.cards.indexOf(card), y, m);
export const cardBillAmount = (card: StCard, ci: number, y: number, m: number): number =>
  getActualCard(ci, y, m)?.actualAmount ?? cardCycleForBillMonth(card, ci, y, m).amount;

export const LEGACY_CARDS = { cardActualKey, getActualCard, setActualCard, cardRowOf, cardCloseDay, cardCycleForBillMonth, cycle, cardBillForGraphDate, cardBillForDate, cardBillAmount };
