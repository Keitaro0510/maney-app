// bootstrap: Service Worker の登録・入力画面の選択肢と見出し・起動。loadData() を呼ぶのはここだけ（最後に読む）
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// Service Worker登録
// ============================================================
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      console.log('SW registered');
    }).catch(err=>{
      console.log('SW registration failed:', err);
    });
  });
}

// ============================================================
// 起動
// ============================================================
// ---------- 入力画面の選択肢と見出し（#71） ----------
// 選択肢（ボタン）が選ばれているかを、見た目（sel のクラス）に合わせて読み上げにも伝える（aria-pressed）。
// 選択肢を作る関数・選ぶ関数は sel のクラスだけを変えるので、ここでまとめてそろえる
const CHOICE_SELECTOR='button.pay-chip,button.chip,button.color-swatch,button.chk-day,#dmt-single,#dmt-range,#plan-mode-allday,#plan-mode-timed';
const syncPressed=b=>b.setAttribute('aria-pressed',b.classList.contains('sel')||b.classList.contains('active')?'true':'false');
function syncChoicePressed(root){root.querySelectorAll(CHOICE_SELECTOR).forEach(syncPressed);}
new MutationObserver(muts=>{
  for(const m of muts){
    const target=/** @type {Element} */ (m.target);
    if(m.type==='attributes'){if(target.matches(CHOICE_SELECTOR))syncPressed(target);}
    else if(target.querySelectorAll)syncChoicePressed(target);
  }
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
syncChoicePressed(document);

// 入力欄の見出し（.fg の label）を、同じ .fg の入力欄につなぐ（見出しを押すと入力欄に移り、読み上げで名前が伝わる）。
// 選択肢の並びには、見出しを名前にしたまとまり（role="group"）を付ける
function linkFormLabels(){
  document.querySelectorAll('.fg').forEach(fg=>{
    const label=/** @type {HTMLLabelElement} */ (fg.querySelector(':scope > label'));
    if(!label)return;
    const fields=fg.querySelectorAll('input:not([type=checkbox]):not([type=hidden]),select,textarea');
    if(!label.htmlFor&&fields.length===1&&fields[0].id)label.htmlFor=fields[0].id;
    const group=fg.querySelector(':scope > .pay-chips, :scope > .cat-chips, :scope > .color-swatches');
    if(group&&!fields.length){group.setAttribute('role','group');group.setAttribute('aria-label',label.textContent.trim());}
  });
}
linkFormLabels();

loadData(); // Supabase対応の非同期起動
