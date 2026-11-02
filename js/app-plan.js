// 予定の画面
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// 予定
// ============================================================
function renderColorSwatches(){document.getElementById('plan-color-swatches').innerHTML=PLAN_COLORS.map(c=>`<button type="button" class="color-swatch${planColorSel===c.key?' sel':''}" style="background:${c.dot}" onclick="selPlanColor('${c.key}')" aria-label="${COLOR_NAMES[c.key]}"></button>`).join('');}
function selPlanColor(key){planColorSel=key;renderColorSwatches();}
function setDateMode(mode){planDateMode=mode;document.getElementById('dmt-single').classList.toggle('active',mode==='single');document.getElementById('dmt-range').classList.toggle('active',mode==='range');document.getElementById('date-single-wrap').style.display=mode==='single'?'block':'none';document.getElementById('date-range-wrap').style.display=mode==='range'?'block':'none';}
function updateRangePreview(){const s=MoneyUI.inputById('plan-date-start').value,e=MoneyUI.inputById('plan-date-end').value,el=document.getElementById('range-preview');if(!s||!e){el.textContent='';return;}const days=Math.round((ds2d(e).getTime()-ds2d(s).getTime())/(864e5))+1;el.textContent=days>=1?`${days}日間の予定として登録されます`:'終了日は開始日より後にしてください';}
let planCardIdx=-1; // -1=現金、0以上=カードインデックス

function renderPlanPayChips(){
  if(!document.getElementById('plan-pay-chips'))return;
  const opts=['現金',...st.cards.map(c=>c.name)];
  document.getElementById('plan-pay-chips').innerHTML=opts.map((o,i)=>i>0&&st.cards[i-1]._deleted&&planCardIdx!==i-1?'':`<button type="button" class="pay-chip${(i===0&&planCardIdx===-1)||(i>0&&planCardIdx===i-1)?' sel':''}" onclick="selPlanPay(${i-1})">${o}</button>`).join('');
  const hint=document.getElementById('plan-pay-hint');
  if(hint){
    if(planCardIdx>=0&&st.cards[planCardIdx]){
      hint.textContent=`${st.cards[planCardIdx].name}払い：カードの集計に加算され、引き落とし日に残高から引かれます`;
    }else{
      hint.textContent='現金・口座払いの場合は予定日に残高から引かれます';
    }
  }
}

function selPlanPay(ci){
  planCardIdx=ci;
  renderPlanPayChips();
}

function setPlanTimeMode(allDay){
  MoneyUI.inputById('plan-allday').checked=allDay;
  togglePlanAllDay();
  if(!allDay)window.setTimeout(()=>document.getElementById('plan-time-start').focus(),0);
}

function togglePlanAllDay(){
  const on=MoneyUI.inputById('plan-allday').checked;
  document.getElementById('plan-time-wrap').classList.toggle('is-all-day',on);
  document.getElementById('plan-mode-allday').classList.toggle('active',on);
  document.getElementById('plan-mode-timed').classList.toggle('active',!on);
  document.getElementById('plan-time-hint').textContent=on
    ?'この予定は終日として表示されます。'
    :'開始時刻を入力してください。終了時刻は任意です。';
}

function openPlanModal(ds){
  planEditIdx=-1;planColorSel='pink';planCardIdx=-1;
  document.getElementById('plan-modal-title').textContent='予定を追加';
  MoneyUI.inputById('plan-title').value='';
  MoneyUI.textareaById('plan-memo').value='';
  MoneyUI.inputById('plan-date').value=ds||TODAY;
  MoneyUI.inputById('plan-date-start').value=ds||TODAY;
  MoneyUI.inputById('plan-date-end').value=ds||TODAY;
  MoneyUI.inputById('plan-budget').value='';
  document.getElementById('plan-save-btn').textContent='追加';
  setDateMode('single');
  // 新規予定はデフォルト終日
  MoneyUI.inputById('plan-allday').checked=true;
  MoneyUI.inputById('plan-time-start').value='';
  MoneyUI.inputById('plan-time-end').value='';
  togglePlanAllDay();
  renderColorSwatches();
  renderPlanPayChips();
  document.getElementById('plan-date-start').oninput=updateRangePreview;
  document.getElementById('plan-date-end').oninput=updateRangePreview;
  document.getElementById('plan-mbg').classList.add('open');
}

