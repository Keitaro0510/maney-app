// データと同期の状態の入れ物（state store。D19 の手順3）。
// - 移した画面（src/）は、この state を import して読み書きする
// - まだ js/ の画面のためには、exposeLegacyState が window に同じ名前の getter・setter を出す（期限付きの互換の層。js/ の画面がなくなったら消す）。
//   js/ は今までどおり st・server などと書けば、この入れ物を読み書きする（st = …・st.ledger.push(…)・({server, outbox} = …) も）
// - 画面ごとの状態（カレンダーの月・選んでいるもの など）は、その画面を移すときに足す
import type { User } from '@supabase/supabase-js';
import type { St } from './compat.ts';
import type { Op, Server } from './data.ts';

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

let st: St | undefined; // 初めの値は js/app-core.js が defaultSt() で入れる（入れる前に読むと止める）

export const state: AppState = {
  get st(): St {
    if (st === undefined) throw new Error('st を、入れる前に読みました（js/app-core.js の st=defaultSt() より前）');
    return st;
  },
  set st(value: St) { st = value; },
  server: null,
  outbox: [],
  currentUser: null,
  remoteReady: false,
  loadingRemote: false,
  sending: false,
  sendBlocked: null,
};

/** window に出す名前（js/ の画面が、名前でそのまま読み書きする） */
export const LEGACY_STATE_NAMES = ['st', 'server', 'outbox', 'currentUser', 'remoteReady', 'loadingRemote', 'sending', 'sendBlocked'] as const satisfies readonly (keyof AppState)[];

/** 互換の層: target（ふつうは window）に、state を読み書きする getter・setter を出す。消したり上書きしたりできないようにする */
export function exposeLegacyState(target: object): void {
  for (const name of LEGACY_STATE_NAMES) {
    Object.defineProperty(target, name, {
      get: () => state[name],
      set: (value: never) => { (state as Record<typeof name, unknown>)[name] = value; },
      enumerable: true,
      configurable: false,
    });
  }
}
