// 共通部分: 定数・状態・認証・データの読み込みと保存・同期・起動の関数・ナビ・計算の補助・グラフ
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// アプリの画面と動き（D4 の手順3 で index.html の <script> から出した）。まだふつうの <script>（import/export ではない）なので、
// 関数は今までどおり window から見え、HTML の onclick から呼べる。index.html の最後（<body> の終わり）で読む
// ============================================================
// データ・定数
// ============================================================
const DAYS=['日','月','火','水','木','金','土'];
const JC=['s0','s1','s2','s3','s4'],BC=['bs0','bs1','bs2','bs3','bs4'];
const DOTC=['#185FA5','#3B6D11','#993556','#BA7517','#3C3489'];
// 色の読み上げ用の名前（色の選択肢はボタンで、文字がないため）
const COLOR_NAMES={pink:'ピンク',blue:'青',green:'緑',orange:'オレンジ',purple:'紫',teal:'青緑'};
const PLAN_COLORS=[{key:'pink',bg:'#FBEAF0',fg:'#993556',dot:'#E06080'},{key:'blue',bg:'#E6F1FB',fg:'#185FA5',dot:'#3A8FE0'},{key:'green',bg:'#EAF3DE',fg:'#3B6D11',dot:'#5CA020'},{key:'orange',bg:'#FAEEDA',fg:'#BA7517',dot:'#E09030'},{key:'purple',bg:'#EEEDFE',fg:'#3C3489',dot:'#7060D0'},{key:'teal',bg:'#DEF3EF',fg:'#0F6E56',dot:'#209070'}];
const planColor=key=>PLAN_COLORS.find(c=>c.key===key)||PLAN_COLORS[0];
function jobColorObj(job){if(!job)return PLAN_COLORS[0];if(job.color)return planColor(job.color);const idx=st.jobs.indexOf(job);return PLAN_COLORS[idx>=0?idx%PLAN_COLORS.length:0];}
function jobColorByName(name){return jobColorObj(st.jobs.find(j=>j.name===name));}
const DEF_EXP=['食費','交通費','外食','娯楽','日用品','通信費','固定費','その他'];
const DEF_INC=['給与','バイト','仕送り','その他'];
const CAT_COL={'食費':'#185FA5','交通費':'#3B6D11','外食':'#993556','娯楽':'#BA7517','日用品':'#3C3089','通信費':'#0F6E56','固定費':'#C45000','その他':'#5F5E5A','給与':'#3B6D11','バイト':'#185FA5','仕送り':'#BA7517'};

// 今の日時と、今日の日付 'YYYY-MM-DD'。日付が変わったら onDayChange で新しくする
let _now=new Date();
const toDS=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
let TODAY=MoneyClock.dayKey(_now);

// 新しいユーザーの st（新しいテーブルに設定の行がまだないとき。最初の保存で行ができる）
function defaultSt(){return {acctBase:0,baseDate:TODAY,shiftCloseDay:31,shiftPayDay:10,budget:0,jobs:[],shifts:[],ledger:[],cards:[],wds:[],actualInputs:[],fuyouLimit:'1300000',otherIncome:0,plans:[],catExp:[...DEF_EXP],catInc:[...DEF_INC]};}
st=defaultSt(); // st は src/state.ts の入れ物（window の getter・setter。D19）
let calY=_now.getFullYear(),calM=_now.getMonth(),selDay=null;
let calView='month';   // 'day' | 'week' | 'month'。デフォルトは月表示
let calAnchor=TODAY;   // 日/週ビューの基準日 'YYYY-MM-DD'
let calRenderSeq=0;    // 非同期レンダの競合ガード（←→連打・ビュー切替直後のレース対策）
let shiftCalY=_now.getFullYear(),shiftCalM=_now.getMonth();
let shiftListY=_now.getFullYear(),shiftListM=_now.getMonth();
let ldgListY=_now.getFullYear(),ldgListM=_now.getMonth(),ldgGraphMode='month';
let selShiftDays=new Set();
let ldgType='expense',ldgPay='現金',ldgCardIdx=-1,ldgCat='',ldgReceive='現金';
let ldeType='expense',ldePay='現金',ldeCardIdx=-1,ldeCat='',ldeIdx=-1,ldeReceive='現金';
let catChart=null,dayChart=null,balChart=null,wdStr='',cardEditIdx=-1;
let planEditIdx=-1,planDateMode='single',planColorSel='pink';

