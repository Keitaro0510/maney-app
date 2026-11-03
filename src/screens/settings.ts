import { renderCal } from '../js-bridge.ts';
// 設定タブ。カードと ATM の表示はそれぞれの画面モジュールに任せる（D20 の 4）。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday } from '../dates.ts';
import { inputById, selectById, elementById, escapeHtml, toast } from '../ui.ts';
import { renderCardList } from './cards.ts';
import { renderWdHist } from './atm.ts';

export function addCatExp(): void { const e = inputById('new-cat-exp'), v = e.value.trim(); if (!v || state.st.catExp.includes(v)) return; state.st.catExp.push(v); save(); e.value = ''; renderCatTags(); }
export function addCatInc(): void { const e = inputById('new-cat-inc'), v = e.value.trim(); if (!v || state.st.catInc.includes(v)) return; state.st.catInc.push(v); save(); e.value = ''; renderCatTags(); }
export function delCatExp(i: number): void { if (state.st.catExp.length <= 1) return; state.st.catExp.splice(i, 1); save(); renderCatTags(); }
export function delCatInc(i: number): void { if (state.st.catInc.length <= 1) return; state.st.catInc.splice(i, 1); save(); renderCatTags(); }
export function renderCatTags(): void {
  const e = document.getElementById('cat-exp-tags'), n = document.getElementById('cat-inc-tags');
  if (e) e.innerHTML = state.st.catExp.map((c, i) => `<span class="cat-tag">${escapeHtml(c)}<button type="button" class="cat-tag-del" aria-label="「${escapeHtml(c)}」を消す" onclick="delCatExp(${i})">×</button></span>`).join('');
  if (n) n.innerHTML = state.st.catInc.map((c, i) => `<span class="cat-tag">${escapeHtml(c)}<button type="button" class="cat-tag-del" aria-label="「${escapeHtml(c)}」を消す" onclick="delCatInc(${i})">×</button></span>`).join('');
}
export function initSettingTab(): void {
  const s = state.st;
  inputById('set-bal').value = String(s.acctBase || ''); inputById('set-bal-date').value = s.baseDate || getToday();
  selectById('set-close').value = String(s.shiftCloseDay || 31); inputById('set-pay').value = String(s.shiftPayDay || 10);
  inputById('set-bud').value = String(s.budget || ''); selectById('set-fuyou').value = s.fuyouLimit || '1300000';
  inputById('set-other-inc').value = String(s.otherIncome || '');
  updateShiftCyclePreview(); renderWdHist(); renderCatTags(); renderCardList();
  elementById('set-close').onchange = () => { updateShiftCyclePreview(); saveSettingFields(); };
  elementById('set-pay').oninput = updateShiftCyclePreview;
  for (const id of ['set-bal', 'set-bal-date', 'set-pay', 'set-bud', 'set-fuyou', 'set-other-inc']) elementById(id).onchange = saveSettingFields;
}
export function updateShiftCyclePreview(): void {
  const cd = selectById('set-close').value, pd = inputById('set-pay').value;
  elementById('shift-cycle-preview').textContent = `締め日: ${Number(cd) >= 28 ? '月末' : '毎月' + cd + '日'}　→　翌月${pd}日に口座に入金`;
}
export function saveSettingFields(): void {
  const next = {
    acctBase: parseInt(inputById('set-bal').value) || 0, baseDate: inputById('set-bal-date').value || getToday(),
    shiftCloseDay: parseInt(selectById('set-close').value) || 31, shiftPayDay: parseInt(inputById('set-pay').value) || 10,
    budget: parseInt(inputById('set-bud').value) || 0, fuyouLimit: selectById('set-fuyou').value,
    otherIncome: parseInt(inputById('set-other-inc').value) || 0,
  };
  if ((Object.keys(next) as (keyof typeof next)[]).every(k => String(state.st[k] ?? '') === String(next[k]))) return;
  Object.assign(state.st, next); save(); renderHome(); renderCal(); toast('設定を保存しました');
}
export const LEGACY_SETTINGS = { addCatExp, addCatInc, delCatExp, delCatInc, renderCatTags, initSettingTab, updateShiftCyclePreview, saveSettingFields };
