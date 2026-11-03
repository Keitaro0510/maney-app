// ATM（D20 の 4。カード画面は src/screens/cards.ts）
function openWd(){wdStr='';updWd();document.getElementById('wd-mbg').classList.add('open');}
function closeWd(){document.getElementById('wd-mbg').classList.remove('open');}
function nk(v){if(wdStr.length>=8)return;if(!wdStr&&(v==='0'||v==='000'))return;wdStr+=v;updWd();}
function nd(){wdStr=wdStr.slice(0,-1);updWd();}
function updWd(){document.getElementById('wd-display').textContent='¥'+(parseInt(wdStr)||0).toLocaleString();}
function doWd(){const amount=parseInt(wdStr)||0;if(!amount)return;st.wds.push({date:TODAY,amount});save();closeWd();renderHome();renderWdHist();}
function renderWdHist(){const el=document.getElementById('wd-hist');if(!el)return;const list=[...st.wds].reverse().slice(0,10);if(!list.length){el.innerHTML='<div class="empty">引き出し履歴なし</div>';return;}el.innerHTML=list.map((w,ri)=>`<div class="wd-hist-item"><span style="color:var(--color-text-secondary)">${w.date}</span><div style="display:flex;align-items:center;gap:8px"><span style="color:#3C3489;font-weight:600">-¥${parseInt(w.amount).toLocaleString()}</span><button class="btn sm del" onclick="delWd(${st.wds.length-1-ri})">削除</button></div></div>`).join('');}
function delWd(i){st.wds.splice(i,1);save();renderHome();renderWdHist();}

