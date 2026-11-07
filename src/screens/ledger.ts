// 家計簿の入力・一覧・グラフ（D20 の 7）。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday, getNow, gY, gM, addM, ds2d, DAYS } from '../dates.ts';
import { followMonth } from '../clock.ts';
import { CAT_COL, DOTC } from '../palette.ts';
import * as ui from '../ui.ts';
import { renderCurrentSection } from '../navigation.ts';
import { renderCal, refreshDayViews } from './calendar.ts';
import { monthLedger, ledgerPayLabel } from '../ledger.ts';
import { renderCardList } from './cards.ts';
import { bindAnalysis } from './analysis.tsx';
import { renderMonthlyTab, saveMonthlyFromLedger } from './monthly.ts';
import type { StLedger } from '../compat.ts';

let ldgListY=getNow().getFullYear(), ldgListM=getNow().getMonth(), ldgGraphMode='month';
let ldgType='expense', ldgPay='現金', ldgCardIdx=-1, ldgCat='', ldgReceive='現金';
let ldeType='expense', ldePay='現金', ldeCardIdx=-1, ldeCat='', ldeIdx=-1, ldeReceive='現金';
let catChart: { destroy(): void } | null = null, dayChart: { destroy(): void } | null = null;
export function onLedgerDayChanged(prev: Date, now: Date): void {
  ({y:ldgListY,m:ldgListM}=followMonth({y:ldgListY,m:ldgListM},prev,now));
}
const yenSigned = (v: number): string => (v<0?'-':'')+'¥'+Math.abs(v).toLocaleString();
export function openLedgerModal(ds?: string, opts: { repeat?: boolean } = {}): void{ldgType='expense';ldgPay='現金';ldgCardIdx=-1;ldgCat=state.st.catExp[0]||'';ldgReceive='現金';ui.inputById('ldg-date').value=ds||getToday();ui.inputById('ldg-amount').value='';ui.inputById('ldg-name').value='';ui.textareaById('ldg-memo').value='';ui.inputById('ldg-repeat').checked=!!opts.repeat;renderLdgType();renderCatChips();renderPayChips();renderLdgRepeat();ui.elementById('ldg-mbg').classList.add('open');setTimeout(()=>ui.elementById('ldg-amount')?.focus(),80);}
export function selLdgType(t: string): void{ldgType=t;ldgCat=(t==='expense'?state.st.catExp[0]:state.st.catInc[0])||'';renderLdgType();renderCatChips();renderPayChips();renderLdgRepeat();}
export function renderLdgType(): void{document.querySelectorAll('#ldg-type-chips .pay-chip').forEach((el,i)=>el.classList.toggle('sel',['expense','income'][i]===ldgType));}
export function renderCatChips(): void{const cats=ldgType==='expense'?state.st.catExp:state.st.catInc;if(!cats.includes(ldgCat))ldgCat=cats[0]||'';ui.elementById('cat-chips').innerHTML=cats.map(c=>`<button type="button" class="chip${ldgCat===c?' sel':''}" data-ledger-action="select-cat" data-value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`).join('');}
export function selCat(c: string): void{ldgCat=c;document.querySelectorAll('#cat-chips .chip').forEach(el=>el.classList.toggle('sel',el.textContent===c));}
// 支払い方法の選択肢: 現金・口座（D11）・カード。削除済みのカードは、その記録が使っているときだけ出す
type PayOption = { label: string; pay: string; ci: number; hidden?: boolean };
export function payOptions(curCardIdx: number): PayOption[]{const opts: PayOption[]=[{label:'現金',pay:'現金',ci:-1},{label:'口座',pay:'口座',ci:-1},...state.st.cards.map((c,i)=>({label:c.name,pay:c.name,ci:i,hidden:c._deleted&&curCardIdx!==i}))];return opts.filter(o=>!o.hidden);}
const isPaySel=(o: PayOption,pay: string,ci: number): boolean=>o.ci>=0?ci===o.ci:(ci<0&&(pay==='口座')===(o.pay==='口座'));
const payHint=(pay: string,ci: number): string=>ci>=0?'カードの引き落とし日に、口座から引きます':pay==='口座'?'振込・口座引き落としなど。その日に口座の残高から引きます':'現金は、ATM で引き出したときに口座から引いています';
export function payChipsHtml(pay: string, ci: number, mode: 'add' | 'edit'): string{return payOptions(ci).map((o,k)=>`<button type="button" class="pay-chip${isPaySel(o,pay,ci)?' sel':''}" data-ledger-action="${mode==='add'?'select-pay':'select-edit-pay'}" data-index="${k}">${ui.escapeHtml(o.label)}</button>`).join('');}
export function renderPayChips(): void{
  const pw=ui.elementById('ldg-pay-wrap');
  const rw=ui.elementById('ldg-receive-wrap');
  if(ldgType==='income'){
    pw.style.display='none';
    rw.style.display=ui.inputById('ldg-repeat').checked?'none':'block'; // 毎月の収入は口座に入るものとして数える（D14）
    // 受取方法：現金 or 口座振込
    ui.elementById('ldg-receive-chips').innerHTML=
      ['現金','口座振込'].map(o=>`<button type="button" class="pay-chip${ldgReceive===o?' sel':''}" data-ledger-action="select-receive" data-value="${o}">${o}</button>`).join('');
    ui.elementById('ldg-receive-hint').textContent=
      ldgReceive==='口座振込'?'口座振込は口座残高にプラスされます':'現金受取は口座残高に影響しません';
    return;
  }
  rw.style.display='none';
  pw.style.display='block';
  ui.elementById('ldg-pay-chips').innerHTML=payChipsHtml(ldgPay,ldgCardIdx,'add');
  ui.elementById('ldg-pay-hint').textContent=payHint(ldgPay,ldgCardIdx);
}
export function selReceive(r: string): void{ldgReceive=r;renderPayChips();}
export function selPayAt(k: number): void{const o=payOptions(ldgCardIdx)[k];if(!o)return;ldgPay=o.pay;ldgCardIdx=o.ci;renderPayChips();}
// 「毎月くり返す」（D14）: 選ぶと、その日を毎月の日にして、その月から数える。カテゴリと備考は残らないので隠す。
// 毎月の収入は、口座に入るものとして数える（受取方法を隠す）
export function renderLdgRepeat(): void{
  const on=ui.inputById('ldg-repeat').checked,date=ui.inputById('ldg-date').value||getToday(),dt=ds2d(date);
  const hint=ui.elementById('ldg-repeat-hint');
  hint.hidden=!on;
  hint.textContent=on?`毎月${dt.getDate()}日に数えます（${dt.getFullYear()}年${dt.getMonth()+1}月から）。家計簿の記録には1件ずつは出ず、「毎月のお金」に入ります${ldgType==='income'?'。毎月の収入は、口座に入るものとして数えます':''}`:'';
  ui.elementById('ldg-cat-wrap').hidden=on;
  ui.elementById('ldg-memo-wrap').hidden=on;
  renderPayChips(); // 毎月の収入は受取方法を出さない
  ui.inputById('ldg-name').placeholder=on?(ldgType==='income'?'仕送り、奨学金など':'家賃、動画のサブスクなど'):'ランチ、交通費など';
  ui.elementById('ldg-name-err').hidden=true;
}
export function saveLedger(): void{const date=ui.inputById('ldg-date').value,amount=ui.inputById('ldg-amount').value,name=ui.inputById('ldg-name').value.trim(),memo=ui.textareaById('ldg-memo').value.trim();if(!date||!amount)return;
  if(ui.inputById('ldg-repeat').checked){
    if(!name){ui.elementById('ldg-name-err').hidden=false;ui.elementById('ldg-name').focus();return;}
    const card=ldgType==='expense'&&ldgCardIdx>=0?state.st.cards[ldgCardIdx]:null;
    const ok=saveMonthlyFromLedger({name,amount:parseInt(amount),dateKey:date,kind:ldgType,payment_method:card?'card':ldgPay==='口座'?'bank':'cash',card_id:card?card._id??null:null});
    if(!ok)return;
    closeLdgModal();renderCurrentSection();return;
  }
  const entry: StLedger={date,amount:parseInt(amount),name:name||ldgCat,cat:ldgCat,type:ldgType,pay:ldgPay,memo};if(ldgType==='expense'&&ldgCardIdx>=0)entry.cardIdx=ldgCardIdx;if(ldgType==='income')entry.receive=ldgReceive;state.st.ledger.push(entry);save();closeLdgModal();renderLedger();renderLedgerMetrics();renderCal();renderHome();renderCardList();}
