// カード設定の画面（D20 の 4）。請求の計算は src/cards.ts。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday, gY, gM, gD, addM, monthDate, fmtMD } from '../dates.ts';
import * as ui from '../ui.ts';
import { cycle, cardBillForDate, getActualCard, setActualCard, cardActualKey } from '../cards.ts';
import type { StCard } from '../compat.ts';
import { moveMonthlyOffCard } from './monthly.ts';

let cardEditIdx = -1;
export function toggleCardCloseEom(prefix: string): void{
  const cb=ui.inputById(`${prefix}-close-eom`);
  const input=ui.inputById(`${prefix}-close`);
  if(cb.checked){input.value='31';input.disabled=true;}
  else{input.value='';input.disabled=false;}
  if(prefix==='cn')previewCycle();
}
export function previewCycle(): void{
  const isEom=ui.inputById('cn-close-eom').checked;
  const cl=isEom?31:parseInt(ui.inputById('cn-close').value);
  const bill=parseInt(ui.inputById('cn-bill').value);
  const el=ui.elementById('cn-cycle-preview');
  if(!cl||!bill){el.style.display='none';return;}
  const tmp={name:'__p__',closeDay:String(cl),billDay:String(bill)};
  const f=cycle(tmp,0),c=cycle(tmp,1);
  el.innerHTML=`<span class="badge bfixed">確定</span> ${fmtMD(f.cs)}〜${fmtMD(f.ce)} → <strong>${f.billY}年${f.billM+1}月${f.billD}日</strong><br><span class="badge bpending">集計中</span> ${fmtMD(c.cs)}〜${fmtMD(c.ce)} → <strong>${c.billY}年${c.billM+1}月${c.billD}日</strong>`;
  el.style.display='block';
}
export function addCard(): void{
  const name=ui.inputById('cn-name').value.trim();
  const isEom=ui.inputById('cn-close-eom').checked;
  const cl=isEom?'31':ui.inputById('cn-close').value;
  const bill=ui.inputById('cn-bill').value;
  if(!name||!cl||!bill)return;
  state.st.cards.push({name,closeDay:cl,billDay:bill});save();
  ui.inputById('cn-name').value='';
  ui.inputById('cn-close').value='';
  ui.inputById('cn-close').disabled=false;
  ui.inputById('cn-close-eom').checked=false;
  ui.inputById('cn-bill').value='';
  ui.elementById('cn-cycle-preview').style.display='none';
  renderCardList();renderHome();
}
// 引き落とし実績の入力欄。引き落とし日を過ぎた月に加えて、締め日を過ぎて額が確定した月（引き落とし前）も出す。確定した額を入れると、ホームのグラフに反映される
export function renderCardBillHistory(ci: number, card: StCard): string{
  const billDay=parseInt(card.billDay),today=new Date(gY(),gM(),gD()),confirmed=cycle(card,0);
  let rows='';
  for(let i=5;i>=-1;i--){
    const bm=addM(gY(),gM(),-i),billDate=monthDate(bm.y,bm.m,billDay);
    const isConfirmed=bm.y===confirmed.billY&&bm.m===confirmed.billM;
    const upcoming=billDate>today;
    if(upcoming&&!isConfirmed)continue;
    const estimated=cardBillForDate(card,bm.y,bm.m),actual=getActualCard(ci,bm.y,bm.m),dispActual=actual?parseInt(String(actual.actualAmount)):null;
    const diff=dispActual?dispActual-estimated:0;
    const diffLabel=dispActual&&diff!==0?`<br><span style="font-size:10px">家計簿との差 ${diff>0?'+':'-'}¥${Math.abs(diff).toLocaleString()}</span>`:'';
    rows+=`<div class="salary-row"><span class="salary-month">${bm.y}/${bm.m+1}月</span><span class="salary-est">推定 ¥${estimated.toLocaleString()}<br><span style="font-size:10px">${bm.m+1}月${billDay}日引き落とし${upcoming?'（確定待ち）':''}</span>${diffLabel}</span><div style="display:flex;align-items:center;gap:6px"><input class="salary-input" type="number" inputmode="numeric" placeholder="実績額" value="${dispActual||''}" data-card-action="bill-change" data-index="${ci}" data-year="${bm.y}" data-month="${bm.m}" data-estimated="${estimated}"/>${dispActual?'<span class="act-badge">入力済</span>':''}</div></div>`;
  }
  return rows||'<div class="empty" style="font-size:12px">まだ引き落とし実績なし</div>';
}
export function onCardBillChange(ci: number, bY: number, bM: number, estimated: number, val: string): void{const amount=parseInt(val)||0;if(amount>0){setActualCard(ci,bY,bM,amount,estimated);save();renderHome();renderCardList();}else{const key=cardActualKey(ci,bY,bM);state.st.actualInputs=state.st.actualInputs.filter(a=>!(a.type==='card'&&a.cardKey===key));save();renderHome();renderCardList();}}
export function renderCardList(): void{const el=ui.elementById('card-list-sec');if(!state.st.cards.some(c=>!c._deleted)){el.innerHTML='';return;}el.innerHTML=state.st.cards.map((card,ci)=>{if(card._deleted)return'';const f=cycle(card,0),c=cycle(card,1),aF=getActualCard(ci,f.billY,f.billM),fAmt=aF?parseInt(String(aF.actualAmount)):f.amount;const closeDayLabel=parseInt(card.closeDay)>=28?'末日':`${card.closeDay}日`;return `<div style="border-top:0.5px solid var(--color-border-tertiary);padding-top:10px;margin-top:10px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:15px;font-weight:600">${ui.escapeHtml(card.name)}</span><div style="display:flex;gap:6px"><button class="btn sm edit" data-card-action="edit" data-index="${ci}">編集</button><button class="btn sm del" data-card-action="delete" data-index="${ci}">削除</button></div></div><div class="fgr" style="margin-bottom:10px"><div><div style="font-size:11px;color:var(--color-text-secondary)">締め日</div><div style="font-size:14px;font-weight:600">毎月${closeDayLabel}</div></div><div><div style="font-size:11px;color:var(--color-text-secondary)">引き落とし日</div><div style="font-size:14px;font-weight:600">毎月${card.billDay}日</div></div></div><div class="bill-row"><div><span class="badge bfixed">確定</span>${aF?'<span class="act-badge">実額入力済</span>':''}<div class="bill-label">${f.billY}年${f.billM+1}月${f.billD}日 口座引き落とし</div><div class="bill-label">${fmtMD(f.cs)}〜${fmtMD(f.ce)} の利用分</div></div><div class="bill-amount" style="color:#A32D2D">¥${fAmt.toLocaleString()}</div></div><div class="bill-row"><div><span class="badge bpending">集計中</span><div class="bill-label">${c.billY}年${c.billM+1}月${c.billD}日 引き落とし予定</div><div class="bill-label">${fmtMD(c.cs)}〜${fmtMD(c.ce)} の利用分</div></div><div class="bill-amount" style="color:#BA7517">¥${c.amount.toLocaleString()}</div></div><div style="margin-top:10px"><div style="font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:8px">引き落とし実績入力</div>${renderCardBillHistory(ci,card)}</div></div>`;}).join('');}
// カードを削除済みにする（配列から消すと、記録のカードの番号がずれる）。そのカードで払う毎月のお金は、来月から口座からの引き落としにする
export function delCard(i: number): void{const cardId=state.st.cards[i]._id;state.st.cards[i]._deleted=true;save();moveMonthlyOffCard(cardId);renderCardList();renderHome();}
export function openCardEdit(i: number): void{
  cardEditIdx=i;const card=state.st.cards[i];
  const isEom=parseInt(card.closeDay)>=28;
  ui.inputById('ce-name').value=card.name;
  ui.inputById('ce-close-eom').checked=isEom;
  ui.inputById('ce-close').value=isEom?'':card.closeDay;
  ui.inputById('ce-close').disabled=isEom;
  ui.inputById('ce-bill').value=card.billDay;
  ui.elementById('card-edit-mbg').classList.add('open');
}
export function closeCardEdit(): void{ui.elementById('card-edit-mbg').classList.remove('open');}
export function saveCardEdit(): void{
  const name=ui.inputById('ce-name').value.trim();
  const isEom=ui.inputById('ce-close-eom').checked;
  const cl=isEom?'31':ui.inputById('ce-close').value;
  const bill=ui.inputById('ce-bill').value;
  if(!name||!cl||!bill)return;
  state.st.cards[cardEditIdx]={...state.st.cards[cardEditIdx],name,closeDay:cl,billDay:bill};
  save();closeCardEdit();renderCardList();renderHome();
}


