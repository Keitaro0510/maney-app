// 保存・送信・読み込みの流れ（D19 の手順4）。js/app-core.js から移した。
// - 状態は src/state.ts の入れ物。DOM には触らず、起動するときに js/ から渡す UiPort だけを呼ぶ（バナーのボタンで動かす操作も、ここで作って渡す）
// - Supabase のクライアントと、st の既定値（defaultSt・fixDefaults）も js/ から受け取る（クライアントを作るのは、手順5で src/ に移す）
// - まだ js/ の画面のために、src/main.ts が LEGACY_SYNC を window に同じ名前で出す（期限付きの互換の層。D19）
//
// サーバーの写し（server）: 新しいテーブルから読んだ行と、その updated_at。src/data.ts で読む
// 送信待ち（outbox）: まだ送れていない操作の列。この端末に保存し、再起動しても残す
// 画面のデータ（st）: サーバーの写しに送信待ちを重ねた行から、互換層（src/compat.ts）で組み立てる
// 保存: 画面で st を変えたら、互換層で行に戻し、前の行との違いを1つの操作にして送信待ちに入れ、順に apply_op で送る
import { rowsToSt, stToRows, type St } from './compat.ts';
import type { DbRows } from './rows.ts';
import {
  acknowledge, applyOutbox, checkDirectChanges, COMPAT_TABLES, diffRows, discardOp, loadAllTables, makeOp, rewriteForOverwrite, sendOp,
  type Change, type Conflict, type Op, type Rows, type Server, type SupaClient,
} from './data.ts';
import { state } from './state.ts';

/** 同期のバナーのボタン */
export interface BannerAction { label: string; onclick: () => unknown; primary?: boolean }

/** 流れが画面に頼むこと（js/ が実装を渡す。D19） */
export interface UiPort {
  showBanner(msg: string, actions: BannerAction[]): void;
  hideBanner(): void;
  /** 開いている画面を描き直す */
  renderCurrentSection(): void;
  /** 送信待ちの件数を出し直す */
  updateSyncStatus(): void;
  /** 入力中の画面（.mbg.open）があるか */
  hasOpenModal(): boolean;
  /** JSON のファイルにして保存させる */
  downloadJson(name: string, text: string): void;
}

export interface SyncDeps {
  supa: SupaClient;
  ui: UiPort;
  /** 端末の保存場所のキーの頭（本番は maney:prod:。src/env.ts） */
  storagePrefix: string;
  /** st の既定値と、足りない項目を埋める処理（js/app-core.js） */
  defaultSt(): St;
  fixDefaults(): void;
  /** テストで差し替える */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  newId?(): string;
  now?(): Date;
}

type Deps = Required<SyncDeps>;
let deps: Deps | null = null;

/** 起動するときに、js/app-core.js が1回呼ぶ（テストは何度でも呼んでよい） */
export function initSync(d: SyncDeps): void {
  deps = {
    storage: globalThis.localStorage,
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
    ...d,
  };
}

function need(): Deps {
  if (!deps) throw new Error('保存の流れ（src/sync.ts）を、initSync の前に使いました');
  return deps;
}

/** 前の `e.message || e` と同じ文字 */
function errText(e: unknown): string {
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  return m ? String(m) : String(e);
}

export const TABLE_LABELS: Record<string, string> = {
  settings: '設定', cards: 'カード', jobs: 'バイト先', categories: 'カテゴリ', ledger_entries: '家計簿',
  shifts: 'シフト', plans: '予定', fixed_costs: '毎月のお金', withdrawals: '引き出し',
  salary_actuals: '給与の実績', card_bill_actuals: 'カードの実績', tasks: 'タスク',
};

// ---------- 端末の保存場所 ----------

/** ログイン中のユーザーの、端末の保存場所のキー（`<頭><ユーザーの id>:<name>`）。タスクの「今日は表示しない」なども使う */
export function userKey(name: string): string {
  if (!state.currentUser) throw new Error('ログインしていないので、端末の保存場所を決められません');
  return `${need().storagePrefix}${state.currentUser.id}:${name}`;
}

