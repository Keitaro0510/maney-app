// データと同期の状態の入れ物。画面・ナビ・起動は import して使う。
import type { User } from '@supabase/supabase-js';
import type { St } from './compat.ts';
import type { Op, Server } from './data.ts';
import { getToday } from './dates.ts';
import { DEF_EXP, DEF_INC } from './default-categories.ts';

/** 送るのを止めている理由。選んでもらうまで送らない */
export type SendBlocked = 'conflict' | 'stale_epoch' | 'error';

export interface AppState {
  /** 画面のデータ（互換の st。今の行から作り直す） */
  st: St;
  /** サーバーの写し */
  server: Server | null;
  /** 送信待ちの操作 */
  outbox: Op[];
  currentUser: User | null;
  /** サーバーから読み込めた */
  remoteReady: boolean;
  /** サーバーから読み込んでいる途中 */
  loadingRemote: boolean;
  /** 送信待ちを送っている途中 */
  sending: boolean;
  sendBlocked: SendBlocked | null;
}

export function defaultSt(): St {
  return { acctBase: 0, baseDate: getToday(), shiftCloseDay: 31, shiftPayDay: 10, budget: 0,
    jobs: [], shifts: [], ledger: [], cards: [], wds: [], actualInputs: [], fuyouLimit: '1300000',
    otherIncome: 0, plans: [], catExp: [...DEF_EXP], catInc: [...DEF_INC] };
}

export function fixDefaults(): void {
  if (!state.st.wds) state.st.wds = [];
  if (!state.st.actualInputs) state.st.actualInputs = [];
  if (!state.st.plans) state.st.plans = [];
  if (!state.st.catExp?.length) state.st.catExp = [...DEF_EXP];
  if (!state.st.catInc?.length) state.st.catInc = [...DEF_INC];
  state.st.plans.forEach(plan => {
    if (typeof plan.timeStart !== 'string') plan.timeStart = '';
    if (typeof plan.timeEnd !== 'string') plan.timeEnd = '';
  });
}

export const state: AppState = {
  st: defaultSt(),
  server: null,
  outbox: [],
  currentUser: null,
  remoteReady: false,
  loadingRemote: false,
  sending: false,
  sendBlocked: null,
};
