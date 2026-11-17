// 通知（Web Push）を受け取る設定（Issue #189・D36）。許可を取る・購読して保存する・やめる・テスト通知。
// iOS は、ホーム画面に追加したアプリの中でだけ Web Push が使える（16.4 以降）。Safari のタブでは使えない
import { getSupa } from './supa.ts';

/** 送る側の公開鍵（VAPID。秘密ではない）。scripts/gen-vapid.mjs で作った鍵の、公開鍵の方。秘密鍵は Supabase の secret にある */
export const VAPID_PUBLIC_KEY = 'BMRZljhF3U1xZHWrTvG2p4H5EGF8QrZ-wpSMETgAwTLZeiQHeHZuyLsML4iauIUG_ZxwlEJPh9QLlk85cUFgIqM';

/** 画面に出す状態。unsupported＝この環境では使えない／needs-install＝iPhone で、ホーム画面に追加していない／denied＝通知を拒否している／off＝使えるが登録していない／on＝登録している */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

export type PushEnv = {
  /** serviceWorker・PushManager・Notification が使える */
  hasApi: boolean;
  isIos: boolean;
  /** ホーム画面から開いたアプリ（standalone）か */
  standalone: boolean;
  permission: 'default' | 'granted' | 'denied';
  /** この端末の購読があり、サーバーにも登録されている */
  subscribed: boolean;
};

/** 環境から、画面に出す状態を決める（画面を使わない。テストできる） */
export function classifyPush(env: PushEnv): PushState {
  if (!env.hasApi) return env.isIos && !env.standalone ? 'needs-install' : 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return env.subscribed && env.permission === 'granted' ? 'on' : 'off';
}

/** base64url の公開鍵を、subscribe に渡す形（バイト列）にする */
export function urlBase64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const bytesToB64url = (buf: ArrayBuffer): string => {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || null; // 手元の開発サーバーでは、Service Worker を登録していないので null
}

async function ownSubscribed(endpoint: string): Promise<boolean> {
  const { data, error } = await getSupa().from('push_subscriptions').select('endpoint').eq('endpoint', endpoint).maybeSingle();
  return !error && !!data;
}

/** いまの端末の状態 */
export async function getPushState(): Promise<PushState> {
  const reg = await registration();
  const hasApi = !!reg && 'PushManager' in window && 'Notification' in window;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  let subscribed = false;
  if (hasApi && reg) {
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub && await ownSubscribed(sub.endpoint).catch(() => false);
  }
  return classifyPush({ hasApi, isIos, standalone, permission: hasApi ? Notification.permission : 'default', subscribed });
}

/** 通知を受け取る。許可を取り、購読して、サーバーに保存する（ボタンを押した動作の中で呼ぶこと。iOS の決まり） */
export async function enablePush(): Promise<void> {
  // 許可の要求は、ボタンを押した動作の直下（await より前）で呼ぶ。iOS は、そうでないと許可の画面を出さないことがある
  if (!('Notification' in window)) throw new Error('この環境では通知を使えません（公開したアプリを、ホーム画面に追加して開いてください）');
  const asking = Notification.requestPermission();
  const reg = await registration();
  if (!reg) throw new Error('この環境では通知を使えません（公開したアプリを、ホーム画面に追加して開いてください）');
  const permission = await asking;
  if (permission !== 'granted') throw new Error('通知が許可されませんでした。設定アプリの「通知」で、このアプリを許可してください');
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) });
  const p256dh = sub.getKey('p256dh'), auth = sub.getKey('auth');
  if (!p256dh || !auth) throw new Error('購読情報を取り出せませんでした');
  const { error } = await getSupa().rpc('register_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: bytesToB64url(p256dh), p_auth: bytesToB64url(auth), p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message || '登録できませんでした');
}

/** 通知をやめる（この端末の購読を止め、サーバーの登録も消す） */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const { error } = await getSupa().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  if (error) throw new Error(error.message || '登録を消せませんでした');
  await sub.unsubscribe();
}

/** テスト通知を、自分の登録した端末すべてに送る。返すのは、送れた数・失敗した数 */
export async function sendTestPush(): Promise<{ sent: number; failed: number }> {
  const { data, error } = await getSupa().functions.invoke('push', { body: { action: 'test' } });
  if (error) throw new Error(error.message || 'テスト通知を送れませんでした');
  return { sent: Number(data?.sent) || 0, failed: Number(data?.failed) || 0 };
}
