// 画面の部品（D12 の手順6）。タスクの画面から使い始め、今ある画面はあとで1つずつこれに直す。
// - 押せる所は 44px 以上。ボタンは <button>、アイコンだけのボタンには読み上げ用の名前（aria-label）を付ける
// - 自由に入れた文字（タスクの名前など）は、innerHTML に入れずに textContent で出す。どうしても HTML にするときは escapeHtml を通す
// 見た目（CSS）は css/app.css の「画面の部品」にある。
(function (root) {
  'use strict';

  // HTML に入れる文字を、そのまま表示されるようにする（< や " で画面やボタンが壊れないように）
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ここから下は画面（document）を使う。Node のテストでは読み込むだけで、呼ばない

  // 要素を作る。props の on〜 はイベント、それ以外は属性（className・textContent は同名のプロパティ）
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'className' || key === 'textContent') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  // id で入力欄を取る（D16）。ないとき・種類が違うときは、どの id かを書いて止める。
  // 画面によってない要素には使わない（そこは document.getElementById で取り、null を確かめる）
  /**
   * @template {HTMLElement} T
   * @param {string} id
   * @param {{ new (): T }} type
   * @param {string} what
   * @returns {T}
   */
  function byId(id, type, what) {
    const node = document.getElementById(id);
    if (!(node instanceof type)) throw new Error(`${what}が見つかりません: #${id}`);
    return node;
  }
  /** @param {string} id @returns {HTMLInputElement} */
  function inputById(id) { return byId(id, HTMLInputElement, '入力欄（input）'); }
  /** @param {string} id @returns {HTMLSelectElement} */
  function selectById(id) { return byId(id, HTMLSelectElement, '選択欄（select）'); }
  /** @param {string} id @returns {HTMLTextAreaElement} */
  function textareaById(id) { return byId(id, HTMLTextAreaElement, '入力欄（textarea）'); }
  /** @param {string} id @returns {HTMLDialogElement} */
  function dialogById(id) { return byId(id, HTMLDialogElement, '画面（dialog）'); }

  // チェックのある行（タスクの一覧の1行）。完了すると横線で薄くなる（D3）。
  // title: 名前、sub: 下の小さな文（期限など）、done: 完了か、label: チェックの読み上げ用の名前、
  // onChange(checked): チェックを変えたとき。end: 行の右に置く要素（ボタンなど）
  /**
   * @param {{ title?: string, sub?: string, done?: boolean, label?: string,
   *   onChange?: (checked: boolean) => void, end?: Node | null }} [options]
   */
  function checkRow({ title, sub, done = false, label, onChange, end } = {}) {
    const input = el('input', {
      type: 'checkbox',
      'aria-label': label || `「${title}」を完了にする`,
      // 押した瞬間に見た目を変える（保存や描き直しは onChange の側で）
      onchange: e => { row.classList.toggle('done', e.target.checked); if (onChange) onChange(e.target.checked); },
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

  // 下からせり上がる画面（<dialog class="sheet">）を開く。
  // 開いている間は後ろを触れない。Esc か閉じるボタンで閉じる（外側を押しても閉じない。今の入力シートと同じ）。
  // 閉じたら、opener（開いたボタン）か、開く前にフォーカスがあった所に戻す。戻り値は閉じる関数。
  // iPhone の Safari はボタンを押してもフォーカスを移さないので、押したボタンを opener で渡す
  /**
   * @param {HTMLDialogElement} dialog
   * @param {HTMLElement | null} [opener]
   */
  function openSheet(dialog, opener = /** @type {HTMLElement | null} */ (document.activeElement)) {
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
  let toastTimer = null;
  /**
   * @param {string} message
   * @param {{ actionLabel?: string, onAction?: () => void, ms?: number }} [options]
   */
  function toast(message, { actionLabel, onAction, ms = 5000 } = {}) {
    let box = document.getElementById('ui-toast');
    if (!box) {
      box = el('div', { id: 'ui-toast', className: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(box);
    }
    clearTimeout(toastTimer);
    const close = () => {
      clearTimeout(toastTimer);
      box.classList.remove('show');
      box.replaceChildren();
    };
    // replaceChildren は null を「null」という文字にしてしまうので、ボタンがないときは渡さない
    box.replaceChildren(...[
      el('span', { className: 'toast-msg', textContent: message }),
      actionLabel ? el('button', {
        type: 'button', className: 'ui-btn toast-action', textContent: actionLabel,
        onclick: () => { close(); if (onAction) onAction(); },
      }) : null,
    ].filter(Boolean));
    box.classList.add('show');
    toastTimer = setTimeout(close, ms);
    return close;
  }

  const MoneyUI = { escapeHtml, el, inputById, selectById, textareaById, dialogById, checkRow, openSheet, toast };
  root.MoneyUI = MoneyUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