export function closeLdgModal(): void{ui.elementById('ldg-mbg').classList.remove('open');}
export function openLdgEdit(i: number): void{ldeIdx=i;const l=state.st.ledger[i];ldeType=l.type;ldeCat=l.cat;ldePay=l.pay||'現金';ldeCardIdx=l.cardIdx!==undefined?l.cardIdx:-1;ldeReceive=l.receive||'現金';ui.inputById('lde-date').value=l.date;ui.inputById('lde-amount').value=String(l.amount);ui.inputById('lde-name').value=l.name;ui.textareaById('lde-memo').value=l.memo||'';renderLdeType();renderLdeCatChips();renderLdePayChips();ui.elementById('ldg-edit-mbg').classList.add('open');}
export function closeLdgEdit(): void{ui.elementById('ldg-edit-mbg').classList.remove('open');}
export function selLdeType(t: string): void{ldeType=t;renderLdeType();renderLdeCatChips();renderLdePayChips();}
export function renderLdeType(): void{document.querySelectorAll('#lde-type-chips .pay-chip').forEach((el,i)=>el.classList.toggle('sel',['expense','income'][i]===ldeType));}
export function renderLdeCatChips(): void{const cats=ldeType==='expense'?state.st.catExp:state.st.catInc;if(!cats.includes(ldeCat))ldeCat=cats[0]||'';ui.elementById('lde-cat-chips').innerHTML=cats.map(c=>`<button type="button" class="chip${ldeCat===c?' sel':''}" data-ledger-action="select-edit-cat" data-value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`).join('');}
export function selLdeCat(c: string): void{ldeCat=c;document.querySelectorAll('#lde-cat-chips .chip').forEach(el=>el.classList.toggle('sel',el.textContent===c));}
export function renderLdePayChips(): void{
  const pw=ui.elementById('lde-pay-wrap');
  const rw=ui.elementById('lde-receive-wrap');
  if(ldeType==='income'){
    pw.style.display='none';
    rw.style.display='block';
    ui.elementById('lde-receive-chips').innerHTML=
      ['現金','口座振込'].map(o=>`<button type="button" class="pay-chip${ldeReceive===o?' sel':''}" data-ledger-action="select-edit-receive" data-value="${o}">${o}</button>`).join('');
    ui.elementById('lde-receive-hint').textContent=
      ldeReceive==='口座振込'?'口座振込は口座残高にプラスされます':'現金受取は口座残高に影響しません';
    return;
  }
  rw.style.display='none';
  pw.style.display='block';
  ui.elementById('lde-pay-chips').innerHTML=payChipsHtml(ldePay,ldeCardIdx,'edit');
  ui.elementById('lde-pay-hint').textContent=payHint(ldePay,ldeCardIdx);
}
export function selLdeReceive(r: string): void{ldeReceive=r;renderLdePayChips();}
export function selLdePayAt(k: number): void{const o=payOptions(ldeCardIdx)[k];if(!o)return;ldePay=o.pay;ldeCardIdx=o.ci;renderLdePayChips();}
export function saveLdgEdit(): void{
  const date=ui.inputById('lde-date').value,amount=ui.inputById('lde-amount').value,name=ui.inputById('lde-name').value.trim(),memo=ui.textareaById('lde-memo').value.trim();
  if(!date||!amount)return;
  const original=state.st.ledger[ldeIdx];
  const entry: StLedger={date,amount:parseInt(amount),name:name||ldeCat,cat:ldeCat,type:ldeType,pay:ldePay,memo};
  if(ldeType==='expense'&&ldeCardIdx>=0)entry.cardIdx=ldeCardIdx;
  if(ldeType==='income')entry.receive=ldeReceive;
  // 元の記録の ID を引き継ぐ（同じ行の更新にする）
  if(original&&original._id)entry._id=original._id;
  state.st.ledger[ldeIdx]=entry;
  save();closeLdgEdit();renderLedger();renderLedgerMetrics();renderCal();renderHome();renderCardList();
}
export function ldgTab(t: string): void{document.querySelectorAll('#ldg-main-tabs .tb2').forEach((el,i)=>{const selected=['list','graph','monthly'][i]===t;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});ui.elementById('ldg-list-sec').style.display=t==='list'?'block':'none';ui.elementById('ldg-graph-sec').style.display=t==='graph'?'block':'none';ui.elementById('ldg-monthly-sec').style.display=t==='monthly'?'block':'none';updateLdgNav_();if(t==='graph')renderCharts();if(t==='monthly')renderMonthlyTab();}

