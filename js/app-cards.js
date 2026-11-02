// カード設定（設定タブ内）と ATM
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// カード設定（設定タブ内）
// ============================================================
document.getElementById('cn-close').addEventListener('input',previewCycle);
document.getElementById('cn-bill').addEventListener('input',previewCycle);
function toggleCardCloseEom(prefix){
  const cb=MoneyUI.inputById(`${prefix}-close-eom`);
  const input=MoneyUI.inputById(`${prefix}-close`);
  if(cb.checked){input.value='31';input.disabled=true;}
  else{input.value='';input.disabled=false;}
  if(prefix==='cn')previewCycle();
}
function previewCycle(){
  const isEom=MoneyUI.inputById('cn-close-eom').checked;
  const cl=isEom?31:parseInt(MoneyUI.inputById('cn-close').value);
  const bill=parseInt(MoneyUI.inputById('cn-bill').value);
  const el=document.getElementById('cn-cycle-preview');
  if(!cl||!bill){el.style.display='none';return;}
  const tmp={name:'__p__',closeDay:cl,billDay:bill};
  st.cards.push(tmp);const f=cycle(tmp,0),c=cycle(tmp,1);st.cards.pop();
  el.innerHTML=`<span class="badge bfixed">確定</span> ${fmtMD(f.cs)}〜${fmtMD(f.ce)} → <strong>${f.billY}年${f.billM+1}月${f.billD}日</strong><br><span class="badge bpending">集計中</span> ${fmtMD(c.cs)}〜${fmtMD(c.ce)} → <strong>${c.billY}年${c.billM+1}月${c.billD}日</strong>`;
  el.style.display='block';
}
function addCard(){
  const name=MoneyUI.inputById('cn-name').value.trim();
  const isEom=MoneyUI.inputById('cn-close-eom').checked;
  const cl=isEom?'31':MoneyUI.inputById('cn-close').value;
  const bill=MoneyUI.inputById('cn-bill').value;
  if(!name||!cl||!bill)return;
  st.cards.push({name,closeDay:cl,billDay:bill});save();
  MoneyUI.inputById('cn-name').value='';
  MoneyUI.inputById('cn-close').value='';
  MoneyUI.inputById('cn-close').disabled=false;
  MoneyUI.inputById('cn-close-eom').checked=false;
  MoneyUI.inputById('cn-bill').value='';
  document.getElementById('cn-cycle-preview').style.display='none';
  renderCardList();renderHome();
}
function renderCardBillHistory(ci,card){const billDay=parseInt(card.billDay),today=new Date(gY(),gM(),gD());let rows='';for(let i=5;i>=0;i--){const bm=addM(gY(),gM(),-i),billDate=monthDate(bm.y,bm.m,billDay);if(billDate>today)continue;const estimated=cardBillForDate(card,bm.y,bm.m),actual=getActualCard(ci,bm.y,bm.m),dispActual=actual?parseInt(actual.actualAmount):null;rows+=`<div class="salary-row"><span class="salary-month">${bm.y}/${bm.m+1}月</span><span class="salary-est">推定 ¥${estimated.toLocaleString()}<br><span style="font-size:10px">${bm.m+1}月${billDay}日引き落とし</span></span><div style="display:flex;align-items:center;gap:6px"><input class="salary-input" type="number" inputmode="numeric" placeholder="実績額" value="${dispActual||''}" onchange="onCardBillChange(${ci},${bm.y},${bm.m},${estimated},this.value)"/>${dispActual?'<span class="act-badge">入力済</span>':''}</div></div>`;}return rows||'<div class="empty" style="font-size:12px">まだ引き落とし実績なし</div>';}
function onCardBillChange(ci,bY,bM,estimated,val){const amount=parseInt(val)||0;if(amount>0){setActualCard(ci,bY,bM,amount,estimated);save();renderHome();renderCardList();}else{const key=cardActualKey(ci,bY,bM);st.actualInputs=st.actualInputs.filter(a=>!(a.type==='card'&&a.cardKey===key));save();renderHome();renderCardList();}}
function renderCardList(){const el=document.getElementById('card-list-sec');if(!st.cards.some(c=>!c._deleted)){el.innerHTML='';return;}el.innerHTML=st.cards.map((card,ci)=>{if(card._deleted)return'';const f=cycle(card,0),c=cycle(card,1),aF=getActualCard(ci,f.billY,f.billM),fAmt=aF?parseInt(aF.actualAmount):f.amount;const closeDayLabel=parseInt(card.closeDay)>=28?'末日':`${card.closeDay}日`;return `<div style="border-top:0.5px solid var(--color-border-tertiary);padding-top:10px;margin-top:10px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:15px;font-weight:600">${card.name}</span><div style="display:flex;gap:6px"><button class="btn sm edit" onclick="openCardEdit(${ci})">編集</button><button class="btn sm del" onclick="delCard(${ci})">削除</button></div></div><div class="fgr" style="margin-bottom:10px"><div><div style="font-size:11px;color:var(--color-text-secondary)">締め日</div><div style="font-size:14px;font-weight:600">毎月${closeDayLabel}</div></div><div><div style="font-size:11px;color:var(--color-text-secondary)">引き落とし日</div><div style="font-size:14px;font-weight:600">毎月${card.billDay}日</div></div></div><div class="bill-row"><div><span class="badge bfixed">確定</span>${aF?'<span class="act-badge">実額入力済</span>':''}<div class="bill-label">${f.billY}年${f.billM+1}月${f.billD}日 口座引き落とし</div><div class="bill-label">${fmtMD(f.cs)}〜${fmtMD(f.ce)} の利用分</div></div><div class="bill-amount" style="color:#A32D2D">¥${fAmt.toLocaleString()}</div></div><div class="bill-row"><div><span class="badge bpending">集計中</span><div class="bill-label">${c.billY}年${c.billM+1}月${c.billD}日 引き落とし予定</div><div class="bill-label">${fmtMD(c.cs)}〜${fmtMD(c.ce)} の利用分</div></div><div class="bill-amount" style="color:#BA7517">¥${c.amount.toLocaleString()}</div></div><div style="margin-top:10px"><div style="font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:8px">引き落とし実績入力</div>${renderCardBillHistory(ci,card)}</div></div>`;}).join('');}
// カードを削除済みにする（配列から消すと、記録のカードの番号がずれる）。そのカードで払う毎月のお金は、来月から口座からの引き落としにする
function delCard(i){const cardId=st.cards[i]._id;st.cards[i]._deleted=true;save();moveMonthlyOffCard(cardId);renderCardList();renderHome();}
function openCardEdit(i){
  cardEditIdx=i;const card=st.cards[i];
  const isEom=parseInt(card.closeDay)>=28;
  MoneyUI.inputById('ce-name').value=card.name;
  MoneyUI.inputById('ce-close-eom').checked=isEom;
  MoneyUI.inputById('ce-close').value=isEom?'':card.closeDay;
  MoneyUI.inputById('ce-close').disabled=isEom;
  MoneyUI.inputById('ce-bill').value=card.billDay;
  document.getElementById('card-edit-mbg').classList.add('open');
}
function closeCardEdit(){document.getElementById('card-edit-mbg').classList.remove('open');}
function saveCardEdit(){
  const name=MoneyUI.inputById('ce-name').value.trim();
  const isEom=MoneyUI.inputById('ce-close-eom').checked;
  const cl=isEom?'31':MoneyUI.inputById('ce-close').value;
  const bill=MoneyUI.inputById('ce-bill').value;
  if(!name||!cl||!bill)return;
  st.cards[cardEditIdx]={...st.cards[cardEditIdx],name,closeDay:cl,billDay:bill};
  save();closeCardEdit();renderCardList();renderHome();
}

