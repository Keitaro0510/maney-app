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
let st=defaultSt();
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
const SUPA_URL = 'https://sgvyjolyfuqchugltvls.supabase.co';
const SUPA_KEY = 'sb_publishable_xQszLlsL0IVxrnxsHK0ZtA_AHqsaDMu';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'money-app-auth',
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let currentUser = null;

// ============================================================
// 認証
// ============================================================
async function loginWithGoogle(){
  await supa.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.href  // ログイン後に元のページに戻る
    }
  });
}

async function logout(){
  if(outbox.length){
    showSyncBanner(`送れていない変更が${outbox.length}件あります。ログアウトすると、この端末から消えます。`,
      [{label: 'ログアウトする', onclick: reallyLogout}, {label: 'やめる', onclick: hideSyncBanner, primary: true}]);
    return;
  }
  await reallyLogout();
}

async function reallyLogout(){
  const userId = currentUser && currentUser.id;
  await supa.auth.signOut();
  if(userId) ['server', 'outbox'].forEach(name=>localStorage.removeItem(`${STORAGE_PREFIX}${userId}:v2:${name}`));
  location.reload();
}

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
// - サーバーの写し（server）: 新しいテーブルから読んだ行と、その updated_at。js/data.js で読む
// - 送信待ち（outbox）: まだ送れていない操作の列。この端末に保存し、再起動しても残す
// - 画面のデータ（st）: サーバーの写しに送信待ちを重ねた行から、互換層（js/compat.js）で組み立てる
// - 保存: 画面で st を変えたら、互換層で行に戻し、前の行との違いを1つの操作にして送信待ちに入れ、順に apply_op で送る
// - 端末の保存場所のキーは maney:prod: で始める（切り替える前の版のキー mavFinal2・mavSync は使わない）
// ============================================================
const STORAGE_PREFIX = 'maney:prod:';
let server = null;         // {rows, epoch, loadedAt}
let outbox = [];           // 送信待ちの操作
let remoteReady = false;   // サーバーから読み込めた
let loadingRemote = false; // サーバーから読み込んでいる途中
let sending = false;       // 送信待ちを送っている途中
let sendBlocked = null;    // 送るのを止めている理由（'conflict'・'stale_epoch'・'error'）。選んでもらうまで送らない

const TABLE_LABELS = {
  settings: '設定', cards: 'カード', jobs: 'バイト先', categories: 'カテゴリ', ledger_entries: '家計簿',
  shifts: 'シフト', plans: '予定', fixed_costs: '毎月のお金', withdrawals: '引き出し',
  salary_actuals: '給与の実績', card_bill_actuals: 'カードの実績', tasks: 'タスク',
};

function storageKey(name){ return `${STORAGE_PREFIX}${currentUser.id}:v2:${name}`; }

function loadStored(name){
  try{
    const s = localStorage.getItem(storageKey(name));
    return s ? JSON.parse(s) : null;
  }catch(e){ return null; }
}

function store(name, value){
  try{ localStorage.setItem(storageKey(name), JSON.stringify(value)); }
  catch(e){
    console.warn('端末に保存できませんでした:', e);
    showSyncBanner('この端末に保存できませんでした（容量がいっぱいかもしれません）。送れていない変更は、アプリを閉じると消えます。',
      [{label: '閉じる', onclick: hideSyncBanner}]);
  }
}

// 今の行（サーバーの写しに送信待ちを重ねたもの）
// 今の行（サーバーの写しに、送信待ちを重ねたもの）。まだサーバーから読み込めていないときは、空の行（お金の計算が止まらないように）
function currentRows(){ return server ? MoneyData.applyOutbox(server.rows, outbox) : {}; }

// 今の行から、画面のデータ（互換の st）を作り直す。設定の行がなければ false
function rebuildSt(){
  if(!server) return false;
  st = MoneyCompat.rowsToSt(currentRows()) || defaultSt();
  fixDefaults();
  return true;
}

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

