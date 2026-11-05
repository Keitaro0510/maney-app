// シフト・バイト先・給与実績の画面（D20 の 5）。
import { renderHome } from './home.ts';
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { gY, gM, gD, getNow, addM, ds2d, toDS, DAYS, monthDay, monthDate, calcH } from '../dates.ts';
import { endsAfterStart, followMonth } from '../clock.ts';
import { PLAN_COLORS, COLOR_NAMES, jobColorObj, jobColorByName } from '../palette.ts';
import * as ui from '../ui.ts';
import { renderCal } from './calendar.ts';
import { monthShifts, jobPayDay, jobCloseDayNum, salaryKeyForShiftMonth, getActualSalary, calcShiftInc, totalShiftIncNoTransport, totalShiftIncNoTransportForJob } from '../shifts.ts';
import type { StShiftActual } from '../compat.ts';

let shiftCalY=getNow().getFullYear(), shiftCalM=getNow().getMonth();
let shiftListY=getNow().getFullYear(), shiftListM=getNow().getMonth();
let selShiftDays=new Set<string>();
export function onShiftDayChanged(prev: Date, now: Date): void {
  ({y:shiftCalY,m:shiftCalM}=followMonth({y:shiftCalY,m:shiftCalM},prev,now));
  ({y:shiftListY,m:shiftListM}=followMonth({y:shiftListY,m:shiftListM},prev,now));
}
export function openShiftModal(ds?: string): void{ui.elementById('m-job').innerHTML=!state.st.jobs.some(j=>!j._deleted)?'<option value="">先にバイト先を登録</option>':state.st.jobs.filter(j=>!j._deleted).map(j=>`<option value="${ui.escapeHtml(j.name)}">${ui.escapeHtml(j.name)}</option>`).join('');selShiftDays.clear();if(ds){selShiftDays.add(ds);shiftCalY=ds2d(ds).getFullYear();shiftCalM=ds2d(ds).getMonth();}else{shiftCalY=shiftListY;shiftCalM=shiftListM;}ui.inputById('m-start').value='09:00';ui.inputById('m-end').value='17:00';ui.inputById('m-rest').value='0';renderRestChips();ui.elementById('shift-cal-dow').innerHTML=DAYS.map(d=>`<div style="font-size:11px;color:var(--color-text-secondary);text-align:center;font-weight:500">${d}</div>`).join('');updateShiftPreview();renderShiftCal();ui.elementById('shift-mbg').classList.add('open');}
export function renderRestChips(): void{const el=ui.elementById('m-rest-chips');if(!el)return;const cur=parseInt(ui.inputById('m-rest').value)||0;const opts=[0,45,60,90];el.innerHTML=opts.map(v=>`<button type="button" class="pay-chip${cur===v?' sel':''}" data-shift-action="rest" data-minutes="${v}">${v===0?'なし':v+'分'}</button>`).join('');}
export function setRestMin(v: number): void{ui.inputById('m-rest').value=String(v);renderRestChips();updateShiftPreview();}
// 退勤が出勤より後かを確かめ、違えば入力画面に知らせを出す。日をまたぐシフトは登録しない（給料を計算できないため）
export function checkShiftTime(): boolean{const start=ui.inputById('m-start').value,end=ui.inputById('m-end').value;const ok=!start||!end||endsAfterStart(start,end);ui.elementById('m-time-err').hidden=ok;ui.elementById('m-end').setAttribute('aria-invalid',String(!ok));return ok;}
export function updateShiftPreview(): void{checkShiftTime();const jobName=ui.selectById('m-job').value,job=state.st.jobs.find(j=>j.name===jobName),start=ui.inputById('m-start').value,end=ui.inputById('m-end').value,rest=parseInt(ui.inputById('m-rest').value)||0;if(!job||!start||!end){['m-prev','m-transport','m-prev-total','m-total-all'].forEach(id=>ui.elementById(id).textContent='¥0');ui.elementById('m-night').textContent='0h';ui.elementById('m-rest-lbl').textContent=rest+'分';return;}const r=calcShiftInc({job:jobName,start,end,rest});ui.elementById('m-prev').textContent='¥'+(r.wage+r.nightWage).toLocaleString();ui.elementById('m-night').textContent=r.nightH.toFixed(1)+'h';ui.elementById('m-rest-lbl').textContent=r.restMin+'分';ui.elementById('m-transport').textContent='¥'+r.transport.toLocaleString();ui.elementById('m-prev-total').textContent='¥'+r.total.toLocaleString();ui.elementById('m-total-all').textContent='¥'+(r.total*selShiftDays.size).toLocaleString();}
export function renderShiftCal(): void{ui.elementById('m-month-lbl').textContent=shiftCalY+'年'+(shiftCalM+1)+'月';const first=new Date(shiftCalY,shiftCalM,1).getDay(),dim=new Date(shiftCalY,shiftCalM+1,0).getDate(),prev=new Date(shiftCalY,shiftCalM,0).getDate();const total=Math.ceil((first+dim)/7)*7;let html='';for(let i=0;i<total;i++){let day,y2=shiftCalY,m2=shiftCalM,other=false;if(i<first){day=prev-first+i+1;m2=shiftCalM-1;if(m2<0){m2=11;y2--;}other=true;}else if(i>=first+dim){day=i-first-dim+1;m2=shiftCalM+1;if(m2>11){m2=0;y2++;}other=true;}else day=i-first+1;const ds=toDS(y2,m2,day);html+=`<button type="button" class="chk-day${other?' off':''}${selShiftDays.has(ds)?' sel':''}" aria-label="${m2+1}月${day}日" data-shift-action="day" data-date="${ds}" data-other="${other}">${day}</button>`;}ui.elementById('shift-cal-grid').innerHTML=html;ui.elementById('sel-days-count').textContent=selShiftDays.size+'日';updateShiftPreview();}
export function toggleShiftDay(ds: string, other: boolean): void{if(other)return;if(selShiftDays.has(ds))selShiftDays.delete(ds);else selShiftDays.add(ds);renderShiftCal();}
export function shiftCalPrev(): void{shiftCalM--;if(shiftCalM<0){shiftCalM=11;shiftCalY--;}renderShiftCal();}
export function shiftCalNext(): void{shiftCalM++;if(shiftCalM>11){shiftCalM=0;shiftCalY++;}renderShiftCal();}
export function saveShift(): void{const job=ui.selectById('m-job').value,start=ui.inputById('m-start').value,end=ui.inputById('m-end').value,rest=Math.max(0,parseInt(ui.inputById('m-rest').value)||0);const jobObj=state.st.jobs.find(j=>j.name===job);if(!job||!start||!end||!jobObj||selShiftDays.size===0)return;if(!checkShiftTime())return;selShiftDays.forEach(ds=>state.st.shifts.push({job,date:ds,start,end,rest,wage:jobObj.wage ?? 0}));save();closeShiftModal();renderCal();renderShiftSection();renderHome();}
export function closeShiftModal(): void{ui.elementById('shift-mbg').classList.remove('open');}
export function shiftListPrev(): void{const nm=addM(shiftListY,shiftListM,-1);shiftListY=nm.y;shiftListM=nm.m;renderShiftList();}
export function shiftListNext(): void{const nm=addM(shiftListY,shiftListM,1);shiftListY=nm.y;shiftListM=nm.m;renderShiftList();}
export function renderShiftList(): void{const y=shiftListY,m=shiftListM;const ms=monthShifts(y,m).sort((a,b)=>a.date.localeCompare(b.date));const isCurrentMonth=(y===gY()&&m===gM());const payM=addM(y,m,1);const totalInc=ms.reduce((a,s)=>a+calcShiftInc(s).total,0);ui.elementById('shift-list-month-label').textContent=`${y}年${m+1}月のシフト`;const jobsInMonth=[...new Set(ms.map(s=>s.job))];const payLabel=jobsInMonth.length?jobsInMonth.map(jn=>{const job=state.st.jobs.find(j=>j.name===jn);return `${jn} ${payM.m+1}月${monthDay(payM.y,payM.m,jobPayDay(job))}日`;}).join('　'):`${payM.m+1}月${monthDay(payM.y,payM.m,parseInt(String(state.st.shiftPayDay))||10)}日払い`;ui.elementById('shift-list-month-sub').textContent=`${ms.length}件　¥${totalInc.toLocaleString()}　→　${payLabel}`;ui.elementById('shift-list-month-label').style.color=isCurrentMonth?'#185FA5':'var(--color-text-primary)';ui.elementById('shift-met-month-label').textContent=`${m+1}月出勤`;ui.elementById('s-days').textContent=ms.length+'日';ui.elementById('s-hours').textContent=ms.reduce((a,s)=>a+calcH(s.start ?? '',s.end ?? '',s.rest),0).toFixed(1)+'h';ui.elementById('s-income').textContent='¥'+totalInc.toLocaleString();if(!ms.length){ui.elementById('shift-list').innerHTML='<div class="empty">この月のシフトなし</div>';return;}ui.elementById('shift-list').innerHTML=ms.map(s=>{const c=jobColorByName(s.job),d=ds2d(s.date),ri=state.st.shifts.indexOf(s),r=calcShiftInc(s);return `<div class="ri"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:0"><span style="font-size:13px;color:var(--color-text-secondary)">${d.getMonth()+1}/${d.getDate()}(${DAYS[d.getDay()]})</span><span class="badge" style="background:${c.bg};color:${c.fg}">${ui.escapeHtml(s.job)}</span><div><div style="font-size:13px">${s.start}〜${s.end}</div><div style="font-size:11px;color:var(--color-text-secondary)">${r.restMin>0?`休憩${r.restMin}分 `:''}${r.nightH>0?`深夜${r.nightH.toFixed(1)}h `:''} ${r.transport>0?`交通費¥${r.transport.toLocaleString()}`:''}</div></div></div><div style="display:flex;align-items:center;gap:8px;flex:none"><span style="font-size:14px;font-weight:600;color:#3B6D11">¥${r.total.toLocaleString()}</span><button class="btn sm del" data-shift-action="delete-shift" data-index="${ri}">削除</button></div></div>`;}).join('');}
export function renderShiftSection(): void{renderFuyou();renderSalaryTable();renderMonthBars();const y=gY(),m=gM(),ms=monthShifts(y,m),totalInc=ms.reduce((a,s)=>a+calcShiftInc(s).total,0),transport=ms.reduce((a,s)=>a+calcShiftInc(s).transport,0);ui.elementById('year-confirmed').textContent='¥'+yearConfirmedIncome().toLocaleString();ui.elementById('year-estimated').textContent='¥'+yearEstimatedIncome().toLocaleString();ui.elementById('year-this-month').textContent='¥'+(totalInc-transport).toLocaleString();ui.elementById('year-transport').textContent='¥'+transport.toLocaleString();renderShiftList();renderJobList();}
export function renderSalaryTable(): void{
  const y=gY(),el=ui.elementById('salary-table');
  if(!state.st.jobs.length){el.innerHTML='<div class="empty">バイト先を登録するとここに表示されます</div>';return;}
  let html='';
  state.st.jobs.forEach(job=>{
    const pay=jobPayDay(job),c=jobColorObj(job);
    // 勤務のある月（見込みの金額があるか、実績を入れた月）は出し、勤務のない過ぎた月はたたむ（#71）
    let rows='',idleRows='',idleCount=0;
    // 振込月ベースで1月〜12月を表示
    // 振込y年payM月 → 勤務月は前月(y年payM-1月、1月払いなら前年12月)
    for(let payM=1;payM<=12;payM++){
      const shiftMo=addM(y,payM-1,-1); // 振込月の前月 = 勤務月
      const shiftY=shiftMo.y, shiftM=shiftMo.m;
      const payDate=monthDate(y,payM-1,pay);
      const today=new Date();
      const salaryKey=salaryKeyForShiftMonth(job.name,shiftY,shiftM);
      const actual=state.st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      const estimated=totalShiftIncNoTransportForJob(job.name,shiftY,shiftM);
      if(estimated===0&&!actual&&payDate>today)continue;
      const dispActual=actual?parseInt(String(actual.actualAmount)):null;
      const idle=estimated===0&&!actual;
      if(idle)idleCount++;
      const row=`<div class="salary-row">
        <span class="salary-month">${payM}月払い</span>
        <span class="salary-est">
          ${shiftY !== y ? shiftY+'年' : ''}${shiftM+1}月分の勤務<br>
          推定 ¥${estimated.toLocaleString()}<br>
          <span style="font-size:10px">${y}年${payM}月${pay}日振込</span>
        </span>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="salary-input" type="number" inputmode="numeric" placeholder="実績額"
            value="${dispActual||''}"
            data-shift-action="salary" data-job="${ui.escapeHtml(job.name)}" data-pay-year="${y}" data-pay-month="${payM}" data-shift-year="${shiftY}" data-shift-month="${shiftM}"/>
          ${dispActual?'<span class="act-badge">入力済</span>':''}
        </div>
      </div>`;
      if(idle)idleRows+=row;else rows+=row;
    }
    const idleHtml=idleCount?`<details class="salary-idle"><summary>勤務のない月も見る（${idleCount}か月）</summary>${idleRows}</details>`:'';
    html+=`<div style="margin-bottom:6px"><div style="display:flex;align-items:center;gap:6px;margin:10px 0 4px"><div class="dot" style="background:${c.dot}"></div><span style="font-size:13px;font-weight:600">${ui.escapeHtml(job.name)}</span></div>${rows||'<div class="empty">今年はまだ勤務がありません</div>'}${idleHtml}</div>`;
  });
  el.innerHTML=html;
}