// ============================================================
// Supabase設定
// ============================================================
// Supabase のクライアント（supa）は src/supa.ts が作り、src/main.ts が window に出す（接続先は src/env.ts。D19 の手順5）

// currentUser は src/state.ts の入れ物（D19）

// ============================================================
// ログイン画面（出す・閉じるだけ。ログインと起動の流れは src/auth.ts）
// ============================================================

function showLoginScreen(){
  document.getElementById('login-screen').style.display = 'flex';
  /** @type {HTMLElement} */ (document.querySelector('.app')).style.display = 'none';
  /** @type {HTMLElement} */ (document.querySelector('.bottom-nav')).style.display = 'none';
  document.getElementById('top-actions').hidden = true;
}

function hideLoginScreen(user){
  document.getElementById('login-screen').style.display = 'none';
  /** @type {HTMLElement} */ (document.querySelector('.app')).style.display = 'block';
  /** @type {HTMLElement} */ (document.querySelector('.bottom-nav')).style.display = 'flex';
  document.getElementById('top-actions').hidden = false;
  // ログイン中のアカウント（設定のいちばん下）
  document.getElementById('account-email').textContent = user.email || '';
}

// ============================================================
// データ（新しいテーブル。テーブル分割 #11、2026-10-29 に切り替え）
// - サーバーの写し（server）: 新しいテーブルから読んだ行と、その updated_at。src/data.ts で読む
// - 送信待ち（outbox）: まだ送れていない操作の列。この端末に保存し、再起動しても残す
// - 画面のデータ（st）: サーバーの写しに送信待ちを重ねた行から、互換層（src/compat.ts）で組み立てる
// - 保存: 画面で st を変えたら、互換層で行に戻し、前の行との違いを1つの操作にして送信待ちに入れ、順に apply_op で送る
// - 端末の保存場所のキーは maney:prod: で始める（切り替える前の版のキー mavFinal2・mavSync は使わない）
// ============================================================
const STORAGE_PREFIX = MoneyEnv.storagePrefix; // 本番は maney:prod:（src/env.ts）
// サーバーの写し（server）・送信待ち（outbox）・remoteReady・loadingRemote・sending・sendBlocked は、src/state.ts の入れ物（window の getter・setter。D19）
// 保存・送信・読み込みの流れ（save・saveRows・currentRows・flushOutbox・loadRemote など）と TABLE_LABELS は src/sync.ts（D19 の手順4）。
// js/ からは window に出した同じ名前で呼ぶ。ここでは、流れが使う Supabase・st の既定値・画面の関数を渡す
// 流れ（src/sync.ts・src/auth.ts）が画面に頼むことの実装（UiPort。D19）
const appUi = {
  showBanner: showSyncBanner,
  hideBanner: hideSyncBanner,
  renderCurrentSection,
  updateSyncStatus,
  hasOpenModal: ()=>!!document.querySelector('.mbg.open'),
  downloadJson,
  showLogin: showLoginScreen,
  hideLogin: hideLoginScreen,
  renderFirst: ()=>{ renderHome(); renderCal(); },
  showStartupTasks: ()=>maybeShowStartupTasks(),
  reload: ()=>location.reload(),
};
MoneySync.initSync({ supa, storagePrefix: STORAGE_PREFIX, defaultSt, fixDefaults, ui: appUi });
// ログインと起動の流れ（loginWithGoogle・logout・loadData など）は src/auth.ts（D19 の手順5）。loadData は js/app-bootstrap.js が最後に呼ぶ
MoneyAuth.initAuth({ supa, storagePrefix: STORAGE_PREFIX, fixDefaults, ui: appUi });