/** サーバーの写し・送信待ちのキー */
export function storageKey(name: string): string {
  return userKey(`v2:${name}`);
}

export function loadStored<T = unknown>(name: string): T | null {
  try {
    const s = need().storage.getItem(storageKey(name));
    return s ? JSON.parse(s) as T : null;
  } catch { return null; }
}

export function store(name: string, value: unknown): void {
  const { storage, ui } = need();
  try { storage.setItem(storageKey(name), JSON.stringify(value)); }
  catch (e) {
    console.warn('端末に保存できませんでした:', e);
    ui.showBanner('この端末に保存できませんでした（容量がいっぱいかもしれません）。送れていない変更は、アプリを閉じると消えます。',
      [{ label: '閉じる', onclick: () => ui.hideBanner() }]);
  }
}

// ---------- 今の行と st ----------

/** 今の行（サーバーの写しに、送信待ちを重ねたもの）。まだサーバーから読み込めていないときは、空の行（お金の計算が止まらないように） */
export function currentRows(): Rows {
  return state.server ? applyOutbox(state.server.rows, state.outbox) : {};
}

/** 今の行から、画面のデータ（互換の st）を作り直す。サーバーの写しがなければ false */
export function rebuildSt(): boolean {
  if (!state.server) return false;
  const { defaultSt, fixDefaults } = need();
  state.st = rowsToSt(currentRows() as DbRows) || defaultSt();
  fixDefaults();
  return true;
}

// ---------- 保存 ----------

function showNotLoaded(): void {
  need().ui.showBanner('まだサーバーから読み込めていないので、保存できません。',
    [{ label: 'もう一度読み込む', onclick: loadRemote, primary: true }]);
}

/** 保存: 画面の処理は st を変えてから save() を呼ぶ。そのあとの描画は、作り直した st で行われる */
export function save(): void {
  const { ui, newId, now: clock } = need();
  if (!state.server) {
    rebuildSt();
    showNotLoaded();
    return;
  }
  try {
    const now = clock().toISOString();
    const before = currentRows();
    const after = stToRows(state.st, before as DbRows, { newId, now });
    // 互換の st が持つテーブルだけを比べる（tasks などは st にないので、比べると全部「消えた」と見なしてしまう。D1）
    queueChanges(diffRows(before, after, COMPAT_TABLES), now);
  } catch (e) {
    console.warn('保存できませんでした:', e);
    rebuildSt();
    ui.renderCurrentSection();
    ui.showBanner('保存できませんでした。変えた内容は取り消しました。\n' + errText(e),
      [{ label: '閉じる', onclick: () => ui.hideBanner() }]);
    return;
  }
  rebuildSt(); // 新しい記録にも _id が付く（続けて編集しても、同じ行の更新になる）
  ui.updateSyncStatus();
  void flushOutbox();
}

/** 変更の列を1つの操作にして、送信待ちに積む（端末にも保存する） */
export function queueChanges(changes: Change[], now: string): void {
  if (!changes.length) return;
  const server = state.server;
  if (!server) throw new Error('サーバーの写しがないので、送信待ちに積めません');
  const op = makeOp(changes, { id: need().newId(), epoch: server.epoch, now, server, outbox: state.outbox });
  state.outbox = [...state.outbox, op];
  store('outbox', state.outbox);
}

/**
 * 互換の st を通さずに、行を直接保存する入り口（tasks など。D1）。1回の呼び出しが1つの操作になる。
 * changes: [{table, action: 'insert'|'update'|'delete', id, row}]。row にはサーバーが決める列（id・user_id・日時）を入れない。
 * base（読み込んだときの updated_at）は makeOp が付ける。保存した行は currentRows()[table] で読める。
 * 保存できたら true。できなければ知らせを出して false（送信待ちには積まない）
 */
