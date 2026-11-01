// データの書き出し（エクスポート）と読み込み（インポート）のファイルの形（D13）。画面は js/backup-ui.js。
// ここは画面を使わないので、Node でテストできる。
// ファイル: { format: 'maney-export', version: 1, exported_at, tables: { テーブル: [行, …] } }。行は DB の行から、サーバーが決める列を除いたもの。
// 読み込み（全部を置き換える）は DB の public.import_backup が行う。ここでは先に中身を確かめ、確かめの画面に出す件数を数える
// （DB でも同じことをもう一度確かめる）
// js/ の画面からは window.MoneyBackup で使う（src/main.ts。D17）
import type { Rows } from './data.ts';

export const FORMAT = 'maney-export';
export const VERSION = 1;
// サーバーが決める列。ファイルには入れない（id は、記録どうしのつながりのために入れる）
const SERVER_COLUMNS = ['user_id', 'created_at', 'updated_at'];

/** 書き出すファイルの中身 */
export interface ExportFile { format: string; version: number; exported_at: string; tables: Record<string, Record<string, unknown>[]> }
/** 読み込むファイルを確かめた結果 */
export interface ParsedImport { file: Record<string, unknown>; exportedAt: string | null; counts: Record<string, number> }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function withoutServerColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) if (!SERVER_COLUMNS.includes(k)) out[k] = row[k];
  return out;
}

// 今の行（{ テーブル: [行] }）から、書き出すファイルの中身を作る。
// tables: 書き出すテーブルの名前（MoneyData.TABLES の順）。削除済みのカード・バイト先・カテゴリも、そのまま入れる
export function buildExport(rows: Rows | null | undefined, tables: string[], exportedAt: string): ExportFile {
  // 設定の行がないのは、まだサーバーから読み込めていないとき。空のファイルを作ると、読み込んだときに全部消えてしまう
  if (!rows || !Array.isArray(rows.settings) || rows.settings.length !== 1) {
    throw new Error('まだデータを読み込めていないので、書き出せません');
  }
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) out[t] = (rows[t] || []).map(withoutServerColumns);
  return { format: FORMAT, version: VERSION, exported_at: exportedAt, tables: out };
}

// ファイルの文字を読み、中身を確かめる。正しくなければ、わけを書いたエラーにする。
// 返す値: { file: DB に渡す中身, exportedAt: 書き出した日時（なければ null）, counts: { テーブル: 件数 } }
export function parseImport(text: string, tables: string[]): ParsedImport {
  let file: unknown;
  try { file = JSON.parse(text); } catch (e) { throw new Error('JSON のファイルとして読めません'); }
  if (!isObject(file) || file.format !== FORMAT) throw new Error('このアプリが書き出したファイルではありません');
  if (file.version !== VERSION) {
    throw new Error(typeof file.version === 'number' && file.version > VERSION
      ? 'このアプリより新しい版で書き出したファイルです。アプリを新しくしてから読み込んでください'
      : `ファイルの版（${file.version}）は読み込めません`);
  }
  const fileTables = file.tables;
  if (!isObject(fileTables)) throw new Error('ファイルに tables がありません');
  const unknown = Object.keys(fileTables).filter(t => !tables.includes(t));
  if (unknown.length) throw new Error(`ファイルに、読み込めないテーブルがあります: ${unknown.join(', ')}`);

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const list = fileTables[t];
    // 置き換えるので、テーブルが1つでも欠けていたら止める（欠けたテーブルを空にしてしまわないように）
    if (!Array.isArray(list)) throw new Error(`ファイルにテーブル ${t} がありません`);
    list.forEach((r: unknown, i) => {
      if (!isObject(r) || !r.id) throw new Error(`${t} の ${i + 1}件目: id がありません`);
    });
    counts[t] = list.length;
  }
  if (counts.settings !== 1) throw new Error('設定（settings）の行は1つにしてください');
  return { file, exportedAt: typeof file.exported_at === 'string' ? file.exported_at : null, counts };
}

// 確かめの画面に出す、テーブルごとの件数（ファイルと今）。設定は1行と決まっているので出さない
export function compareCounts(fileCounts: Record<string, number>, rows: Rows | null | undefined, tables: string[]): { table: string; file: number; now: number }[] {
  return tables.filter(t => t !== 'settings').map(t => ({
    table: t, file: fileCounts[t] || 0, now: ((rows && rows[t]) || []).length,
  }));
}
