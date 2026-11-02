// 家計簿の画面（記録一覧・グラフ・対象年月のナビ）
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// 家計簿
// ============================================================
// opts.repeat: 「毎月くり返す」を選んだ状態で開く（家計簿のタブの「毎月のお金」から）
function openLedgerModal(ds,opts={}){ldgType='expense';ldgPay='現金';ldgCardIdx=-1;ldgCat=st.catExp[0]||'';ldgReceive='現金';MoneyUI.inputById('ldg-date').value=ds||TODAY;MoneyUI.inputById('ldg-amount').value='';MoneyUI.inputById('ldg-name').value='';MoneyUI.textareaById('ldg-memo').value='';MoneyUI.inputById('ldg-repeat').checked=!!opts.repeat;renderLdgType();renderCatChips();renderPayChips();renderLdgRepeat();document.getElementById('ldg-mbg').classList.add('open');window.setTimeout(()=>document.getElementById('ldg-amount')?.focus(),80);}
function selLdgType(t){ldgType=t;ldgCat=(t==='expense'?st.catExp[0]:st.catInc[0])||'';renderLdgType();renderCatChips();renderPayChips();renderLdgRepeat();}
function renderLdgType(){document.querySelectorAll('#ldg-type-chips .pay-chip').forEach((el,i)=>el.classList.toggle('sel',['expense','income'][i]===ldgType));}
function renderCatChips(){const cats=ldgType==='expense'?st.catExp:st.catInc;if(!cats.includes(ldgCat))ldgCat=cats[0]||'';document.getElementById('cat-chips').innerHTML=cats.map(c=>`<button type="button" class="chip${ldgCat===c?' sel':''}" onclick="selCat('${c}')">${c}</button>`).join('');}
function selCat(c){ldgCat=c;document.querySelectorAll('#cat-chips .chip').forEach(el=>el.classList.toggle('sel',el.textContent===c));}
// 支払い方法の選択肢: 現金・口座（D11）・カード。削除済みのカードは、その記録が使っているときだけ出す
/** @typedef {{ label: string, pay: string, ci: number, hidden?: boolean }} PayOption */
function payOptions(curCardIdx){return /** @type {PayOption[]} */ ([{label:'現金',pay:'現金',ci:-1},{label:'口座',pay:'口座',ci:-1},...st.cards.map((c,i)=>({label:c.name,pay:c.name,ci:i,hidden:c._deleted&&curCardIdx!==i}))]).filter(o=>!o.hidden);}
const isPaySel=(o,pay,ci)=>o.ci>=0?ci===o.ci:(ci<0&&(pay==='口座')===(o.pay==='口座'));
const payHint=(pay,ci)=>ci>=0?'カードの引き落とし日に、口座から引きます':pay==='口座'?'振込・口座引き落としなど。その日に口座の残高から引きます':'現金は、ATM で引き出したときに口座から引いています';
function payChipsHtml(pay,ci,fn){return payOptions(ci).map((o,k)=>`<button type="button" class="pay-chip${isPaySel(o,pay,ci)?' sel':''}" onclick="${fn}(${k})">${MoneyUI.escapeHtml(o.label)}</button>`).join('');}
function renderPayChips(){
  const pw=document.getElementById('ldg-pay-wrap');
  const rw=document.getElementById('ldg-receive-wrap');
  if(ldgType==='income'){
    pw.style.display='none';
    rw.style.display=MoneyUI.inputById('ldg-repeat').checked?'none':'block'; // 毎月の収入は口座に入るものとして数える（D14）
    // 受取方法：現金 or 口座振込
    document.getElementById('ldg-receive-chips').innerHTML=
      ['現金','口座振込'].map(o=>`<button type="button" class="pay-chip${ldgReceive===o?' sel':''}" onclick="selReceive('${o}')">${o}</button>`).join('');
    document.getElementById('ldg-receive-hint').textContent=
      ldgReceive==='口座振込'?'口座振込は口座残高にプラスされます':'現金受取は口座残高に影響しません';
    return;
  }
  rw.style.display='none';
  pw.style.display='block';
  document.getElementById('ldg-pay-chips').innerHTML=payChipsHtml(ldgPay,ldgCardIdx,'selPayAt');
  document.getElementById('ldg-pay-hint').textContent=payHint(ldgPay,ldgCardIdx);
}
function selReceive(r){ldgReceive=r;renderPayChips();}
function selPayAt(k){const o=payOptions(ldgCardIdx)[k];if(!o)return;ldgPay=o.pay;ldgCardIdx=o.ci;renderPayChips();}
// 「毎月くり返す」（D14）: 選ぶと、その日を毎月の日にして、その月から数える。カテゴリと備考は残らないので隠す。
// 毎月の収入は、口座に入るものとして数える（受取方法を隠す）
function renderLdgRepeat(){
  const on=MoneyUI.inputById('ldg-repeat').checked,date=MoneyUI.inputById('ldg-date').value||TODAY,dt=ds2d(date);
  const hint=document.getElementById('ldg-repeat-hint');
  hint.hidden=!on;
  hint.textContent=on?`毎月${dt.getDate()}日に数えます（${dt.getFullYear()}年${dt.getMonth()+1}月から）。家計簿の記録には1件ずつは出ず、「毎月のお金」に入ります${ldgType==='income'?'。毎月の収入は、口座に入るものとして数えます':''}`:'';
  document.getElementById('ldg-cat-wrap').hidden=on;
  document.getElementById('ldg-memo-wrap').hidden=on;
  renderPayChips(); // 毎月の収入は受取方法を出さない
  MoneyUI.inputById('ldg-name').placeholder=on?(ldgType==='income'?'仕送り、奨学金など':'家賃、動画のサブスクなど'):'ランチ、交通費など';
  document.getElementById('ldg-name-err').hidden=true;
}
function saveLedger(){const date=MoneyUI.inputById('ldg-date').value,amount=MoneyUI.inputById('ldg-amount').value,name=MoneyUI.inputById('ldg-name').value.trim(),memo=MoneyUI.textareaById('ldg-memo').value.trim();if(!date||!amount)return;
  if(MoneyUI.inputById('ldg-repeat').checked){
    if(!name){document.getElementById('ldg-name-err').hidden=false;document.getElementById('ldg-name').focus();return;}
    const card=ldgType==='expense'&&ldgCardIdx>=0?st.cards[ldgCardIdx]:null;
    const ok=saveMonthlyFromLedger({name,amount:parseInt(amount),dateKey:date,kind:ldgType,payment_method:card?'card':ldgPay==='口座'?'bank':'cash',card_id:card?card._id:null});
    if(!ok)return;
    closeLdgModal();renderCurrentSection();return;
  }
  const entry={date,amount:parseInt(amount),name:name||ldgCat,cat:ldgCat,type:ldgType,pay:ldgPay,memo};if(ldgType==='expense'&&ldgCardIdx>=0)entry.cardIdx=ldgCardIdx;if(ldgType==='income')entry.receive=ldgReceive;st.ledger.push(entry);save();closeLdgModal();renderLedger();renderLedgerMetrics();renderCal();renderHome();renderCardList();}
