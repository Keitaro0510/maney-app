// 祝日とカレンダーの画面（D20 の 9）。
import { state } from '../state.ts';
import { save } from '../sync.ts';
import { getToday, getNow, gY, gM, gD, toDS, addM, ds2d, monthDay, fmtMD, DAYS } from '../dates.ts';
import { followMonth } from '../clock.ts';
import * as MoneyUI from '../ui.ts';
import * as MoneyTasks from '../tasks.ts';
import { taskRows } from './tasks.ts';
import { monthShifts, jobPayDay, jobCloseDayNum, getActualSalary, totalShiftIncForJob, calcShiftInc } from '../shifts.ts';
import { monthlyRowsIn, monthlyPayLabel } from './monthly.ts';
import { getPlansForDay, planTimeOnDay, hm2min } from '../plans.ts';
import { getLedgerForDay, ledgerPayLabel } from '../ledger.ts';
import { cardCloseDay, cardBillAmount, cardCycleForBillMonth, getActualCard } from '../cards.ts';
import { jobColorByName, planColor } from '../palette.ts';
import { renderHome } from './home.ts';
import type { StShift } from '../compat.ts';

let calY=getNow().getFullYear(), calM=getNow().getMonth(), selDay: string | null=null;
let calView: 'day' | 'week' | 'month'='month';
let calAnchor=getToday();
let calRenderSeq=0;
export const getSelectedCalDay = (): string | null => selDay;
export function onCalendarDayChanged(prev: Date, now: Date, prevKey: string): void {
  ({y:calY,m:calM}=followMonth({y:calY,m:calM},prev,now));
  if(calAnchor===prevKey)calAnchor=getToday();
}

// 祝日（Google Calendar API）とカレンダーの画面
// ============================================================
// 祝日（Google Calendar API）
// ============================================================
// 祝日を読むための Google のキー（ブラウザで使うので公開される）。Google Cloud で、使えるサイト（keitaro0510.github.io・手元の 127.0.0.1:8765）と
// 使える API（Google Calendar API だけ）に制限している。キーを替えたら、古いキーは Google Cloud で消す
const GCAL_API_KEY = 'AIzaSyA23lyUb631P_fKLEa1LXDGtGTx8ARkj3o';
const HOLIDAY_CAL_ID = 'ja.japanese%23holiday%40group.v.calendar.google.com';
let holidayCache: Record<string, string | Record<string, never>> = {}; // { 'YYYY-MM-DD': '祝日名' }

