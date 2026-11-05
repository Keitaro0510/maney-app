// ホームの画面（D20 の 8）。計算は ../home.ts。
import { state } from '../state.ts';
import { currentRows } from '../sync.ts';
import { getToday, gY, gM, gD, toDS, addM, ds2d, monthDay, DAYS } from '../dates.ts';
import * as MoneyCalc from '../money.ts';
import * as MoneyUI from '../ui.ts';
import { estimateAcct, buildBalanceSeries } from '../home.ts';
import { cycle, getActualCard, cardCloseDay } from '../cards.ts';
import { jobPayDay, jobCloseDayNum, totalShiftIncForJob, getActualSalary, calcShiftInc } from '../shifts.ts';
import { monthlyRowsIn, monthlyPayLabel } from './monthly.ts';
import { monthLedger } from '../ledger.ts';
import { getPlansForDay } from '../plans.ts';
import { planColor } from '../palette.ts';
import { renderHomeTasks } from './tasks.ts';
import { openLedgerModal } from './ledger.ts';
import { openPlanModal } from './plans.ts';
import { openWd } from './atm.ts';
import type { Rows } from '../money.ts';

let balChart: { destroy(): void } | null = null;

// お金を「-¥1,200」「¥3,400」の形にする（マイナスはそのまま出す。D11）
const yenSigned=(v: number): string=>(v<0?'-':'')+'¥'+Math.abs(v).toLocaleString();
// これから90日のお金の動き（D22）。日付順に、その日の終わりの残高を添える。残高の最低点に印を付ける
function renderTimeline(): void{
  const{start,rows}=MoneyCalc.timeline(currentRows(),getToday());
  let html=`<div class="up-row"><span class="up-date">今日</span><span class="up-label">口座の残高（推定）</span><span class="up-bal">${yenSigned(start)}</span></div>`;
  html+=rows.map(e=>{
    const dt=ds2d(e.date),[kind,cls]=UPCOMING_KIND[e.kind]||['',''];
    const label=e.kind==='salary'?`${e.label}の給料`:e.kind==='card_bill'?`${e.label}の引き落とし`:e.label;
    const bal=`<span class="up-bal${e.balance!==null&&e.balance<0?' neg':''}">${e.balance===null?'':yenSigned(e.balance)}</span>`;
    return `<div class="up-row${e.lowest?' up-low':''}"><span class="up-date">${dt.getMonth()+1}/${dt.getDate()}(${DAYS[dt.getDay()]})</span><span class="badge ${cls}">${kind}</span><span class="up-label">${MoneyUI.escapeHtml(label)}</span><span class="up-amount ${e.amount<0?'out':'in'}">${e.amount<0?'-':'+'}¥${Math.abs(e.amount).toLocaleString()}</span>${bal}${e.lowest?'<span class="badge bpending">最低</span>':''}</div>`;
  }).join('');
  if(!rows.length)html+='<div class="empty">この先90日、口座のお金の動きはありません</div>';
  MoneyUI.elementById('forecast-content').innerHTML=html;
}

