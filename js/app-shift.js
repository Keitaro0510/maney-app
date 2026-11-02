// シフトの画面
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// シフト
// ============================================================
function openShiftModal(ds){document.getElementById('m-job').innerHTML=!st.jobs.some(j=>!j._deleted)?'<option value="">先にバイト先を登録</option>':st.jobs.filter(j=>!j._deleted).map(j=>`<option value="${j.name}">${j.name}</option>`).join('');selShiftDays.clear();if(ds){selShiftDays.add(ds);shiftCalY=ds2d(ds).getFullYear();shiftCalM=ds2d(ds).getMonth();}else{shiftCalY=shiftListY;shiftCalM=shiftListM;}MoneyUI.inputById('m-start').value='09:00';MoneyUI.inputById('m-end').value='17:00';MoneyUI.inputById('m-rest').value='0';renderRestChips();document.getElementById('shift-cal-dow').innerHTML=DAYS.map(d=>`<div style="font-size:11px;color:var(--color-text-secondary);text-align:center;font-weight:500">${d}</div>`).join('');updateShiftPreview();renderShiftCal();document.getElementById('m-job').onchange=updateShiftPreview;document.getElementById('m-start').oninput=updateShiftPreview;document.getElementById('m-end').oninput=updateShiftPreview;document.getElementById('m-rest').oninput=()=>{renderRestChips();updateShiftPreview();};document.getElementById('shift-mbg').classList.add('open');}
function renderRestChips(){const el=document.getElementById('m-rest-chips');if(!el)return;const cur=parseInt(MoneyUI.inputById('m-rest').value)||0;const opts=[0,45,60,90];el.innerHTML=opts.map(v=>`<button type="button" class="pay-chip${cur===v?' sel':''}" onclick="setRestMin(${v})">${v===0?'なし':v+'分'}</button>`).join('');}
function setRestMin(v){MoneyUI.inputById('m-rest').value=v;renderRestChips();updateShiftPreview();}
// 退勤が出勤より後かを確かめ、違えば入力画面に知らせを出す。日をまたぐシフトは登録しない（給料を計算できないため）
function checkShiftTime(){const start=MoneyUI.inputById('m-start').value,end=MoneyUI.inputById('m-end').value;const ok=!start||!end||MoneyClock.endsAfterStart(start,end);document.getElementById('m-time-err').hidden=ok;document.getElementById('m-end').setAttribute('aria-invalid',String(!ok));return ok;}
function updateShiftPreview(){checkShiftTime();const jobName=MoneyUI.selectById('m-job').value,job=st.jobs.find(j=>j.name===jobName),start=MoneyUI.inputById('m-start').value,end=MoneyUI.inputById('m-end').value,rest=parseInt(MoneyUI.inputById('m-rest').value)||0;if(!job||!start||!end){['m-prev','m-transport','m-prev-total','m-total-all'].forEach(id=>document.getElementById(id).textContent='¥0');document.getElementById('m-night').textContent='0h';document.getElementById('m-rest-lbl').textContent=rest+'分';return;}const r=calcShiftInc({job:jobName,start,end,rest});document.getElementById('m-prev').textContent='¥'+(r.wage+r.nightWage).toLocaleString();document.getElementById('m-night').textContent=r.nightH.toFixed(1)+'h';document.getElementById('m-rest-lbl').textContent=r.restMin+'分';document.getElementById('m-transport').textContent='¥'+r.transport.toLocaleString();document.getElementById('m-prev-total').textContent='¥'+r.total.toLocaleString();document.getElementById('m-total-all').textContent='¥'+(r.total*selShiftDays.size).toLocaleString();}
function renderShiftCal(){document.getElementById('m-month-lbl').textContent=shiftCalY+'年'+(shiftCalM+1)+'月';const first=new Date(shiftCalY,shiftCalM,1).getDay(),dim=new Date(shiftCalY,shiftCalM+1,0).getDate(),prev=new Date(shiftCalY,shiftCalM,0).getDate();const total=Math.ceil((first+dim)/7)*7;let html='';for(let i=0;i<total;i++){let day,y2=shiftCalY,m2=shiftCalM,other=false;if(i<first){day=prev-first+i+1;m2=shiftCalM-1;if(m2<0){m2=11;y2--;}other=true;}else if(i>=first+dim){day=i-first-dim+1;m2=shiftCalM+1;if(m2>11){m2=0;y2++;}other=true;}else day=i-first+1;const ds=toDS(y2,m2,day);html+=`<button type="button" class="chk-day${other?' off':''}${selShiftDays.has(ds)?' sel':''}" aria-label="${m2+1}月${day}日" onclick="toggleShiftDay('${ds}',${other})">${day}</button>`;}document.getElementById('shift-cal-grid').innerHTML=html;document.getElementById('sel-days-count').textContent=selShiftDays.size+'日';updateShiftPreview();}
function toggleShiftDay(ds,other){if(other)return;if(selShiftDays.has(ds))selShiftDays.delete(ds);else selShiftDays.add(ds);renderShiftCal();}
function shiftCalPrev(){shiftCalM--;if(shiftCalM<0){shiftCalM=11;shiftCalY--;}renderShiftCal();}
function shiftCalNext(){shiftCalM++;if(shiftCalM>11){shiftCalM=0;shiftCalY++;}renderShiftCal();}
function saveShift(){const job=MoneyUI.selectById('m-job').value,start=MoneyUI.inputById('m-start').value,end=MoneyUI.inputById('m-end').value,rest=Math.max(0,parseInt(MoneyUI.inputById('m-rest').value)||0);const jobObj=st.jobs.find(j=>j.name===job);if(!job||!start||!end||!jobObj||selShiftDays.size===0)return;if(!checkShiftTime())return;selShiftDays.forEach(ds=>st.shifts.push({job,date:ds,start,end,rest,wage:jobObj.wage}));save();closeShiftModal();renderCal();renderShiftSection();renderHome();}
function closeShiftModal(){document.getElementById('shift-mbg').classList.remove('open');}
function shiftListPrev(){const nm=addM(shiftListY,shiftListM,-1);shiftListY=nm.y;shiftListM=nm.m;renderShiftList();}
function shiftListNext(){const nm=addM(shiftListY,shiftListM,1);shiftListY=nm.y;shiftListM=nm.m;renderShiftList();}
function renderShiftList(){const y=shiftListY,m=shiftListM;const ms=monthShifts(y,m).sort((a,b)=>a.date.localeCompare(b.date));const isCurrentMonth=(y===gY()&&m===gM());const payM=addM(y,m,1);const totalInc=ms.reduce((a,s)=>a+calcShiftInc(s).total,0);document.getElementById('shift-list-month-label').textContent=`${y}年${m+1}月のシフト`;const jobsInMonth=[...new Set(ms.map(s=>s.job))];const payLabel=jobsInMonth.length?jobsInMonth.map(jn=>{const job=st.jobs.find(j=>j.name===jn);return `${jn} ${payM.m+1}月${monthDay(payM.y,payM.m,jobPayDay(job))}日`;}).join('　'):`${payM.m+1}月${monthDay(payM.y,payM.m,parseInt(String(st.shiftPayDay))||10)}日払い`;document.getElementById('shift-list-month-sub').textContent=`${ms.length}件　¥${totalInc.toLocaleString()}　→　${payLabel}`;document.getElementById('shift-list-month-label').style.color=isCurrentMonth?'#185FA5':'var(--color-text-primary)';document.getElementById('shift-met-month-label').textContent=`${m+1}月出勤`;document.getElementById('s-days').textContent=ms.length+'日';document.getElementById('s-hours').textContent=ms.reduce((a,s)=>a+calcH(s.start,s.end,s.rest),0).toFixed(1)+'h';document.getElementById('s-income').textContent='¥'+totalInc.toLocaleString();if(!ms.length){document.getElementById('shift-list').innerHTML='<div class="empty">この月のシフトなし</div>';return;}document.getElementById('shift-list').innerHTML=ms.map(s=>{const c=jobColorByName(s.job),d=ds2d(s.date),ri=st.shifts.indexOf(s),r=calcShiftInc(s);return `<div class="ri"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:0"><span style="font-size:13px;color:var(--color-text-secondary)">${d.getMonth()+1}/${d.getDate()}(${DAYS[d.getDay()]})</span><span class="badge" style="background:${c.bg};color:${c.fg}">${MoneyUI.escapeHtml(s.job)}</span><div><div style="font-size:13px">${s.start}〜${s.end}</div><div style="font-size:11px;color:var(--color-text-secondary)">${r.restMin>0?`休憩${r.restMin}分 `:''}${r.nightH>0?`深夜${r.nightH.toFixed(1)}h `:''} ${r.transport>0?`交通費¥${r.transport.toLocaleString()}`:''}</div></div></div><div style="display:flex;align-items:center;gap:8px;flex:none"><span style="font-size:14px;font-weight:600;color:#3B6D11">¥${r.total.toLocaleString()}</span><button class="btn sm del" onclick="delShift(${ri})">削除</button></div></div>`;}).join('');}
function renderShiftSection(){renderFuyou();renderSalaryTable();renderMonthBars();const y=gY(),m=gM(),ms=monthShifts(y,m),totalInc=ms.reduce((a,s)=>a+calcShiftInc(s).total,0),transport=ms.reduce((a,s)=>a+calcShiftInc(s).transport,0);document.getElementById('year-confirmed').textContent='¥'+yearConfirmedIncome().toLocaleString();document.getElementById('year-estimated').textContent='¥'+yearEstimatedIncome().toLocaleString();document.getElementById('year-this-month').textContent='¥'+(totalInc-transport).toLocaleString();document.getElementById('year-transport').textContent='¥'+transport.toLocaleString();renderShiftList();renderJobList();}
function renderSalaryTable(){
  const y=gY(),el=document.getElementById('salary-table');
  if(!st.jobs.length){el.innerHTML='<div class="empty">バイト先を登録するとここに表示されます</div>';return;}
  let html='';
  st.jobs.forEach(job=>{
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
      const actual=st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      const estimated=totalShiftIncNoTransportForJob(job.name,shiftY,shiftM);
      if(estimated===0&&!actual&&payDate>today)continue;
      const dispActual=actual?parseInt(actual.actualAmount):null;
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
            onchange="onSalaryChangeByPayMonth('${job.name.replace(/'/g,"\\'")}',${y},${payM},${shiftY},${shiftM},this.value)"/>
          ${dispActual?'<span class="act-badge">入力済</span>':''}
        </div>
      </div>`;
      if(idle)idleRows+=row;else rows+=row;
    }
    const idleHtml=idleCount?`<details class="salary-idle"><summary>勤務のない月も見る（${idleCount}か月）</summary>${idleRows}</details>`:'';
    html+=`<div style="margin-bottom:6px"><div style="display:flex;align-items:center;gap:6px;margin:10px 0 4px"><div class="dot" style="background:${c.dot}"></div><span style="font-size:13px;font-weight:600">${MoneyUI.escapeHtml(job.name)}</span></div>${rows||'<div class="empty">今年はまだ勤務がありません</div>'}${idleHtml}</div>`;
  });
  el.innerHTML=html;
}

function onSalaryChangeByPayMonth(jobName,payY,payM,shiftY,shiftM,val){
  const amount=parseInt(val)||0;
  const job=st.jobs.find(j=>j.name===jobName);
  const salaryKey=salaryKeyForShiftMonth(jobName,shiftY,shiftM);
  if(amount>0){
    const pay=jobPayDay(job);
    const date=toDS(payY,payM-1,monthDay(payY,payM-1,pay));
    const ei=st.actualInputs.findIndex(a=>a.type==='shift'&&a.job===jobName&&a.salaryKey===salaryKey);
    const entry={type:'shift',job:jobName,salaryKey,date,actualAmount:amount,estimatedAmount:totalShiftIncNoTransportForJob(jobName,shiftY,shiftM)};
    if(ei>=0){entry._id=st.actualInputs[ei]._id;st.actualInputs[ei]=entry;}else st.actualInputs.push(entry);
  }else{
    st.actualInputs=st.actualInputs.filter(a=>!(a.type==='shift'&&a.job===jobName&&a.salaryKey===salaryKey));
  }
  save();renderShiftSection();renderHome();
}

// 振込年で収入を集計（扶養計算用）
function yearConfirmedIncome(){
  let total=parseInt(String(st.otherIncome))||0;
  const y=gY(),today=new Date();
  st.jobs.forEach(job=>{
    const pay=jobPayDay(job);
    for(let payM=1;payM<=12;payM++){
      const shiftMo=addM(y,payM-1,-1);
      const salaryKey=salaryKeyForShiftMonth(job.name,shiftMo.y,shiftMo.m);
      const actual=st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      const payDate=monthDate(y,payM-1,pay);
      if(actual) total+=parseInt(actual.actualAmount);
      else if(payDate<=today) total+=totalShiftIncNoTransportForJob(job.name,shiftMo.y,shiftMo.m);
    }
  });
  return total;
}

function yearEstimatedIncome(){
  let total=parseInt(String(st.otherIncome))||0;
  const y=gY();
  st.jobs.forEach(job=>{
    for(let payM=1;payM<=12;payM++){
      const shiftMo=addM(y,payM-1,-1);
      const salaryKey=salaryKeyForShiftMonth(job.name,shiftMo.y,shiftMo.m);
      const actual=st.actualInputs.find(a=>a.type==='shift'&&a.job===job.name&&a.salaryKey===salaryKey);
      total+=actual?parseInt(actual.actualAmount):totalShiftIncNoTransportForJob(job.name,shiftMo.y,shiftMo.m);
    }
  });
  return total;
}
function renderFuyou(){const confirmed=yearConfirmedIncome(),estimated=yearEstimatedIncome();const limits=[];if(st.fuyouLimit==='1030000'||st.fuyouLimit==='both')limits.push({label:'103万円の壁',amount:1030000,color:'#185FA5'});if(st.fuyouLimit==='1300000'||st.fuyouLimit==='both')limits.push({label:'130万円の壁',amount:1300000,color:'#993556'});let html='';limits.forEach(lim=>{const pct=Math.min(100,Math.round(confirmed/lim.amount*100)),estPct=Math.min(100,Math.round(estimated/lim.amount*100));const color=pct>=90?'#A32D2D':pct>=70?'#BA7517':lim.color;html+=`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px"><span style="font-size:13px;font-weight:600">${lim.label}</span><span style="font-size:11px;color:var(--color-text-secondary)">残り ¥${Math.max(0,lim.amount-estimated).toLocaleString()}</span></div><div style="height:10px;background:var(--color-background-secondary);border-radius:5px;overflow:hidden"><div style="height:100%;width:${estPct}%;background:${color}30;border-radius:5px"></div><div style="height:100%;width:${pct}%;background:${color};border-radius:5px;position:relative;margin-top:-10px"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-secondary);margin-top:3px"><span>確定 ${pct}% ¥${confirmed.toLocaleString()}</span><span>予想 ${estPct}% ¥${estimated.toLocaleString()}</span></div>${pct>=90?`<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:6px 10px;font-size:12px;margin-top:6px">⚠ 残り ¥${Math.max(0,lim.amount-confirmed).toLocaleString()}</div>`:''}</div>`;});document.getElementById('fuyou-content').innerHTML=html;}
function renderMonthBars(){const y=gY(),vals=Array.from({length:12},(_,m)=>{if(!st.jobs.length)return totalShiftIncNoTransport(y,m);return st.jobs.reduce((sum,job)=>{const a=getActualSalary(job.name,y,m);return sum+(a?parseInt(a.actualAmount):totalShiftIncNoTransportForJob(job.name,y,m));},0);}),hasActual=Array.from({length:12},(_,m)=>st.jobs.length?st.jobs.some(job=>getActualSalary(job.name,y,m)):false);const maxV=Math.max(...vals,1);let html='';for(let m=0;m<12;m++){const v=vals[m],pct=Math.round(v/maxV*100),isCurrent=m===gM(),actual=hasActual[m];html+=`<div class="month-bar-row"><span class="month-bar-label" style="${isCurrent?'color:var(--color-text-primary);font-weight:600':''}">${m+1}月</span><div class="month-bar-bg"><div class="month-bar" style="width:${pct}%;background:${actual?'#3B6D11':isCurrent?'#185FA5':'#185FA540'}"></div></div><span class="month-bar-val">${v>0?(actual?'¥'+v.toLocaleString()+'✓':'¥'+v.toLocaleString()):'-'}</span></div>`;}document.getElementById('month-bars').innerHTML=html;}
let jobAddColorSel=null;
function ensureJobAddColor(){if(!jobAddColorSel)jobAddColorSel=PLAN_COLORS[st.jobs.length%PLAN_COLORS.length].key;renderJobAddColorSwatches();}
function renderJobAddColorSwatches(){const el=document.getElementById('job-color-swatches');if(!el)return;el.innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${jobAddColorSel===c.key?' sel':''}" style="background:${c.dot}" onclick="selJobAddColor('${c.key}')" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
function selJobAddColor(key){jobAddColorSel=key;renderJobAddColorSwatches();}
function renderJobList(){ensureJobAddColor();const el=document.getElementById('job-list');el.innerHTML=!st.jobs.some(j=>!j._deleted)?'<div class="empty">バイト先未登録</div>':st.jobs.map((j,i)=>{if(j._deleted)return'';const c=jobColorObj(j);return `<div class="ri"><div style="display:flex;align-items:center;gap:8px"><div class="dot" style="background:${c.dot}"></div><div><div style="font-size:14px">${j.name}</div><div style="font-size:11px;color:var(--color-text-secondary)">時給 ¥${j.wage} / 深夜 ${j.nightStart||'22:00'}〜+${j.nightRate||25}% / 交通費 ¥${(j.transport||0)*2}/回</div><div style="font-size:11px;color:var(--color-text-secondary)">締め日 ${(parseInt(j.closeDay)||31)>=28?'月末':(parseInt(j.closeDay)||31)+'日'} / 給料日 翌月${jobPayDay(j)}日</div></div></div><div style="display:flex;gap:6px"><button class="btn sm edit" onclick="openJobEdit(${i})">編集</button><button class="btn sm del" onclick="delJob(${i})">削除</button></div></div>`;}).join('');}
function addJob(){const name=MoneyUI.inputById('job-name').value.trim(),wage=parseInt(MoneyUI.inputById('job-wage').value)||0;if(!name||!wage)return;const nightStart=MoneyUI.inputById('job-night-start').value||'22:00',nightRate=parseInt(MoneyUI.inputById('job-night-rate').value)||25,transport=parseInt(MoneyUI.inputById('job-transport').value)||0,closeDayVal=parseInt(MoneyUI.inputById('job-close-day').value)||parseInt(String(st.shiftCloseDay))||31,payDayVal=parseInt(MoneyUI.inputById('job-pay-day').value)||parseInt(String(st.shiftPayDay))||10,color=jobAddColorSel||PLAN_COLORS[st.jobs.length%PLAN_COLORS.length].key;st.jobs.push({name,wage,nightStart,nightRate,transport,closeDay:closeDayVal,payDay:payDayVal,color});save();MoneyUI.inputById('job-name').value='';MoneyUI.inputById('job-wage').value='';MoneyUI.inputById('job-transport').value='';MoneyUI.inputById('job-close-day').value='';MoneyUI.inputById('job-pay-day').value='';jobAddColorSel=null;renderJobList();renderShiftSection();renderCal();toggleJobAdd(false);MoneyUI.toast(`「${name}」を追加しました`);}
// 「バイト先を追加」の欄を開く・閉じる（open を省くと、開いていれば閉じる）
function toggleJobAdd(open){
  const form=document.getElementById('job-add-form'),btn=document.getElementById('job-add-toggle');
  const next=open===undefined?form.hidden:open;
  form.hidden=!next;btn.hidden=next;btn.setAttribute('aria-expanded',String(next));
  if(next){renderJobAddColorSwatches();document.getElementById('job-name').focus();}else btn.focus();
}
let jobEditIdx=-1,jobEditColorSel='blue';
function openJobEdit(i){jobEditIdx=i;const j=st.jobs[i];MoneyUI.inputById('je-name').value=j.name;MoneyUI.inputById('je-wage').value=j.wage;MoneyUI.inputById('je-night-start').value=j.nightStart||'22:00';MoneyUI.inputById('je-night-rate').value=j.nightRate||25;MoneyUI.inputById('je-transport').value=j.transport||'';MoneyUI.inputById('je-close-day').value=j.closeDay||st.shiftCloseDay||31;MoneyUI.inputById('je-pay-day').value=j.payDay||st.shiftPayDay||10;jobEditColorSel=jobColorObj(j).key;renderJobEditColorSwatches();document.getElementById('job-edit-mbg').classList.add('open');}
function closeJobEdit(){document.getElementById('job-edit-mbg').classList.remove('open');}
function renderJobEditColorSwatches(){document.getElementById('je-color-swatches').innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${jobEditColorSel===c.key?' sel':''}" style="background:${c.dot}" onclick="selJobEditColor('${c.key}')" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
function selJobEditColor(key){jobEditColorSel=key;renderJobEditColorSwatches();}
function saveJobEdit(){const name=MoneyUI.inputById('je-name').value.trim(),wage=parseInt(MoneyUI.inputById('je-wage').value)||0;if(!name||!wage||jobEditIdx<0)return;const oldName=st.jobs[jobEditIdx].name;const nightStart=MoneyUI.inputById('je-night-start').value||'22:00',nightRate=parseInt(MoneyUI.inputById('je-night-rate').value)||25,transport=parseInt(MoneyUI.inputById('je-transport').value)||0,closeDayVal=parseInt(MoneyUI.inputById('je-close-day').value)||parseInt(String(st.shiftCloseDay))||31,payDayVal=parseInt(MoneyUI.inputById('je-pay-day').value)||parseInt(String(st.shiftPayDay))||10;st.jobs[jobEditIdx]={_id:st.jobs[jobEditIdx]._id,name,wage,nightStart,nightRate,transport,closeDay:closeDayVal,payDay:payDayVal,color:jobEditColorSel};if(oldName!==name){st.shifts.forEach(s=>{if(s.job===oldName)s.job=name;});st.actualInputs.forEach(a=>{if(a.type==='shift'&&a.job===oldName){a.job=name;a.salaryKey=a.salaryKey.replace(`${oldName}|`,`${name}|`);}});}save();closeJobEdit();renderJobList();renderShiftSection();renderCal();renderHome();}
function delJob(i){st.jobs[i]._deleted=true;/* 削除済みにする */save();renderJobList();}
function delShift(i){st.shifts.splice(i,1);save();renderShiftList();renderShiftSection();renderCal();renderHome();}