// ============================================================
// 家計簿の対象年月ナビゲーション（記録一覧・グラフで共有）
// ============================================================
export function updateLdgNav_(): void{
  ui.elementById('ldg-month-label').textContent=`${ldgListY}年${ldgListM+1}月`;
  const yEl=ui.elementById('ldg-year-label');
  if(yEl)yEl.textContent=`${ldgListY}年`;
  const graphVisible=ui.elementById('ldg-graph-sec').style.display!=='none';
  const showYearNav=graphVisible&&ldgGraphMode==='year';
  const monthlyVisible=ui.elementById('ldg-monthly-sec').style.display!=='none'; // 毎月のお金は月送りを使わない
  ui.elementById('ldg-month-nav').style.display=monthlyVisible||showYearNav?'none':'flex';
  ui.elementById('ldg-year-nav').style.display=!monthlyVisible&&showYearNav?'flex':'none';
}
export function ldgMonthPrev(): void{const nm=addM(ldgListY,ldgListM,-1);ldgListY=nm.y;ldgListM=nm.m;renderLedgerAll_();}
export function ldgMonthNext(): void{const nm=addM(ldgListY,ldgListM,1);ldgListY=nm.y;ldgListM=nm.m;renderLedgerAll_();}
export function ldgYearPrev(): void{ldgListY--;renderLedgerAll_();}
export function ldgYearNext(): void{ldgListY++;renderLedgerAll_();}
export function setLdgGraphMode(mode: string): void{
  ldgGraphMode=mode;
  document.querySelectorAll('#ldg-graph-mode-tabs .tb2').forEach((el,i)=>{const selected=['month','year'][i]===mode;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});
  updateLdgNav_();
  renderCharts();
}
export function renderLedgerAll_(): void{
  updateLdgNav_();
  renderLedger();
  renderLedgerMetrics();
  if(ui.elementById('ldg-graph-sec').style.display!=='none')renderCharts();
}

