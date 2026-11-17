// 分析（D28）。家計簿タブの「分析」の中に、React で作るグラフを足していく場所。
// 今あるグラフ（カテゴリのドーナツ・日別の棒）は、移すまで ledger.ts がそのまま描く。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as ui from '../ui.ts';
import { mountReact } from '../react/mount.tsx';
import { state } from '../state.ts';
import { CAT_COL, DOTC } from '../palette.ts';
import { getNow, getToday, DAYS } from '../dates.ts';
import { monthlyTotals, fuyouGauge, fuyouLimits, dailyExpenseHeat, averageWage, fmtHours, spendInWork, categoryTrend, OTHER_CAT, dayOfMonthAverages, averageOnDays, weekdayAverages, weekdayRangeStart, topWeekday, type WeekdayRange, type SpendPeriod, type MonthTotal, type MonthHeat, type FuyouGauge, type FuyouLevel } from '../analysis.ts';
import { jobPayDay } from '../shifts.ts';
import { yearConfirmedIncome, yearEstimatedIncome } from './shift.ts';
import { BadgesCard } from './badges.tsx';

const yen = (n: number): string => (n < 0 ? '-' : '') + '¥' + Math.abs(n).toLocaleString();

/** 月ごとの収支の推移（D28 の 1）。棒＝収入と支出、折れ線＝その月の収支（収入−支出） */
function MonthlyTrend({ totals }: { totals: MonthTotal[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(totals); // 中身が同じなら作り直さない（アニメを繰り返さない）
  const empty = totals.every(t => t.income === 0 && t.expense === 0);
  useEffect(() => {
    if (!canvas.current || empty) return;
    const chart = new Chart(canvas.current.getContext('2d'), {
      data: {
        labels: totals.map(t => t.label),
        datasets: [
          { type: 'line', label: '収支', data: totals.map(t => t.net), borderColor: '#185FA5', backgroundColor: '#185FA5', borderWidth: 2, pointRadius: 3, tension: 0, cubicInterpolationMode: 'monotone', order: 0 },
          { type: 'bar', label: '収入', data: totals.map(t => t.income), backgroundColor: '#3B6D1190', borderRadius: 4, order: 1 },
          { type: 'bar', label: '支出', data: totals.map(t => t.expense), backgroundColor: '#A32D2D90', borderRadius: 4, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: (c: { dataset: { label: string }; parsed: { y: number } }) => `${c.dataset.label}: ${yen(c.parsed.y)}` } },
        },
        scales: { y: { ticks: { font: { size: 10 }, callback: (v: number) => (Math.abs(v) >= 10000 ? v / 10000 + '万' : v) } }, x: { ticks: { font: { size: 10 } } } },
      },
    });
    return () => chart.destroy(); // データが変わったら作り直す
  }, [key, empty]);

  const last = totals[totals.length - 1];
  return (
    <div className="card">
      <div className="st">月ごとの収支の推移（直近12か月）</div>
      {empty ? <div className="empty">この期間の記録なし</div> : (
        <>
          <div className="chart-wrap"><canvas ref={canvas} aria-label="月ごとの収入・支出・収支のグラフ" /></div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>{last.label}は 収入 {yen(last.income)}・支出 {yen(last.expense)}・収支 {yen(last.net)}（家計簿の記録だけ。毎月のお金は含みません）</div>
        </>
      )}
    </div>
  );
}

const WEEKDAY_RANGES: { id: WeekdayRange; label: string }[] = [{ id: 'all', label: '全期間' }, { id: '6m', label: '直近6か月' }, { id: '3m', label: '直近3か月' }];

/** 曜日ごとの平均支出（D32 の 1）。その曜日の1日あたり。支出の最多の曜日は色を変える。期間は切り替え */
function WeekdayCard() {
  const [range, setRange] = useState<WeekdayRange>('3m');
  const canvas = useRef<HTMLCanvasElement>(null);
  const today = getToday();
  const start = weekdayRangeStart(state.st.ledger, range, today);
  const list = start ? weekdayAverages(state.st.ledger, start, today) : null;
  const top = list ? topWeekday(list) : null;
  const key = JSON.stringify(list);
  useEffect(() => {
    if (!canvas.current || !list || !top) return;
    const chart = new Chart(canvas.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: list.map(w => w.label),
        datasets: [{ label: '1日あたりの平均支出', data: list.map(w => w.avg), backgroundColor: list.map(w => (w.dow === top.dow ? '#A32D2D' : '#A32D2D70')), borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { parsed: { y: number } }) => `平均 ${yen(c.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } }, x: { ticks: { font: { size: 11 } } } },
      },
    });
    return () => chart.destroy();
  }, [key]);

  return (
    <div className="card">
      <div className="st">曜日ごとの支出（1日あたりの平均）</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="group" aria-label="期間">
        {WEEKDAY_RANGES.map(r => <button key={r.id} type="button" className={`chip${r.id === range ? ' sel' : ''}`} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>{r.label}</button>)}
      </div>
      {!list || !top ? <div className="empty">この期間の支出の記録なし</div> : (
        <>
          <div className="chart-wrap"><canvas ref={canvas} aria-label="曜日ごとの平均支出のグラフ" /></div>
          <div style={{ fontSize: 13, marginTop: 8 }}><b>{top.label}曜日</b>が最も多く、1日あたり平均 {yen(top.avg)}（{top.days}日分）</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>支出のなかった日も 0 円として平均します。家計簿の記録だけで、毎月のお金は含みません</div>
        </>
      )}
    </div>
  );
}


const TREND_RANGES: { months: number; label: string }[] = [{ months: 6, label: '直近6か月' }, { months: 12, label: '直近12か月' }];

/** カテゴリ別の月推移（D32 の 2）。支出を、月ごとにカテゴリで積み上げた棒。上位5つ＋その他 */
function CategoryTrendCard() {
  const [months, setMonths] = useState(6);
  const canvas = useRef<HTMLCanvasElement>(null);
  const now = getNow();
  const trend = categoryTrend(state.st.ledger, now.getFullYear(), now.getMonth(), months);
  const empty = trend.series.length === 0;
  const key = JSON.stringify(trend);
  useEffect(() => {
    if (!canvas.current || empty) return;
    const chart = new Chart(canvas.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: trend.labels,
        datasets: trend.series.map((s, i) => ({ label: s.cat, data: s.amounts, backgroundColor: s.cat === OTHER_CAT ? '#9AA0A6' : (CAT_COL[s.cat] || DOTC[i % DOTC.length]) })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: (c: { dataset: { label: string }; parsed: { y: number } }) => `${c.dataset.label}: ${yen(c.parsed.y)}` } },
        },
        scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 }, callback: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } } },
      },
    });
    return () => chart.destroy();
  }, [key, empty]);

  const last = trend.series.length ? trend.monthTotals[trend.monthTotals.length - 1] : 0;
  return (
    <div className="card">
      <div className="st">カテゴリ別の月ごとの支出</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="group" aria-label="期間">
        {TREND_RANGES.map(r => <button key={r.months} type="button" className={`chip${r.months === months ? ' sel' : ''}`} aria-pressed={r.months === months} onClick={() => setMonths(r.months)}>{r.label}</button>)}
      </div>
      {empty ? <div className="empty">この期間の支出の記録なし</div> : (
        <>
          <div className="chart-wrap" style={{ height: 240 }}><canvas ref={canvas} aria-label="カテゴリ別の月ごとの支出の積み上げグラフ" /></div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>{trend.labels[trend.labels.length - 1]}の支出は {yen(last)}。多いカテゴリ5つを分け、残りは「{OTHER_CAT}」にまとめています（家計簿の記録だけで、毎月のお金は含みません）</div>
        </>
      )}
    </div>
  );
}

const CYCLE_RANGES: { id: WeekdayRange; label: string }[] = [{ id: 'all', label: '全期間' }, { id: '12m', label: '直近12か月' }, { id: '6m', label: '直近6か月' }];
const PAY_COLOR = '#185FA5', CLOSE_COLOR = '#BA7517', BASE_COLOR = '#A32D2D70';

/** 月の中の時期（D32 の 3）。1〜31日それぞれの、1日あたりの平均支出。給料日（青）・カードの締め日（オレンジ）の日は色を変える */
function MonthCycleCard() {
  const [range, setRange] = useState<WeekdayRange>('6m');
  const canvas = useRef<HTMLCanvasElement>(null);
  const today = getToday();
  const start = weekdayRangeStart(state.st.ledger, range, today);
  const list = start ? dayOfMonthAverages(state.st.ledger, start, today) : null;
  const jobs = state.st.jobs.filter(j => !j._deleted);
  const payDays = [...new Set((jobs.length ? jobs.map(jobPayDay) : [parseInt(String(state.st.shiftPayDay)) || 10]).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
  const closeDays = [...new Set(state.st.cards.filter(c => !c._deleted).map(c => parseInt(String(c.closeDay))).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
  const empty = !list || list.every(c => c.total === 0);
  const key = JSON.stringify([list, payDays, closeDays]);
  useEffect(() => {
    if (!canvas.current || !list || empty) return;
    const chart = new Chart(canvas.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: list.map(c => c.day),
        datasets: [{ label: '1日あたりの平均支出', data: list.map(c => c.avg), backgroundColor: list.map(c => (payDays.includes(c.day) ? PAY_COLOR : closeDays.includes(c.day) ? CLOSE_COLOR : BASE_COLOR)), borderRadius: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items: { label: string }[]) => `${items[0].label}日`, label: (c: { parsed: { y: number } }) => `平均 ${yen(c.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } }, x: { ticks: { font: { size: 9 }, autoSkip: false, maxRotation: 0 } } },
      },
    });
    return () => chart.destroy();
  }, [key, empty]);

  const all = list ? averageOnDays(list, list.map(c => c.day)) : null;
  const payAvg = list ? averageOnDays(list, payDays) : null;
  const top = list && !empty ? list.reduce((a, c) => (c.avg > a.avg ? c : a)) : null;
  return (
    <div className="card">
      <div className="st">月の中の時期（日にち別の平均支出）</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="group" aria-label="期間">
        {CYCLE_RANGES.map(r => <button key={r.id} type="button" className={`chip${r.id === range ? ' sel' : ''}`} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>{r.label}</button>)}
      </div>
      {empty ? <div className="empty">この期間の支出の記録なし</div> : (
        <>
          <div className="chart-wrap"><canvas ref={canvas} aria-label="日にち別の平均支出のグラフ" /></div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }} aria-hidden="true">
            <span style={{ color: PAY_COLOR }}>■</span> 給料日（{payDays.join('・')}日）　{closeDays.length > 0 && <><span style={{ color: CLOSE_COLOR }}>■</span> カードの締め日（{closeDays.join('・')}日）</>}
          </div>
          {top && <div style={{ fontSize: 13, marginTop: 8 }}><b>{top.day}日</b>が最も多く、1日あたり平均 {yen(top.avg)}</div>}
          {payAvg !== null && all !== null && <div style={{ fontSize: 13, marginTop: 2 }}>給料日の日は 平均 {yen(payAvg)}（ふだんを含めた全体は {yen(all)}）</div>}
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>支出のなかった日も 0 円として平均します。29〜31日は、その日がある月だけ数えます。家計簿の記録だけで、毎月のお金は含みません</div>
        </>
      )}
    </div>
  );
}

