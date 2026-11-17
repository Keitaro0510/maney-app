// 予定の入力画面（D20 の 6）。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday, ds2d, toDS, DAYS } from '../dates.ts';
import { budgetsForDays } from '../plans.ts';
import { PLAN_COLORS, COLOR_NAMES } from '../palette.ts';
import * as ui from '../ui.ts';
import { renderCal, refreshDayViews } from './calendar.ts';
import type { StPlan } from '../compat.ts';

type PlanDateMode='multi'|'single'|'range'; // multi=新しい予定（日付を複数選ぶ）、single・range=編集のとき（1日・前からある連続の予定）
let planEditIdx=-1, planDateMode: PlanDateMode='multi', planColorSel='pink';
const selPlanDays=new Set<string>();
let planCalY=0, planCalM=0;
export function renderColorSwatches(): void{ui.elementById('plan-color-swatches').innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${planColorSel===c.key?' sel':''}" style="background:${c.dot}" data-plan-action="color" data-color="${c.key}" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
export function selPlanColor(key: string): void{planColorSel=key;renderColorSwatches();}
export function setDateMode(mode: PlanDateMode): void{planDateMode=mode;ui.elementById('date-multi-wrap').style.display=mode==='multi'?'block':'none';ui.elementById('date-single-wrap').style.display=mode==='single'?'block':'none';ui.elementById('date-range-wrap').style.display=mode==='range'?'block':'none';}

// 日付を複数選ぶカレンダー（新しい予定。シフトと同じ作り）
export function renderPlanCal(): void{
  ui.elementById('plan-cal-lbl').textContent=planCalY+'年'+(planCalM+1)+'月';
  const first=new Date(planCalY,planCalM,1).getDay(),dim=new Date(planCalY,planCalM+1,0).getDate(),prev=new Date(planCalY,planCalM,0).getDate();
  const total=Math.ceil((first+dim)/7)*7;let html='';
  for(let i=0;i<total;i++){
    let day,y2=planCalY,m2=planCalM,other=false;
    if(i<first){day=prev-first+i+1;m2=planCalM-1;if(m2<0){m2=11;y2--;}other=true;}
    else if(i>=first+dim){day=i-first-dim+1;m2=planCalM+1;if(m2>11){m2=0;y2++;}other=true;}
    else day=i-first+1;
    const ds=toDS(y2,m2,day);
    html+=`<button type="button" class="chk-day${other?' off':''}${selPlanDays.has(ds)?' sel':''}" aria-label="${m2+1}月${day}日" aria-pressed="${selPlanDays.has(ds)}" data-plan-action="day" data-date="${ds}" data-other="${other}">${day}</button>`;
  }
  ui.elementById('plan-cal-grid').innerHTML=html;
  updatePlanMultiHint();
}
export function updatePlanMultiHint(): void{
  ui.elementById('plan-sel-count').textContent=selPlanDays.size+'日';
  const hint=ui.elementById('plan-multi-hint');
  const budget=parseInt(ui.inputById('plan-budget').value)||0;
  const first=[...selPlanDays].sort()[0];
  hint.hidden=!(selPlanDays.size>1);
  hint.textContent=selPlanDays.size>1?`選んだ日ごとに、1日の予定ができます${budget>0?`（予算は最初の日 ${first.slice(5).replace('-','/')} だけに入ります）`:''}`:'';
}
export function togglePlanDay(ds: string, other: boolean): void{if(other)return;if(selPlanDays.has(ds))selPlanDays.delete(ds);else selPlanDays.add(ds);renderPlanCal();}
export function planCalShift(dir: number): void{planCalM+=dir;if(planCalM<0){planCalM=11;planCalY--;}else if(planCalM>11){planCalM=0;planCalY++;}renderPlanCal();}
export function updateRangePreview(): void{const s=ui.inputById('plan-date-start').value,e=ui.inputById('plan-date-end').value,el=ui.elementById('range-preview');if(!s||!e){el.textContent='';return;}const days=Math.round((ds2d(e).getTime()-ds2d(s).getTime())/(864e5))+1;el.textContent=days>=1?`${days}日間の予定として登録されます`:'終了日は開始日より後にしてください';}
let planCardIdx=-1; // -1=現金、0以上=カードインデックス

export function renderPlanPayChips(): void{
  if(!ui.elementById('plan-pay-chips'))return;
  const opts=['現金',...state.st.cards.map(c=>c.name)];
  ui.elementById('plan-pay-chips').innerHTML=opts.map((o,i)=>i>0&&state.st.cards[i-1]._deleted&&planCardIdx!==i-1?'':`<button type="button" class="pay-chip${(i===0&&planCardIdx===-1)||(i>0&&planCardIdx===i-1)?' sel':''}" data-plan-action="pay" data-index="${i-1}">${ui.escapeHtml(o)}</button>`).join('');
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
  // 日付は複数選べる（日の詳細から開いたときは、その日を選んだ状態で）
  selPlanDays.clear();selPlanDays.add(ds||getToday());
  const base=ds2d(ds||getToday());planCalY=base.getFullYear();planCalM=base.getMonth();
  ui.elementById('plan-cal-dow').innerHTML=DAYS.map(d=>`<div style="font-size:11px;color:var(--color-text-secondary);text-align:center;font-weight:500">${d}</div>`).join('');
  setDateMode('multi');renderPlanCal();
  // 新規予定はデフォルト終日
  ui.inputById('plan-allday').checked=true;
  ui.inputById('plan-time-start').value='';
  ui.inputById('plan-time-end').value='';
  togglePlanAllDay();
  renderColorSwatches();
  renderPlanPayChips();
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
  if(mode==='range')updateRangePreview();
  ui.elementById('plan-mbg').classList.add('open');
}

export function closePlanModal(): void{ui.elementById('plan-mbg').classList.remove('open');}

export function savePlan(): void{
  const title=ui.inputById('plan-title').value.trim();
  if(!title)return;
  const budget=parseInt(ui.inputById('plan-budget').value)||0,memo=ui.textareaById('plan-memo').value.trim(),color=planColorSel;
  let dateStart,dateEnd;
  if(planDateMode==='multi'){
    // 新しい予定: 選んだ日ごとに、1日の予定を作る（予算は最初の日だけ。D40）
    if(!selPlanDays.size)return;
    const allDayM=ui.inputById('plan-allday').checked;
    const tsM=allDayM?'':(ui.inputById('plan-time-start').value||'');
    let teM=allDayM?'':(ui.inputById('plan-time-end').value||'');
    if(!tsM||(teM&&teM<tsM))teM=''; // 開始がない・終了が開始より前なら、終了は捨てる（1日の予定なので）
    const base=Date.now();
    budgetsForDays(selPlanDays,budget).forEach((e,i)=>{
      const p: StPlan={id:base+i,title,date:e.date,dateStart:e.date,dateEnd:e.date,timeStart:tsM,timeEnd:teM,budget:e.budget,memo,color,done:false};
      if(planCardIdx>=0)p.planCardIdx=planCardIdx;
      state.st.plans.push(p);
    });
    save();closePlanModal();renderCal();refreshDayViews();renderHome();
    return;
  }
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


/** 予定の入力画面を起動時に一度だけ登録する。 */
export function bindPlanControls(): void {
  ui.elementById('plan-mbg').addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-plan-action]');
    if (!target) return;
    const action = target.dataset.planAction;
    if (action === 'day' && target.dataset.date) togglePlanDay(target.dataset.date, target.dataset.other === 'true');
    else if (action === 'cal-prev') planCalShift(-1);
    else if (action === 'cal-next') planCalShift(1);
    else if (action === 'all-day') setPlanTimeMode(true);
    else if (action === 'timed') setPlanTimeMode(false);
    else if (action === 'close') closePlanModal();
    else if (action === 'save') savePlan();
    else if (action === 'color' && target.dataset.color) selPlanColor(target.dataset.color);
    else if (action === 'pay' && target.dataset.index !== undefined) selPlanPay(Number(target.dataset.index));
  });
  ui.inputById('plan-allday').addEventListener('change', togglePlanAllDay);
  ui.inputById('plan-budget').addEventListener('input', updatePlanMultiHint);
  for (const id of ['plan-date-start', 'plan-date-end']) ui.inputById(id).addEventListener('input', updateRangePreview);
}

export const LEGACY_PLAN_SCREEN = { openPlanModal };