export function renderLedgerMetrics(): void{const ml=monthLedger(ldgListY,ldgListM);const exp=ml.filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(String(l.amount)),0);const inc=ml.filter(l=>l.type==='income').reduce((a,l)=>a+parseInt(String(l.amount)),0);ui.elementById('ldg-exp').textContent='¥'+exp.toLocaleString();ui.elementById('ldg-inc').textContent='¥'+inc.toLocaleString();const bal=inc-exp;const bEl=ui.elementById('ldg-bal');bEl.textContent=(bal>0?'+':'')+yenSigned(bal);bEl.style.color=bal>=0?'#3B6D11':'#A32D2D';}
export function renderLedger(): void{
  const ml=monthLedger(ldgListY,ldgListM).sort((a,b)=>b.date.localeCompare(a.date));
  const el=ui.elementById('ldg-list');
  if(!ml.length){el.innerHTML='<div class="card"><div class="empty">この月の記録なし</div></div>';return;}

  // 日付ごとにグループ化
  const groups: Record<string, StLedger[]>={};
  ml.forEach(l=>{
    if(!groups[l.date])groups[l.date]=[];
    groups[l.date].push(l);
  });

  const html=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(date=>{
    const items=groups[date];
    const d=ds2d(date);
    const dateStr=`${d.getMonth()+1}/${d.getDate()}(${DAYS[d.getDay()]})`;
    const dayExp=items.filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(String(l.amount)),0);
    const dayInc=items.filter(l=>l.type==='income').reduce((a,l)=>a+parseInt(String(l.amount)),0);
    const dayNet=dayInc-dayExp;

    // サマリー（件数）
    const summary=`${items.length}件`;

    // 合計表示
    let totalHtml='';
    if(dayExp>0&&dayInc>0){
      totalHtml=`<span style="color:#A32D2D">-¥${dayExp.toLocaleString()}</span><span style="color:var(--color-text-secondary);margin:0 3px">/</span><span style="color:#3B6D11">+¥${dayInc.toLocaleString()}</span>`;
    }else if(dayExp>0){
      totalHtml=`<span style="color:#A32D2D">-¥${dayExp.toLocaleString()}</span>`;
    }else{
      totalHtml=`<span style="color:#3B6D11">+¥${dayInc.toLocaleString()}</span>`;
    }

    // 詳細アイテム
    const detailItems=items.map(l=>{
      const ri=state.st.ledger.indexOf(l);
      return `<div class="ri">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge ${l.type==='expense'?'bexp':'binc'}">${ui.escapeHtml(l.cat)}</span>
          <div>
            <div style="font-size:14px">${ui.escapeHtml(l.name)}</div>
            <div style="font-size:12px;color:var(--color-text-secondary)">${ui.escapeHtml(ledgerPayLabel(l))}${l.memo?' · '+ui.escapeHtml(l.memo):''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:14px;font-weight:600;color:${l.type==='expense'?'#A32D2D':'#3B6D11'}">${l.type==='expense'?'-':'+'}¥${parseInt(String(l.amount)).toLocaleString()}</span>
          <button class="btn sm edit" data-ledger-action="list-edit" data-index="${ri}">編集</button>
          <button class="btn sm del" data-ledger-action="list-delete" data-index="${ri}">削除</button>
        </div>
      </div>`;
    }).join('');

    const groupId=`ldg-group-${date}`;
    return `<div class="ldg-day-group">
      <div class="ldg-day-header" id="${groupId}-header" role="button" tabindex="0" aria-expanded="false" aria-controls="${groupId}" data-ledger-action="toggle-group" data-group-id="${groupId}">
        <div class="ldg-day-header-left">
          <span class="ldg-day-date">${dateStr}</span>
          <span class="ldg-day-summary">${summary}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="ldg-day-total">${totalHtml}</div>
          <span class="ldg-day-arrow" id="${groupId}-arrow" aria-hidden="true">▼</span>
        </div>
      </div>
      <div class="ldg-day-detail" id="${groupId}" role="region" aria-labelledby="${groupId}-header">${detailItems}</div>
    </div>`;
  }).join('');

  el.innerHTML=html;
}