const LEVEL_COLOR: Record<FuyouLevel, string | null> = { ok: null, warn: '#BA7517', danger: '#A32D2D', over: '#A32D2D' };

/** 扶養の限度額までの残り（D28 の 3）。半円のゲージ。濃い弧＝確定した収入、薄い弧＝シフトの予想 */
function FuyouGaugeView({ label, g, baseColor }: { label: string; g: FuyouGauge; baseColor: string }) {
  const color = LEVEL_COLOR[g.level] ?? baseColor;
  const arc = 'M20 100 A80 80 0 0 1 180 100'; // 長さを100として扱う（pathLength）
  const over = g.level === 'over';
  const forecast = over ? '' : g.margin < 0 ? `予想では ¥${(-g.margin).toLocaleString()} 超えます` : `予想でも ¥${g.margin.toLocaleString()} の余裕があります`;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <svg viewBox="0 0 200 112" style={{ width: '100%', maxWidth: 280, display: 'block', margin: '0 auto' }} role="img"
        aria-label={`${label}。確定 ${Math.round(g.confirmedPct)}%、予想 ${Math.round(g.estimatedPct)}%`}>
        <path d={arc} pathLength={100} fill="none" stroke="var(--color-background-secondary)" strokeWidth={14} strokeLinecap="round" />
        {g.estimatedPct > 0 && <path className="gauge-arc" d={arc} pathLength={100} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={14} strokeLinecap="round" strokeDasharray="100 100" strokeDashoffset={100 - g.estimatedPct} />}
        {g.confirmedPct > 0 && <path className="gauge-arc" d={arc} pathLength={100} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeDasharray="100 100" strokeDashoffset={100 - g.confirmedPct} />}
        <text x={100} y={74} textAnchor="middle" fontSize={11} style={{ fill: 'var(--color-text-secondary)' }}>{over ? '超えています' : '残り'}</text>
        <text x={100} y={98} textAnchor="middle" fontSize={22} fontWeight={700} style={{ fill: over ? '#A32D2D' : 'var(--color-text-primary)' }}>¥{Math.abs(g.remaining).toLocaleString()}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
        <span>確定 {Math.round(g.confirmedPct)}% ¥{g.confirmed.toLocaleString()}</span>
        <span>予想 {Math.round(g.estimatedPct)}% ¥{g.estimated.toLocaleString()}</span>
      </div>
      {forecast && <div style={{ fontSize: 12, marginTop: 4, color: g.margin < 0 ? '#BA7517' : 'var(--color-text-secondary)' }}>{forecast}</div>}
    </div>
  );
}