export function saveRows(changes: unknown): boolean {
  const { ui, now } = need();
  if (!state.server) {
    showNotLoaded();
    return false;
  }
  try {
    queueChanges(checkDirectChanges(changes), now().toISOString());
  } catch (e) {
    console.warn('保存できませんでした:', e);
    ui.showBanner('保存できませんでした。\n' + errText(e), [{ label: '閉じる', onclick: () => ui.hideBanner() }]);
    return false;
  }
  ui.updateSyncStatus();
  void flushOutbox();
  return true;
}

// ---------- 送る ----------

/** 送信待ちを、古いものから1つずつ送る */
export async function flushOutbox(): Promise<void> {
  if (!state.currentUser || state.sending || state.loadingRemote || state.sendBlocked || !state.outbox.length) return;
  const { supa, ui } = need();
  state.sending = true;
  try {
    while (state.outbox.length && !state.sendBlocked) {
      const op = state.outbox[0];
      const res = await sendOp(supa, op);
      if (res.kind === 'applied') {
        const server = state.server;
        if (!server) throw new Error('サーバーの写しがないまま、送った結果を受け取りました');
        const next = acknowledge({ server, outbox: state.outbox }, op, res.result);
        state.server = next.server;
        state.outbox = next.outbox;
        store('server', state.server);
        store('outbox', state.outbox);
      } else if (res.kind === 'conflict') {
        state.sendBlocked = 'conflict';
        showConflict(op, res.conflicts);
      } else if (res.kind === 'stale_epoch') {
        state.sendBlocked = 'stale_epoch';
        showStaleEpoch();
      } else if (res.kind === 'network') {
        ui.showBanner(`通信できないため、送れていない変更が${state.outbox.length}件あります。この端末に残っていて、通信が戻ったら送ります。`,
          [{ label: 'もう一度送る', onclick: flushOutbox, primary: true }]);
        break;
      } else {
        state.sendBlocked = 'error';
        showSendError(op, res.error);
      }
    }
    if (!state.outbox.length) ui.hideBanner();
  } finally {
    state.sending = false;
    ui.updateSyncStatus();
  }
}

// ---------- 読み込む ----------

/**
 * 新しいテーブルから読み込む（起動時と、アプリに戻ってきたとき）。
 * すべてのテーブルを読み終えて件数が合ったときだけ、サーバーの写しを置き換える。送信待ちは、新しい写しに重ね直す
 */
export async function loadRemote(): Promise<void> {
  if (!state.currentUser || state.loadingRemote || state.sending) return;
  const { supa, ui } = need();
  state.loadingRemote = true;
  try {
    const server: Server = await loadAllTables(supa);
    state.server = server;
    store('server', server);
    state.remoteReady = true;
    rebuildSt();
    if (!state.sendBlocked) ui.hideBanner();
    ui.renderCurrentSection();
    console.log('サーバーから読み込みました', server.loadedAt);
  } catch (e) {
    console.warn('新しいテーブルを読み込めませんでした:', e);
    ui.showBanner(
      (state.server ? '新しいテーブルを読み込めませんでした。前に読み込んだ内容を表示しています。' : '新しいテーブルを読み込めませんでした。')
        + '\n' + errText(e),
      [{ label: 'もう一度読み込む', onclick: loadRemote, primary: true }]);
  } finally {
    state.loadingRemote = false;
  }
}

/** アプリに戻ってきたとき・通信が戻ったとき: 送信待ちを送ってから、読み込み直す（入力中の画面があるときは読み込まない。送るのは入力中でもよい） */
export async function resyncRemote(): Promise<void> {
  if (!state.currentUser) return;
  await flushOutbox();
  if (state.outbox.length) return;
  if (need().ui.hasOpenModal()) return;
  await loadRemote();
}

// ---------- 同期の知らせ（送れない・別の端末との競合） ----------

const CONFLICT_REASONS: Record<string, string> = {
  changed: '別の端末で変更されています',
  missing: '別の端末で削除されています',
  exists: 'すでにあります',
  duplicate: '同じ内容の記録が、別の端末で登録されています',
};