async function fetchHolidays(year: number, month: number): Promise<void>{
  const cacheKey = `${year}-${String(month+1).padStart(2,'0')}`;
  if(holidayCache[cacheKey] !== undefined) return; // 取得済みならスキップ

  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month+1, 0, 23, 59, 59).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${HOLIDAY_CAL_ID}/events?key=${GCAL_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`;

  try{
    const res = await fetch(url);
    const data = await res.json() as { items?: { start: { date: string }; summary: string }[] };
    holidayCache[cacheKey] = {}; // 空でもキャッシュ（再取得しないように）
    if(data.items){
      data.items.forEach(item=>{
        const ds = item.start.date; // 'YYYY-MM-DD'
        holidayCache[ds] = item.summary;
      });
    }
  }catch(e){
    console.warn('祝日取得失敗:', e);
    holidayCache[cacheKey] = {};
  }
}

function getHoliday(ds: string): string | null{
  return typeof holidayCache[ds] === 'string' ? holidayCache[ds] as string : null;
}

// ============================================================
// カレンダー
// ============================================================
// fetchHolidaysはholidayCacheにキー済みなら即returnするため重複呼び出しは無料。
// holidayCacheは'YYYY-MM'(取得済みマーカー)と'YYYY-MM-DD'(祝日名)が同一オブジェクトに
// 混在するため、getHoliday(ds)経由以外でキー走査しないこと
async function ensureHolidays(dsList: string[]): Promise<void>{
  const keys=[...new Set(dsList.map(ds=>ds.slice(0,7)))];
  for(const k of keys){ const[y,mm]=k.split('-').map(Number); await fetchHolidays(y,mm-1); }
}

export async function renderCal(): Promise<void>{
  const seq=++calRenderSeq;
  const isMonth=calView==='month';
  MoneyUI.elementById('cal-month-wrap').style.display=isMonth?'block':'none';
  MoneyUI.elementById('cal-list').style.display=isMonth?'none':'block';
  if(!isMonth) MoneyUI.elementById('day-detail').style.display='none';
  if(isMonth){
    await renderCalMonth(seq);
    // 日の詳細が開いていれば、今のデータで描き直す（読み込み直したあとに、古い番号のボタンを残さない）
    if(seq===calRenderSeq && selDay && MoneyUI.elementById('day-detail').style.display==='block') dayClick(selDay);
  }
  else if(calView==='week') await renderCalWeek(seq);
  else await renderCalDay(seq);
}

async function renderCalMonth(seq: number): Promise<void>{
  MoneyUI.elementById('cal-title').textContent=calY+'年'+(calM+1)+'月';
  MoneyUI.elementById('cal-hdr').innerHTML=DAYS.map(d=>`<div class="chdr">${d}</div>`).join('');

  // 当月・前月・翌月分の祝日を取得（カレンダーに表示されるため）
  const prevMo=addM(calY,calM,-1),nextMo=addM(calY,calM,1);
  await ensureHolidays([toDS(calY,calM,1),toDS(prevMo.y,prevMo.m,1),toDS(nextMo.y,nextMo.m,1)]);
  if(seq!==calRenderSeq)return;

  const first=new Date(calY,calM,1).getDay(),dim=new Date(calY,calM+1,0).getDate(),prev=new Date(calY,calM,0).getDate();
  const total=Math.ceil((first+dim)/7)*7;
  const byDay: Record<number, StShift[]>={};
  monthShifts(calY,calM).forEach(s=>{const d=new Date(s.date).getDate();(byDay[d]=byDay[d]||[]).push(s);});
  const fcDays=new Set(monthlyRowsIn(calY,calM).map(fc=>monthDay(calY,calM,fc.day))); // 毎月のお金がある日（D14）
  const shimeD=state.st.jobs.map(j=>jobCloseDayNum(j,calY,calM)),payD=(state.st.jobs.length?state.st.jobs.map(jobPayDay):[parseInt(String(state.st.shiftPayDay))||10]).map(p=>monthDay(calY,calM,p));
  const taskCount=MoneyTasks.countByDay(taskRows()); // タスクの件数（期限の日ごと。D10）
  let html='';
  for(let i=0;i<total;i++){
    let day,y2=calY,m2=calM,other=false;
    if(i<first){day=prev-first+i+1;m2=calM-1;if(m2<0){m2=11;y2--;}other=true;}
    else if(i>=first+dim){day=i-first-dim+1;m2=calM+1;if(m2>11){m2=0;y2++;}other=true;}
    else day=i-first+1;
    const isT=!other&&y2===getNow().getFullYear()&&m2===getNow().getMonth()&&day===getNow().getDate();
    const ds=toDS(y2,m2,day);
    const dow=new Date(y2,m2,day).getDay();
    const holiday=getHoliday(ds);
    const isSun=dow===0,isSat=dow===6;

    const shifts=other?[]:(byDay[day]||[]),wdT=other?[]:state.st.wds.filter(w=>w.date===ds),plans=other?[]:getPlansForDay(ds);
    const hasFc=!other&&fcDays.has(day);
    const isPay=!other&&payD.includes(day),isShime=!other&&shimeD.includes(day);
    const isClose=!other&&state.st.cards.some(c=>!c._deleted&&cardCloseDay(c,calY,calM)===day),isBill=!other&&state.st.cards.some((c,ci)=>monthDay(calY,calM,parseInt(c.billDay))===day&&(!c._deleted||cardBillAmount(c,ci,calY,calM)>0));

    // 日曜・祝日は赤、土曜は青で日付表示
    const dnumColor=holiday||isSun?'#A32D2D':isSat?'#185FA5':'var(--color-text-secondary)';

    let pills='';
    if(holiday&&!other) pills+=`<div class="pill holiday">${MoneyUI.escapeHtml(holiday)}</div>`;
    // タスク（D10）: 印と件数だけ。期限が過ぎた日に残っていれば赤、全部済んでいれば薄く
    const tc=other?null:taskCount.get(ds);
    if(tc) pills+=tc.open?`<div class="pill task${ds<getToday()?' overdue':''}">タスク${tc.open}</div>`:'<div class="pill task done" title="タスク（済み）">タスク</div>';
    if(isPay) pills+='<div class="pill payday">給料日</div>';
    if(isShime&&!isPay) pills+='<div class="pill shime">締め日</div>';
    if(isClose&&!isShime) pills+='<div class="pill shime">締め日</div>';
    if(isBill) pills+='<div class="pill hikiotoshi">引落</div>';
    if(hasFc) pills+='<div class="pill fixedcost">毎月</div>';
    if(wdT.length) pills+='<div class="pill wd">ATM</div>';
    shifts.forEach(s=>{const c=jobColorByName(s.job);pills+=`<div class="pill" style="background:${c.bg};color:${c.fg}">${(s.start || '').slice(0,5)}</div>`;});
    // 予定は時刻順に並べ、時刻があれば先頭に表示する。.pillはoverflow:hidden+ellipsisがあるので
    // JS側でtitleを.sliceして切らない方が正しく省略される
    plans.sort((a,b)=>planTimeOnDay(a,ds).min-planTimeOnDay(b,ds).min);
    plans.forEach(p=>{const c=planColor(p.color),t=planTimeOnDay(p,ds);pills+=`<div class="pill" style="background:${c.bg};color:${c.fg};${p.done?'opacity:.4':''}">${t.start?t.start+' ':''}${p.title}</div>`;});
    // 支出・収入の金額はセルに出さない（D10。セルを整理する。日の詳細・週表示・家計簿では見られる）

    const selected=ds===selDay;
    html+=`<div class="cday${other?' otherm':''}${isT?' today':''}${selected?' selected':''}" data-day="${ds}" role="button" tabindex="0" aria-label="${y2}年${m2+1}月${day}日の詳細を表示" aria-expanded="${selected}" aria-controls="day-detail" aria-describedby="cal-detail-hint" onclick="dayCellClick('${ds}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dayCellClick('${ds}')}"><div class="dnum" style="color:${dnumColor}">${day}</div>${pills}</div>`;
  }
  MoneyUI.elementById('cal-body').innerHTML=html;
}

function weekStart(ds: string): Date{ const d=ds2d(ds); d.setDate(d.getDate()-d.getDay()); return d; } // 日曜始まり

function dayActionButtonsHtml(): string{
  return `<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
    <button class="btn plan-btn" style="flex:1" onclick="openPlanModal(getSelectedCalDay())">＋ 予定</button>
    <button class="btn" style="flex:1;background:var(--color-background-secondary)" onclick="openShiftModal(getSelectedCalDay())">＋ シフト</button>
    <button class="btn" style="flex:1;background:var(--color-background-secondary)" onclick="openLedgerModal(getSelectedCalDay())">＋ 支出</button>
  </div>`;
}

async function renderCalDay(seq: number): Promise<void>{
  const ds=calAnchor;
  await ensureHolidays([ds]);
  if(seq!==calRenderSeq)return;
  selDay=ds;
  const d=ds2d(ds), hd=getHoliday(ds), dow=d.getDay();
  const col=hd||dow===0?'#A32D2D':dow===6?'#185FA5':'var(--color-text-primary)';
  MoneyUI.elementById('cal-title').innerHTML=`<span style="color:${col}">${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${DAYS[dow]})</span>`+(ds===getToday()?' <span class="badge bs0" style="font-size:10px">今日</span>':'');

  const {items}=buildDay(ds,{actions:true, showTime:true});
  const allday=items.filter(i=>i.sort<0), timed=items.filter(i=>i.sort>=0);

  let html='<div class="card" style="margin-bottom:8px">';
  if(hd) html+=`<div class="abar" style="background:#FCEBEB;color:#A32D2D">${hd}</div>`;
  if(allday.length) html+='<div class="st">終日・日付イベント</div>'+allday.map(i=>i.html).join('');
  if(timed.length) html+='<div class="st" style="margin-top:14px">時間指定</div>'+timed.map(i=>i.html).join('');
  if(!items.length) html+='<div class="empty">この日のイベントなし</div>';
  html+='</div>'+dayActionButtonsHtml();
  MoneyUI.elementById('cal-list').innerHTML=html;
}

async function renderCalWeek(seq: number): Promise<void>{
  const ws=weekStart(calAnchor);
  const days=[...Array(7)].map((_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return toDS(d.getFullYear(),d.getMonth(),d.getDate());});
  await ensureHolidays(days); // 月跨ぎの週でも自動で2ヶ月分取得される
  if(seq!==calRenderSeq)return;
  const we=ds2d(days[6]);
  MoneyUI.elementById('cal-title').textContent=`${ws.getMonth()+1}/${ws.getDate()} 〜 ${we.getMonth()+1}/${we.getDate()}`;

  let html='';
  days.forEach(ds=>{
    const {items,inc,exp}=buildDay(ds,{actions:false, showTime:true});
    const d=ds2d(ds), dow=d.getDay(), hd=getHoliday(ds), isT=ds===getToday();
    const col=hd||dow===0?'#A32D2D':dow===6?'#185FA5':'var(--color-text-primary)';
    const sum=[inc?`+¥${inc.toLocaleString()}`:'',exp?`-¥${exp.toLocaleString()}`:''].filter(Boolean).join(' / ');
    html+=`<div class="cal-day-block${isT?' today':''}">
      <div class="cal-day-head" onclick="jumpToDay('${ds}')">
        <span class="cal-day-date" style="color:${col}">${d.getMonth()+1}/${d.getDate()}(${DAYS[dow]})</span>
        ${hd?`<span style="font-size:10px;color:#A32D2D">${hd}</span>`:''}
        <span class="cal-day-sum">${sum||(items.length?items.length+'件':'')}</span>
      </div>
      <div class="cal-day-body">${items.length?items.map(i=>i.html).join(''):'<div class="empty">予定なし</div>'}</div>
    </div>`;
  });
  MoneyUI.elementById('cal-list').innerHTML=html;
}

// 指定日のイベントを、今までの追加順で集める。
type DayItem = { sort: number; time: string; html: string };
type DayOptions = { actions?: boolean; showTime?: boolean; tasks?: 'names' };
function buildDay(ds: string, opts: DayOptions={}): { items: DayItem[]; inc: number; exp: number }{
  const actions=opts.actions!==false, showTime=!!opts.showTime;
  const d=ds2d(ds), y=d.getFullYear(), m=d.getMonth(), day=d.getDate();
  const shifts=state.st.shifts.filter(s=>s.date===ds),lds=getLedgerForDay(ds),wdList=state.st.wds.filter(w=>w.date===ds),
        plans=getPlansForDay(ds),fcList=monthlyRowsIn(y,m).filter(fc=>monthDay(y,m,fc.day)===day);
  const items: DayItem[]=[]; let inc=0, exp=0;
  const push=(sort: number,time: string,html: string): void=>{items.push({sort,time,html:showTime?`<div class="ri-with-time"><span class="ri-time">${time||''}</span>${html}</div>`:html});};

  // タスク（D10）: 日の詳細（opts.tasks='names'）は名前を出す（見るだけ。完了はタスクのタブで）。日・週の表示は件数だけ
  const dayTasks=MoneyTasks.tasksOnDay(taskRows(),ds);
  if(dayTasks.length){
    if(opts.tasks==='names'){
      dayTasks.forEach(t=>push(-1,'',`<div class="ri task-ri${t.completed_at?' done':''}"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="badge btask">タスク</span><span class="task-ri-title">${MoneyUI.escapeHtml(t.title)}</span></div></div>`));
    }else{
      const left=dayTasks.filter(t=>!t.completed_at).length;
      push(-1,'',`<div class="ri"><span class="badge btask">タスク</span><span class="task-ri-count">${left?`${left}件`:'すべて済み'}</span></div>`);
    }
  }

  state.st.jobs.forEach(job=>{
    const jPayD=monthDay(y,m,jobPayDay(job)),jShimeD=jobCloseDayNum(job,y,m);
    if(day===jPayD){
      const sm=addM(y,m,-1);
      const act=getActualSalary(job.name,sm.y,sm.m);
      const si=act?parseInt(String(act.actualAmount)):totalShiftIncForJob(job.name,sm.y,sm.m);
      if(si>0){inc+=si;push(-1,'',`<div class="ri"><span class="badge binc">${job.name} 給料入金</span><span style="font-size:14px;font-weight:600;color:#3B6D11">+¥${si.toLocaleString()}</span></div>`);}
    }
    if(day===jShimeD&&day!==jPayD)push(-1,'',`<div class="ri"><span class="badge bpending">${job.name} 締め日</span></div>`);
  });
  state.st.cards.forEach((card,ci)=>{
    const cl=cardCloseDay(card,y,m),billD=monthDay(y,m,parseInt(card.billDay));
    if(!card._deleted&&day===cl){
      const billM=addM(y,m,1);
      const isPending=new Date(y,m,cl)>=new Date(gY(),gM(),gD());
      push(-1,'',`<div class="ri"><span class="badge bcard">${MoneyUI.escapeHtml(card.name)}</span><span class="ri-note">${isPending?'集計中・':''}締め日（${billM.m+1}月${monthDay(billM.y,billM.m,parseInt(card.billDay))}日に引き落とし）</span></div>`);
    }
    if(day===billD){
      const actual=getActualCard(ci,y,m);
      const billCycle=cardCycleForBillMonth(card,ci,y,m);
      const amt=actual?parseInt(String(actual.actualAmount)):billCycle.amount;
      if(card._deleted&&!amt)return; // 削除したカードは、引き落とす分があるときだけ出す
      const billDate=new Date(y,m,billD),todayDate=new Date(gY(),gM(),gD());
      const isFuture=billDate>todayDate;
      push(-1,'',`<div class="ri"><div><span class="badge ${isFuture?'bpending':'bfixed'}">${card.name}</span>${actual?'<span class="act-badge">実額</span>':''}<div class="bill-label">${isFuture?'引き落とし予定日':'引き落とし日'}</div><div class="bill-label">${fmtMD(billCycle.cs)}〜${fmtMD(billCycle.ce)} の利用分</div></div><span style="font-size:14px;font-weight:600;color:${isFuture?'#BA7517':'#A32D2D'}">¥${amt.toLocaleString()}</span></div>`);
    }
  });
  fcList.forEach(fc=>{
    if(fc.kind==='income')inc+=fc.amount; // 支出側(固定費)の集計はcycle等の既存ロジックと重複するため対象外、収入だけ加算
    push(-1,'',`<div class="ri"><div><span class="badge bfixcost">${MoneyUI.escapeHtml(fc.name)}</span><div style="font-size:11px;color:var(--color-text-secondary)">毎月・${MoneyUI.escapeHtml(monthlyPayLabel(fc))}</div></div><span style="font-size:14px;font-weight:600;color:${fc.kind==='income'?'#3B6D11':'#C45000'}">${fc.kind==='income'?'+':'-'}¥${fc.amount.toLocaleString()}</span></div>`);
  });
  wdList.forEach(w=>push(-1,'',`<div class="ri"><span class="badge bwd">ATM引き出し</span><span style="font-size:14px;font-weight:600;color:#3C3489">-¥${parseInt(String(w.amount)).toLocaleString()}</span></div>`));
  plans.forEach(p=>{
    const pidx=state.st.plans.indexOf(p),c=planColor(p.color);
    const isMultiDay=p.dateEnd&&p.dateEnd!==p.date;
    const t=planTimeOnDay(p,ds);
    const timeLabel=t.start&&t.end?`${t.start}〜${t.end}`:t.start?t.start:t.end?`〜${t.end}`:'';
    // ボタンには番号と ID を埋め込み、押したときに同じ記録かを確かめる（sameRecord）
    const guard=`sameRecord('plans',${pidx},'${p._id}')`;
    const actionsHtml=actions?`<button class="btn sm edit" onclick="${guard}&&openPlanEdit(${pidx})">編集</button><button class="btn sm del" onclick="${guard}&&deletePlan(${pidx})">削除</button>`:'';
    // 「済み」のチェック（D2）: 済みにした予定は、予算を見込みの支出に入れない。列の名前は done のまま（D11 で見直す）
    // 名前とメモは、自由に入れた文字なのでエスケープする
    const title=MoneyUI.escapeHtml(p.title);
    push(t.min,timeLabel,`<div class="ri" style="${p.done?'opacity:.5':''}"><div style="display:flex;align-items:center;gap:4px"><label class="plan-done" title="済みにすると、予算を見込みの支出に入れません"><input type="checkbox" ${p.done?'checked':''} aria-label="「${title}」を済みにする（予算に含めない）" onchange="${guard}&&togglePlanDone(${pidx})"></label><div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><div style="width:10px;height:10px;border-radius:50%;background:${c.dot};flex-shrink:0"></div><span style="font-size:14px${p.done?';text-decoration:line-through':''}">${title}</span>${p.done?'<span class="plan-done-badge">済み・予算に含めない</span>':''}${isMultiDay?`<span style="font-size:10px;color:${c.fg};background:${c.bg};padding:1px 6px;border-radius:100px">${ds2d(p.dateStart || p.date).getDate()}〜${ds2d(p.dateEnd || p.date).getDate()}日</span>`:''}</div>${p.memo?`<div style="font-size:12px;color:var(--color-text-secondary)">${MoneyUI.escapeHtml(p.memo)}</div>`:''}</div></div><div style="display:flex;align-items:center;gap:6px">${(p.budget||0)>0?`<span style="font-size:13px;font-weight:600;color:${c.fg}">-¥${(p.budget||0).toLocaleString()}</span>`:''}${actionsHtml}</div></div>`);
  });
  shifts.forEach(s=>{
    const c=jobColorByName(s.job),r=calcShiftInc(s);
    inc+=r.total;
    push(hm2min(s.start || ''),s.start || '',`<div class="ri"><div><div style="display:flex;align-items:center;gap:8px"><span class="badge" style="background:${c.bg};color:${c.fg}">${s.job}</span><span style="font-size:13px">${s.start}〜${s.end}</span></div><div style="font-size:11px;color:var(--color-text-secondary)">${r.restMin>0?`休憩${r.restMin}分 `:''}${r.nightH>0?`深夜${r.nightH.toFixed(1)}h `:''} ${r.transport>0?`交通費 ¥${r.transport.toLocaleString()}`:''}</div></div><span style="font-size:14px;font-weight:600;color:#3B6D11">¥${r.total.toLocaleString()}</span></div>`);
  });
  lds.forEach(l=>{
    const amt=parseInt(String(l.amount));
    if(l.type==='income')inc+=amt; else exp+=amt;
    const lidx=state.st.ledger.indexOf(l),guard=`sameRecord('ledger',${lidx},'${l._id}')`;
    const actionsHtml=actions?`<button class="btn sm edit" onclick="${guard}&&openLdgEdit(${lidx})">編集</button><button class="btn sm del" onclick="${guard}&&delLedger(${lidx})">削除</button>`:'';
    push(-1,'',`<div class="ri"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="badge ${l.type==='expense'?'bexp':'binc'}">${MoneyUI.escapeHtml(l.cat)}</span><div style="min-width:0"><div style="font-size:14px">${MoneyUI.escapeHtml(l.name)}</div><div style="font-size:12px;color:var(--color-text-secondary)">${MoneyUI.escapeHtml(ledgerPayLabel(l))}</div></div></div><div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:600;color:${l.type==='expense'?'#A32D2D':'#3B6D11'}">${l.type==='expense'?'-':'+'}¥${amt.toLocaleString()}</span>${actionsHtml}</div></div>`);
  });

  items.sort((a,b)=>a.sort-b.sort); // 終日(-1)が先頭、以降は時刻昇順。同値はstable sortでpush順を維持
  return {items, inc, exp};
}