function FuyouCard() {
  const limits = fuyouLimits(state.st.fuyouLimit);
  if (!limits.length) return null;
  const confirmed = yearConfirmedIncome(), estimated = yearEstimatedIncome();
  return (
    <div className="card">
      <div className="st">扶養の壁までの残り（{getNow().getFullYear()}年）</div>
      {limits.map(l => <FuyouGaugeView key={l.amount} label={l.label} g={fuyouGauge(l.amount, confirmed, estimated)} baseColor={l.amount === 1030000 ? '#185FA5' : '#993556'} />)}
    </div>
  );
}


/** 支出カレンダー（D28 の 2）。日ごとの支出を色の濃さで見せる。日付を押すと、その日の金額が出る */
function SpendHeatmap({ heat }: { heat: MonthHeat }) {
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked ?? heat.maxDay; // 何も押していないときは、いちばん使った日
  const cell = day ? heat.cells[day - 1] : null;
  const weekday = (d: number): string => DAYS[(heat.offset + d - 1) % 7];
  return (
    <div className="card">
      <div className="st">支出カレンダー（{heat.y}年{heat.m + 1}月）</div>
      <div className="heat-grid" role="group" aria-label="日ごとの支出">
        {DAYS.map(d => <div key={d} className="heat-dow">{d}</div>)}
        {Array.from({ length: heat.offset }, (_, i) => <div key={`b${i}`} />)}
        {heat.cells.map((c, i) => (
          <button key={c.day} type="button" className={`heat-cell heat-${c.level}${c.day === day ? ' sel' : ''}`} style={{ '--i': i } as CSSProperties}
            aria-pressed={c.day === day} aria-label={`${c.day}日 ${c.amount ? yen(c.amount) : '支出なし'}`} onClick={() => setPicked(c.day)}>{c.day}</button>
        ))}
      </div>
      <div className="heat-legend" aria-hidden="true">少<span className="heat-cell heat-1" /><span className="heat-cell heat-2" /><span className="heat-cell heat-3" /><span className="heat-cell heat-4" />多</div>
      <div style={{ fontSize: 13, marginTop: 8 }} aria-live="polite">
        {cell && day
          ? <>{heat.m + 1}月{day}日（{weekday(day)}）<b>{cell.amount ? yen(cell.amount) : '支出なし'}</b>{cell.count ? `（${cell.count}件）` : ''}</>
          : 'この月の支出はありません'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>この月の支出 {yen(heat.total)}（日付を押すと、その日の金額が出ます）</div>
    </div>
  );
}


/** 支出を労働時間に換算（D28 の 4）。「この期間の支出は、バイト何時間分か」。時給はバイト先の平均 */
function WorkHoursCard({ period, wage, label }: { period: SpendPeriod; wage: number | null; label: string }) {
  if (wage === null) {
    return (
      <div className="card">
        <div className="st">支出をバイトの時間にすると</div>
        <div className="empty">シフトのタブでバイト先（時給）を登録すると、支出がバイト何時間分か分かります</div>
      </div>
    );
  }
  const topAmount = period.top[0]?.amount || 1;
  return (
    <div className="card">
      <div className="st">支出をバイトの時間にすると（{label}）</div>
      {period.total === 0 ? <div className="empty">この期間の支出はありません</div> : (
        <>
          <div style={{ textAlign: 'center', margin: '4px 0 2px' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>バイト約 </span>
            <span style={{ fontSize: 34, fontWeight: 700 }}>{fmtHours(period.hours)}</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}> 時間分</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)' }}>
            支出 {yen(period.total)} ÷ 平均時給 {yen(wage)}（8時間働くとして約 {fmtHours(period.hours / 8)} 日分）
          </div>
          <div style={{ marginTop: 12 }}>
            {period.top.map((t, i) => (
              <div key={t.cat} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>{t.cat}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{yen(t.amount)} ≒ <b style={{ color: 'var(--color-text-primary)' }}>{fmtHours(t.hours)}時間</b></span>
                </div>
                <div style={{ height: 8, background: 'var(--color-background-secondary)', borderRadius: 4, marginTop: 3, overflow: 'hidden' }}>
                  <div className="wh-bar" style={{ width: `${Math.max(2, (t.amount / topAmount) * 100)}%`, '--i': i } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 分析の画面。ここに、グラフの部品を1つずつ足す（D28 の 1〜4） */
function Analysis({ y, m, monthMode }: { y: number; m: number; monthMode: boolean }) {
  const now = getNow();
  const totals = monthlyTotals(state.st.ledger, now.getFullYear(), now.getMonth(), 12);
  const wage = averageWage(state.st.jobs);
  return (
    <>
      <BadgesCard />
      <MonthlyTrend totals={totals} />
      <WeekdayCard />
      <CategoryTrendCard />
      <MonthCycleCard />
      {monthMode && <SpendHeatmap key={`${y}-${m}`} heat={dailyExpenseHeat(state.st.ledger, y, m)} />}
      <WorkHoursCard period={spendInWork(state.st.ledger, y, monthMode ? m : null, wage)} wage={wage} label={monthMode ? `${y}年${m + 1}月` : `${y}年`} />
      <FuyouCard />
    </>
  );
}

/** 分析の画面を描く（最新の記録で）。「分析」を開くときと、記録・月が変わったとき、ledger.ts の renderCharts から呼ばれる。
 *  y・m は家計簿で見ている月（m は 0 から）。monthMode は「月」の表示か（「年」のときは月のカレンダーを出さない） */
export function renderAnalysis(y: number, m: number, monthMode: boolean): void {
  mountReact(ui.elementById('analysis-root'), <Analysis y={y} m={m} monthMode={monthMode} />);
}