export function toggleLdgGroup(id: string): void{
  const detail=ui.elementById(id);
  const arrow=ui.elementById(id+'-arrow');
  const header=ui.elementById(id+'-header');
  const isOpen=detail.classList.contains('open');
  detail.classList.toggle('open',!isOpen);
  arrow.classList.toggle('open',!isOpen);
  header.setAttribute('aria-expanded',String(!isOpen));
}
export function delLedger(i: number): void{state.st.ledger.splice(i,1);save();renderLedger();renderLedgerMetrics();renderCal();refreshDayViews();renderHome();renderCardList();}
export function renderCatChart_(ml: StLedger[]): void{
  const catMap: Record<string, number>={};ml.forEach(l=>{catMap[l.cat]=(catMap[l.cat]||0)+parseInt(String(l.amount));});
  const catLabels=Object.keys(catMap),catData=Object.values(catMap),catColors=catLabels.map((c,i)=>CAT_COL[c]||DOTC[i%DOTC.length]);
  if(catChart)catChart.destroy();
  catChart=new Chart((ui.elementById('cat-chart') as HTMLCanvasElement).getContext('2d'),{type:'doughnut',data:{labels:catLabels,datasets:[{data:catData,backgroundColor:catColors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:10,padding:8}}}}});
}
export function renderChartsMonth_(): void{
  ui.elementById('cat-chart-title').textContent='カテゴリ別支出';
  ui.elementById('day-chart-title').textContent='日別支出推移';
  const ml=monthLedger(ldgListY,ldgListM).filter(l=>l.type==='expense');
  renderCatChart_(ml);
  const dim=new Date(ldgListY,ldgListM+1,0).getDate(),dayMap: Record<number, number>={};
  for(let d=1;d<=dim;d++)dayMap[d]=0;
  ml.forEach(l=>{const d=ds2d(l.date).getDate();dayMap[d]=(dayMap[d]||0)+parseInt(String(l.amount));});
  if(dayChart)dayChart.destroy();
  dayChart=new Chart((ui.elementById('day-chart') as HTMLCanvasElement).getContext('2d'),{type:'bar',data:{labels:Object.keys(dayMap).map(d=>d+'日'),datasets:[{data:Object.values(dayMap),backgroundColor:'#185FA590',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:15}},y:{ticks:{callback:(v: number)=>'¥'+v.toLocaleString(),font:{size:10}}}}}});
}
export function renderChartsYear_(): void{
  ui.elementById('cat-chart-title').textContent='カテゴリ別支出（年間）';
  ui.elementById('day-chart-title').textContent='月別支出推移';
  const yl=state.st.ledger.filter(l=>l.type==='expense'&&ds2d(l.date).getFullYear()===ldgListY);
  renderCatChart_(yl);
  const monthMap: Record<number, number>={};for(let m=0;m<12;m++)monthMap[m]=0;
  yl.forEach(l=>{const m=ds2d(l.date).getMonth();monthMap[m]=(monthMap[m]||0)+parseInt(String(l.amount));});
  if(dayChart)dayChart.destroy();
  dayChart=new Chart((ui.elementById('day-chart') as HTMLCanvasElement).getContext('2d'),{type:'bar',data:{labels:Object.keys(monthMap).map(m=>(parseInt(m)+1)+'月'),datasets:[{data:Object.values(monthMap),backgroundColor:'#185FA590',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10}}},y:{ticks:{callback:(v: number)=>'¥'+v.toLocaleString(),font:{size:10}}}}}});
}
export function renderCharts(): void{ldgGraphMode==='year'?renderChartsYear_():renderChartsMonth_();}