export function closeDayDetail(): void{
  MoneyUI.elementById('day-detail').style.display='none';
  document.querySelectorAll('#cal-body .cday.selected').forEach(cell=>{
    cell.classList.remove('selected');cell.setAttribute('aria-expanded','false');
  });
  selDay=null;
}

// 日の詳細のボタンが指す記録（list の idx 番目）が、描いたときと同じ記録（id）かを確かめる。
// 画面が古いと、番号が別の記録を指していることがある（別の端末で消した・読み込み直した）。
// 違えば何もせず、日の詳細を描き直す
export function sameRecord(kind: 'plans' | 'ledger', idx: number, id: string): boolean{
  const list = state.st[kind];
  if(list[idx] && list[idx]._id===id) return true;
  console.warn('日の詳細が古かったので、描き直しました');
  refreshDayViews();
  return false;
}

// 月表示タップ時の日詳細（#day-detail、常設カード）。時刻ガターは出さず現行の見た目を維持
export function dayClick(ds: string): void{
  selDay=ds;
  document.querySelectorAll<HTMLElement>('#cal-body .cday').forEach(cell=>{
    const selected=cell.dataset.day===ds;
    cell.classList.toggle('selected',selected);
    cell.setAttribute('aria-expanded',String(selected));
  });
  const d=ds2d(ds), hd=getHoliday(ds);
  const {items}=buildDay(ds,{actions:true, showTime:false, tasks:'names'});
  let html=`<div class="st day-detail-head"><span>${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${DAYS[d.getDay()]})${hd?` <span style="color:#A32D2D">・${hd}</span>`:''}</span><span class="day-detail-actions"><button type="button" class="day-detail-open" onclick="jumpToDay('${ds}')">詳しく見る <span aria-hidden="true">→</span></button><button type="button" class="day-detail-close" aria-label="日の詳細を閉じる" onclick="closeDayDetail()">×</button></span></div>`;
  html += items.length ? items.map(i=>i.html).join('') : '<div class="empty">この日のイベントなし</div>';
  MoneyUI.elementById('day-detail-content').innerHTML=html;
  MoneyUI.elementById('day-detail').style.display='block';
}
// 月表示の日を押したとき: 詳細を出し、詳細が画面の下のほうに隠れていれば、見えるところまで動かす（#71）。
// カレンダーの下のほうは残すため、詳細の上の端が画面の 35% の高さに来るまでにとどめる
export function dayCellClick(ds: string): void{
  dayClick(ds);
  const detail=MoneyUI.elementById('day-detail');
  const top=detail.getBoundingClientRect().top;
  if(top>innerHeight*0.6){
    const reduce=matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollBy({top:top-innerHeight*0.35,behavior:reduce?'auto':'smooth'});
  }
}
// dir: -1|+1。月ビューは月単位、週ビューは7日単位、日ビューは1日単位でcalAnchorを動かす
function calShift(dir: number): Promise<void>{
  if(calView==='month'){
    const nm=addM(calY,calM,dir); calY=nm.y; calM=nm.m;
    calAnchor=toDS(calY,calM,1);
  }else{
    const step=calView==='week'?7:1;
    const d=ds2d(calAnchor); d.setDate(d.getDate()+dir*step);
    calAnchor=toDS(d.getFullYear(),d.getMonth(),d.getDate());
    calY=d.getFullYear(); calM=d.getMonth(); // 月ビュー復帰時のために同期しておく
  }
  return renderCal();
}
export async function prevM(): Promise<void>{await calShift(-1);}
export async function nextM(): Promise<void>{await calShift(1);}

