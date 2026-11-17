// Claude などに予定・タスクを書く許可を出す画面（Issue #190・D37）。流れは src/oauth-consent.ts。
// Auth から ?authorization_id=... で案内されたら、端末に id を置く（ログインを挟んでも忘れないように）。
// ログインしたあと、本人に「許可する／しない」を聞く。
import { ENV } from './env.ts';
import { state } from './state.ts';
import { getSupa } from './supa.ts';
import { dialogById, elementById } from './ui.ts';
import { appUi } from './navigation.ts';
import {
  authorizationIdFromSearch, rememberAuthorizationId, runConsent, type ConsentAsk, type ConsentUi,
} from './oauth-consent.ts';

/** 起動のとき（ログインより前）に1回。案内の id を置いて、URL からは消す（戻る・再読み込みで二重に動かないように） */
export function captureAuthorizationId(): void {
  const id = authorizationIdFromSearch(location.search);
  if (!id) return;
  rememberAuthorizationId(window.localStorage, id, Date.now());
  const url = new URL(location.href);
  url.searchParams.delete('authorization_id');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function ask({ clientName, host }: ConsentAsk): Promise<'approve' | 'deny'> {
  const box = dialogById('oauth-consent');
  elementById('oauth-consent-text').textContent =
    `「${clientName}」（${host}）が、あなたのアカウントでこのアプリにつなぎます。つなぐと、Claude の会話から、予定とタスク（と、カードの名前）を読んだり、追加・変更・削除したりできます。家計簿の記録・残高・金額の設定は、読めません・書けません。`;
  // showModal なので、今日のタスクなど、先に開いているダイアログより前に出る。Esc で黙って閉じないようにする（押したのは「つなぐ／つながない」だけにする）
  const keepOpen = (event: Event): void => event.preventDefault();
  box.addEventListener('cancel', keepOpen);
  box.showModal();
  return new Promise(resolve => {
    const done = (answer: 'approve' | 'deny'): void => { box.removeEventListener('cancel', keepOpen); box.close(); resolve(answer); };
    elementById('oauth-consent-approve').addEventListener('click', () => done('approve'), { once: true });
    elementById('oauth-consent-deny').addEventListener('click', () => done('deny'), { once: true });
  });
}

const ui: ConsentUi = {
  ask,
  notify: message => appUi.showBanner(message, [{ label: '閉じる', onclick: () => appUi.hideBanner(), primary: true }]),
  redirect: url => { location.assign(url); },
};

/** ログインしたあとに呼ぶ。案内の id があれば、許可の流れを動かす */
export async function maybeAskConsent(): Promise<void> {
  if (!state.currentUser) return; // ログインしていなければ、ログインのあとにもう一度呼ばれる（id は端末に置いてある）
  await runConsent({ supa: getSupa(), storage: window.localStorage, now: Date.now, local: ENV.target === 'local', ui });
}
