// データの書き出し・読み込みの画面（D13）。js/backup-ui.js から移した（D20 の 3）。ファイルの形は src/backup.ts、部品は src/ui.ts。
// 設定の「データの書き出し・読み込み」から使う。
// - 書き出し: 今の行（サーバーの写しに送信待ちを重ねたもの。画面に出ている内容）を JSON のファイルにする
// - 読み込み: 今のデータを全部、ファイルの中身に置き換える（DB の public.import_backup。直前の状態は写しに残る）
import { state } from '../state.ts';
import { currentRows, flushOutbox, loadRemote, TABLE_LABELS } from '../sync.ts';
import { TABLES } from '../data.ts';
import { getSupa } from '../supa.ts';
import { buildExport, parseImport, compareCounts, type ParsedImport } from '../backup.ts';
import { el, inputById, dialogById, elementById, openSheet, toast, downloadJson } from '../ui.ts';

// ---------- 書き出す ----------
export function exportBackup(): void {
  let file;
  try {
    file = buildExport(currentRows(), TABLES, new Date().toISOString());
  } catch (e) {
    return showBackupError(errorMessage(e));
  }
  hideBackupError();
  downloadJson('maney-export', JSON.stringify(file, null, 2));
  toast(`書き出しました（家計簿 ${file.tables.ledger_entries.length}件ほか）`);
}

function errorMessage(e: unknown): string {
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  return m ? String(m) : String(e);
}

/** 設定のカードの中に出す、うまくいかなかったわけ */
function showBackupError(message: string): void {
  const box = elementById('backup-err');
  box.textContent = message;
  box.hidden = false;
}
function hideBackupError(): void { elementById('backup-err').hidden = true; }

// ---------- 読み込む ----------
/** 確かめの画面に出している、読み込むファイル（parseImport の結果） */
let pendingImport: ParsedImport | null = null;
let closeImportSheetFn: (() => void) | null = null;

export function pickBackupFile(): void {
  const input = inputById('backup-file');
  input.value = ''; // 同じファイルを続けて選んでも、選んだことがわかるように
  input.click();
}

/** ファイルを選んだ: 中身を確かめてから、確かめの画面を出す（まだ何も書かない） */
export async function readBackupFile(input: HTMLInputElement): Promise<void> {
  const f = input.files && input.files[0];
  if (!f) return;
  try {
    pendingImport = parseImport(await f.text(), TABLES);
  } catch (e) {
    pendingImport = null;
    return showBackupError(`読み込めません: ${errorMessage(e)}`);
  }
  hideBackupError();
  openImportSheet(f.name, elementById('backup-import-btn'));
}

/** '2026-10-31T12:00:00.000Z' → 「2026年10月31日 21:00」（端末の時刻） */
export function backupTimeLabel(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '日時がわかりません';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openImportSheet(fileName: string, opener: HTMLElement): void {
  const pending = pendingImport;
  if (!pending) return;
  elementById('import-file').replaceChildren(
    el('div', { textContent: fileName }),
    el('div', { textContent: `${backupTimeLabel(pending.exportedAt)} に書き出したファイル` }),
  );
  // テーブルごとの件数。ファイルのほうが少ないものは、消える行があるので目立たせる
  const list = compareCounts(pending.counts, currentRows(), TABLES);
  elementById('import-counts').replaceChildren(
    el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', textContent: '' }),
      el('th', { scope: 'col', textContent: 'ファイル' }),
      el('th', { scope: 'col', textContent: '今' }),
    ])),
    el('tbody', {}, list.map(x => el('tr', { className: x.file < x.now ? 'less' : '' }, [
      el('th', { scope: 'row', textContent: TABLE_LABELS[x.table] || x.table }),
      el('td', { textContent: `${x.file}件` }),
      el('td', { textContent: `${x.now}件` }),
    ]))),
  );
  elementById('import-err').hidden = true;
  setImportRunning(false);
  closeImportSheetFn = openSheet(dialogById('import-sheet'), opener);
}
export function closeImportSheet(): void {
  pendingImport = null;
  if (closeImportSheetFn) closeImportSheetFn();
}

function setImportRunning(running: boolean): void {
  const btn = elementById('import-run') as HTMLButtonElement;
  btn.disabled = running;
  btn.textContent = running ? '読み込んでいます…' : '置き換える';
  (elementById('import-cancel') as HTMLButtonElement).disabled = running;
}

/** 置き換える */
export async function runImport(): Promise<void> {
  const pending = pendingImport;
  if (!pending) return;
  const err = elementById('import-err');
  err.hidden = true;
  setImportRunning(true);
  try {
    // 送れていない変更が残っていると、置き換えたあとには保存できない（移行の番号が上がるため）。先に送っておく
    await flushOutbox();
    if (state.outbox.length) throw new Error(`送れていない変更が${state.outbox.length}件あります。送れてから読み込んでください`);
    const { data, error } = await getSupa().rpc('import_backup', { p_file: pending.file });
    // DB が止めたとき（code がある）は、全部が取り消されている。通信が切れたときは、置き換わったかどうかわからない
    if (error) throw Object.assign(new Error(error.message), { unchanged: !!(error as { code?: string }).code });
    setImportRunning(false);
    closeImportSheet();
    // 読み込み直す。ほかの読み込みの途中なら、終わるのを待つ（古い内容のまま止まらないように）
    for (let i = 0; (state.loadingRemote || state.sending) && i < 100; i++) await new Promise(r => setTimeout(r, 100));
    await loadRemote();
    toast(`読み込みました。前の状態は、サーバーの写し（#${(data as { snapshot_id: number }).snapshot_id}）に残しています`, { ms: 8000 });
  } catch (e) {
    const unchanged = e && typeof e === 'object' ? (e as { unchanged?: boolean }).unchanged : undefined;
    err.textContent = (unchanged === false
      ? '通信が切れました。置き換わったかどうかは、アプリを開き直して確かめてください。'
      : '読み込めませんでした。今のデータは変わっていません。') + `\n${errorMessage(e)}`;
    err.hidden = false;
    setImportRunning(false);
  }
}

/** 設定の書き出し・読み込みボタンを登録する。 */
export function bindBackupControls(): void {
  elementById('backup-export-btn').addEventListener('click', exportBackup);
  elementById('backup-import-btn').addEventListener('click', pickBackupFile);
  const file = inputById('backup-file');
  file.addEventListener('change', () => { void readBackupFile(file); });
  elementById('import-close').addEventListener('click', closeImportSheet);
  elementById('import-cancel').addEventListener('click', closeImportSheet);
  elementById('import-run').addEventListener('click', () => { void runImport(); });
}
