// 設定タブの「通知」（Issue #189・D36）。通知を受け取る・やめる・テスト通知を送る。
import { elementById, toast } from '../ui.ts';
import { getPushState, enablePush, disablePush, sendTestPush, type PushState } from '../push.ts';

let busy = false;

const STATUS: Record<PushState, string> = {
  'unsupported': 'この環境では通知を使えません（公開したアプリを、ホーム画面に追加して開くと使えます）',
  'needs-install': 'iPhone では、Safari の共有ボタンから「ホーム画面に追加」して、そのアイコンから開くと使えます（iOS 16.4 以上）',
  'denied': '通知が拒否されています。端末の設定アプリで、このアプリの通知を許可してください',
  'off': 'この端末は、まだ通知を受け取っていません',
  'on': 'この端末で、通知を受け取っています',
};

const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'うまくいきませんでした。通信を確かめてください');

function setMsg(text: string): void {
  const el = elementById('push-msg');
  el.textContent = text;
  el.hidden = !text;
}

async function render(): Promise<void> {
  let state: PushState;
  try { state = await getPushState(); } catch (e) { console.warn('通知の状態を調べられませんでした', e); state = 'unsupported'; }
  elementById('push-status').textContent = STATUS[state];
  const usable = state === 'off' || state === 'on';
  elementById('push-enable').hidden = state !== 'off';
  elementById('push-disable').hidden = state !== 'on';
  elementById('push-test').hidden = state !== 'on';
  elementById('push-actions').hidden = !usable;
}

/** 設定タブを開いたとき */
export function initPushSection(): void { void render(); }

async function run(task: () => Promise<string>): Promise<void> {
  if (busy) return;
  busy = true;
  try { const done = await task(); setMsg(''); if (done) toast(done); } catch (e) { setMsg(errText(e)); } finally { busy = false; }
  await render();
}

/** 起動時に一度だけ登録する */
export function bindPushControls(): void {
  // enablePush は、押した動作の中で許可を取る（iOS の決まり）ので、await の前に呼ぶ
  elementById('push-enable').addEventListener('click', () => { void run(async () => { await enablePush(); return '通知を受け取るようにしました'; }); });
  elementById('push-disable').addEventListener('click', () => { void run(async () => { await disablePush(); return '通知をやめました'; }); });
  elementById('push-test').addEventListener('click', () => {
    void run(async () => {
      const r = await sendTestPush();
      if (r.sent === 0) throw new Error(r.failed ? 'テスト通知を送れませんでした。いったん「やめる」を押して、もう一度受け取るようにしてください' : '登録された端末がありません');
      return `テスト通知を ${r.sent} 台に送りました。数秒で届きます`;
    });
  });
}