/** カードの入力と描画した一覧の操作を登録する。 */
export function bindCardControls(): void {
  for (const id of ['cn-close', 'cn-bill']) ui.inputById(id).addEventListener('input', previewCycle);
  ui.inputById('cn-close-eom').addEventListener('change', () => toggleCardCloseEom('cn'));
  ui.inputById('ce-close-eom').addEventListener('change', () => toggleCardCloseEom('ce'));
  ui.elementById('add-card').addEventListener('click', addCard);
  ui.elementById('card-edit-mbg').addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest<HTMLElement>('[data-card-action]')?.dataset.cardAction;
    if (action === 'close-edit') closeCardEdit();
    else if (action === 'save-edit') saveCardEdit();
  });
  const list = ui.elementById('card-list-sec');
  list.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-card-action]');
    if (!button || button.dataset.index === undefined) return;
    const index = Number(button.dataset.index);
    if (!Number.isInteger(index) || !state.st.cards[index] || state.st.cards[index]._deleted) return;
    if (button.dataset.cardAction === 'edit') openCardEdit(index);
    else if (button.dataset.cardAction === 'delete') delCard(index);
  });
  list.addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.dataset.cardAction !== 'bill-change') return;
    const { index, year, month, estimated } = event.target.dataset;
    if ([index, year, month, estimated].some(value => value === undefined)) return;
    const ci = Number(index), y = Number(year), m = Number(month), amount = Number(estimated);
    if (!Number.isInteger(ci) || !state.st.cards[ci] || state.st.cards[ci]._deleted) return;
    onCardBillChange(ci, y, m, amount, event.target.value);
  });
}

export const LEGACY_CARD_SCREEN = { openCardEdit };