export function onSalaryChangeByPayMonth(jobName: string, payY: number, payM: number, shiftY: number, shiftM: number, val: string): void{
  const amount=parseInt(val)||0;
  const job=state.st.jobs.find(j=>j.name===jobName);
  const salaryKey=salaryKeyForShiftMonth(jobName,shiftY,shiftM);
  if(amount>0){
    const pay=jobPayDay(job);
    const date=toDS(payY,payM-1,monthDay(payY,payM-1,pay));
    const ei=state.st.actualInputs.findIndex(a=>a.type==='shift'&&a.job===jobName&&a.salaryKey===salaryKey);
    const entry: StShiftActual={type:'shift',job:jobName,salaryKey,date,actualAmount:amount,estimatedAmount:totalShiftIncNoTransportForJob(jobName,shiftY,shiftM)};
    if(ei>=0){entry._id=state.st.actualInputs[ei]._id;state.st.actualInputs[ei]=entry;}else state.st.actualInputs.push(entry);
  }else{
    state.st.actualInputs=state.st.actualInputs.filter(a=>!(a.type==='shift'&&a.job===jobName&&a.salaryKey===salaryKey));
  }
  save();renderShiftSection();renderHome();
}

// 振込年で収入を集計（扶養計算用）
export function yearConfirmedIncome(): number{
  let total=parseInt(String(state.st.otherIncome))||0;
  const y=gY(),today=new Date();
  state.st.jobs.forEach(job=>{
    const pay=jobPayDay(job);
    for(let payM=1;payM<=12;payM++){
      const shiftMo=addM(y,payM-1,-1);
      const salaryKey=salaryKeyForShiftMonth(job.name,shiftMo.y,shiftMo.m);
      const actual=state.st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      const payDate=monthDate(y,payM-1,pay);
      if(actual) total+=parseInt(String(actual.actualAmount));
      else if(payDate<=today) total+=totalShiftIncNoTransportForJob(job.name,shiftMo.y,shiftMo.m);
    }
  });
  return total;
}