function renderCurrentSection(){
  const cur = document.querySelector('.sec.active');
  sw(cur ? cur.id.replace('sec-', '') : 'home');
}

// 送れていない変更があるときだけ、左上に件数を出す
function updateSyncStatus(){
  const pill = document.getElementById('sync-pill');
  if(!pill) return;
  pill.hidden = !outbox.length;
  pill.textContent = `送信待ち ${outbox.length}件`;
}

// ============================================================
// 同期の通知（送れない・別の端末との競合）
// ============================================================
function showSyncBanner(msg, actions){
  document.getElementById('sync-banner-msg').textContent = msg;
  const box = document.getElementById('sync-banner-actions');
  box.innerHTML = '';
  actions.forEach(a=>{
    const b = document.createElement('button');
    b.className = 'btn sm' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.onclick = a.onclick;
    box.appendChild(b);
  });
  document.getElementById('sync-banner').classList.add('show');
}

function hideSyncBanner(){
  document.getElementById('sync-banner').classList.remove('show');
}

function downloadJson(name, text){
  const blob = new Blob([text], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${TODAY}.json`; // 端末の時刻での日付（toISOString の日付は、朝9時までは前の日になる）
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

// 前の版の保存の入り口（何もしない。呼んでいる所が残っている）。保存は save()（src/sync.ts）
function saveLocal(){}

// 日付が変わったとき（裏に置いたまま日をまたいだ・開いたまま0時をまたいだ）: 「今日」を新しくして描き直す。
// 「今月」「今日」を見ていた画面は新しい今月・今日に合わせる。ほかの月・日を見ていたら、そのままにする
function onDayChange(now, prevKey){
  const prev=_now;
  _now=now;
  TODAY=MoneyClock.dayKey(now);
  const follow=(y,m)=>MoneyClock.followMonth({y,m},prev,now);
  ({y:calY,m:calM}=follow(calY,calM));
  ({y:shiftCalY,m:shiftCalM}=follow(shiftCalY,shiftCalM));
  ({y:shiftListY,m:shiftListM}=follow(shiftListY,shiftListM));
  ({y:ldgListY,m:ldgListM}=follow(ldgListY,ldgListM));
  if(calAnchor===prevKey) calAnchor=TODAY;
  if(currentUser){ renderCurrentSection(); maybeShowStartupTasks(); }
}
const todayWatcher=MoneyClock.createDayWatcher(()=>new Date(), onDayChange);

// 0時を過ぎたら確かめる（開いたまま日をまたいだとき）。裏にいる間は止まるが、戻ったときに下で確かめる
function scheduleDayCheck(){
  setTimeout(()=>{ todayWatcher.check(); scheduleDayCheck(); }, MoneyClock.msUntilNextDay(new Date())+1000);
}
scheduleDayCheck();

document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState !== 'visible') return;
  todayWatcher.check();
  // 戻ってきたとき: 読み込み直してから、開いたときのタスクの一覧を出すか決める（前に出してから1時間以上なら出す。D10）
  resyncRemote().then(()=>maybeShowStartupTasks(true));
});
window.addEventListener('focus', ()=>todayWatcher.check());
window.addEventListener('online', resyncRemote);

// ============================================================
// st の足りない項目を埋める（src/sync.ts・src/auth.ts に渡す）
// ============================================================

function fixDefaults(){
  ['wds','actualInputs','plans'].forEach(k=>{if(!st[k])st[k]=[];});
  if(!st.catExp||!st.catExp.length)st.catExp=[...DEF_EXP];
  if(!st.catInc||!st.catInc.length)st.catInc=[...DEF_INC];
  // 予定に時刻フィールドを追加(2026-08-10〜)。既存予定はtimeStart:''(終日)として正規化する
  st.plans.forEach(p=>{
    if(typeof p.timeStart!=='string')p.timeStart='';
    if(typeof p.timeEnd!=='string')p.timeEnd='';
  });
}

// ============================================================
// ナビゲーション
// ============================================================
function sw(t){
  ['home','cal','ledger','shift','task','set'].forEach(x=>{
    document.getElementById('sec-'+x).classList.toggle('active',x===t);
    const n=document.getElementById('nav-'+x);
    if(n){n.classList.toggle('active',x===t);if(x===t)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');}
  });
  // 設定は右上のボタンから開く（D10）。開いている間はボタンを色付きにする
  const sb=document.getElementById('settings-btn');
  if(sb){sb.classList.toggle('active',t==='set');if(t==='set')sb.setAttribute('aria-current','page');else sb.removeAttribute('aria-current');}
  if(t==='home')renderHome();
  else if(t==='cal')renderCal();
  else if(t==='ledger'){updateLdgNav_();renderLedger();renderLedgerMetrics();if(document.getElementById('ldg-monthly-sec').style.display!=='none')renderMonthlyTab();}
  else if(t==='shift')renderShiftSection();
  else if(t==='task')renderTaskTab();
  else if(t==='set')initSettingTab();
}

// ============================================================
// ユーティリティ
// ============================================================
const gY=()=>_now.getFullYear(),gM=()=>_now.getMonth(),gD=()=>_now.getDate();
const fmtMD=d=>`${d.getMonth()+1}/${d.getDate()}`;
function addM(y,m,n){let nm=m+n,ny=y;while(nm>11){nm-=12;ny++;}while(nm<0){nm+=12;ny--;}return{y:ny,m:nm};}
const ds2d=ds=>{const[y,m,d]=ds.split('-').map(Number);return new Date(y,m-1,d);};
// 「毎月○日」（固定費・給料日・引き落とし日）の、その月の日と日付。月にない日（30日までの月の31日など）は月末にする（src/clock.ts）
const monthDay=(y,m,day)=>MoneyClock.monthDay(y,m,day);
const monthDate=(y,m,day)=>new Date(y,m,monthDay(y,m,day));
const monthShifts=(y,m)=>st.shifts.filter(s=>{const d=new Date(s.date);return d.getFullYear()===y&&d.getMonth()===m;});
const monthLedger=(y,m)=>st.ledger.filter(l=>{const d=new Date(l.date);return d.getFullYear()===y&&d.getMonth()===m;});
const getLedgerForDay=ds=>st.ledger.filter(l=>l.date===ds);
const closeDay=(y,m)=>parseInt(String(st.shiftCloseDay))>=28?new Date(y,m+1,0).getDate():parseInt(String(st.shiftCloseDay));
function jobPayDay(job){return parseInt(job&&job.payDay)||parseInt(String(st.shiftPayDay))||10;}
function jobCloseDayNum(job,y,m){const cl=parseInt(job&&job.closeDay)||parseInt(String(st.shiftCloseDay))||31;return cl>=28?new Date(y,m+1,0).getDate():cl;}

// ============================================================
// 実績
// ============================================================
const salaryKeyForShiftMonth=(jobName,y,m)=>{const pm=addM(y,m,1);return `${jobName}|${pm.y}-${String(pm.m+1).padStart(2,'0')}`;};
const getActualSalary=(jobName,y,m)=>st.actualInputs.find(a=>a.type==='shift'&&a.job===jobName&&a.salaryKey===salaryKeyForShiftMonth(jobName,y,m));
function setActualSalary(jobName,y,m,amount){const key=salaryKeyForShiftMonth(jobName,y,m),pm=addM(y,m,1),job=st.jobs.find(j=>j.name===jobName),date=toDS(pm.y,pm.m,monthDay(pm.y,pm.m,jobPayDay(job)));const ei=st.actualInputs.findIndex(a=>a.type==='shift'&&a.job===jobName&&a.salaryKey===key);const entry={type:'shift',job:jobName,salaryKey:key,date,actualAmount:amount,estimatedAmount:totalShiftIncNoTransportForJob(jobName,y,m)};if(ei>=0){entry._id=st.actualInputs[ei]._id;st.actualInputs[ei]=entry;}else st.actualInputs.push(entry);}
const cardActualKey=(ci,bY,bM)=>`card-${ci}-${bY}-${String(bM+1).padStart(2,'0')}`;
const getActualCard=(ci,bY,bM)=>st.actualInputs.find(a=>a.type==='card'&&a.cardKey===cardActualKey(ci,bY,bM));
function setActualCard(ci,bY,bM,amount,estimated){const key=cardActualKey(ci,bY,bM),ei=st.actualInputs.findIndex(a=>a.type==='card'&&a.cardKey===key);const entry={type:'card',cardKey:key,cardIdx:ci,billY:bY,billM:bM,actualAmount:amount,estimatedAmount:estimated};if(ei>=0){entry._id=st.actualInputs[ei]._id;st.actualInputs[ei]=entry;}else st.actualInputs.push(entry);}

// ============================================================
// シフト計算
// ============================================================
// 1回のシフトの給料（src/money.ts。D11）
function calcShiftInc(shift){const job=st.jobs.find(j=>j.name===shift.job);return MoneyCalc.shiftIncome({start:shift.start,end:shift.end,rest:shift.rest},job);}
const totalShiftInc=(y,m)=>monthShifts(y,m).reduce((a,s)=>a+calcShiftInc(s).total,0);
const totalShiftIncNoTransport=(y,m)=>monthShifts(y,m).reduce((a,s)=>{const r=calcShiftInc(s);return a+r.wage+r.nightWage;},0);
const totalTransport=(y,m)=>monthShifts(y,m).reduce((a,s)=>a+calcShiftInc(s).transport,0);
const jobMonthShifts=(jobName,y,m)=>monthShifts(y,m).filter(s=>s.job===jobName);
const totalShiftIncForJob=(jobName,y,m)=>jobMonthShifts(jobName,y,m).reduce((a,s)=>a+calcShiftInc(s).total,0);
const totalShiftIncNoTransportForJob=(jobName,y,m)=>jobMonthShifts(jobName,y,m).reduce((a,s)=>{const r=calcShiftInc(s);return a+r.wage+r.nightWage;},0);
const calcH=(s,e,rest)=>{const[sh,sm]=s.split(':').map(Number);const[eh,em]=e.split(':').map(Number);return Math.max(0,(eh*60+em-sh*60-sm-(parseInt(rest)||0))/60);};

// ============================================================
// カードサイクル
// ============================================================
// その月にカードから引き落とす金額（実額があれば実額、なければ集計した見込み）
function cardBillAmount(card, ci, y, m){
  const actual = getActualCard(ci, y, m);
  return actual ? parseInt(actual.actualAmount) : cardCycleForBillMonth(card, ci, y, m).amount;
}
// 記録の下に出す小さな文字。支出は払い方（カード名・現金・口座）、収入は受け取り方（現金・口座振込）
function ledgerPayLabel(l){
  if(l.type === 'income') return l.receive || '現金';
  const card = l.cardIdx >= 0 ? st.cards[l.cardIdx] : null;
  return card ? card.name : (l.pay || '');
}
// カードの締め日を実際の日付で取得（31=末日として扱う）
function cardCloseDay(card, y, m){
  const cl = parseInt(card.closeDay);
  if(cl >= 28) return new Date(y, m+1, 0).getDate(); // その月の末日
  return cl;
}

// カードの集計は src/money.ts の cardCycle（D11）。cs・ce は今の画面に合わせて Date で返す
// 登録の前の見本（_id のないカード）は、記録のない仮のカードとして数える
function cardRowOf(card){const row=card._id&&(currentRows().cards||[]).find(c=>c.id===card._id);return row||{id:'__preview__',close_day:parseInt(card.closeDay),bill_day:parseInt(card.billDay)};}
function cardCycleForBillMonth(card,ci,billY,billM){const n=MoneyCalc.cardCycle(currentRows(),cardRowOf(card),billY,billM);return{cs:ds2d(n.cs),ce:ds2d(n.ce),billD:n.billD,amount:n.amount};}
// idx: 0 は確定（次に引き落とされる分）、1 は集計中（その次）
function cycle(card,idx){const row=cardRowOf(card),mo=MoneyCalc.cardCycleMonths(row,TODAY),bm=idx===0?mo.confirmed:mo.pending,n=MoneyCalc.cardCycle(currentRows(),row,bm.y,bm.m);return{label:idx===0?'確定':'集計中',cs:ds2d(n.cs),ce:ds2d(n.ce),billY:n.billY,billM:n.billM,billD:n.billD,amount:n.amount};}
const cardBillForGraphDate=(card,ci,billY,billM)=>cardCycleForBillMonth(card,ci,billY,billM).amount;
const cardBillForDate=(card,bY,bM)=>cardBillForGraphDate(card,st.cards.indexOf(card),bY,bM);

// ============================================================
// 口座推定
// ============================================================
// 今日の口座の残高（推定）。src/money.ts で数える（D11）
function estimateAcct(){return server?MoneyCalc.balanceAt(currentRows(),TODAY):(parseInt(String(st.acctBase))||0);}

// ============================================================
// グラフ
// ============================================================
// 残高推移（今後90日）。src/money.ts で数える（D11。予定はカード払い以外を予定の日に、先の日付の口座の記録もその日に）
function buildBalanceSeries(){const s=MoneyCalc.balanceSeries(currentRows(),TODAY,90);return{labels:s.map((p,i)=>{const d=ds2d(p.date);return i===0?'今日':`${d.getMonth()+1}/${d.getDate()}`;}),balances:s.map(p=>Math.round(p.balance))};}
function renderBalanceChart(){const{labels,balances}=buildBalanceSeries();const ctx=/** @type {HTMLCanvasElement} */ (document.getElementById('balance-chart')).getContext('2d');if(balChart)balChart.destroy();balChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'口座残高',data:balances,borderWidth:2.5,pointRadius:balances.map((b,i)=>{if(i===0)return 4;if(i>0&&Math.abs(balances[i]-balances[i-1])>3000)return 3;return 0;}),pointBackgroundColor:balances.map(b=>b<0?'#A32D2D':'#185FA5'),fill:{target:'origin',above:'rgba(24,95,165,0.07)',below:'rgba(163,45,45,0.09)'},tension:0.1,segment:{borderColor:ctx2=>{const i=ctx2.p0DataIndex;return(balances[i]<0||balances[i+1]<0)?'#A32D2D':'#185FA5';}}},{data:new Array(balances.length).fill(0),borderColor:'rgba(163,45,45,0.3)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:ctx2=>labels[ctx2[0].dataIndex],label:ctx2=>{if(ctx2.datasetIndex===1)return null;return`口座残高: ¥${ctx2.raw.toLocaleString()}`;}},filter:item=>item.datasetIndex===0}},scales:{x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:10,callback:(v,i)=>labels[i]},grid:{display:false}},y:{ticks:{callback:v=>{const a=Math.abs(v);return(v<0?'-':'')+(a>=10000?'¥'+Math.round(a/1000)+'k':'¥'+a.toLocaleString());},font:{size:10}},grid:{color:'rgba(128,128,128,0.08)'}}}}});document.getElementById('balance-warn').innerHTML=balances.some(b=>b<0)?'<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:4px">⚠ この期間に残高がマイナスになる日があります</div>':'';}

