// ホームの画面
// js/app.js を中身を変えずに分けたファイル（D18）。ふつうの <script> を、index.html に書いた順に読む（共通部分 → 画面 → bootstrap）。
// ============================================================
// ホーム
// ============================================================
// 今月これから入るお金（毎月のお金の収入・給料。給料日が過ぎていたら来月の給料）。数え方は src/money.ts（固定費の期間も見る）
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
function renderForecast(){const y=gY(),m=gM(),acct=estimateAcct(),incInfo=upcomingIncome(),fixed=upcomingFixed();const planBudget=thisMonthPlanBudget(),pendingCards=st.cards.reduce((a,card)=>a+cycle(card,1).amount,0);const forecast=acct+incInfo.total-fixed-planBudget-pendingCards;const planCount=st.plans.filter(p=>{if(p.done||!p.budget||p.planCardIdx!=null)return false;const ms=toDS(y,m,1),me=toDS(y,m,new Date(y,m+1,0).getDate());const s=p.dateStart||p.date,e=p.dateEnd||p.date;return s<=me&&e>=ms;}).length;let html=`<div class="forecast-row"><span style="color:var(--color-text-secondary)">現在の口座残高（推定）</span><span style="font-weight:600">${yenSigned(acct)}</span></div><div class="forecast-row"><span style="color:#3B6D11">＋ 予定収入</span><span style="color:#3B6D11;font-weight:600">+¥${incInfo.total.toLocaleString()}</span></div><div class="forecast-row"><span style="color:#A32D2D">− 確定引き落とし・毎月のお金</span><span style="color:#A32D2D;font-weight:600">-¥${fixed.toLocaleString()}</span></div><div class="forecast-row"><span style="color:#BA7517">− 集計中カード（見込み）</span><span style="color:#BA7517;font-weight:600">-¥${pendingCards.toLocaleString()}</span></div>`;if(planBudget>0)html+=`<div class="forecast-row"><span style="color:#993556">− 予定支出（${planCount}件）</span><span style="color:#993556;font-weight:600">-¥${planBudget.toLocaleString()}</span></div>`;html+=`<div class="forecast-sep"></div><div class="forecast-row"><span style="font-weight:600">収支見通し</span><span class="forecast-total" style="color:${forecast>=0?'#3B6D11':'#A32D2D'}">${forecast>0?'+':''}${yenSigned(forecast)}</span></div>`;if(forecast<0)html+=`<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:8px">⚠ ¥${Math.abs(forecast).toLocaleString()} 不足する見込みです</div>`;document.getElementById('forecast-content').innerHTML=html;}

// お金を「-¥1,200」「¥3,400」の形にする（マイナスはそのまま出す。D11）
const yenSigned=v=>(v<0?'-':'')+'¥'+Math.abs(v).toLocaleString();
// ホーム（D11: いちばん大事な数字・タスクの1行・記録のボタン・今日のお知らせ・これからのお金の動き・くわしく）。数えるのは src/money.ts
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

// これからのお金の動き（2週間）。給料・引き落とし・予定など、口座のお金が動くものを日付の順に（src/money.ts の upcoming）
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