function openPlanEdit(idx){
  planEditIdx=idx;
  const p=st.plans[idx];
  planColorSel=p.color||'pink';
  planCardIdx=p.planCardIdx!==undefined?p.planCardIdx:-1;
  document.getElementById('plan-modal-title').textContent='予定を編集';
  MoneyUI.inputById('plan-title').value=p.title;
  MoneyUI.inputById('plan-date').value=p.date;
  MoneyUI.inputById('plan-date-start').value=p.dateStart||p.date;
  MoneyUI.inputById('plan-date-end').value=p.dateEnd||p.date;
  MoneyUI.inputById('plan-budget').value=p.budget||'';
  MoneyUI.textareaById('plan-memo').value=p.memo||'';
  document.getElementById('plan-save-btn').textContent='保存';
  const mode=p.dateEnd&&p.dateEnd!==p.date?'range':'single';
  setDateMode(mode);
  MoneyUI.inputById('plan-allday').checked=!p.timeStart;
  MoneyUI.inputById('plan-time-start').value=p.timeStart||'';
  MoneyUI.inputById('plan-time-end').value=p.timeEnd||'';
  togglePlanAllDay();
  renderColorSwatches();
  renderPlanPayChips();
  document.getElementById('plan-date-start').oninput=updateRangePreview;
  document.getElementById('plan-date-end').oninput=updateRangePreview;
  if(mode==='range')updateRangePreview();
  document.getElementById('plan-mbg').classList.add('open');
}

function closePlanModal(){document.getElementById('plan-mbg').classList.remove('open');}

function savePlan(){
  const title=MoneyUI.inputById('plan-title').value.trim();
  if(!title)return;
  const budget=parseInt(MoneyUI.inputById('plan-budget').value)||0,memo=MoneyUI.textareaById('plan-memo').value.trim(),color=planColorSel;
  let dateStart,dateEnd;
  if(planDateMode==='range'){
    dateStart=MoneyUI.inputById('plan-date-start').value;
    dateEnd=MoneyUI.inputById('plan-date-end').value;
    if(!dateStart||!dateEnd||ds2d(dateEnd)<ds2d(dateStart))return;
  }else{
    dateStart=MoneyUI.inputById('plan-date').value;
    if(!dateStart)return;
    dateEnd=dateStart;
  }
  const allDay=MoneyUI.inputById('plan-allday').checked;
  let timeStart=allDay?'':(MoneyUI.inputById('plan-time-start').value||'');
  let timeEnd=allDay?'':(MoneyUI.inputById('plan-time-end').value||'');
  if(!timeStart)timeEnd='';
  // 'HH:MM'は辞書順=時刻順なので単純比較でOK。単日で終了が開始より前なら終了を捨てる
  if(timeStart&&timeEnd&&dateStart===dateEnd&&timeEnd<timeStart)timeEnd='';
  const obj={id:planEditIdx>=0?st.plans[planEditIdx].id:Date.now(),title,date:dateStart,dateStart,dateEnd,timeStart,timeEnd,budget,memo,color,done:false};
  // カード払いの場合planCardIdxを保存
  if(planCardIdx>=0) obj.planCardIdx=planCardIdx;
  if(planEditIdx>=0){obj.done=st.plans[planEditIdx].done;obj._id=st.plans[planEditIdx]._id;st.plans[planEditIdx]=obj;}
  else st.plans.push(obj);
  save();closePlanModal();renderCal();refreshDayViews();renderHome();
}

