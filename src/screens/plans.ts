import { renderCal, refreshDayViews } from '../js-bridge.ts';
// 予定の入力画面（D20 の 6）。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday, ds2d } from '../dates.ts';
import { PLAN_COLORS, COLOR_NAMES } from '../palette.ts';
import * as ui from '../ui.ts';
import type { StPlan } from '../compat.ts';

let planEditIdx=-1, planDateMode='single', planColorSel='pink';
export function renderColorSwatches(): void{ui.elementById('plan-color-swatches').innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${planColorSel===c.key?' sel':''}" style="background:${c.dot}" onclick="selPlanColor('${c.key}')" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
export function selPlanColor(key: string): void{planColorSel=key;renderColorSwatches();}
export function setDateMode(mode: string): void{planDateMode=mode;ui.elementById('dmt-single').classList.toggle('active',mode==='single');ui.elementById('dmt-range').classList.toggle('active',mode==='range');ui.elementById('date-single-wrap').style.display=mode==='single'?'block':'none';ui.elementById('date-range-wrap').style.display=mode==='range'?'block':'none';}
export function updateRangePreview(): void{const s=ui.inputById('plan-date-start').value,e=ui.inputById('plan-date-end').value,el=ui.elementById('range-preview');if(!s||!e){el.textContent='';return;}const days=Math.round((ds2d(e).getTime()-ds2d(s).getTime())/(864e5))+1;el.textContent=days>=1?`${days}日間の予定として登録されます`:'終了日は開始日より後にしてください';}
let planCardIdx=-1; // -1=現金、0以上=カードインデックス

export function renderPlanPayChips(): void{
  if(!ui.elementById('plan-pay-chips'))return;
  const opts=['現金',...state.st.cards.map(c=>c.name)];
  ui.elementById('plan-pay-chips').innerHTML=opts.map((o,i)=>i>0&&state.st.cards[i-1]._deleted&&planCardIdx!==i-1?'':`<button type="button" class="pay-chip${(i===0&&planCardIdx===-1)||(i>0&&planCardIdx===i-1)?' sel':''}" onclick="selPlanPay(${i-1})">${o}</button>`).join('');
  const hint=ui.elementById('plan-pay-hint');
  if(hint){
    if(planCardIdx>=0&&state.st.cards[planCardIdx]){
      hint.textContent=`${state.st.cards[planCardIdx].name}払い：カードの集計に加算され、引き落とし日に残高から引かれます`;
    }else{
      hint.textContent='現金・口座払いの場合は予定日に残高から引かれます';
    }
  }
}

export function selPlanPay(ci: number): void{
  planCardIdx=ci;
  renderPlanPayChips();
}

export function setPlanTimeMode(allDay: boolean): void{
  ui.inputById('plan-allday').checked=allDay;
  togglePlanAllDay();
  if(!allDay)setTimeout(()=>ui.elementById('plan-time-start').focus(),0);
}

export function togglePlanAllDay(): void{
  const on=ui.inputById('plan-allday').checked;
  ui.elementById('plan-time-wrap').classList.toggle('is-all-day',on);
  ui.elementById('plan-mode-allday').classList.toggle('active',on);
  ui.elementById('plan-mode-timed').classList.toggle('active',!on);
  ui.elementById('plan-time-hint').textContent=on
    ?'この予定は終日として表示されます。'
    :'開始時刻を入力してください。終了時刻は任意です。';
}

export function openPlanModal(ds?: string): void{
  planEditIdx=-1;planColorSel='pink';planCardIdx=-1;
  ui.elementById('plan-modal-title').textContent='予定を追加';
  ui.inputById('plan-title').value='';
  ui.textareaById('plan-memo').value='';
  ui.inputById('plan-date').value=ds||getToday();
  ui.inputById('plan-date-start').value=ds||getToday();
  ui.inputById('plan-date-end').value=ds||getToday();
  ui.inputById('plan-budget').value='';
  ui.elementById('plan-save-btn').textContent='追加';
  setDateMode('single');
  // 新規予定はデフォルト終日
  ui.inputById('plan-allday').checked=true;
  ui.inputById('plan-time-start').value='';
  ui.inputById('plan-time-end').value='';
  togglePlanAllDay();
  renderColorSwatches();
  renderPlanPayChips();
  ui.elementById('plan-date-start').oninput=updateRangePreview;
  ui.elementById('plan-date-end').oninput=updateRangePreview;
  ui.elementById('plan-mbg').classList.add('open');
}

export function openPlanEdit(idx: number): void{
  planEditIdx=idx;
  const p=state.st.plans[idx];
  planColorSel=p.color||'pink';
  planCardIdx=p.planCardIdx!==undefined?p.planCardIdx:-1;
  ui.elementById('plan-modal-title').textContent='予定を編集';
  ui.inputById('plan-title').value=p.title;
  ui.inputById('plan-date').value=p.date;
  ui.inputById('plan-date-start').value=p.dateStart||p.date;
  ui.inputById('plan-date-end').value=p.dateEnd||p.date;
  ui.inputById('plan-budget').value=String(p.budget||'');
  ui.textareaById('plan-memo').value=p.memo||'';
  ui.elementById('plan-save-btn').textContent='保存';
  const mode=p.dateEnd&&p.dateEnd!==p.date?'range':'single';
  setDateMode(mode);
  ui.inputById('plan-allday').checked=!p.timeStart;
  ui.inputById('plan-time-start').value=p.timeStart||'';
  ui.inputById('plan-time-end').value=p.timeEnd||'';
  togglePlanAllDay();
  renderColorSwatches();
  renderPlanPayChips();
  ui.elementById('plan-date-start').oninput=updateRangePreview;
  ui.elementById('plan-date-end').oninput=updateRangePreview;
  if(mode==='range')updateRangePreview();
  ui.elementById('plan-mbg').classList.add('open');
}

export function closePlanModal(): void{ui.elementById('plan-mbg').classList.remove('open');}

export function savePlan(): void{
  const title=ui.inputById('plan-title').value.trim();
  if(!title)return;
  const budget=parseInt(ui.inputById('plan-budget').value)||0,memo=ui.textareaById('plan-memo').value.trim(),color=planColorSel;
  let dateStart,dateEnd;
  if(planDateMode==='range'){
    dateStart=ui.inputById('plan-date-start').value;
    dateEnd=ui.inputById('plan-date-end').value;
    if(!dateStart||!dateEnd||ds2d(dateEnd)<ds2d(dateStart))return;
  }else{
    dateStart=ui.inputById('plan-date').value;
    if(!dateStart)return;
    dateEnd=dateStart;
  }
  const allDay=ui.inputById('plan-allday').checked;
  let timeStart=allDay?'':(ui.inputById('plan-time-start').value||'');
  let timeEnd=allDay?'':(ui.inputById('plan-time-end').value||'');
  if(!timeStart)timeEnd='';
  // 'HH:MM'は辞書順=時刻順なので単純比較でOK。単日で終了が開始より前なら終了を捨てる
  if(timeStart&&timeEnd&&dateStart===dateEnd&&timeEnd<timeStart)timeEnd='';
  const obj: StPlan={id:planEditIdx>=0?state.st.plans[planEditIdx].id:Date.now(),title,date:dateStart,dateStart,dateEnd,timeStart,timeEnd,budget,memo,color,done:false};
  // カード払いの場合planCardIdxを保存
  if(planCardIdx>=0) obj.planCardIdx=planCardIdx;
  if(planEditIdx>=0){obj.done=state.st.plans[planEditIdx].done;obj._id=state.st.plans[planEditIdx]._id;state.st.plans[planEditIdx]=obj;}
  else state.st.plans.push(obj);
  save();closePlanModal();renderCal();refreshDayViews();renderHome();
}


export const LEGACY_PLAN_SCREEN = { renderColorSwatches, selPlanColor, setDateMode, updateRangePreview, renderPlanPayChips, selPlanPay, setPlanTimeMode, togglePlanAllDay, openPlanModal, openPlanEdit, closePlanModal, savePlan };
