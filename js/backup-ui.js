// データの書き出し・読み込みの画面（D13）。ファイルの形は js/backup.js（MoneyBackup）、部品は js/ui.js（MoneyUI）。
// 設定の「データの書き出し・読み込み」から使う。
// - 書き出し: 今の行（サーバーの写しに送信待ちを重ねたもの。画面に出ている内容）を JSON のファイルにする
// - 読み込み: 今のデータを全部、ファイルの中身に置き換える（DB の public.import_backup。直前の状態は写しに残る）
// js/app.js の次のものを使う（呼ばれたときに読む）: supa・outbox・currentRows・flushOutbox・loadRemote・loadingRemote・sending・
// downloadJson・TABLE_LABELS

// ---------- 書き出す ----------
function exportBackup(){
  let file;
  try{
    file = MoneyBackup.buildExport(currentRows(), MoneyData.TABLES, new Date().toISOString());
  }catch(e){
    return showBackupError(e.message);
  }
  hideBackupError();
  downloadJson('maney-export', JSON.stringify(file, null, 2));
  MoneyUI.toast(`書き出しました（家計簿 ${file.tables.ledger_entries.length}件ほか）`);
}

// 設定のカードの中に出す、うまくいかなかったわけ
function showBackupError(message){
  const box = document.getElementById('backup-err');
  box.textContent = message;
  box.hidden = false;
}
function hideBackupError(){ document.getElementById('backup-err').hidden = true; }

// ---------- 読み込む ----------
let pendingImport = null;      // 確かめの画面に出している、読み込むファイル（MoneyBackup.parseImport の結果）
let closeImportSheetFn = null;

function pickBackupFile(){
  const input = MoneyUI.inputById('backup-file');
  input.value = ''; // 同じファイルを続けて選んでも、選んだことがわかるように
  input.click();
}

// ファイルを選んだ: 中身を確かめてから、確かめの画面を出す（まだ何も書かない）
async function readBackupFile(input){
  const f = input.files && input.files[0];
  if(!f) return;
  try{
    pendingImport = MoneyBackup.parseImport(await f.text(), MoneyData.TABLES);
  }catch(e){
    pendingImport = null;
    return showBackupError(`読み込めません: ${e.message}`);
  }
  hideBackupError();
  openImportSheet(f.name, document.getElementById('backup-import-btn'));
}

// '2026-10-31T12:00:00.000Z' → 「2026年10月31日 21:00」（端末の時刻）
function backupTimeLabel(iso){
  const d = iso ? new Date(iso) : null;
  if(!d || isNaN(d.getTime())) return '日時がわかりません';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openImportSheet(fileName, opener){
  const { el } = MoneyUI;
  document.getElementById('import-file').replaceChildren(
    el('div', { textContent: fileName }),
    el('div', { textContent: `${backupTimeLabel(pendingImport.exportedAt)} に書き出したファイル` }),
  );
  // テーブルごとの件数。ファイルのほうが少ないものは、消える行があるので目立たせる
  const list = MoneyBackup.compareCounts(pendingImport.counts, currentRows(), MoneyData.TABLES);
  document.getElementById('import-counts').replaceChildren(
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
  document.getElementById('import-err').hidden = true;
  setImportRunning(false);
  closeImportSheetFn = MoneyUI.openSheet(MoneyUI.dialogById('import-sheet'), opener);
}
function closeImportSheet(){
  pendingImport = null;
  if(closeImportSheetFn) closeImportSheetFn();
}

function setImportRunning(running){
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('import-run'));
  btn.disabled = running;
  btn.textContent = running ? '読み込んでいます…' : '置き換える';
  /** @type {HTMLButtonElement} */ (document.getElementById('import-cancel')).disabled = running;
}

// 置き換える
async function runImport(){
  if(!pendingImport) return;
  const err = document.getElementById('import-err');
  err.hidden = true;
  setImportRunning(true);
  try{
    // 送れていない変更が残っていると、置き換えたあとには保存できない（移行の番号が上がるため）。先に送っておく
    await flushOutbox();
    if(outbox.length) throw new Error(`送れていない変更が${outbox.length}件あります。送れてから読み込んでください`);
    const { data, error } = await supa.rpc('import_backup', { p_file: pendingImport.file });
    // DB が止めたとき（code がある）は、全部が取り消されている。通信が切れたときは、置き換わったかどうかわからない
    if(error) throw Object.assign(new Error(error.message), { unchanged: !!error.code });
    setImportRunning(false);
    closeImportSheet();
    // 読み込み直す。ほかの読み込みの途中なら、終わるのを待つ（古い内容のまま止まらないように）
    for(let i = 0; (loadingRemote || sending) && i < 100; i++) await new Promise(r => setTimeout(r, 100));
    await loadRemote();
    MoneyUI.toast(`読み込みました。前の状態は、サーバーの写し（#${data.snapshot_id}）に残しています`, { ms: 8000 });
  }catch(e){
    err.textContent = (e.unchanged === false
      ? '通信が切れました。置き換わったかどうかは、アプリを開き直して確かめてください。'
      : '読み込めませんでした。今のデータは変わっていません。') + `\n${e.message || e}`;
    err.hidden = false;
    setImportRunning(false);
  }
}