/** 別の端末の変更とぶつかった */
export function showConflict(op: Op, conflicts: Conflict[]): void {
  const lines = conflicts.map(c => `・${TABLE_LABELS[c.table] || c.table}: ${CONFLICT_REASONS[c.reason] || c.reason}`);
  need().ui.showBanner(
    '別の端末の変更とぶつかったため、この端末の変更を保存していません。\n' + lines.join('\n') + '\n\n' +
    '・サーバーの内容にする: この端末の送れていない変更は、すべて消えます\n' +
    '・この端末の内容で上書き: ぶつかった記録を、この端末の内容にします',
    [
      { label: 'サーバーの内容にする', onclick: useServerVersion },
      { label: 'この端末の内容で上書き', onclick: () => overwriteWithMine(op, conflicts) },
    ]);
}

/** 競合を解く: 送信待ちを捨てて、サーバーの内容を読み込み直す */
export async function useServerVersion(): Promise<void> {
  const { ui } = need();
  state.outbox = [];
  store('outbox', state.outbox);
  state.sendBlocked = null;
  ui.hideBanner();
  ui.updateSyncStatus();
  await loadRemote();
}

/** 競合を解く: ぶつかった記録を、この端末の内容で上書きして送り直す */
export async function overwriteWithMine(op: Op, conflicts: Conflict[]): Promise<void> {
  const { ui, newId } = need();
  state.outbox = rewriteForOverwrite(state.outbox, op, conflicts, newId());
  store('outbox', state.outbox);
  state.sendBlocked = null;
  ui.hideBanner();
  rebuildSt();
  ui.renderCurrentSection();
  await flushOutbox();
  if (!state.outbox.length) await loadRemote(); // 別の端末の、ほかの変更も読み込む
}

/** サーバーのデータが移し直された（移行の番号が上がった） */
export function showStaleEpoch(): void {
  need().ui.showBanner(
    `サーバーのデータが移し直されたため、この端末の送れていない変更（${state.outbox.length}件）は保存できません。\n` +
    '必要なら書き出して（JSON のファイル）から、捨てて読み込み直してください。',
    [
      { label: '書き出す', onclick: downloadOutbox },
      { label: '捨てて読み込み直す', onclick: useServerVersion, primary: true },
    ]);
}

/** 送信待ちを JSON のファイルにして保存する（捨てる前の退避） */
export function downloadOutbox(): void {
  const { ui, now } = need();
  ui.downloadJson('maney-outbox', JSON.stringify({ exportedAt: now().toISOString(), outbox: state.outbox }, null, 2));
}

/** 前の `(error && (error.message || error.code)) || error` と同じ文字 */
function sendErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown };
    if (e.message) return String(e.message);
    if (e.code) return String(e.code);
  }
  return String(error);
}

/** サーバーが受け付けなかった（制約違反など。送り直しても通らない） */
export function showSendError(op: Op, error: unknown): void {
  const { ui } = need();
  ui.showBanner(
    'サーバーがこの端末の変更を受け付けませんでした。\n' + sendErrorText(error) + '\n' +
    '・この変更を捨てる: この変更と、これを前提にしたあとの変更を捨てます',
    [
      { label: 'この変更を捨てる', onclick: () => {
        state.outbox = discardOp(state.outbox, op.id);
        store('outbox', state.outbox);
        state.sendBlocked = null;
        ui.hideBanner();
        rebuildSt();
        ui.renderCurrentSection();
        void flushOutbox();
      } },
      { label: 'もう一度送る', onclick: () => { state.sendBlocked = null; ui.hideBanner(); void flushOutbox(); }, primary: true },
    ]);
}

/** まだ js/ の画面が名前で使うもの（src/main.ts が window に出す。期限付きの互換の層。D19） */
export const LEGACY_SYNC = {
  TABLE_LABELS, currentRows, rebuildSt, loadStored, save, saveRows, flushOutbox, loadRemote, resyncRemote,
};
