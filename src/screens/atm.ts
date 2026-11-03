// ATM の入力と引き出し履歴（D20 の 4）。
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday } from '../dates.ts';
import { elementById } from '../ui.ts';
import { renderHome } from '../js-bridge.ts';

let wdStr = '';
export function openWd(): void { wdStr = ''; updWd(); elementById('wd-mbg').classList.add('open'); }
export function closeWd(): void { elementById('wd-mbg').classList.remove('open'); }
export function nk(v: string): void { if (wdStr.length >= 8) return; if (!wdStr && (v === '0' || v === '000')) return; wdStr += v; updWd(); }
export function nd(): void { wdStr = wdStr.slice(0, -1); updWd(); }
export function updWd(): void { elementById('wd-display').textContent = '¥' + (parseInt(wdStr) || 0).toLocaleString(); }
export function doWd(): void { const amount = parseInt(wdStr) || 0; if (!amount) return; state.st.wds.push({ date: getToday(), amount }); save(); closeWd(); renderHome(); renderWdHist(); }
export function renderWdHist(): void {
  const el = document.getElementById('wd-hist'); if (!el) return;
  const list = [...state.st.wds].reverse().slice(0, 10);
  if (!list.length) { el.innerHTML = '<div class="empty">引き出し履歴なし</div>'; return; }
  el.innerHTML = list.map((w, ri) => `<div class="wd-hist-item"><span style="color:var(--color-text-secondary)">${w.date}</span><div style="display:flex;align-items:center;gap:8px"><span style="color:#3C3489;font-weight:600">-¥${parseInt(String(w.amount)).toLocaleString()}</span><button class="btn sm del" onclick="delWd(${state.st.wds.length - 1 - ri})">削除</button></div></div>`).join('');
}
export function delWd(i: number): void { state.st.wds.splice(i, 1); save(); renderHome(); renderWdHist(); }
export const LEGACY_ATM = { openWd, closeWd, nk, nd, updWd, doWd, renderWdHist, delWd };