export function yearEstimatedIncome(): number{
  let total=parseInt(String(state.st.otherIncome))||0;
  const y=gY();
  state.st.jobs.forEach(job=>{
    for(let payM=1;payM<=12;payM++){
      const shiftMo=addM(y,payM-1,-1);
      const salaryKey=salaryKeyForShiftMonth(job.name,shiftMo.y,shiftMo.m);
      const actual=state.st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      total+=actual?parseInt(String(actual.actualAmount)):totalShiftIncNoTransportForJob(job.name,shiftMo.y,shiftMo.m);
    }
  });
  return total;
}
export function renderFuyou(): void{const confirmed=yearConfirmedIncome(),estimated=yearEstimatedIncome();const limits=[];if(state.st.fuyouLimit==='1030000'||state.st.fuyouLimit==='both')limits.push({label:'103万円の壁',amount:1030000,color:'#185FA5'});if(state.st.fuyouLimit==='1300000'||state.st.fuyouLimit==='both')limits.push({label:'130万円の壁',amount:1300000,color:'#993556'});let html='';limits.forEach(lim=>{const pct=Math.min(100,Math.round(confirmed/lim.amount*100)),estPct=Math.min(100,Math.round(estimated/lim.amount*100));const color=pct>=90?'#A32D2D':pct>=70?'#BA7517':lim.color;html+=`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-size:13px;font-weight:600">${lim.label}</span><span style="font-size:11px;color:var(--color-text-secondary)">残り ¥${Math.max(0,lim.amount-estimated).toLocaleString()}</span></div><div style="height:10px;background:var(--color-background-secondary);border-radius:5px;overflow:hidden"><div style="height:100%;width:${estPct}%;background:${color}30;border-radius:5px"></div><div style="height:100%;width:${pct}%;background:${color};border-radius:5px;position:relative;margin-top:-10px"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary);margin-top:3px"><span>確定 ${pct}% ¥${confirmed.toLocaleString()}</span><span>予想 ${estPct}% ¥${estimated.toLocaleString()}</span></div>${pct>=90?`<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:6px 10px;font-size:12px;margin-top:6px">⚠ 残り ¥${Math.max(0,lim.amount-confirmed).toLocaleString()}</div>`:''}</div>`;});ui.elementById('fuyou-content').innerHTML=html;}
export function renderMonthBars(): void{const y=gY(),vals=Array.from({length:12},(_,m)=>{if(!state.st.jobs.length)return totalShiftIncNoTransport(y,m);return state.st.jobs.reduce((sum,job)=>{const a=getActualSalary(job.name,y,m);return sum+(a?parseInt(String(a.actualAmount)):totalShiftIncNoTransportForJob(job.name,y,m));},0);}),hasActual=Array.from({length:12},(_,m)=>state.st.jobs.length?state.st.jobs.some(job=>getActualSalary(job.name,y,m)):false);const maxV=Math.max(...vals,1);let html='';for(let m=0;m<12;m++){const v=vals[m],pct=Math.round(v/maxV*100),isCurrent=m===gM(),actual=hasActual[m];html+=`<div class="month-bar-row"><span class="month-bar-label" style="${isCurrent?'color:var(--color-text-primary);font-weight:600':''}">${m+1}月</span><div class="month-bar-bg"><div class="month-bar" style="width:${pct}%;background:${actual?'#3B6D11':isCurrent?'#185FA5':'#185FA540'}"></div></div><span class="month-bar-val">${v>0?(actual?'¥'+v.toLocaleString()+'✓':'¥'+v.toLocaleString()):'-'}</span></div>`;}ui.elementById('month-bars').innerHTML=html;}
let jobAddColorSel: string | null = null;
export function ensureJobAddColor(): void{if(!jobAddColorSel)jobAddColorSel=PLAN_COLORS[state.st.jobs.length%PLAN_COLORS.length].key;renderJobAddColorSwatches();}
export function renderJobAddColorSwatches(): void{const el=ui.elementById('job-color-swatches');if(!el)return;el.innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${jobAddColorSel===c.key?' sel':''}" style="background:${c.dot}" data-shift-action="add-color" data-color="${c.key}" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
export function selJobAddColor(key: string): void{jobAddColorSel=key;renderJobAddColorSwatches();}
export function renderJobList(): void{ensureJobAddColor();const el=ui.elementById('job-list');el.innerHTML=!state.st.jobs.some(j=>!j._deleted)?'<div class="empty">バイト先未登録</div>':state.st.jobs.map((j,i)=>{if(j._deleted)return'';const c=jobColorObj(j);return `<div class="ri"><div style="display:flex;align-items:center;gap:8px"><div class="dot" style="background:${c.dot}"></div><div><div style="font-size:14px">${ui.escapeHtml(j.name)}</div><div style="font-size:11px;color:var(--color-text-secondary)">時給 ¥${j.wage} / 深夜 ${j.nightStart||'22:00'}〜+${j.nightRate||25}% / 交通費 ¥${(j.transport||0)*2}/回</div><div style="font-size:11px;color:var(--color-text-secondary)">締め日 ${(parseInt(String(j.closeDay))||31)>=28?'月末':(parseInt(String(j.closeDay))||31)+'日'} / 給料日 翌月${jobPayDay(j)}日</div></div></div><div style="display:flex;gap:6px"><button class="btn sm edit" data-shift-action="edit-job" data-index="${i}">編集</button><button class="btn sm del" data-shift-action="delete-job" data-index="${i}">削除</button></div></div>`;}).join('');}
export function addJob(): void{const name=ui.inputById('job-name').value.trim(),wage=parseInt(ui.inputById('job-wage').value)||0;if(!name||!wage)return;const nightStart=ui.inputById('job-night-start').value||'22:00',nightRate=parseInt(ui.inputById('job-night-rate').value)||25,transport=parseInt(ui.inputById('job-transport').value)||0,closeDayVal=parseInt(ui.inputById('job-close-day').value)||parseInt(String(state.st.shiftCloseDay))||31,payDayVal=parseInt(ui.inputById('job-pay-day').value)||parseInt(String(state.st.shiftPayDay))||10,color=jobAddColorSel||PLAN_COLORS[state.st.jobs.length%PLAN_COLORS.length].key;state.st.jobs.push({name,wage,nightStart,nightRate,transport,closeDay:closeDayVal,payDay:payDayVal,color});save();ui.inputById('job-name').value='';ui.inputById('job-wage').value='';ui.inputById('job-transport').value='';ui.inputById('job-close-day').value='';ui.inputById('job-pay-day').value='';jobAddColorSel=null;renderJobList();renderShiftSection();renderCal();toggleJobAdd(false);ui.toast(`「${name}」を追加しました`);}
// 「バイト先を追加」の欄を開く・閉じる（open を省くと、開いていれば閉じる）
export function toggleJobAdd(open?: boolean): void{
  const form=ui.elementById('job-add-form'),btn=ui.elementById('job-add-toggle');
  const next=open===undefined?form.hidden:open;
  form.hidden=!next;btn.hidden=next;btn.setAttribute('aria-expanded',String(next));
  if(next){renderJobAddColorSwatches();ui.elementById('job-name').focus();}else btn.focus();
}
let jobEditIdx=-1,jobEditColorSel='blue';
export function openJobEdit(i: number): void{jobEditIdx=i;const j=state.st.jobs[i];ui.inputById('je-name').value=j.name;ui.inputById('je-wage').value=String(j.wage ?? '');ui.inputById('je-night-start').value=j.nightStart||'22:00';ui.inputById('je-night-rate').value=String(j.nightRate||25);ui.inputById('je-transport').value=String(j.transport||'');ui.inputById('je-close-day').value=String(j.closeDay||state.st.shiftCloseDay||31);ui.inputById('je-pay-day').value=String(j.payDay||state.st.shiftPayDay||10);jobEditColorSel=jobColorObj(j).key;renderJobEditColorSwatches();ui.elementById('job-edit-mbg').classList.add('open');}
export function closeJobEdit(): void{ui.elementById('job-edit-mbg').classList.remove('open');}
export function renderJobEditColorSwatches(): void{ui.elementById('je-color-swatches').innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${jobEditColorSel===c.key?' sel':''}" style="background:${c.dot}" data-shift-action="edit-color" data-color="${c.key}" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
export function selJobEditColor(key: string): void{jobEditColorSel=key;renderJobEditColorSwatches();}
export function saveJobEdit(): void{const name=ui.inputById('je-name').value.trim(),wage=parseInt(ui.inputById('je-wage').value)||0;if(!name||!wage||jobEditIdx<0)return;const oldName=state.st.jobs[jobEditIdx].name;const nightStart=ui.inputById('je-night-start').value||'22:00',nightRate=parseInt(ui.inputById('je-night-rate').value)||25,transport=parseInt(ui.inputById('je-transport').value)||0,closeDayVal=parseInt(ui.inputById('je-close-day').value)||parseInt(String(state.st.shiftCloseDay))||31,payDayVal=parseInt(ui.inputById('je-pay-day').value)||parseInt(String(state.st.shiftPayDay))||10;state.st.jobs[jobEditIdx]={_id:state.st.jobs[jobEditIdx]._id,name,wage,nightStart,nightRate,transport,closeDay:closeDayVal,payDay:payDayVal,color:jobEditColorSel};if(oldName!==name){state.st.shifts.forEach(s=>{if(s.job===oldName)s.job=name;});state.st.actualInputs.forEach(a=>{if(a.type==='shift'&&a.job===oldName){a.job=name;a.salaryKey=a.salaryKey.replace(`${oldName}|`,`${name}|`);}});}save();closeJobEdit();renderJobList();renderShiftSection();renderCal();renderHome();}
export function delJob(i: number): void{state.st.jobs[i]._deleted=true;/* 削除済みにする */save();renderJobList();}
export function delShift(i: number): void{state.st.shifts.splice(i,1);save();renderShiftList();renderShiftSection();renderCal();renderHome();}


/** シフトとバイト先の固定・描画後の操作を起動時に一度だけ登録する。 */
export function bindShiftControls(): void {
  for (const id of ['sec-shift', 'shift-mbg', 'job-edit-mbg']) {
    ui.elementById(id).addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('[data-shift-action]');
      if (!target) return;
      const action = target.dataset.shiftAction;
      const index = Number(target.dataset.index);
      if (action === 'list-prev') shiftListPrev();
      else if (action === 'list-next') shiftListNext();
      else if (action === 'open-add') openShiftModal();
      else if (action === 'toggle-job-add') toggleJobAdd();
      else if (action === 'close-job-add') toggleJobAdd(false);
      else if (action === 'add-job') addJob();
      else if (action === 'cal-prev') shiftCalPrev();
      else if (action === 'cal-next') shiftCalNext();
      else if (action === 'close-shift') closeShiftModal();
      else if (action === 'save-shift') saveShift();
      else if (action === 'close-job-edit') closeJobEdit();
      else if (action === 'save-job-edit') saveJobEdit();
      else if (action === 'rest' && target.dataset.minutes !== undefined) setRestMin(Number(target.dataset.minutes));
      else if (action === 'day' && target.dataset.date) toggleShiftDay(target.dataset.date, target.dataset.other === 'true');
      else if (action === 'delete-shift' && Number.isInteger(index) && state.st.shifts[index]) delShift(index);
      else if (action === 'add-color' && target.dataset.color) selJobAddColor(target.dataset.color);
      else if (action === 'edit-job' && Number.isInteger(index) && state.st.jobs[index] && !state.st.jobs[index]._deleted) openJobEdit(index);
      else if (action === 'delete-job' && Number.isInteger(index) && state.st.jobs[index] && !state.st.jobs[index]._deleted) delJob(index);
      else if (action === 'edit-color' && target.dataset.color) selJobEditColor(target.dataset.color);
    });
  }
  ui.elementById('salary-table').addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.dataset.shiftAction !== 'salary') return;
    const { job, payYear, payMonth, shiftYear, shiftMonth } = event.target.dataset;
    if ([job, payYear, payMonth, shiftYear, shiftMonth].some(value => value === undefined)) return;
    if (!state.st.jobs.some(row => row.name === job)) return;
    onSalaryChangeByPayMonth(job!, Number(payYear), Number(payMonth), Number(shiftYear), Number(shiftMonth), event.target.value);
  });
  ui.selectById('m-job').addEventListener('change', updateShiftPreview);
  for (const id of ['m-start', 'm-end']) ui.inputById(id).addEventListener('input', updateShiftPreview);
  ui.inputById('m-rest').addEventListener('input', () => { renderRestChips(); updateShiftPreview(); });
}

export const LEGACY_SHIFT_SCREEN = { openShiftModal, openJobEdit };