/** 家計簿上部の固定タブと期間ボタンを登録する。 */
export function bindLedgerControls(): void {
  bindAnalysis(); // 分析の中の React の画面（D28）
  document.querySelectorAll<HTMLButtonElement>('#ldg-main-tabs button').forEach((button, i) => {
    button.addEventListener('click', () => ldgTab(['list', 'graph', 'monthly'][i]));
  });
  document.querySelectorAll<HTMLButtonElement>('#ldg-graph-mode-tabs button').forEach((button, i) => {
    button.addEventListener('click', () => setLdgGraphMode(i === 0 ? 'month' : 'year'));
  });
  for (const [id, previous, next] of [
    ['ldg-month-nav', ldgMonthPrev, ldgMonthNext],
    ['ldg-year-nav', ldgYearPrev, ldgYearNext],
  ] as const) {
    document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((button, i) => {
      button.addEventListener('click', i === 0 ? previous : next);
    });
  }
  for (const id of ['sec-ledger', 'ldg-mbg', 'ldg-edit-mbg']) {
    ui.elementById(id).addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('[data-ledger-action]');
      if (!target) return;
      const action = target.dataset.ledgerAction;
      const value = target.dataset.value;
      const index = Number(target.dataset.index);
      if (action === 'open-add') openLedgerModal();
      else if (action === 'open-monthly-add') openLedgerModal(undefined, { repeat: true });
      else if (action === 'type-expense') selLdgType('expense');
      else if (action === 'type-income') selLdgType('income');
      else if (action === 'edit-type-expense') selLdeType('expense');
      else if (action === 'edit-type-income') selLdeType('income');
      else if (action === 'close-add') closeLdgModal();
      else if (action === 'save-add') saveLedger();
      else if (action === 'close-edit') closeLdgEdit();
      else if (action === 'save-edit') saveLdgEdit();
      else if (action === 'select-cat' && value !== undefined) selCat(value);
      else if (action === 'select-edit-cat' && value !== undefined) selLdeCat(value);
      else if (action === 'select-receive' && value !== undefined) selReceive(value);
      else if (action === 'select-edit-receive' && value !== undefined) selLdeReceive(value);
      else if (action === 'select-pay' && Number.isInteger(index)) selPayAt(index);
      else if (action === 'select-edit-pay' && Number.isInteger(index)) selLdePayAt(index);
      else if (action === 'list-edit' && Number.isInteger(index)) openLdgEdit(index);
      else if (action === 'list-delete' && Number.isInteger(index)) delLedger(index);
      else if (action === 'toggle-group' && target.dataset.groupId) toggleLdgGroup(target.dataset.groupId);
    });
  }
  ui.elementById('ldg-list').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target instanceof HTMLElement) || !event.target.matches('.ldg-day-header[data-group-id]')) return;
    event.preventDefault();
    if (event.target.dataset.groupId) toggleLdgGroup(event.target.dataset.groupId);
  });
  for (const id of ['ldg-date', 'ldg-repeat']) {
    ui.inputById(id).addEventListener('change', renderLdgRepeat);
  }
}

export const LEGACY_LEDGER_SCREEN = { openLedgerModal, openLdgEdit };

