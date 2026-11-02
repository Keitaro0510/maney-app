// ログインと起動の流れ（D19 の手順5）。js/app-core.js から移した。
// - 状態は src/state.ts、保存・送信・読み込みは src/sync.ts
// - DOM には触らず、js/ から渡す AuthUi だけを呼ぶ（ログイン画面・最初の描画・開いたときのタスク・読み込み直し）
// - まだ js/ と index.html が名前で呼ぶもの（loginWithGoogle・logout・loadData）は、src/main.ts が window に出す（期限付きの互換の層）
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Op, Server } from './data.ts';
import { state } from './state.ts';
import { flushOutbox, loadRemote, loadStored, rebuildSt, type UiPort } from './sync.ts';

/** 流れが画面に頼むこと（UiPort に、ログインと起動の分を足したもの） */
export interface AuthUi extends Pick<UiPort, 'showBanner' | 'hideBanner' | 'updateSyncStatus' | 'downloadJson'> {
  showLogin(): void;
  /** ログイン画面を閉じ、アプリを出す（設定にアカウントを出す） */
  hideLogin(user: User): void;
  /** ログインした直後に、端末の写しで最初の画面（ホームとカレンダー）を描く */
  renderFirst(): void;
  /** 開いたときのタスクの一覧（D10。開くたびに出す） */
  showStartupTasks(): void;
  /** ページを読み込み直す */
  reload(): void;
}

export interface AuthDeps {
  supa: Pick<SupabaseClient, 'auth'>;
  ui: AuthUi;
  /** 端末の保存場所のキーの頭（本番は maney:prod:。src/env.ts） */
  storagePrefix: string;
  /** st の足りない項目を埋める（js/app-core.js） */
  fixDefaults(): void;
  /** テストで差し替える */
  storage?: Storage;
  /** ログインしたあとに戻る場所 */
  currentUrl?(): string;
}

type Deps = Required<AuthDeps>;
let deps: Deps | null = null;

/** 起動するときに、js/app-core.js が1回呼ぶ（テストは何度でも呼んでよい） */
export function initAuth(d: AuthDeps): void {
  deps = { storage: globalThis.localStorage, currentUrl: () => globalThis.location.href, ...d };
}

function need(): Deps {
  if (!deps) throw new Error('ログインの流れ（src/auth.ts）を、initAuth の前に使いました');
  return deps;
}

// ---------- ログイン・ログアウト ----------

export async function loginWithGoogle(): Promise<void> {
  const { supa, currentUrl } = need();
  await supa.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: currentUrl() }, // ログイン後に元のページに戻る
  });
}

export async function logout(): Promise<void> {
  const { ui } = need();
  if (state.outbox.length) {
    ui.showBanner(`送れていない変更が${state.outbox.length}件あります。ログアウトすると、この端末から消えます。`,
      [{ label: 'ログアウトする', onclick: reallyLogout }, { label: 'やめる', onclick: () => ui.hideBanner(), primary: true }]);
    return;
  }
  await reallyLogout();
}

export async function reallyLogout(): Promise<void> {
  const { supa, storage, storagePrefix, ui } = need();
  const userId = state.currentUser && state.currentUser.id;
  await supa.auth.signOut();
  if (userId) ['server', 'outbox'].forEach(name => storage.removeItem(`${storagePrefix}${userId}:v2:${name}`));
  ui.reload();
}

// ---------- 起動 ----------

/** ログインした直後: 端末に保存したサーバーの写しと送信待ちをすぐ表示し、そのあとサーバーから読み込んで送る */
export async function startWithUser(user: User): Promise<void> {
  const { ui } = need();
  state.currentUser = user;
  ui.hideLogin(user);
  state.server = loadStored<Server>('server');
  state.outbox = loadStored<Op[]>('outbox') || [];
  rebuildSt();
  ui.updateSyncStatus();
  ui.renderFirst();
  await loadRemote();
  ui.showStartupTasks(); // 開いたときのタスクの一覧（D10。開くたびに出す）
  await flushOutbox();
  handleLegacyLocalData();
}

/** アプリを開いたとき（js/app-bootstrap.js が最後に1回呼ぶ。D18） */
export async function loadData(): Promise<void> {
  const { supa, ui, fixDefaults } = need();
  fixDefaults();

  const { data: { session } } = await supa.auth.getSession();
  let initialLoadDone = false;

  if (session) {
    initialLoadDone = true;
    await startWithUser(session.user);
  } else {
    ui.showLogin();
  }

  // 認証状態の変化を監視（ログイン後のリダイレクト時に発火）
  supa.auth.onAuthStateChange(async (event: string, session: Session | null) => {
    if (event === 'SIGNED_IN' && session) {
      // 初回ログイン時だけ読み込む（アプリ復帰時の再発火を防ぐ）
      if (!initialLoadDone) {
        initialLoadDone = true;
        await startWithUser(session.user);
      }
    } else if (event === 'SIGNED_OUT') {
      state.currentUser = null;
      initialLoadDone = false;
      state.remoteReady = false;
      state.server = null;
      state.outbox = [];
      ui.showLogin();
    }
  });
}

// ---------- 切り替える前の版のデータ ----------

/**
 * 切り替える前の版（user_data）が端末に残したデータ。
 * 送れていなかった変更があれば、書き出せるようにする（新しい版では保存できないため）。なければ消す
 */
export function handleLegacyLocalData(): void {
  const { storage, ui } = need();
  let legacy: string | null = null;
  try {
    const sync = JSON.parse(storage.getItem('mavSync') || 'null') as { dirty?: boolean } | null;
    if (sync && sync.dirty) legacy = storage.getItem('mavFinal2');
  } catch { /* 読めなければ、ないものとする */ }
  const forget = () => { storage.removeItem('mavFinal2'); storage.removeItem('mavSync'); };
  // 試験版（next.html。切り替えのときに消した）が端末に残したキー
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k !== null) keys.push(k); }
    keys.filter(k => k.startsWith('maney:next:')).forEach(k => storage.removeItem(k));
  } catch { /* 消せなくても続ける */ }
  if (!legacy) { forget(); return; }
  const text = legacy;
  ui.showBanner(
    '切り替える前の版で、サーバーに送れていなかった変更が、この端末に残っています。\n' +
    '書き出して（JSON のファイル）、必要なら入れ直してください。',
    [
      { label: '書き出す', onclick: () => ui.downloadJson('maney-before-cutover', text), primary: true },
      { label: '捨てる', onclick: () => { forget(); ui.hideBanner(); } },
    ]);
}

/** まだ js/ と index.html が名前で呼ぶもの（src/main.ts が window に出す。期限付きの互換の層。D19） */
export const LEGACY_AUTH = { loginWithGoogle, logout, loadData };
