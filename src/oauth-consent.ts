// Claude などの MCP クライアントに、このアプリの予定・タスクを書く許可を出す画面の流れ（Issue #190・D37）。
// Supabase Auth を OAuth 2.1 の認可サーバーにしている。認可の途中で、Auth がこのアプリの
//   <Site URL>/?authorization_id=<id>
// へ人を案内してくる。ここで、本人が「許可する／しない」を押すと、Auth がクライアントへ戻す。
// 画面を使わない部分だけここに置く（Node のテストが読めるように）。画面は src/oauth-consent-ui.ts。
import type { SupabaseClient } from '@supabase/supabase-js';

/** 許可を出してよいつなぎ先（redirect_uri の host）。claude.ai のカスタムコネクタ（D37）。
 *  ローカルの検証（ENV.target が local）のときだけ、手元（127.0.0.1・localhost）も許す */
export const ALLOWED_REDIRECT_HOSTS = ['claude.ai'];
export const LOCAL_REDIRECT_HOSTS = ['127.0.0.1', 'localhost'];

/** 案内された authorization_id を、ログインを挟んでも忘れないよう、端末に置いておく期間（ミリ秒） */
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const PENDING_KEY = 'maney:oauth-pending';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** URL の ?authorization_id=... を取り出す（なければ null） */
export function authorizationIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('authorization_id');
  return id && /^[A-Za-z0-9_-]{8,200}$/.test(id) ? id : null;
}

/** 案内された id を端末に置く（ログインで画面が切り替わっても、あとで取り出せるように） */
export function rememberAuthorizationId(storage: StorageLike, id: string, now: number): void {
  try { storage.setItem(PENDING_KEY, JSON.stringify({ id, at: now })); } catch { /* 置けなくても、そのまま続ける */ }
}

/** 置いてある id（10分以内のものだけ。古いものは捨てる） */
export function pendingAuthorizationId(storage: StorageLike, now: number): string | null {
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof v.id === 'string' && typeof v.at === 'number' && now - v.at >= 0 && now - v.at <= PENDING_TTL_MS && authorizationIdFromSearch(`?authorization_id=${v.id}`)) return v.id;
  } catch { /* 読めなければ、ないものとする */ }
  try { storage.removeItem(PENDING_KEY); } catch { /* 消せなくても続ける */ }
  return null;
}

export const clearPendingAuthorizationId = (storage: StorageLike): void => { try { storage.removeItem(PENDING_KEY); } catch { /* 続ける */ } };

/** つなぎ先（redirect_uri）の host。URL として読めなければ null */
export function redirectHost(redirectUri: string): string | null {
  try { return new URL(redirectUri).hostname.toLowerCase(); } catch { return null; }
}

/** つなぎ先を許してよいか。https の claude.ai だけ（local のときは、手元の http も） */
export function isAllowedRedirect(redirectUri: string, local: boolean): boolean {
  let url: URL;
  try { url = new URL(redirectUri); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.includes(host)) return true;
  return local && (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_REDIRECT_HOSTS.includes(host);
}

export type ConsentAsk = { clientName: string; host: string };
export type ConsentUi = {
  /** 許可する／しない のどちらを押したか */
  ask(info: ConsentAsk): Promise<'approve' | 'deny'>;
  /** つなげなかったことを、1文で知らせる（画面に出す） */
  notify(message: string): void;
  /** 別のページ（つなぎ先）へ移る */
  redirect(url: string): void;
};
export type ConsentDeps = {
  supa: Pick<SupabaseClient, 'auth'>;
  storage: StorageLike;
  now: () => number;
  local: boolean;
  ui: ConsentUi;
};
export type ConsentResult = 'none' | 'approved' | 'denied' | 'blocked' | 'error' | 'already';

/** 許可の流れ。ログインしたあとに呼ぶ。案内された id が端末に置いてあるときだけ動く。
 *  1. Auth から内容（つなぎ先・名前）を取る  2. つなぎ先が許せるか確かめる（許せなければ、拒否して知らせるだけ。つなぎ先へは移らない）
 *  3. 本人に聞く  4. 許可・拒否を Auth に伝え、返ってきた戻り先へ移る */
export async function runConsent(deps: ConsentDeps): Promise<ConsentResult> {
  const { supa, storage, now, local, ui } = deps;
  const id = pendingAuthorizationId(storage, now());
  if (!id) return 'none';
  const oauth = supa.auth.oauth;
  const { data, error } = await oauth.getAuthorizationDetails(id);
  clearPendingAuthorizationId(storage); // 1回きり（失敗しても、同じ id でやり直さない）
  if (error || !data) { ui.notify('許可の依頼を読み込めませんでした。Claude からもう一度つなぎ直してください。'); return 'error'; }
  // すでに許可済みのときは、確かめずに戻り先だけが返る
  if (!('authorization_id' in data)) { ui.redirect((data as { redirect_url: string }).redirect_url); return 'already'; }
  const host = redirectHost(data.redirect_uri);
  if (!host || !isAllowedRedirect(data.redirect_uri, local)) {
    await oauth.denyAuthorization(id); // 戻り先へは移らず、依頼だけ閉じる
    ui.notify(`許可できないつなぎ先からの依頼でした（${host ?? data.redirect_uri}）。何も許可していません。`);
    return 'blocked';
  }
  const answer = await ui.ask({ clientName: data.client.name, host });
  const result = answer === 'approve' ? await oauth.approveAuthorization(id) : await oauth.denyAuthorization(id);
  if (result.error || !result.data) { ui.notify('許可の結果を送れませんでした。もう一度つなぎ直してください。'); return 'error'; }
  ui.redirect(result.data.redirect_url);
  return answer === 'approve' ? 'approved' : 'denied';
}
