// 実績バッジ（D30）。分析タブの先頭に出す。メダルは自作の SVG（ブロンズ・シルバー・ゴールド）。
// 数え方は src/badges.ts。バッジは記録から毎回計算する（保存しない）。
import type { CSSProperties } from 'react';
import { state } from '../state.ts';
import { getToday } from '../dates.ts';
import { taskRows } from './tasks.ts';
import {
  THRESHOLDS, badgeProgress, recordStreak, monthSums, budgetMonths, surplusRun, completedTasks,
  type BadgeKind, type BadgeProgress, type Tier,
} from '../badges.ts';

const TIER_NAME = ['まだ', 'ブロンズ', 'シルバー', 'ゴールド'];
// メダルの色: 地・縁・リボン
const TIER_COLOR: Record<Tier, { fill: string; ring: string; ribbon: string }> = {
  0: { fill: '#D5DAE0', ring: '#E8ECF0', ribbon: '#C3CAD2' },
  1: { fill: '#C98A5B', ring: '#E8B88D', ribbon: '#A5683D' },
  2: { fill: '#AEB6BF', ring: '#DDE2E7', ribbon: '#8A939C' },
  3: { fill: '#E0A21B', ring: '#F6D36B', ribbon: '#B97F0C' },
};
const META: Record<BadgeKind, { title: string; unit: string; hint: string }> = {
  streak: { title: '記録の連続', unit: '日', hint: '家計簿を付けた日が、つづいた日数' },
  budget: { title: '予算内の月', unit: 'か月', hint: '支出が予算以内だった月の数' },
  surplus: { title: '黒字の月', unit: 'か月', hint: '収入が支出より多い月が、つづいた数' },
  tasks: { title: 'タスク完了', unit: '個', hint: '完了したタスクの数' },
};

type Item = { kind: BadgeKind; progress: BadgeProgress | null; extra?: string };

/** 今の記録から、4つのバッジの進み具合を出す */
function computeBadges(): Item[] {
  const today = getToday();
  const sums = monthSums(state.st.ledger);
  const streak = recordStreak(state.st.ledger.map(l => l.date), today);
  const budget = budgetMonths(sums, Number(state.st.budget) || 0, today);
  return [
    { kind: 'streak', progress: badgeProgress(streak.best, THRESHOLDS.streak), extra: `いま ${streak.current}日連続` },
    { kind: 'budget', progress: budget === null ? null : badgeProgress(budget, THRESHOLDS.budget), extra: budget === null ? '設定で予算を入れると数えます' : undefined },
    { kind: 'surplus', progress: badgeProgress(surplusRun(sums, today), THRESHOLDS.surplus) },
    { kind: 'tasks', progress: badgeProgress(completedTasks(taskRows()), THRESHOLDS.tasks) },
  ];
}

/** メダルの中の絵（中心が 40,38）。白の線で描く */
function Icon({ kind }: { kind: BadgeKind }) {
  const s = { fill: 'none', stroke: '#fff', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  if (kind === 'streak') return <path d="M40 24 C44 30 49 33 49 40 C49 46 45 50 40 50 C35 50 31 46 31 40 C31 36 33 34 35 32 C35 36 37 37 38 37 C37 32 38 28 40 24 Z" fill="#fff" />;
  if (kind === 'budget') return <text x={40} y={45} textAnchor="middle" fontSize={18} fontWeight={800} fill="#fff">¥</text>;
  if (kind === 'surplus') return <><polyline points="30,46 37,38 42,42 51,31" {...s} /><polyline points="45,31 51,31 51,37" {...s} /></>;
  return <polyline points="31,39 38,46 50,31" {...s} />;
}

/** 自作の SVG のメダル。tier 0 は灰色（まだ） */
function Medal({ kind, tier }: { kind: BadgeKind; tier: Tier }) {
  const c = TIER_COLOR[tier];
  return (
    <svg viewBox="0 0 80 100" width={72} height={90} aria-hidden="true">
      <polygon points="27,60 18,96 29,90 36,98 40,62" fill={c.ribbon} />
      <polygon points="53,60 62,96 51,90 44,98 40,62" fill={c.ribbon} />
      <circle cx={40} cy={38} r={30} fill={c.fill} />
      <circle cx={40} cy={38} r={25} fill="none" stroke={c.ring} strokeWidth={2.5} />
      {tier === 0 ? <g opacity={0.7}><Icon kind={kind} /></g> : <Icon kind={kind} />}
    </svg>
  );
}

function BadgeCard({ item, index }: { item: Item; index: number }) {
  const meta = META[item.kind];
  const p = item.progress;
  const tier: Tier = p ? p.tier : 0;
  const ratio = p && p.next ? Math.min(100, (p.value / p.next) * 100) : 100;
  return (
    <div className={`badge${tier ? ' got' : ''}`} style={{ '--i': index } as CSSProperties}
      aria-label={`${meta.title}。${p ? `${TIER_NAME[tier]}。${p.value}${meta.unit}` : '予算が未設定'}`}>
      <div className="badge-medal"><Medal kind={item.kind} tier={tier} /></div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{meta.title}</div>
      <div style={{ fontSize: 12, color: tier ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
        {p ? <><b>{TIER_NAME[tier]}</b>　最高 {p.value}{meta.unit}</> : 'まだ'}
      </div>
      {p && (
        <div className="badge-track" aria-hidden="true"><div className="badge-bar" style={{ width: `${ratio}%`, background: TIER_COLOR[tier || 1].ribbon }} /></div>
      )}
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', minHeight: 28 }}>
        {p ? (p.next ? `あと ${p.next - p.value}${meta.unit}で ${TIER_NAME[tier + 1]}（${p.next}${meta.unit}）` : '最高の段階です') : item.extra}
        {p && item.extra ? <><br />{item.extra}</> : null}
      </div>
    </div>
  );
}

/** 分析の先頭の「実績バッジ」 */
export function BadgesCard() {
  const items = computeBadges();
  const got = items.filter(i => i.progress && i.progress.tier > 0).length;
  return (
    <div className="card">
      <div className="st">実績バッジ（{got}/{items.length} 獲得）</div>
      <div className="badge-grid">{items.map((it, i) => <BadgeCard key={it.kind} item={it} index={i} />)}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 8 }}>
        予算内の月と黒字の月は、終わった月だけを数えます（家計簿の記録だけ。毎月のお金は含みません）。バッジは記録から数えるので、記録を消すと減ることがあります。
      </div>
    </div>
  );
}