function closeLdgModal(){document.getElementById('ldg-mbg').classList.remove('open');}
function openLdgEdit(i){ldeIdx=i;const l=st.ledger[i];ldeType=l.type;ldeCat=l.cat;ldePay=l.pay||'現金';ldeCardIdx=l.cardIdx!==undefined?l.cardIdx:-1;ldeReceive=l.receive||'現金';MoneyUI.inputById('lde-date').value=l.date;MoneyUI.inputById('lde-amount').value=l.amount;MoneyUI.inputById('lde-name').value=l.name;MoneyUI.textareaById('lde-memo').value=l.memo||'';renderLdeType();renderLdeCatChips();renderLdePayChips();document.getElementById('ldg-edit-mbg').classList.add('open');}
function closeLdgEdit(){document.getElementById('ldg-edit-mbg').classList.remove('open');}
function selLdeType(t){ldeType=t;renderLdeType();renderLdeCatChips();renderLdePayChips();}
function renderLdeType(){document.querySelectorAll('#lde-type-chips .pay-chip').forEach((el,i)=>el.classList.toggle('sel',['expense','income'][i]===ldeType));}
function renderLdeCatChips(){const cats=ldeType==='expense'?st.catExp:st.catInc;if(!cats.includes(ldeCat))ldeCat=cats[0]||'';document.getElementById('lde-cat-chips').innerHTML=cats.map(c=>`<button type="button" class="chip${ldeCat===c?' sel':''}" onclick="selLdeCat('${c}')">${c}</button>`).join('');}
function selLdeCat(c){ldeCat=c;document.querySelectorAll('#lde-cat-chips .chip').forEach(el=>el.classList.toggle('sel',el.textContent===c));}
function renderLdePayChips(){
  const pw=document.getElementById('lde-pay-wrap');
  const rw=document.getElementById('lde-receive-wrap');
  if(ldeType==='income'){
    pw.style.display='none';
    rw.style.display='block';
    document.getElementById('lde-receive-chips').innerHTML=
      ['現金','口座振込'].map(o=>`<button type="button" class="pay-chip${ldeReceive===o?' sel':''}" onclick="selLdeReceive('${o}')">${o}</button>`).join('');
    document.getElementById('lde-receive-hint').textContent=
      ldeReceive==='口座振込'?'口座振込は口座残高にプラスされます':'現金受取は口座残高に影響しません';
    return;
  }
  rw.style.display='none';
  pw.style.display='block';
  document.getElementById('lde-pay-chips').innerHTML=payChipsHtml(ldePay,ldeCardIdx,'selLdePayAt');
  document.getElementById('lde-pay-hint').textContent=payHint(ldePay,ldeCardIdx);
}
function selLdeReceive(r){ldeReceive=r;renderLdePayChips();}
function selLdePayAt(k){const o=payOptions(ldeCardIdx)[k];if(!o)return;ldePay=o.pay;ldeCardIdx=o.ci;renderLdePayChips();}
function saveLdgEdit(){
  const date=MoneyUI.inputById('lde-date').value,amount=MoneyUI.inputById('lde-amount').value,name=MoneyUI.inputById('lde-name').value.trim(),memo=MoneyUI.textareaById('lde-memo').value.trim();
  if(!date||!amount)return;
  const original=st.ledger[ldeIdx];
  const entry={date,amount:parseInt(amount),name:name||ldeCat,cat:ldeCat,type:ldeType,pay:ldePay,memo};
  if(ldeType==='expense'&&ldeCardIdx>=0)entry.cardIdx=ldeCardIdx;
  if(ldeType==='income')entry.receive=ldeReceive;
  // 元の記録の ID を引き継ぐ（同じ行の更新にする）
  if(original&&original._id)entry._id=original._id;
  st.ledger[ldeIdx]=entry;
  save();closeLdgEdit();renderLedger();renderLedgerMetrics();renderCal();renderHome();renderCardList();
}
function ldgTab(t){document.querySelectorAll('#ldg-main-tabs .tb2').forEach((el,i)=>{const selected=['list','graph','monthly'][i]===t;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});document.getElementById('ldg-list-sec').style.display=t==='list'?'block':'none';document.getElementById('ldg-graph-sec').style.display=t==='graph'?'block':'none';document.getElementById('ldg-monthly-sec').style.display=t==='monthly'?'block':'none';updateLdgNav_();if(t==='graph')renderCharts();if(t==='monthly')renderMonthlyTab();}