// 別の端末の変更とぶつかった
function showConflict(op, conflicts){
  const reasons = {
    changed: '別の端末で変更されています',
    missing: '別の端末で削除されています',
    exists: 'すでにあります',
    duplicate: '同じ内容の記録が、別の端末で登録されています',
  };
  const lines = conflicts.map(c => `・${TABLE_LABELS[c.table] || c.table}: ${reasons[c.reason] || c.reason}`);
  showSyncBanner(
    '別の端末の変更とぶつかったため、この端末の変更を保存していません。\n' + lines.join('\n') + '\n\n' +
    '・サーバーの内容にする: この端末の送れていない変更は、すべて消えます\n' +
    '・この端末の内容で上書き: ぶつかった記録を、この端末の内容にします',
    [
      {label: 'サーバーの内容にする', onclick: useServerVersion},
      {label: 'この端末の内容で上書き', onclick: ()=>overwriteWithMine(op, conflicts)},
    ]);
}

// 競合を解く: 送信待ちを捨てて、サーバーの内容を読み込み直す
async function useServerVersion(){
  outbox = [];
  store('outbox', outbox);
  sendBlocked = null;
  hideSyncBanner();
  updateSyncStatus();
  await loadRemote();
}

// 競合を解く: ぶつかった記録を、この端末の内容で上書きして送り直す
async function overwriteWithMine(op, conflicts){
  outbox = MoneyData.rewriteForOverwrite(outbox, op, conflicts, crypto.randomUUID());
  store('outbox', outbox);
  sendBlocked = null;
  hideSyncBanner();
  rebuildSt();
  renderCurrentSection();
  await flushOutbox();
  if(!outbox.length) await loadRemote(); // 別の端末の、ほかの変更も読み込む
}

// サーバーのデータが移し直された（移行の番号が上がった）
function showStaleEpoch(){
  showSyncBanner(
    `サーバーのデータが移し直されたため、この端末の送れていない変更（${outbox.length}件）は保存できません。\n` +
    '必要なら書き出して（JSON のファイル）から、捨てて読み込み直してください。',
    [
      {label: '書き出す', onclick: downloadOutbox},
      {label: '捨てて読み込み直す', onclick: useServerVersion, primary: true},
    ]);
}

// 送信待ちを JSON のファイルにして保存する（捨てる前の退避）
function downloadOutbox(){
  downloadJson('maney-outbox', JSON.stringify({exportedAt: new Date().toISOString(), outbox}, null, 2));
}