// ホーム（D11: いちばん大事な数字・タスクの1行・記録のボタン・今日のお知らせ・これからのお金の動き・くわしく）。数えるのは src/money.ts
export function renderHome(): void{const y=gY(),m=gM(),d=gD();
  const rows=currentRows(),sp=MoneyCalc.spendable(rows,getToday()),bal=estimateAcct(),pd=ds2d(sp.minDate);
  const spEl=MoneyUI.elementById('home-spendable');
  spEl.textContent=yenSigned(sp.amount);spEl.closest('.home-main')!.classList.toggle('short',sp.amount<0);
  MoneyUI.elementById('home-spendable-sub').textContent=sp.minDays===0?`この先${sp.days}日で、今日がいちばん低い残高です`:`いちばん低くなるのは ${pd.getMonth()+1}/${pd.getDate()}（${sp.minDays}日後）・${sp.days}日先まで`;
  const balEl=MoneyUI.elementById('home-balance');
  balEl.textContent=yenSigned(bal);balEl.classList.toggle('negative',bal<0);
  renderHomeTasks();
  // 今日のお知らせ（作り方は前と同じ）
  let ahtml='';const todayDS=toDS(y,m,d);state.st.cards.forEach((card,ci)=>{if(monthDay(y,m,parseInt(card.billDay))===d){const f=cycle(card,0),actual=getActualCard(ci,y,m);if(actual)ahtml+=`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(card.name)}</strong> 引き落とし ¥${parseInt(String(actual.actualAmount)).toLocaleString()} <span class="act-badge">実額反映済</span></div>`;else if(f.amount>0)ahtml+=`<div class="abar-action"><strong>${MoneyUI.escapeHtml(card.name)}</strong> の引き落とし日（推定 ¥${f.amount.toLocaleString()}）</div>`;}if(!card._deleted&&cardCloseDay(card,y,m)===d)ahtml+=`<div class="abar neutral">今日は <strong>${MoneyUI.escapeHtml(card.name)}</strong> の締め日</div>`;});state.st.jobs.forEach(job=>{const jPayD=monthDay(y,m,jobPayDay(job)),jShimeD=jobCloseDayNum(job,y,m);if(d===jPayD){const sm=addM(y,m,-1);const estInc=totalShiftIncForJob(job.name,sm.y,sm.m);const actual=getActualSalary(job.name,sm.y,sm.m);if(actual)ahtml+=`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(job.name)}</strong> 給料（${sm.m+1}月分） 入金 ¥${parseInt(String(actual.actualAmount)).toLocaleString()} <span class="act-badge">実額反映済</span></div>`;else if(estInc>0)ahtml+=`<div class="abar-action"><strong>${MoneyUI.escapeHtml(job.name)}</strong> 給料の入金日（${sm.m+1}月分 推定 ¥${estInc.toLocaleString()}）</div>`;}if(d===jShimeD&&d!==jPayD)ahtml+=`<div class="abar neutral">今日は <strong>${MoneyUI.escapeHtml(job.name)}</strong> の締め日 — ${jPayD}日払い</div>`;});monthlyRowsIn(y,m).filter(fc=>monthDay(y,m,fc.day)===d).forEach(fc=>{ahtml+=fc.kind==='income'?`<div class="abar ok">今日 <strong>${MoneyUI.escapeHtml(fc.name)}</strong> 入金 ¥${fc.amount.toLocaleString()}</div>`:`<div class="abar warn">今日 <strong>${MoneyUI.escapeHtml(fc.name)}</strong> ${monthlyPayLabel(fc)} ¥${fc.amount.toLocaleString()}</div>`;});state.st.shifts.filter(s=>s.date===todayDS).forEach(s=>{const r=calcShiftInc(s);ahtml+=`<div class="abar info">今日 <strong>${MoneyUI.escapeHtml(s.job)}</strong> ${s.start}〜${s.end} (¥${r.total.toLocaleString()})</div>`;});getPlansForDay(todayDS).filter(p=>!p.done).forEach(p=>{const c=planColor(p.color);ahtml+=`<div class="abar plan" style="--dot:${c.dot}">📅 <strong>${MoneyUI.escapeHtml(p.title)}</strong>${(p.budget||0)>0?` 予算 ¥${(p.budget||0).toLocaleString()}`:''}</div>`;});MoneyUI.elementById('alerts-home').innerHTML=ahtml?`<section class="card home-alerts" aria-labelledby="home-alerts-title"><h2 class="home-alerts-title" id="home-alerts-title">今日のお知らせ</h2>${ahtml}</section>`:'';
  renderHomeUpcoming(rows);
  if(MoneyUI.dialogById('home-more').open)renderHomeMore();
}

// これからのお金の動き（2週間）。給料・引き落とし・予定など、口座のお金が動くものを日付の順に（src/money.ts の upcoming）
const UPCOMING_KIND: Record<string, [string, string]> ={salary:['給料','binc'],fixed_income:['入金','binc'],ledger_income:['入金','binc'],fixed_cost:['引き落とし','bfixcost'],card_bill:['カード','bcard'],ledger_expense:['口座払い','bfixcost'],withdrawal:['ATM','bwd'],plan:['予定','bplan']};
function renderHomeUpcoming(rows: Rows): void{
  const box=MoneyUI.elementById('home-upcoming');
  const list=MoneyCalc.upcoming(rows,getToday(),14);
  if(!list.length){box.innerHTML='<div class="empty">この2週間、口座のお金の動きはありません</div>';return;}
  box.innerHTML=list.map(e=>{
    const dt=ds2d(e.date),[kind,cls]=UPCOMING_KIND[e.kind]||['',''];
    const label=e.kind==='salary'?`${e.label}の給料`:e.kind==='card_bill'?`${e.label}の引き落とし`:e.label;
    return `<div class="up-row"><span class="up-date">${dt.getMonth()+1}/${dt.getDate()}(${DAYS[dt.getDay()]})</span><span class="badge ${cls}">${kind}</span><span class="up-label">${MoneyUI.escapeHtml(label)}</span><span class="up-amount ${e.amount<0?'out':'in'}">${e.amount<0?'-':'+'}¥${Math.abs(e.amount).toLocaleString()}</span></div>`;
  }).join('');
}

