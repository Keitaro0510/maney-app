// 設定タブの「カレンダーの共有」（D39）。共有コードを渡す・相手のコードで申請する・承認する・解除する。
import { elementById, inputById, escapeHtml, toast } from '../ui.ts';
import {
  getMyShareCode, resetMyShareCode, requestShare, listShares, respondShare, revokeShare, formatShareCode, type ShareRow,
} from '../share.ts';
import { resetShareView, renderCal } from './calendar.ts';

let myCode = '';
let rows: ShareRow[] = [];
let busy = false;
// 押し間違いを防ぐため、解除と作り直しは2回押す（1回目で「もう一度押すと…」になる）
let armed = '';
let armTimer: ReturnType<typeof setTimeout> | undefined;

const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'うまくいきませんでした。通信を確かめてください');

function setMsg(text: string): void {
  const el = elementById('share-msg');
  el.textContent = text;
  el.hidden = !text;
}

function arm(key: string): boolean {
  if (armed === key) { armed = ''; clearTimeout(armTimer); return true; }
  armed = key;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed = ''; render(); }, 4000);
  render();
  return false;
}

function rowHtml(r: ShareRow): string {
  const id = escapeHtml(r.id);
  const btn = (action: string, label: string, cls = ''): string =>
    `<button type="button" class="ui-btn sm ${cls}" data-share-action="${action}" data-id="${id}">${label}</button>`;
  const armedBtn = (action: string, label: string, armLabel: string): string =>
    btn(action, armed === `${action}:${r.id}` ? armLabel : label, 'danger');
  if (r.direction === 'sharing') {
    if (r.status === 'pending') {
      return `<div class="share-row"><div class="share-who"><div>${escapeHtml(r.other_email)}</div><div class="share-sub">あなたのカレンダーを見たいと申請しています</div></div>`
        + `<div class="share-btns">${btn('approve', '承認', 'primary')}${btn('reject', '断る')}</div></div>`;
    }
    return `<div class="share-row"><div class="share-who"><div>${escapeHtml(r.other_email)}</div><div class="share-sub">あなたのカレンダーを見られます</div></div>`
      + `<div class="share-btns">${armedBtn('revoke', '解除', 'もう一度押すと解除')}</div></div>`;
  }
  const name = escapeHtml(r.nickname || '相手');
  if (r.status === 'pending') {
    return `<div class="share-row"><div class="share-who"><div>${name}</div><div class="share-sub">承認を待っています</div></div>`
      + `<div class="share-btns">${armedBtn('revoke', '取り消す', 'もう一度押すと取り消す')}</div></div>`;
  }
  return `<div class="share-row"><div class="share-who"><div>${name}</div><div class="share-sub">カレンダーを見られます（カレンダーのタブで切り替え）</div></div>`
    + `<div class="share-btns">${armedBtn('revoke', '解除', 'もう一度押すと解除')}</div></div>`;
}

function render(): void {
  elementById('share-code').textContent = myCode ? formatShareCode(myCode) : '読み込み中…';
  elementById('share-reset').textContent = armed === 'reset' ? 'もう一度押すと作り直す' : '作り直す';
  const list = elementById('share-list');
  list.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="share-empty">まだ誰ともつながっていません</div>';
}

async function reload(): Promise<void> {
  try {
    [myCode, rows] = await Promise.all([getMyShareCode(), listShares()]);
  } catch (e) {
    setMsg(errText(e));
  }
  render();
}

/** 設定タブを開いたとき */
export function initShareSection(): void {
  render();
  void reload();
}

async function run(task: () => Promise<void>, done?: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await task();
    setMsg('');
    if (done) toast(done);
  } catch (e) {
    setMsg(errText(e));
  } finally {
    busy = false;
  }
  resetShareView();
  await reload();
  void renderCal();
}

/** 起動時に一度だけ登録する */
export function bindShareControls(): void {
  elementById('share-copy').addEventListener('click', () => {
    if (!myCode) return;
    navigator.clipboard.writeText(myCode).then(() => toast('コードをコピーしました'), () => toast('コピーできませんでした。長押しで選んでください'));
  });
  elementById('share-reset').addEventListener('click', () => {
    if (!arm('reset')) return;
    void run(async () => { myCode = await resetMyShareCode(); }, 'コードを作り直しました（承認前の申請は消えました）');
  });
  elementById('share-request').addEventListener('click', () => {
    const code = inputById('share-code-input').value.trim();
    const nick = inputById('share-nick').value.trim();
    if (!code) { setMsg('相手のコードを入れてください'); return; }
    void run(async () => {
      await requestShare(code, nick);
      inputById('share-code-input').value = '';
    }, '申請しました。相手が承認すると見られます');
  });
  elementById('share-list').addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const b = event.target.closest<HTMLElement>('[data-share-action]');
    if (!b) return;
    const id = b.dataset.id || '';
    const action = b.dataset.shareAction;
    if (!id) return;
    if (action === 'approve') void run(() => respondShare(id, true), '承認しました');
    else if (action === 'reject') void run(() => respondShare(id, false), '断りました');
    else if (action === 'revoke' && arm(`revoke:${id}`)) void run(() => revokeShare(id), '解除しました');
  });
}
