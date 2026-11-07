// 分析（D28）。家計簿タブの「分析」の中に、React で作るグラフを足していく場所。
// 今あるグラフ（カテゴリのドーナツ・日別の棒）は、移すまで ledger.ts がそのまま描く。
import { useEffect, useRef } from 'react';
import * as ui from '../ui.ts';
import { mountReact } from '../react/mount.tsx';
import { state } from '../state.ts';
import { getNow } from '../dates.ts';
import { monthlyTotals, fuyouGauge, fuyouLimits, type MonthTotal, type FuyouGauge, type FuyouLevel } from '../analysis.ts';
import { yearConfirmedIncome, yearEstimatedIncome } from './shift.ts';

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

/** 分析の画面。ここに、グラフの部品を1つずつ足す（D28 の 1〜4） */
function Analysis() {
  const now = getNow();
  const totals = monthlyTotals(state.st.ledger, now.getFullYear(), now.getMonth(), 12);
  return <><MonthlyTrend totals={totals} /><FuyouCard /></>;
}

/** 分析の画面を描く（最新の記録で）。「分析」を開くときと、記録が変わったとき、ledger.ts の renderCharts から呼ばれる */
export function renderAnalysis(): void {
  mountReact(ui.elementById('analysis-root'), <Analysis />);
}
