// 祝日（Google Calendar API）とカレンダーの画面
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// 祝日（Google Calendar API）
// ============================================================
// 祝日を読むための Google のキー（ブラウザで使うので公開される）。Google Cloud で、使えるサイト（keitaro0510.github.io・手元の 127.0.0.1:8765）と
// 使える API（Google Calendar API だけ）に制限している。キーを替えたら、古いキーは Google Cloud で消す
const GCAL_API_KEY = 'AIzaSyA23lyUb631P_fKLEa1LXDGtGTx8ARkj3o';
const HOLIDAY_CAL_ID = 'ja.japanese%23holiday%40group.v.calendar.google.com';
let holidayCache = {}; // { 'YYYY-MM-DD': '祝日名' }

async function fetchHolidays(year, month){
  const cacheKey = `${year}-${String(month+1).padStart(2,'0')}`;
  if(holidayCache[cacheKey] !== undefined) return; // 取得済みならスキップ

  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month+1, 0, 23, 59, 59).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${HOLIDAY_CAL_ID}/events?key=${GCAL_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`;

  try{
    const res = await fetch(url);
    const data = await res.json();
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

function getHoliday(ds){
  return holidayCache[ds] || null;
}

// ============================================================
// カレンダー
// ============================================================
// fetchHolidaysはholidayCacheにキー済みなら即returnするため重複呼び出しは無料。
// holidayCacheは'YYYY-MM'(取得済みマーカー)と'YYYY-MM-DD'(祝日名)が同一オブジェクトに
// 混在するため、getHoliday(ds)経由以外でキー走査しないこと
async function ensureHolidays(dsList){
  const keys=[...new Set(dsList.map(ds=>ds.slice(0,7)))];
  for(const k of keys){ const[y,mm]=k.split('-').map(Number); await fetchHolidays(y,mm-1); }
}

async function renderCal(){
  const seq=++calRenderSeq;
  const isMonth=calView==='month';
  document.getElementById('cal-month-wrap').style.display=isMonth?'block':'none';
  document.getElementById('cal-list').style.display=isMonth?'none':'block';
  if(!isMonth) document.getElementById('day-detail').style.display='none';
  if(isMonth){
    await renderCalMonth(seq);
    // 日の詳細が開いていれば、今のデータで描き直す（読み込み直したあとに、古い番号のボタンを残さない）
    if(seq===calRenderSeq && selDay && document.getElementById('day-detail').style.display==='block') dayClick(selDay);
  }
  else if(calView==='week') await renderCalWeek(seq);
  else await renderCalDay(seq);
}

async function renderCalMonth(seq){
  document.getElementById('cal-title').textContent=calY+'年'+(calM+1)+'月';
  document.getElementById('cal-hdr').innerHTML=DAYS.map(d=>`<div class="chdr">${d}</div>`).join('');

  // 当月・前月・翌月分の祝日を取得（カレンダーに表示されるため）
  const prevMo=addM(calY,calM,-1),nextMo=addM(calY,calM,1);
  await ensureHolidays([toDS(calY,calM,1),toDS(prevMo.y,prevMo.m,1),toDS(nextMo.y,nextMo.m,1)]);
  if(seq!==calRenderSeq)return;

  const first=new Date(calY,calM,1).getDay(),dim=new Date(calY,calM+1,0).getDate(),prev=new Date(calY,calM,0).getDate();
  const total=Math.ceil((first+dim)/7)*7;
  const byDay={};
  monthShifts(calY,calM).forEach(s=>{const d=new Date(s.date).getDate();(byDay[d]=byDay[d]||[]).push(s);});
  const fcDays=new Set(monthlyRowsIn(calY,calM).map(fc=>monthDay(calY,calM,fc.day))); // 毎月のお金がある日（D14）
  const shimeD=st.jobs.map(j=>jobCloseDayNum(j,calY,calM)),payD=(st.jobs.length?st.jobs.map(jobPayDay):[parseInt(String(st.shiftPayDay))||10]).map(p=>monthDay(calY,calM,p));
  const taskCount=MoneyTasks.countByDay(taskRows()); // タスクの件数（期限の日ごと。D10）
  let html='';
  for(let i=0;i<total;i++){
    let day,y2=calY,m2=calM,other=false;
    if(i<first){day=prev-first+i+1;m2=calM-1;if(m2<0){m2=11;y2--;}other=true;}
    else if(i>=first+dim){day=i-first-dim+1;m2=calM+1;if(m2>11){m2=0;y2++;}other=true;}
    else day=i-first+1;
    const isT=!other&&y2===_now.getFullYear()&&m2===_now.getMonth()&&day===_now.getDate();
    const ds=toDS(y2,m2,day);
    const dow=new Date(y2,m2,day).getDay();
    const holiday=getHoliday(ds);
    const isSun=dow===0,isSat=dow===6;

    const shifts=other?[]:(byDay[day]||[]),wdT=other?[]:st.wds.filter(w=>w.date===ds),plans=other?[]:getPlansForDay(ds);
    const hasFc=!other&&fcDays.has(day);
    const isPay=!other&&payD.includes(day),isShime=!other&&shimeD.includes(day);
    const isClose=!other&&st.cards.some(c=>!c._deleted&&cardCloseDay(c,calY,calM)===day),isBill=!other&&st.cards.some((c,ci)=>monthDay(calY,calM,parseInt(c.billDay))===day&&(!c._deleted||cardBillAmount(c,ci,calY,calM)>0));

    // 日曜・祝日は赤、土曜は青で日付表示
    const dnumColor=holiday||isSun?'#A32D2D':isSat?'#185FA5':'var(--color-text-secondary)';

    let pills='';
    if(holiday&&!other) pills+=`<div class="pill holiday">${MoneyUI.escapeHtml(holiday)}</div>`;
    // タスク（D10）: 印と件数だけ。期限が過ぎた日に残っていれば赤、全部済んでいれば薄く
    const tc=other?null:taskCount.get(ds);
    if(tc) pills+=tc.open?`<div class="pill task${ds<TODAY?' overdue':''}">タスク${tc.open}</div>`:'<div class="pill task done" title="タスク（済み）">タスク</div>';
    if(isPay) pills+='<div class="pill payday">給料日</div>';
    if(isShime&&!isPay) pills+='<div class="pill shime">締め日</div>';
    if(isClose&&!isShime) pills+='<div class="pill shime">締め日</div>';
    if(isBill) pills+='<div class="pill hikiotoshi">引落</div>';
    if(hasFc) pills+='<div class="pill fixedcost">毎月</div>';
    if(wdT.length) pills+='<div class="pill wd">ATM</div>';
    shifts.forEach(s=>{const c=jobColorByName(s.job);pills+=`<div class="pill" style="background:${c.bg};color:${c.fg}">${s.start.slice(0,5)}</div>`;});
    // 予定は時刻順に並べ、時刻があれば先頭に表示する。.pillはoverflow:hidden+ellipsisがあるので
    // JS側でtitleを.sliceして切らない方が正しく省略される
    plans.sort((a,b)=>planTimeOnDay(a,ds).min-planTimeOnDay(b,ds).min);
    plans.forEach(p=>{const c=planColor(p.color),t=planTimeOnDay(p,ds);pills+=`<div class="pill" style="background:${c.bg};color:${c.fg};${p.done?'opacity:.4':''}">${t.start?t.start+' ':''}${p.title}</div>`;});
    // 支出・収入の金額はセルに出さない（D10。セルを整理する。日の詳細・週表示・家計簿では見られる）

    const selected=ds===selDay;
    html+=`<div class="cday${other?' otherm':''}${isT?' today':''}${selected?' selected':''}" data-day="${ds}" role="button" tabindex="0" aria-label="${y2}年${m2+1}月${day}日の詳細を表示" aria-expanded="${selected}" aria-controls="day-detail" aria-describedby="cal-detail-hint" onclick="dayCellClick('${ds}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();dayCellClick('${ds}')}"><div class="dnum" style="color:${dnumColor}">${day}</div>${pills}</div>`;
  }
  document.getElementById('cal-body').innerHTML=html;
}

function weekStart(ds){ const d=ds2d(ds); d.setDate(d.getDate()-d.getDay()); return d; } // 日曜始まり

function dayActionButtonsHtml(){
  return `<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
    <button class="btn plan-btn" style="flex:1" onclick="openPlanModal(selDay)">＋ 予定</button>
    <button class="btn" style="flex:1;background:var(--color-background-secondary)" onclick="openShiftModal(selDay)">＋ シフト</button>
    <button class="btn" style="flex:1;background:var(--color-background-secondary)" onclick="openLedgerModal(selDay)">＋ 支出</button>
  </div>`;
}

async function renderCalDay(seq){
  const ds=calAnchor;
  await ensureHolidays([ds]);
  if(seq!==calRenderSeq)return;
  selDay=ds;
  const d=ds2d(ds), hd=getHoliday(ds), dow=d.getDay();
  const col=hd||dow===0?'#A32D2D':dow===6?'#185FA5':'var(--color-text-primary)';
  document.getElementById('cal-title').innerHTML=`<span style="color:${col}">${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${DAYS[dow]})</span>`+(ds===TODAY?' <span class="badge bs0" style="font-size:10px">今日</span>':'');

  const {items}=buildDay(ds,{actions:true, showTime:true});
  const allday=items.filter(i=>i.sort<0), timed=items.filter(i=>i.sort>=0);

  let html='<div class="card" style="margin-bottom:8px">';
  if(hd) html+=`<div class="abar" style="background:#FCEBEB;color:#A32D2D">${hd}</div>`;
  if(allday.length) html+='<div class="st">終日・日付イベント</div>'+allday.map(i=>i.html).join('');
  if(timed.length) html+='<div class="st" style="margin-top:14px">時間指定</div>'+timed.map(i=>i.html).join('');
  if(!items.length) html+='<div class="empty">この日のイベントなし</div>';
  html+='</div>'+dayActionButtonsHtml();
  document.getElementById('cal-list').innerHTML=html;
}

async function renderCalWeek(seq){
  const ws=weekStart(calAnchor);
  const days=[...Array(7)].map((_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return toDS(d.getFullYear(),d.getMonth(),d.getDate());});
  await ensureHolidays(days); // 月跨ぎの週でも自動で2ヶ月分取得される
  if(seq!==calRenderSeq)return;
  const we=ds2d(days[6]);
  document.getElementById('cal-title').textContent=`${ws.getMonth()+1}/${ws.getDate()} 〜 ${we.getMonth()+1}/${we.getDate()}`;

  let html='';
  days.forEach(ds=>{
    const {items,inc,exp}=buildDay(ds,{actions:false, showTime:true});
    const d=ds2d(ds), dow=d.getDay(), hd=getHoliday(ds), isT=ds===TODAY;
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
  document.getElementById('cal-list').innerHTML=html;
}

/**
 * 指定日のイベントを収集して返す（DOMには触らない）。
 * pushする順序は現行dayClickと同一に保つ（給料/締め日→カード→固定費→ATM→予定→シフト→家計簿）。
 * これによりsortが同値=終日群(-1)はJSのstable sortでpush順のまま保たれ、
 * 月タップの#day-detail（showTime:false）は現行の見た目・並びと完全に一致する。
 * @param {string} ds 'YYYY-MM-DD'
 * @param {{actions?:boolean, showTime?:boolean, tasks?:'names'}} [opts]
 *   actions  : 編集/削除ボタンを含めるか（省略時true。週ビューはfalseで圧縮しつつ
 *              インデックスずれ事故のリスクも減らす）
 *   showTime : 各アイテムの左に時刻ガター(.ri-time)を出すか（省略時false）
 *   tasks    : 'names' ならタスクの名前を出す（日の詳細）。省略時は件数だけ（D10）
 * @returns {{items:Array<{sort:number,time:string,html:string}>, inc:number, exp:number}}
 */
function buildDay(ds, opts={}){
  const actions=opts.actions!==false, showTime=!!opts.showTime;
  const d=ds2d(ds), y=d.getFullYear(), m=d.getMonth(), day=d.getDate();
  const shifts=st.shifts.filter(s=>s.date===ds),lds=getLedgerForDay(ds),wdList=st.wds.filter(w=>w.date===ds),
        plans=getPlansForDay(ds),fcList=monthlyRowsIn(y,m).filter(fc=>monthDay(y,m,fc.day)===day);
  const items=[]; let inc=0, exp=0;
  const push=(sort,time,html)=>items.push({sort,time,html:showTime?`<div class="ri-with-time"><span class="ri-time">${time||''}</span>${html}</div>`:html});

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

  st.jobs.forEach(job=>{
    const jPayD=monthDay(y,m,jobPayDay(job)),jShimeD=jobCloseDayNum(job,y,m);
    if(day===jPayD){
      const sm=addM(y,m,-1);
      const act=getActualSalary(job.name,sm.y,sm.m);
      const si=act?parseInt(act.actualAmount):totalShiftIncForJob(job.name,sm.y,sm.m);
      if(si>0){inc+=si;push(-1,'',`<div class="ri"><span class="badge binc">${job.name} 給料入金</span><span style="font-size:14px;font-weight:600;color:#3B6D11">+¥${si.toLocaleString()}</span></div>`);}
    }
    if(day===jShimeD&&day!==jPayD)push(-1,'',`<div class="ri"><span class="badge bpending">${job.name} 締め日</span></div>`);
  });
  st.cards.forEach((card,ci)=>{
    const cl=cardCloseDay(card,y,m),billD=monthDay(y,m,parseInt(card.billDay));
    if(!card._deleted&&day===cl){
      const billM=addM(y,m,1);
      const isPending=new Date(y,m,cl)>=new Date(gY(),gM(),gD());
      push(-1,'',`<div class="ri"><span class="badge bcard">${MoneyUI.escapeHtml(card.name)}</span><span class="ri-note">${isPending?'集計中・':''}締め日（${billM.m+1}月${monthDay(billM.y,billM.m,parseInt(card.billDay))}日に引き落とし）</span></div>`);
    }
    if(day===billD){
      const actual=getActualCard(ci,y,m);
      const billCycle=cardCycleForBillMonth(card,ci,y,m);
      const amt=actual?parseInt(actual.actualAmount):billCycle.amount;
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
  wdList.forEach(w=>push(-1,'',`<div class="ri"><span class="badge bwd">ATM引き出し</span><span style="font-size:14px;font-weight:600;color:#3C3489">-¥${parseInt(w.amount).toLocaleString()}</span></div>`));
  plans.forEach(p=>{
    const pidx=st.plans.indexOf(p),c=planColor(p.color);
    const isMultiDay=p.dateEnd&&p.dateEnd!==p.date;
    const t=planTimeOnDay(p,ds);
    const timeLabel=t.start&&t.end?`${t.start}〜${t.end}`:t.start?t.start:t.end?`〜${t.end}`:'';
    // ボタンには番号と ID を埋め込み、押したときに同じ記録かを確かめる（sameRecord）
    const guard=`sameRecord(st.plans,${pidx},'${p._id}')`;
    const actionsHtml=actions?`<button class="btn sm edit" onclick="${guard}&&openPlanEdit(${pidx})">編集</button><button class="btn sm del" onclick="${guard}&&deletePlan(${pidx})">削除</button>`:'';
    // 「済み」のチェック（D2）: 済みにした予定は、予算を見込みの支出に入れない。列の名前は done のまま（D11 で見直す）
    // 名前とメモは、自由に入れた文字なのでエスケープする
    const title=MoneyUI.escapeHtml(p.title);
    push(t.min,timeLabel,`<div class="ri" style="${p.done?'opacity:.5':''}"><div style="display:flex;align-items:center;gap:4px"><label class="plan-done" title="済みにすると、予算を見込みの支出に入れません"><input type="checkbox" ${p.done?'checked':''} aria-label="「${title}」を済みにする（予算に含めない）" onchange="${guard}&&togglePlanDone(${pidx})"></label><div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><div style="width:10px;height:10px;border-radius:50%;background:${c.dot};flex-shrink:0"></div><span style="font-size:14px${p.done?';text-decoration:line-through':''}">${title}</span>${p.done?'<span class="plan-done-badge">済み・予算に含めない</span>':''}${isMultiDay?`<span style="font-size:10px;color:${c.fg};background:${c.bg};padding:1px 6px;border-radius:100px">${ds2d(p.dateStart).getDate()}〜${ds2d(p.dateEnd).getDate()}日</span>`:''}</div>${p.memo?`<div style="font-size:12px;color:var(--color-text-secondary)">${MoneyUI.escapeHtml(p.memo)}</div>`:''}</div></div><div style="display:flex;align-items:center;gap:6px">${p.budget>0?`<span style="font-size:13px;font-weight:600;color:${c.fg}">-¥${p.budget.toLocaleString()}</span>`:''}${actionsHtml}</div></div>`);
  });
  shifts.forEach(s=>{
    const c=jobColorByName(s.job),r=calcShiftInc(s);
    inc+=r.total;
    push(hm2min(s.start),s.start,`<div class="ri"><div><div style="display:flex;align-items:center;gap:8px"><span class="badge" style="background:${c.bg};color:${c.fg}">${s.job}</span><span style="font-size:13px">${s.start}〜${s.end}</span></div><div style="font-size:11px;color:var(--color-text-secondary)">${r.restMin>0?`休憩${r.restMin}分 `:''}${r.nightH>0?`深夜${r.nightH.toFixed(1)}h `:''} ${r.transport>0?`交通費 ¥${r.transport.toLocaleString()}`:''}</div></div><span style="font-size:14px;font-weight:600;color:#3B6D11">¥${r.total.toLocaleString()}</span></div>`);
  });
  lds.forEach(l=>{
    const amt=parseInt(l.amount);
    if(l.type==='income')inc+=amt; else exp+=amt;
    const lidx=st.ledger.indexOf(l),guard=`sameRecord(st.ledger,${lidx},'${l._id}')`;
    const actionsHtml=actions?`<button class="btn sm edit" onclick="${guard}&&openLdgEdit(${lidx})">編集</button><button class="btn sm del" onclick="${guard}&&delLedger(${lidx})">削除</button>`:'';
    push(-1,'',`<div class="ri"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span class="badge ${l.type==='expense'?'bexp':'binc'}">${MoneyUI.escapeHtml(l.cat)}</span><div style="min-width:0"><div style="font-size:14px">${MoneyUI.escapeHtml(l.name)}</div><div style="font-size:12px;color:var(--color-text-secondary)">${MoneyUI.escapeHtml(ledgerPayLabel(l))}</div></div></div><div style="display:flex;align-items:center;gap:6px"><span style="font-size:14px;font-weight:600;color:${l.type==='expense'?'#A32D2D':'#3B6D11'}">${l.type==='expense'?'-':'+'}¥${amt.toLocaleString()}</span>${actionsHtml}</div></div>`);
  });

  items.sort((a,b)=>a.sort-b.sort); // 終日(-1)が先頭、以降は時刻昇順。同値はstable sortでpush順を維持
  return {items, inc, exp};
}

function closeDayDetail(){
  document.getElementById('day-detail').style.display='none';
  document.querySelectorAll('#cal-body .cday.selected').forEach(cell=>{
    cell.classList.remove('selected');cell.setAttribute('aria-expanded','false');
  });
  selDay=null;
}

// 日の詳細のボタンが指す記録（list の idx 番目）が、描いたときと同じ記録（id）かを確かめる。
// 画面が古いと、番号が別の記録を指していることがある（別の端末で消した・読み込み直した）。
// 違えば何もせず、日の詳細を描き直す
function sameRecord(list, idx, id){
  if(list[idx] && list[idx]._id===id) return true;
  console.warn('日の詳細が古かったので、描き直しました');
  refreshDayViews();
  return false;
}

// 月表示タップ時の日詳細（#day-detail、常設カード）。時刻ガターは出さず現行の見た目を維持
function dayClick(ds){
  selDay=ds;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#cal-body .cday')).forEach(cell=>{
    const selected=cell.dataset.day===ds;
    cell.classList.toggle('selected',selected);
    cell.setAttribute('aria-expanded',String(selected));
  });
  const d=ds2d(ds), hd=getHoliday(ds);
  const {items}=buildDay(ds,{actions:true, showTime:false, tasks:'names'});
  let html=`<div class="st day-detail-head"><span>${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${DAYS[d.getDay()]})${hd?` <span style="color:#A32D2D">・${hd}</span>`:''}</span><span class="day-detail-actions"><button type="button" class="day-detail-open" onclick="jumpToDay('${ds}')">詳しく見る <span aria-hidden="true">→</span></button><button type="button" class="day-detail-close" aria-label="日の詳細を閉じる" onclick="closeDayDetail()">×</button></span></div>`;
  html += items.length ? items.map(i=>i.html).join('') : '<div class="empty">この日のイベントなし</div>';
  document.getElementById('day-detail-content').innerHTML=html;
  document.getElementById('day-detail').style.display='block';
}
// 月表示の日を押したとき: 詳細を出し、詳細が画面の下のほうに隠れていれば、見えるところまで動かす（#71）。
// カレンダーの下のほうは残すため、詳細の上の端が画面の 35% の高さに来るまでにとどめる
function dayCellClick(ds){
  dayClick(ds);
  const detail=document.getElementById('day-detail');
  const top=detail.getBoundingClientRect().top;
  if(top>window.innerHeight*0.6){
    const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({top:top-window.innerHeight*0.35,behavior:reduce?'auto':'smooth'});
  }
}
// dir: -1|+1。月ビューは月単位、週ビューは7日単位、日ビューは1日単位でcalAnchorを動かす
function calShift(dir){
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
async function prevM(){await calShift(-1);}  // 既存の関数名・onclickを温存
async function nextM(){await calShift(1);}

async function setCalView(v){
  if(calView===v)return;
  if(v==='month'){
    const d=ds2d(calAnchor); calY=d.getFullYear(); calM=d.getMonth();
  }else if(calView==='month'){
    calAnchor = selDay || ((calY===gY()&&calM===gM())?TODAY:toDS(calY,calM,1));
  }
  calView=v;
  ['day','week','month'].forEach(x=>{
    const tab=document.getElementById('cvt-'+x),selected=x===v;
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-pressed',String(selected));
  });
  await renderCal();
}
// 週ビューの日ヘッダタップ／#day-detailの「詳しく見る」から日ビューへ遷移する共通入口
function jumpToDay(ds){ calAnchor=ds; selDay=ds; setCalView('day'); }
// 予定/シフト/家計簿の増減後の再描画を1本化する。月ビューではselDayがあれば#day-detailを
// 更新、日/週ビューはbuildDayベースで丸ごと再描画（祝日はキャッシュ済みなので体感コストは低い）
function refreshDayViews(){
  if(calView==='month'){ if(selDay) dayClick(selDay); }
  else renderCal();
}
function togglePlanDone(idx){st.plans[idx].done=!st.plans[idx].done;save();renderCal();refreshDayViews();renderHome();}
function deletePlan(idx){st.plans.splice(idx,1);save();renderCal();refreshDayViews();renderHome();}