export async function setCalView(v: 'day' | 'week' | 'month'): Promise<void>{
  if(calView===v)return;
  if(v==='month'){
    const d=ds2d(calAnchor); calY=d.getFullYear(); calM=d.getMonth();
  }else if(calView==='month'){
    calAnchor = selDay || ((calY===gY()&&calM===gM())?getToday():toDS(calY,calM,1));
  }
  calView=v;
  ['day','week','month'].forEach(x=>{
    const tab=MoneyUI.elementById('cvt-'+x),selected=x===v;
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-pressed',String(selected));
  });
  await renderCal();
}
// 週ビューの日ヘッダタップ／#day-detailの「詳しく見る」から日ビューへ遷移する共通入口
export function jumpToDay(ds: string): void{ calAnchor=ds; selDay=ds; setCalView('day'); }
// 予定/シフト/家計簿の増減後の再描画を1本化する。月ビューではselDayがあれば#day-detailを
// 更新、日/週ビューはbuildDayベースで丸ごと再描画（祝日はキャッシュ済みなので体感コストは低い）
export function refreshDayViews(): void{
  if(calView==='month'){ if(selDay) dayClick(selDay); }
  else renderCal();
}
export function togglePlanDone(idx: number): void{state.st.plans[idx].done=!state.st.plans[idx].done;save();renderCal();refreshDayViews();renderHome();}
export function deletePlan(idx: number): void{state.st.plans.splice(idx,1);save();renderCal();refreshDayViews();renderHome();}


/** カレンダー上部の固定ボタンを登録する。 */
export function bindCalendarControls(): void {
  for (const view of ['day', 'week', 'month'] as const) {
    MoneyUI.elementById('cvt-' + view).addEventListener('click', () => { void setCalView(view); });
  }
  document.querySelectorAll<HTMLButtonElement>('.cal-nav button').forEach((button, i) => {
    button.addEventListener('click', () => { void (i === 0 ? prevM() : nextM()); });
  });
}

export const LEGACY_CALENDAR = { renderCal, refreshDayViews, jumpToDay, closeDayDetail, sameRecord, dayClick, dayCellClick, togglePlanDone, deletePlan, getSelectedCalDay };
