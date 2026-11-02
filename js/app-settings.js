// 設定の画面
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// 設定
// ============================================================
function addCatExp(){const v=MoneyUI.inputById('new-cat-exp').value.trim();if(!v||st.catExp.includes(v))return;st.catExp.push(v);save();MoneyUI.inputById('new-cat-exp').value='';renderCatTags();}
function addCatInc(){const v=MoneyUI.inputById('new-cat-inc').value.trim();if(!v||st.catInc.includes(v))return;st.catInc.push(v);save();MoneyUI.inputById('new-cat-inc').value='';renderCatTags();}
function delCatExp(i){if(st.catExp.length<=1)return;st.catExp.splice(i,1);save();renderCatTags();}
function delCatInc(i){if(st.catInc.length<=1)return;st.catInc.splice(i,1);save();renderCatTags();}
function renderCatTags(){const e=document.getElementById('cat-exp-tags'),n=document.getElementById('cat-inc-tags');if(e)e.innerHTML=st.catExp.map((c,i)=>`<span class="cat-tag">${MoneyUI.escapeHtml(c)}<button type="button" class="cat-tag-del" aria-label="「${MoneyUI.escapeHtml(c)}」を消す" onclick="delCatExp(${i})">×</button></span>`).join('');if(n)n.innerHTML=st.catInc.map((c,i)=>`<span class="cat-tag">${MoneyUI.escapeHtml(c)}<button type="button" class="cat-tag-del" aria-label="「${MoneyUI.escapeHtml(c)}」を消す" onclick="delCatInc(${i})">×</button></span>`).join('');}
function initSettingTab(){MoneyUI.inputById('set-bal').value=String(st.acctBase||'');MoneyUI.inputById('set-bal-date').value=st.baseDate||TODAY;MoneyUI.selectById('set-close').value=String(st.shiftCloseDay||31);MoneyUI.inputById('set-pay').value=String(st.shiftPayDay||10);MoneyUI.inputById('set-bud').value=String(st.budget||'');MoneyUI.selectById('set-fuyou').value=st.fuyouLimit||'1300000';MoneyUI.inputById('set-other-inc').value=String(st.otherIncome||'');updateShiftCyclePreview();renderWdHist();renderCatTags();renderCardList();document.getElementById('set-close').onchange=()=>{updateShiftCyclePreview();saveSettingFields();};document.getElementById('set-pay').oninput=updateShiftCyclePreview;
  // 変えたら（入力欄から離れたら）すぐ保存する（#71）
  ['set-bal','set-bal-date','set-pay','set-bud','set-fuyou','set-other-inc'].forEach(id=>{document.getElementById(id).onchange=saveSettingFields;});}
function updateShiftCyclePreview(){const cd=MoneyUI.selectById('set-close').value,pd=MoneyUI.inputById('set-pay').value;document.getElementById('shift-cycle-preview').textContent=`締め日: ${Number(cd)>=28?'月末':'毎月'+cd+'日'}　→　翌月${pd}日に口座に入金`;}
// 設定の入力欄（口座残高・基準日・給料サイクル・予算・扶養）を変えたら、すぐ保存する（#71）。
// 入力欄から離れたとき（change）に呼ぶ。値が変わっていなければ何もしない
function saveSettingFields(){
  const next={
    acctBase:parseInt(MoneyUI.inputById('set-bal').value)||0,
    baseDate:MoneyUI.inputById('set-bal-date').value||TODAY,
    shiftCloseDay:parseInt(MoneyUI.selectById('set-close').value)||31,
    shiftPayDay:parseInt(MoneyUI.inputById('set-pay').value)||10,
    budget:parseInt(MoneyUI.inputById('set-bud').value)||0,
    fuyouLimit:MoneyUI.selectById('set-fuyou').value,
    otherIncome:parseInt(MoneyUI.inputById('set-other-inc').value)||0,
  };
  if(Object.keys(next).every(k=>String(st[k]??'')===String(next[k])))return;
  Object.assign(st,next);
  save(); // サーバーに送れなかったときは、同期の通知で知らせる
  renderHome();
  renderCal();
  MoneyUI.toast('設定を保存しました');
}