function downloadJson(name, text){
  const blob = new Blob([text], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${TODAY}.json`; // 端末の時刻での日付（toISOString の日付は、朝9時までは前の日になる）
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

// 切り替える前の版（user_data）が端末に残したデータ。
// 送れていなかった変更があれば、書き出せるようにする（新しい版では保存できないため）。なければ消す
function handleLegacyLocalData(){
  let legacy = null;
  try{
    const sync = JSON.parse(localStorage.getItem('mavSync') || 'null');
    if(sync && sync.dirty) legacy = localStorage.getItem('mavFinal2');
  }catch(e){}
  const forget = ()=>{ localStorage.removeItem('mavFinal2'); localStorage.removeItem('mavSync'); };
  // 試験版（next.html。切り替えのときに消した）が端末に残したキー
  try{ Object.keys(localStorage).filter(k=>k.startsWith('maney:next:')).forEach(k=>localStorage.removeItem(k)); }catch(e){}
  if(!legacy){ forget(); return; }
  showSyncBanner(
    '切り替える前の版で、サーバーに送れていなかった変更が、この端末に残っています。\n' +
    '書き出して（JSON のファイル）、必要なら入れ直してください。',
    [
      {label: '書き出す', onclick: ()=>downloadJson('maney-before-cutover', legacy), primary: true},
      {label: '捨てる', onclick: ()=>{ forget(); hideSyncBanner(); }},
    ]);
}

// サーバーが受け付けなかった（制約違反など。送り直しても通らない）
function showSendError(op, error){
  showSyncBanner(
    'サーバーがこの端末の変更を受け付けませんでした。\n' + ((error && (error.message || error.code)) || error) + '\n' +
    '・この変更を捨てる: この変更と、これを前提にしたあとの変更を捨てます',
    [
      {label: 'この変更を捨てる', onclick: ()=>{
        outbox = MoneyData.discardOp(outbox, op.id);
        store('outbox', outbox);
        sendBlocked = null;
        hideSyncBanner();
        rebuildSt();
        renderCurrentSection();
        flushOutbox();
      }},
      {label: 'もう一度送る', onclick: ()=>{ sendBlocked = null; hideSyncBanner(); flushOutbox(); }, primary: true},
    ]);
}

// ============================================================
// 保存: 画面で変えた st を、送信待ちの操作にする
// UI の処理は st を変えてから save() を呼ぶ。そのあとの描画は、作り直した st で行われる
// ============================================================
function saveLocal(){}

function save(){
  if(!server){
    rebuildSt();
    showSyncBanner('まだサーバーから読み込めていないので、保存できません。',
      [{label: 'もう一度読み込む', onclick: loadRemote, primary: true}]);
    return;
  }
  try{
    const now = new Date().toISOString();
    const before = currentRows();
    const after = MoneyCompat.stToRows(st, before, {newId: ()=>crypto.randomUUID(), now});
    // 互換の st が持つテーブルだけを比べる（tasks などは st にないので、比べると全部「消えた」と見なしてしまう。D1）
    queueChanges(MoneyData.diffRows(before, after, MoneyData.COMPAT_TABLES), now);
  }catch(e){
    console.warn('保存できませんでした:', e);
    rebuildSt();
    renderCurrentSection();
    showSyncBanner('保存できませんでした。変えた内容は取り消しました。\n' + (e.message || e),
      [{label: '閉じる', onclick: hideSyncBanner}]);
    return;
  }
  rebuildSt(); // 新しい記録にも _id が付く（続けて編集しても、同じ行の更新になる）
  updateSyncStatus();
  flushOutbox();
}

// 変更の列を1つの操作にして、送信待ちに積む（端末にも保存する）
function queueChanges(changes, now){
  if(!changes.length) return;
  const op = MoneyData.makeOp(changes, {id: crypto.randomUUID(), epoch: server.epoch, now, server, outbox});
  outbox = [...outbox, op];
  store('outbox', outbox);
}

// 互換の st を通さずに、行を直接保存する入り口（tasks など。D1）。1回の呼び出しが1つの操作になる。
// changes: [{table, action: 'insert'|'update'|'delete', id, row}]。row にはサーバーが決める列（id・user_id・日時）を入れない。
// base（読み込んだときの updated_at）は makeOp が付ける。保存した行は currentRows()[table] で読める。
// 保存できたら true。できなければ知らせを出して false（送信待ちには積まない）
function saveRows(changes){
  if(!server){
    showSyncBanner('まだサーバーから読み込めていないので、保存できません。',
      [{label: 'もう一度読み込む', onclick: loadRemote, primary: true}]);
    return false;
  }
  try{
    queueChanges(MoneyData.checkDirectChanges(changes), new Date().toISOString());
  }catch(e){
    console.warn('保存できませんでした:', e);
    showSyncBanner('保存できませんでした。\n' + (e.message || e), [{label: '閉じる', onclick: hideSyncBanner}]);
    return false;
  }
  updateSyncStatus();
  flushOutbox();
  return true;
}

// 送信待ちを、古いものから1つずつ送る
async function flushOutbox(){
  if(!currentUser || sending || loadingRemote || sendBlocked || !outbox.length) return;
  sending = true;
  try{
    while(outbox.length && !sendBlocked){
      const op = outbox[0];
      const res = await MoneyData.sendOp(supa, op);
      if(res.kind === 'applied'){
        ({server, outbox} = MoneyData.acknowledge({server, outbox}, op, res.result));
        store('server', server);
        store('outbox', outbox);
      }else if(res.kind === 'conflict'){
        sendBlocked = 'conflict';
        showConflict(op, res.conflicts);
      }else if(res.kind === 'stale_epoch'){
        sendBlocked = 'stale_epoch';
        showStaleEpoch();
      }else if(res.kind === 'network'){
        showSyncBanner(`通信できないため、送れていない変更が${outbox.length}件あります。この端末に残っていて、通信が戻ったら送ります。`,
          [{label: 'もう一度送る', onclick: flushOutbox, primary: true}]);
        break;
      }else{
        sendBlocked = 'error';
        showSendError(op, res.error);
      }
    }
    if(!outbox.length) hideSyncBanner();
  }finally{
    sending = false;
    updateSyncStatus();
  }
}

// ============================================================
// 新しいテーブルから読み込む（起動時と、アプリに戻ってきたとき）
// すべてのテーブルを読み終えて件数が合ったときだけ、サーバーの写しを置き換える
// 送信待ちは、新しい写しに重ね直す
// ============================================================
async function loadRemote(){
  if(!currentUser || loadingRemote || sending) return;
  loadingRemote = true;
  try{
    server = await MoneyData.loadAllTables(supa);
    store('server', server);
    remoteReady = true;
    rebuildSt();
    if(!sendBlocked) hideSyncBanner();
    renderCurrentSection();
    console.log('サーバーから読み込みました', server.loadedAt);
  }catch(e){
    console.warn('新しいテーブルを読み込めませんでした:', e);
    showSyncBanner(
      (server ? '新しいテーブルを読み込めませんでした。前に読み込んだ内容を表示しています。' : '新しいテーブルを読み込めませんでした。')
        + '\n' + (e.message || e),
      [{label: 'もう一度読み込む', onclick: loadRemote, primary: true}]);
  }finally{
    loadingRemote = false;
  }
}

// アプリに戻ってきたとき・通信が戻ったとき: 送信待ちを送ってから、読み込み直す
// （入力中の画面があるときは読み込まない。送るのは入力中でもよい）
async function resyncRemote(){
  if(!currentUser) return;
  await flushOutbox();
  if(outbox.length) return;
  if(document.querySelector('.mbg.open')) return;
  await loadRemote();
}
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
// 起動
// ============================================================

// ログインした直後: 端末に保存したサーバーの写しと送信待ちをすぐ表示し、そのあとサーバーから読み込んで送る
async function startWithUser(user){
  currentUser = user;
  hideLoginScreen(currentUser);
  server = loadStored('server');
  outbox = loadStored('outbox') || [];
  rebuildSt();
  updateSyncStatus();
  renderHome();
  renderCal();
  await loadRemote();
  maybeShowStartupTasks(); // 開いたときのタスクの一覧（D10。開くたびに出す）
  await flushOutbox();
  handleLegacyLocalData();
}

async function loadData(){
  fixDefaults();

  const { data: { session } } = await supa.auth.getSession();
  let initialLoadDone = false;

  if(session){
    initialLoadDone = true;
    await startWithUser(session.user);
  } else {
    showLoginScreen();
  }

  // 認証状態の変化を監視（ログイン後のリダイレクト時に発火）
  supa.auth.onAuthStateChange(async (event, session) => {
    if(event === 'SIGNED_IN' && session){
      // 初回ログイン時だけ読み込む（アプリ復帰時の再発火を防ぐ）
      if(!initialLoadDone){
        initialLoadDone = true;
        await startWithUser(session.user);
      }
    } else if(event === 'SIGNED_OUT'){
      currentUser = null;
      initialLoadDone = false;
      remoteReady = false;
      server = null;
      outbox = [];
      showLoginScreen();
    }
  });
}

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
// 「毎月○日」（固定費・給料日・引き落とし日）の、その月の日と日付。月にない日（30日までの月の31日など）は月末にする（js/clock.js）
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
// 1回のシフトの給料（js/money.js。D11）
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

// カードの集計は js/money.js の cardCycle（D11）。cs・ce は今の画面に合わせて Date で返す
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
// 今日の口座の残高（推定）。js/money.js で数える（D11）
function estimateAcct(){return server?MoneyCalc.balanceAt(currentRows(),TODAY):(parseInt(String(st.acctBase))||0);}

// ============================================================
// グラフ
// ============================================================
// 残高推移（今後90日）。js/money.js で数える（D11。予定はカード払い以外を予定の日に、先の日付の口座の記録もその日に）
function buildBalanceSeries(){const s=MoneyCalc.balanceSeries(currentRows(),TODAY,90);return{labels:s.map((p,i)=>{const d=ds2d(p.date);return i===0?'今日':`${d.getMonth()+1}/${d.getDate()}`;}),balances:s.map(p=>Math.round(p.balance))};}
function renderBalanceChart(){const{labels,balances}=buildBalanceSeries();const ctx=/** @type {HTMLCanvasElement} */ (document.getElementById('balance-chart')).getContext('2d');if(balChart)balChart.destroy();balChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'口座残高',data:balances,borderWidth:2.5,pointRadius:balances.map((b,i)=>{if(i===0)return 4;if(i>0&&Math.abs(balances[i]-balances[i-1])>3000)return 3;return 0;}),pointBackgroundColor:balances.map(b=>b<0?'#A32D2D':'#185FA5'),fill:{target:'origin',above:'rgba(24,95,165,0.07)',below:'rgba(163,45,45,0.09)'},tension:0.1,segment:{borderColor:ctx2=>{const i=ctx2.p0DataIndex;return(balances[i]<0||balances[i+1]<0)?'#A32D2D':'#185FA5';}}},{data:new Array(balances.length).fill(0),borderColor:'rgba(163,45,45,0.3)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:ctx2=>labels[ctx2[0].dataIndex],label:ctx2=>{if(ctx2.datasetIndex===1)return null;return`口座残高: ¥${ctx2.raw.toLocaleString()}`;}},filter:item=>item.datasetIndex===0}},scales:{x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:10,callback:(v,i)=>labels[i]},grid:{display:false}},y:{ticks:{callback:v=>{const a=Math.abs(v);return(v<0?'-':'')+(a>=10000?'¥'+Math.round(a/1000)+'k':'¥'+a.toLocaleString());},font:{size:10}},grid:{color:'rgba(128,128,128,0.08)'}}}}});document.getElementById('balance-warn').innerHTML=balances.some(b=>b<0)?'<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:4px">⚠ この期間に残高がマイナスになる日があります</div>':'';}

// ============================================================
// ホーム
// ============================================================
// 今月これから入るお金（毎月のお金の収入・給料。給料日が過ぎていたら来月の給料）。数え方は js/money.js（固定費の期間も見る）
function upcomingIncome(){const mdl=MoneyCalc.model(currentRows()),y=gY(),m=gM(),d=gD(),parts=[];
  mdl.fixedCosts.filter(fc=>fc.kind==='income'&&MoneyCalc.activeInMonth(fc,y,m)).forEach(fc=>{if(monthDay(y,m,fc.day)>d)parts.push({label:fc.name,amount:fc.amount});});
  mdl.jobs.forEach(job=>{const pay=monthDay(y,m,MoneyCalc.payDayOf(mdl,job))>d?{y,m}:addM(y,m,1),work=addM(pay.y,pay.m,-1),s=MoneyCalc.salary(mdl,job,pay.y,pay.m);if(s.amount>0)parts.push({label:`${job.name}（${work.m+1}月分）`,amount:s.amount});});
  return{total:parts.reduce((a,p)=>a+p.amount,0),parts};}
// これからの確定引き落とし: 次に引き落とされるカードの分（確定）と、今月これからの口座払いの固定費・口座払いの支出（D11）
function upcomingFixed(){const mdl=MoneyCalc.model(currentRows()),y=gY(),m=gM(),d=gD(),monthEnd=toDS(y,m,new Date(y,m+1,0).getDate());let total=0;
  mdl.cards.forEach(card=>{const c=MoneyCalc.cardCycleMonths(card,TODAY).confirmed;if(toDS(c.y,c.m,monthDay(c.y,c.m,card.bill_day))>TODAY)total+=MoneyCalc.cardBill(mdl,card,c.y,c.m).amount;});
  mdl.fixedCosts.filter(fc=>fc.kind==='expense'&&fc.payment_method==='bank'&&MoneyCalc.activeInMonth(fc,y,m)).forEach(fc=>{if(monthDay(y,m,fc.day)>d)total+=fc.amount;});
  mdl.ledger.filter(l=>l.kind==='expense'&&l.payment_method==='bank'&&l.date>TODAY&&l.date<=monthEnd).forEach(l=>{total+=l.amount;});
  return total;}
function thisMonthPlanBudget(){const y=gY(),m=gM(),ms=toDS(y,m,1),me=toDS(y,m,new Date(y,m+1,0).getDate());return st.plans.filter(p=>{if(p.done||!p.budget||p.planCardIdx!=null)return false;const s=p.dateStart||p.date,e=p.dateEnd||p.date;return s<=me&&e>=ms;}).reduce((a,p)=>a+p.budget,0);}
function getPlansForDay(ds){return st.plans.filter(p=>{const s=p.dateStart||p.date,e=p.dateEnd||p.date;return ds>=s&&ds<=e;});}

// 'HH:MM' → 分（時刻なしは-1）。calcShiftInc()のsh*60+smイディオムを関数化したもの
const hm2min = t => { if(!t) return -1; const [h,m]=t.split(':').map(Number); return h*60+m; };

// 指定日における予定の時刻情報を返す。期間予定は「初日=timeStart、最終日=timeEnd、中日=終日」という
// Googleカレンダー準拠のセマンティクスにする
function planTimeOnDay(p, ds){
  const s=p.dateStart||p.date, e=p.dateEnd||p.date;
  if(!p.timeStart) return {start:'',end:'',min:-1};
  if(s===e) return {start:p.timeStart,end:p.timeEnd||'',min:hm2min(p.timeStart)};
  if(ds===s) return {start:p.timeStart,end:'',min:hm2min(p.timeStart)};
  if(ds===e) return {start:'',end:p.timeEnd||'',min:p.timeEnd?hm2min(p.timeEnd):-1};
  return {start:'',end:'',min:-1};
}

function renderForecast(){const y=gY(),m=gM(),acct=estimateAcct(),incInfo=upcomingIncome(),fixed=upcomingFixed();const planBudget=thisMonthPlanBudget(),pendingCards=st.cards.reduce((a,card)=>a+cycle(card,1).amount,0);const forecast=acct+incInfo.total-fixed-planBudget-pendingCards;const planCount=st.plans.filter(p=>{if(p.done||!p.budget||p.planCardIdx!=null)return false;const ms=toDS(y,m,1),me=toDS(y,m,new Date(y,m+1,0).getDate());const s=p.dateStart||p.date,e=p.dateEnd||p.date;return s<=me&&e>=ms;}).length;let html=`<div class="forecast-row"><span style="color:var(--color-text-secondary)">現在の口座残高（推定）</span><span style="font-weight:600">${yenSigned(acct)}</span></div><div class="forecast-row"><span style="color:#3B6D11">＋ 予定収入</span><span style="color:#3B6D11;font-weight:600">+¥${incInfo.total.toLocaleString()}</span></div><div class="forecast-row"><span style="color:#A32D2D">− 確定引き落とし・毎月のお金</span><span style="color:#A32D2D;font-weight:600">-¥${fixed.toLocaleString()}</span></div><div class="forecast-row"><span style="color:#BA7517">− 集計中カード（見込み）</span><span style="color:#BA7517;font-weight:600">-¥${pendingCards.toLocaleString()}</span></div>`;if(planBudget>0)html+=`<div class="forecast-row"><span style="color:#993556">− 予定支出（${planCount}件）</span><span style="color:#993556;font-weight:600">-¥${planBudget.toLocaleString()}</span></div>`;html+=`<div class="forecast-sep"></div><div class="forecast-row"><span style="font-weight:600">収支見通し</span><span class="forecast-total" style="color:${forecast>=0?'#3B6D11':'#A32D2D'}">${forecast>0?'+':''}${yenSigned(forecast)}</span></div>`;if(forecast<0)html+=`<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:8px">⚠ ¥${Math.abs(forecast).toLocaleString()} 不足する見込みです</div>`;document.getElementById('forecast-content').innerHTML=html;}

// お金を「-¥1,200」「¥3,400」の形にする（マイナスはそのまま出す。D11）
const yenSigned=v=>(v<0?'-':'')+'¥'+Math.abs(v).toLocaleString();
// ホーム（D11: いちばん大事な数字・タスクの1行・記録のボタン・今日のお知らせ・これからのお金の動き・くわしく）。数えるのは js/money.js
function renderHome(){const y=gY(),m=gM(),d=gD();
  const rows=currentRows(),sp=MoneyCalc.spendable(rows,TODAY),bal=estimateAcct(),pd=ds2d(sp.payday);
  const spEl=document.getElementById('home-spendable');
  spEl.textContent=yenSigned(sp.amount);spEl.closest('.home-main').classList.toggle('short',sp.amount<0);
  document.getElementById('home-spendable-sub').textContent=`1日あたり ${yenSigned(sp.perDay)}・給料まで ${sp.days}日（${pd.getMonth()+1}/${pd.getDate()}）`;
  const balEl=document.getElementById('home-balance');
  balEl.textContent=yenSigned(bal);balEl.classList.toggle('negative',bal<0);
  renderHomeTasks();
  // 今日のお知らせ（作り方は前と同じ）
  let ahtml='';const todayDS=toDS(y,m,d);st.cards.forEach((card,ci)=>{if(monthDay(y,m,parseInt(card.billDay))===d){const f=cycle(card,0),actual=getActualCard(ci,y,m);if(actual)ahtml+=`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(card.name)}</strong> 引き落とし ¥${parseInt(actual.actualAmount).toLocaleString()} <span class="act-badge">実額反映済</span></div>`;else if(f.amount>0)ahtml+=`<div class="abar-action"><strong>${MoneyUI.escapeHtml(card.name)}</strong> の引き落とし日（推定 ¥${f.amount.toLocaleString()}）</div>`;}if(!card._deleted&&cardCloseDay(card,y,m)===d)ahtml+=`<div class="abar neutral">今日は <strong>${MoneyUI.escapeHtml(card.name)}</strong> の締め日</div>`;});st.jobs.forEach(job=>{const jPayD=monthDay(y,m,jobPayDay(job)),jShimeD=jobCloseDayNum(job,y,m);if(d===jPayD){const sm=addM(y,m,-1);const estInc=totalShiftIncForJob(job.name,sm.y,sm.m);const actual=getActualSalary(job.name,sm.y,sm.m);if(actual)ahtml+=`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(job.name)}</strong> 給料（${sm.m+1}月分） 入金 ¥${parseInt(actual.actualAmount).toLocaleString()} <span class="act-badge">実額反映済</span></div>`;else if(estInc>0)ahtml+=`<div class="abar-action"><strong>${MoneyUI.escapeHtml(job.name)}</strong> 給料の入金日（${sm.m+1}月分 推定 ¥${estInc.toLocaleString()}）</div>`;}if(d===jShimeD&&d!==jPayD)ahtml+=`<div class="abar neutral">今日は <strong>${MoneyUI.escapeHtml(job.name)}</strong> の締め日 — ${jPayD}日払い</div>`;});monthlyRowsIn(y,m).filter(fc=>monthDay(y,m,fc.day)===d).forEach(fc=>{ahtml+=fc.kind==='income'?`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(fc.name)}</strong> 入金 ¥${fc.amount.toLocaleString()}</div>`:`<div class="abar warn">今日 <strong>${MoneyUI.escapeHtml(fc.name)}</strong> ${monthlyPayLabel(fc)} ¥${fc.amount.toLocaleString()}</div>`;});st.shifts.filter(s=>s.date===todayDS).forEach(s=>{const r=calcShiftInc(s);ahtml+=`<div class="abar info">今日 <strong>${MoneyUI.escapeHtml(s.job)}</strong> ${s.start}〜${s.end} (¥${r.total.toLocaleString()})</div>`;});getPlansForDay(todayDS).filter(p=>!p.done).forEach(p=>{const c=planColor(p.color);ahtml+=`<div class="abar plan" style="--dot:${c.dot}">📅 <strong>${MoneyUI.escapeHtml(p.title)}</strong>${p.budget>0?` 予算 ¥${p.budget.toLocaleString()}`:''}</div>`;});document.getElementById('alerts-home').innerHTML=ahtml?`<section class="card home-alerts" aria-labelledby="home-alerts-title"><h2 class="home-alerts-title" id="home-alerts-title">今日のお知らせ</h2>${ahtml}</section>`:'';
  renderHomeUpcoming(rows);
  if(MoneyUI.dialogById('home-more').open)renderHomeMore();
}

// これからのお金の動き（2週間）。給料・引き落とし・予定など、口座のお金が動くものを日付の順に（js/money.js の upcoming）
const UPCOMING_KIND={salary:['給料','binc'],fixed_income:['入金','binc'],ledger_income:['入金','binc'],fixed_cost:['引き落とし','bfixcost'],card_bill:['カード','bcard'],ledger_expense:['口座払い','bfixcost'],withdrawal:['ATM','bwd'],plan:['予定','bplan']};
function renderHomeUpcoming(rows){
  const box=document.getElementById('home-upcoming');
  const list=MoneyCalc.upcoming(rows,TODAY,14);
  if(!list.length){box.innerHTML='<div class="empty">この2週間、口座のお金の動きはありません</div>';return;}
  box.innerHTML=list.map(e=>{
    const dt=ds2d(e.date),[kind,cls]=UPCOMING_KIND[e.kind]||['',''];
    const label=e.kind==='salary'?`${e.label}の給料`:e.kind==='card_bill'?`${e.label}の引き落とし`:e.label;
    return `<div class="up-row"><span class="up-date">${dt.getMonth()+1}/${dt.getDate()}(${DAYS[dt.getDay()]})</span><span class="badge ${cls}">${kind}</span><span class="up-label">${MoneyUI.escapeHtml(label)}</span><span class="up-amount ${e.amount<0?'out':'in'}">${e.amount<0?'-':'+'}¥${Math.abs(e.amount).toLocaleString()}</span></div>`;
  }).join('');
}

// くわしく（画面を開いているときだけ描く。グラフは見えていないと大きさが決まらないため）
function renderHomeMore(){renderBalanceChart();renderForecast();renderHomeBudget();}
// 「くわしく」の画面（下から出る）を開く。グラフは、画面が見えてから描く
let closeHomeMoreFn=null;
function openHomeMore(opener){closeHomeMoreFn=MoneyUI.openSheet(MoneyUI.dialogById('home-more'),opener);renderHomeMore();}
function closeHomeMore(){if(closeHomeMoreFn)closeHomeMoreFn();}
function renderHomeBudget(){
  const y=gY(),m=gM(),lexp=monthLedger(y,m).filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(l.amount),0);
  const bud=st.budget||0,pct=bud>0?Math.min(100,Math.round(lexp/bud*100)):0;
  document.getElementById('h-budlbl').textContent='予算 ¥'+bud.toLocaleString();
  document.getElementById('h-budused').textContent='支出 ¥'+lexp.toLocaleString();
  const bar=document.getElementById('h-prog');
  bar.style.width=pct+'%';bar.style.background=pct>80?'#A32D2D':pct>60?'#BA7517':'#3B6D11';
}

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