// くわしく（画面を開いているときだけ描く。グラフは見えていないと大きさが決まらないため）
function renderHomeMore(): void{renderBalanceChart();renderTimeline();renderHomeBudget();}
// 「くわしく」の画面（下から出る）を開く。グラフは、画面が見えてから描く
let closeHomeMoreFn: (() => void) | null=null;
export function openHomeMore(opener: HTMLElement): void{closeHomeMoreFn=MoneyUI.openSheet(MoneyUI.dialogById('home-more'),opener);renderHomeMore();}
export function closeHomeMore(): void{if(closeHomeMoreFn)closeHomeMoreFn();}
function renderHomeBudget(): void{
  const y=gY(),m=gM(),lexp=monthLedger(y,m).filter(l=>l.type==='expense').reduce((a,l)=>a+parseInt(String(l.amount)),0);
  const bud=state.st.budget||0,pct=bud>0?Math.min(100,Math.round(lexp/bud*100)):0;
  MoneyUI.elementById('h-budlbl').textContent='予算 ¥'+bud.toLocaleString();
  MoneyUI.elementById('h-budused').textContent='支出 ¥'+lexp.toLocaleString();
  const bar=MoneyUI.elementById('h-prog');
  bar.style.width=pct+'%';bar.style.background=pct>80?'#A32D2D':pct>60?'#BA7517':'#3B6D11';
}


function renderBalanceChart(): void{const{labels,balances,marks,lowIndex}=buildBalanceSeries();const ctx=(MoneyUI.elementById('balance-chart') as HTMLCanvasElement).getContext('2d');if(balChart)balChart.destroy();balChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'口座残高',data:balances,borderWidth:2.5,pointRadius:balances.map((b,i)=>{if(i===lowIndex&&i>0)return 6;if(i===0)return 4;return marks[i].length?3:0;}),pointBackgroundColor:balances.map((b,i)=>i===lowIndex&&i>0?'#BA7517':b<0?'#A32D2D':'#185FA5'),fill:{target:'origin',above:'rgba(24,95,165,0.07)',below:'rgba(163,45,45,0.09)'},tension:0.1,segment:{borderColor:(ctx2: { p0DataIndex: number })=>{const i=ctx2.p0DataIndex;return(balances[i]<0||balances[i+1]<0)?'#A32D2D':'#185FA5';}}},{data:new Array(balances.length).fill(0),borderColor:'rgba(163,45,45,0.3)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:(ctx2: { dataIndex: number }[])=>labels[ctx2[0].dataIndex],label:(ctx2: { datasetIndex: number; raw: number })=>{if(ctx2.datasetIndex===1)return null;return`口座残高: ¥${ctx2.raw.toLocaleString()}`;},afterBody:(ctx2: { dataIndex: number }[])=>{const i=ctx2[0].dataIndex;return i===lowIndex&&i>0?['▼ ここがいちばん低い',...marks[i]]:marks[i];}},filter:(item: { datasetIndex: number })=>item.datasetIndex===0}},scales:{x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:10,callback:(_v: unknown,i: number)=>labels[i]},grid:{display:false}},y:{ticks:{callback:(v: number)=>{const a=Math.abs(v);return(v<0?'-':'')+(a>=10000?'¥'+Math.round(a/1000)+'k':'¥'+a.toLocaleString());},font:{size:10}},grid:{color:'rgba(128,128,128,0.08)'}}}}});MoneyUI.elementById('balance-warn').innerHTML=balances.some(b=>b<0)?'<div style="background:#FAEEDA;color:#BA7517;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:4px">⚠ この期間に残高がマイナスになる日があります</div>':'';}

/** ホームの固定ボタンを登録する。 */
export function bindHomeControls(): void {
  MoneyUI.elementById('home-add-ledger').addEventListener('click', () => openLedgerModal());
  MoneyUI.elementById('home-add-plan').addEventListener('click', () => openPlanModal());
  MoneyUI.elementById('home-open-atm').addEventListener('click', openWd);
  const more = MoneyUI.elementById('home-more-btn');
  more.addEventListener('click', () => openHomeMore(more));
  MoneyUI.elementById('home-more-close').addEventListener('click', closeHomeMore);
}