// ============================================================
// ATM
// ============================================================
function openWd(){wdStr='';updWd();document.getElementById('wd-mbg').classList.add('open');}
function closeWd(){document.getElementById('wd-mbg').classList.remove('open');}
function nk(v){if(wdStr.length>=8)return;if(!wdStr&&(v==='0'||v==='000'))return;wdStr+=v;updWd();}
function nd(){wdStr=wdStr.slice(0,-1);updWd();}
function updWd(){document.getElementById('wd-display').textContent='¥'+(parseInt(wdStr)||0).toLocaleString();}
function doWd(){const amount=parseInt(wdStr)||0;if(!amount)return;st.wds.push({date:TODAY,amount});save();closeWd();renderHome();renderWdHist();}
function renderWdHist(){const el=document.getElementById('wd-hist');if(!el)return;const list=[...st.wds].reverse().slice(0,10);if(!list.length){el.innerHTML='<div class="empty">引き出し履歴なし</div>';return;}el.innerHTML=list.map((w,ri)=>`<div class="wd-hist-item"><span style="color:var(--color-text-secondary)">${w.date}</span><div style="display:flex;align-items:center;gap:8px"><span style="color:#3C3489;font-weight:600">-¥${parseInt(w.amount).toLocaleString()}</span><button class="btn sm del" onclick="delWd(${st.wds.length-1-ri})">削除</button></div></div>`).join('');}
function delWd(i){st.wds.splice(i,1);save();renderHome();renderWdHist();}

