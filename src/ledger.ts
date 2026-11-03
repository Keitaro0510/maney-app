// 家計簿の記録を読む補助（D20 の 7）。ホームとカレンダーも使う。
import { state } from './state.ts';
import type { StLedger } from './compat.ts';

export const monthLedger = (y: number, m: number): StLedger[] => state.st.ledger.filter(l => {
  const d = new Date(l.date); return d.getFullYear() === y && d.getMonth() === m;
});
export const getLedgerForDay = (ds: string): StLedger[] => state.st.ledger.filter(l => l.date === ds);
export function ledgerPayLabel(l: StLedger): string {
  if (l.type === 'income') return l.receive || '現金';
  const card = l.cardIdx != null && l.cardIdx >= 0 ? state.st.cards[l.cardIdx] : null;
  return card ? card.name : (l.pay || '');
}
export const LEGACY_LEDGER = { monthLedger, getLedgerForDay, ledgerPayLabel };