// ============================================================
// 家計簿の対象年月ナビゲーション（記録一覧・グラフで共有）
// ============================================================
function updateLdgNav_(){
  document.getElementById('ldg-month-label').textContent=`${ldgListY}年${ldgListM+1}月`;
  const yEl=document.getElementById('ldg-year-label');
  if(yEl)yEl.textContent=`${ldgListY}年`;
  const graphVisible=document.getElementById('ldg-graph-sec').style.display!=='none';
  const showYearNav=graphVisible&&ldgGraphMode==='year';
  const monthlyVisible=document.getElementById('ldg-monthly-sec').style.display!=='none'; // 毎月のお金は月送りを使わない
  document.getElementById('ldg-month-nav').style.display=monthlyVisible||showYearNav?'none':'flex';
  document.getElementById('ldg-year-nav').style.display=!monthlyVisible&&showYearNav?'flex':'none';
}
function ldgMonthPrev(){const nm=addM(ldgListY,ldgListM,-1);ldgListY=nm.y;ldgListM=nm.m;renderLedgerAll_();}
function ldgMonthNext(){const nm=addM(ldgListY,ldgListM,1);ldgListY=nm.y;ldgListM=nm.m;renderLedgerAll_();}
function ldgYearPrev(){ldgListY--;renderLedgerAll_();}
function ldgYearNext(){ldgListY++;renderLedgerAll_();}
function setLdgGraphMode(mode){
  ldgGraphMode=mode;
  document.querySelectorAll('#ldg-graph-mode-tabs .tb2').forEach((el,i)=>{const selected=['month','year'][i]===mode;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});
  updateLdgNav_();
  renderCharts();
}
function renderLedgerAll_(){
  updateLdgNav_();
  renderLedger();
  renderLedgerMetrics();
  if(document.getElementById('ldg-graph-sec').style.display!=='none')renderCharts();
}

