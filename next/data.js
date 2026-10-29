// 新しいテーブルを読み書きするデータの層（テーブル分割 #11）。
// 画面のための変換（next/compat.js の互換層）とは分けている。Phase 4 で画面を作り直しても、この層は使い続ける。
// 設計は docs/db/TABLE_SPLIT.md の「保存の仕組み」「読み込み」。
(function (root) {
  'use strict';

  // 参照される側が先
  const TABLES = [
    'settings', 'cards', 'jobs', 'categories', 'ledger_entries', 'shifts', 'plans',
    'fixed_costs', 'fixed_incomes', 'withdrawals', 'salary_actuals', 'card_bill_actuals',
  ];

  // Supabase が1回に返す件数には上限（既定は1,000件）があるので、それより小さく分けて読む
  const PAGE_SIZE = 500;

  // 1つのテーブルを、決まった順番（position, id）でページに分けて読む。
  // 件数を一緒に受け取り、読んだ行数と合うかを確かめる。合わなければエラーにする。
  async function loadTable(supa, table, pageSize = PAGE_SIZE) {
    const rows = [];
    let total = null;
    for (let from = 0; ; from += pageSize) {
      let query = supa.from(table).select('*', { count: 'exact' });
      query = table === 'settings' ? query.order('id') : query.order('position').order('id');
      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      if (typeof count !== 'number') throw new Error(`${table}: 件数を受け取れませんでした`);
      if (total === null) total = count;
      else if (count !== total) throw new Error(`${table}: 読んでいる間に件数が変わりました（${total} → ${count}）`);
      rows.push(...data);
      if (data.length < pageSize || rows.length >= total) break;
    }
    if (rows.length !== total) throw new Error(`${table}: 読んだ行数（${rows.length}）が件数（${total}）と合いません`);
    return rows;
  }

  // 全テーブルと移行の番号を読む。1つでも失敗したら全体を失敗にする。
  // 呼んだ側は、成功したときだけサーバーの写しを置き換える（読めなかった行を「消えた」と扱わない）。
  async function loadAllTables(supa, pageSize = PAGE_SIZE) {
    const lists = await Promise.all(TABLES.map(t => loadTable(supa, t, pageSize)));
    const rows = {};
    TABLES.forEach((t, i) => { rows[t] = lists[i]; });

    const { data, error } = await supa.from('sync_state').select('epoch').maybeSingle();
    if (error) throw error;
    return { rows, epoch: data ? data.epoch : 1, loadedAt: new Date().toISOString() };
  }

  const MoneyData = { TABLES, PAGE_SIZE, loadTable, loadAllTables };
  root.MoneyData = MoneyData;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyData;
})(typeof globalThis !== 'undefined' ? globalThis : this);
