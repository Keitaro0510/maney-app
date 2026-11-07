// 分析の計算（D28）。画面を使わない関数だけ置く（テストできるように）。
import { addM } from './dates.ts';
import type { StLedger } from './compat.ts';

export type MonthTotal = { y: number; m: number; label: string; income: number; expense: number; net: number };

/** 家計簿の記録から、y 年 m 月（m は 0 から）で終わる直近 months か月の、月ごとの収入・支出・収支を出す。記録のない月は 0 */
export function monthlyTotals(ledger: StLedger[], endY: number, endM: number, months = 12): MonthTotal[] {
  const list: MonthTotal[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const { y, m } = addM(endY, endM, -i);
    list.push({ y, m, label: `${m + 1}月`, income: 0, expense: 0, net: 0 });
  }
  const byKey = new Map(list.map(t => [`${t.y}-${String(t.m + 1).padStart(2, '0')}`, t]));
  for (const l of ledger) {
    const t = byKey.get(l.date.slice(0, 7)); // 日付の文字列の「年-月」。時刻のずれを避ける
    if (!t) continue;
    const amount = Number(l.amount) || 0;
    if (l.type === 'income') t.income += amount;
    else if (l.type === 'expense') t.expense += amount;
  }
  for (const t of list) t.net = t.income - t.expense;
  return list;
}

export type FuyouLevel = 'ok' | 'warn' | 'danger' | 'over';
export type FuyouGauge = {
  limit: number; confirmed: number; estimated: number;
  /** 確定・予想が限度額の何%か（0〜100。それ以上は100で止める。描くため） */
  confirmedPct: number; estimatedPct: number;
  /** 限度額から確定を引いた残り（超えたらマイナス）。予想で引いた余裕も */
  remaining: number; margin: number;
  /** 確定の進み具合: ok（70%未満）・warn（70%以上）・danger（90%以上）・over（超えた） */
  level: FuyouLevel;
};

/** 扶養の限度額 limit に対して、今年の確定した収入 confirmed と、シフトの予想 estimated がどこまで来ているか */
export function fuyouGauge(limit: number, confirmed: number, estimated: number): FuyouGauge {
  const pct = (v: number): number => Math.max(0, Math.min(100, (v / limit) * 100));
  const raw = (confirmed / limit) * 100;
  const level: FuyouLevel = confirmed >= limit ? 'over' : raw >= 90 ? 'danger' : raw >= 70 ? 'warn' : 'ok';
  return { limit, confirmed, estimated, confirmedPct: pct(confirmed), estimatedPct: pct(estimated), remaining: limit - confirmed, margin: limit - estimated, level };
}

/** 設定（fuyouLimit: '1030000'・'1300000'・'both'）で出す限度額 */
export function fuyouLimits(setting: string): { label: string; amount: number }[] {
  const all = [{ label: '103万円の壁', amount: 1030000 }, { label: '130万円の壁', amount: 1300000 }];
  return all.filter(l => setting === 'both' || String(l.amount) === setting);
}