function renderLedgerMetrics(){const ml=monthLedger(ldgListY,ldgListM);const exp=ml.filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(l.amount),0);const inc=ml.filter(l=>l.type==='income').reduce((a,l)=>a+parseInt(l.amount),0);document.getElementById('ldg-exp').textContent='¥'+exp.toLocaleString();document.getElementById('ldg-inc').textContent='¥'+inc.toLocaleString();const bal=inc-exp;const bEl=document.getElementById('ldg-bal');bEl.textContent=(bal>0?'+':'')+yenSigned(bal);bEl.style.color=bal>=0?'#3B6D11':'#A32D2D';}
function renderLedger(){
  const ml=monthLedger(ldgListY,ldgListM).sort((a,b)=>b.date.localeCompare(a.date));
  const el=document.getElementById('ldg-list');
  if(!ml.length){el.innerHTML='<div class="card"><div class="empty">この月の記録なし</div></div>';return;}

  // 日付ごとにグループ化
  const groups={};
  ml.forEach(l=>{
    if(!groups[l.date])groups[l.date]=[];
    groups[l.date].push(l);
  });

  const html=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(date=>{
    const items=groups[date];
    const d=ds2d(date);
    const dateStr=`${d.getMonth()+1}/${d.getDate()}(${DAYS[d.getDay()]})`;
    const dayExp=items.filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(l.amount),0);
    const dayInc=items.filter(l=>l.type==='income').reduce((a,l)=>a+parseInt(l.amount),0);
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
      const ri=st.ledger.indexOf(l);
      return `<div class="ri">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge ${l.type==='expense'?'bexp':'binc'}">${MoneyUI.escapeHtml(l.cat)}</span>
          <div>
            <div style="font-size:14px">${MoneyUI.escapeHtml(l.name)}</div>
            <div style="font-size:12px;color:var(--color-text-secondary)">${MoneyUI.escapeHtml(ledgerPayLabel(l))}${l.memo?' · '+MoneyUI.escapeHtml(l.memo):''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:14px;font-weight:600;color:${l.type==='expense'?'#A32D2D':'#3B6D11'}">${l.type==='expense'?'-':'+'}¥${parseInt(l.amount).toLocaleString()}</span>
          <button class="btn sm edit" onclick="openLdgEdit(${ri})">編集</button>
          <button class="btn sm del" onclick="delLedger(${ri})">削除</button>
        </div>
      </div>`;
    }).join('');

    const groupId=`ldg-group-${date}`;
    return `<div class="ldg-day-group">
      <div class="ldg-day-header" id="${groupId}-header" role="button" tabindex="0" aria-expanded="false" aria-controls="${groupId}" onclick="toggleLdgGroup('${groupId}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleLdgGroup('${groupId}')}">
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

function toggleLdgGroup(id){
  const detail=document.getElementById(id);
  const arrow=document.getElementById(id+'-arrow');
  const header=document.getElementById(id+'-header');
  const isOpen=detail.classList.contains('open');
  detail.classList.toggle('open',!isOpen);
  arrow.classList.toggle('open',!isOpen);
  header.setAttribute('aria-expanded',String(!isOpen));
}
function delLedger(i){st.ledger.splice(i,1);save();renderLedger();renderLedgerMetrics();renderCal();refreshDayViews();renderHome();renderCardList();}
function renderCatChart_(ml){
  const catMap={};ml.forEach(l=>{catMap[l.cat]=(catMap[l.cat]||0)+parseInt(l.amount);});
  const catLabels=Object.keys(catMap),catData=Object.values(catMap),catColors=catLabels.map((c,i)=>CAT_COL[c]||DOTC[i%DOTC.length]);
  if(catChart)catChart.destroy();
  catChart=new Chart(/** @type {HTMLCanvasElement} */ (document.getElementById('cat-chart')).getContext('2d'),{type:'doughnut',data:{labels:catLabels,datasets:[{data:catData,backgroundColor:catColors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:10,padding:8}}}}});
}
function renderChartsMonth_(){
  document.getElementById('cat-chart-title').textContent='カテゴリ別支出';
  document.getElementById('day-chart-title').textContent='日別支出推移';
  const ml=monthLedger(ldgListY,ldgListM).filter(l=>l.type==='expense');
  renderCatChart_(ml);
  const dim=new Date(ldgListY,ldgListM+1,0).getDate(),dayMap={};
  for(let d=1;d<=dim;d++)dayMap[d]=0;
  ml.forEach(l=>{const d=ds2d(l.date).getDate();dayMap[d]=(dayMap[d]||0)+parseInt(l.amount);});
  if(dayChart)dayChart.destroy();
  dayChart=new Chart(/** @type {HTMLCanvasElement} */ (document.getElementById('day-chart')).getContext('2d'),{type:'bar',data:{labels:Object.keys(dayMap).map(d=>d+'日'),datasets:[{data:Object.values(dayMap),backgroundColor:'#185FA590',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:15}},y:{ticks:{callback:v=>'¥'+v.toLocaleString(),font:{size:10}}}}}});
}
function renderChartsYear_(){
  document.getElementById('cat-chart-title').textContent='カテゴリ別支出（年間）';
  document.getElementById('day-chart-title').textContent='月別支出推移';
  const yl=st.ledger.filter(l=>l.type==='expense'&&ds2d(l.date).getFullYear()===ldgListY);
  renderCatChart_(yl);
  const monthMap={};for(let m=0;m<12;m++)monthMap[m]=0;
  yl.forEach(l=>{const m=ds2d(l.date).getMonth();monthMap[m]=(monthMap[m]||0)+parseInt(l.amount);});
  if(dayChart)dayChart.destroy();
  dayChart=new Chart(/** @type {HTMLCanvasElement} */ (document.getElementById('day-chart')).getContext('2d'),{type:'bar',data:{labels:Object.keys(monthMap).map(m=>(parseInt(m)+1)+'月'),datasets:[{data:Object.values(monthMap),backgroundColor:'#185FA590',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10}}},y:{ticks:{callback:v=>'¥'+v.toLocaleString(),font:{size:10}}}}}});
}
function renderCharts(){ldgGraphMode==='year'?renderChartsYear_():renderChartsMonth_();}

