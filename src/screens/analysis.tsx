// 分析（D28）。家計簿タブの「分析」の中に、React で作るグラフを足していく場所。
// 今あるグラフ（カテゴリのドーナツ・日別の棒）は、移すまで ledger.ts がそのまま描く。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as ui from '../ui.ts';
import { mountReact } from '../react/mount.tsx';
import { state } from '../state.ts';
import { getNow, DAYS } from '../dates.ts';
import { monthlyTotals, fuyouGauge, fuyouLimits, dailyExpenseHeat, averageWage, fmtHours, spendInWork, type SpendPeriod, type MonthTotal, type MonthHeat, type FuyouGauge, type FuyouLevel } from '../analysis.ts';
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
