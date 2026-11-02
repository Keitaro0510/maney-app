// 画面の部品（D12 の手順6）。js/ui.js から移した（D20 の 2）。
// - 押せる所は 44px 以上。ボタンは <button>、アイコンだけのボタンには読み上げ用の名前（aria-label）を付ける
// - 自由に入れた文字（タスクの名前など）は、innerHTML に入れずに textContent で出す。どうしても HTML にするときは escapeHtml を通す
// - まだ js/ の画面のために、src/main.ts が window.MoneyUI に出す
// 見た目（CSS）は css/app.css の「画面の部品」にある。
import { getToday } from './dates.ts';

/** HTML に入れる文字を、そのまま表示されるようにする（< や " で画面やボタンが壊れないように） */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ここから下は画面（document）を使う。Node のテストでは読み込むだけで、呼ばない

/** 子に渡せるもの。null・false は飛ばす */
export type Child = Node | string | number | null | undefined | false;

/** 要素を作る。props の on〜（関数）はイベント、className・textContent は同名のプロパティ、それ以外は属性（true は空の属性、null・false は付けない） */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, children?: Child | Child[]): HTMLElementTagNameMap[K];
export function el(tag: string, props?: Record<string, unknown>, children?: Child | Child[]): HTMLElement;
export function el(tag: string, props: Record<string, unknown> = {}, children: Child | Child[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'className') node.className = String(value);
    else if (key === 'textContent') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of ([] as Child[]).concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// id で要素を取る（D16）。ないとき・種類が違うときは、どの id かを書いて止める。
// 画面によってない要素には使わない（そこは document.getElementById で取り、null を確かめる）
function byId<T extends HTMLElement>(id: string, type: { new (): T }, what: string): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`${what}が見つかりません: #${id}`);
  return node;
}
export function inputById(id: string): HTMLInputElement { return byId(id, HTMLInputElement, '入力欄（input）'); }
export function selectById(id: string): HTMLSelectElement { return byId(id, HTMLSelectElement, '選択欄（select）'); }
export function textareaById(id: string): HTMLTextAreaElement { return byId(id, HTMLTextAreaElement, '入力欄（textarea）'); }
export function dialogById(id: string): HTMLDialogElement { return byId(id, HTMLDialogElement, '画面（dialog）'); }
/** 必ずある要素（div・section など）。ないときは、どの id かを書いて止める */
export function elementById(id: string): HTMLElement { return byId(id, HTMLElement, '要素'); }

/** JSON のファイルにして保存させる。ファイル名は `<name>-<今日の日付>.json`（端末の時刻での日付。toISOString の日付は、朝9時までは前の日になる） */
export function downloadJson(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${getToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * チェックのある行（タスクの一覧の1行）。完了すると横線で薄くなる（D3）。
 * title: 名前、sub: 下の小さな文（期限など）、done: 完了か、label: チェックの読み上げ用の名前、
 * onChange(checked): チェックを変えたとき。end: 行の右に置く要素（ボタンなど）
 */
export function checkRow({ title, sub, done = false, label, onChange, end }: {
  title?: string; sub?: string; done?: boolean; label?: string; onChange?: (checked: boolean) => void; end?: Node | null;
} = {}): HTMLDivElement {
  const input = el('input', {
    type: 'checkbox',
    'aria-label': label || `「${title}」を完了にする`,
    // 押した瞬間に見た目を変える（保存や描き直しは onChange の側で）
    onchange: (e: Event) => {
      const checked = (e.target as HTMLInputElement).checked;
      row.classList.toggle('done', checked);
      if (onChange) onChange(checked);
    },
  });
  input.checked = !!done;
  const row = el('div', { className: 'check-row' + (done ? ' done' : '') }, [
    el('label', { className: 'check' }, [input, el('span', { className: 'check-box', 'aria-hidden': 'true' })]),
    el('div', { className: 'check-body' }, [
      el('div', { className: 'check-title', textContent: title }),
      sub ? el('div', { className: 'check-sub', textContent: sub }) : null,
    ]),
    end || null,
  ]);
  return row;
}

/**
 * 下からせり上がる画面（<dialog class="sheet">）を開く。
 * 開いている間は後ろを触れない。Esc か閉じるボタンで閉じる（外側を押しても閉じない。今の入力シートと同じ）。
 * 閉じたら、opener（開いたボタン）か、開く前にフォーカスがあった所に戻す。戻り値は閉じる関数。
 * iPhone の Safari はボタンを押してもフォーカスを移さないので、押したボタンを opener で渡す
 */
export function openSheet(dialog: HTMLDialogElement, opener: HTMLElement | null = document.activeElement as HTMLElement | null): () => void {
  const restore = () => {
    dialog.removeEventListener('close', restore);
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  };
  dialog.addEventListener('close', restore);
  if (!dialog.open) dialog.showModal();
  return () => { if (dialog.open) dialog.close(); };
}

// 短い知らせ（画面の下）。action を渡すと、ボタン（「元に戻す」など）を付ける。ms で消える。
// 新しい知らせを出すと、前の知らせは消える。戻り値は消す関数
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, { actionLabel, onAction, ms = 5000 }: { actionLabel?: string; onAction?: () => void; ms?: number } = {}): () => void {
  let box = document.getElementById('ui-toast');
  if (!box) {
    box = el('div', { id: 'ui-toast', className: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const shown = box;
  clearTimeout(toastTimer);
  const close = () => {
    clearTimeout(toastTimer);
    shown.classList.remove('show');
    shown.replaceChildren();
  };
  // replaceChildren は null を「null」という文字にしてしまうので、ボタンがないときは渡さない
  const parts: Node[] = [el('span', { className: 'toast-msg', textContent: message })];
  if (actionLabel) {
    parts.push(el('button', {
      type: 'button', className: 'ui-btn toast-action', textContent: actionLabel,
      onclick: () => { close(); if (onAction) onAction(); },
    }));
  }
  shown.replaceChildren(...parts);
  shown.classList.add('show');
  toastTimer = setTimeout(close, ms);
  return close;
}
