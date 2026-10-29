// 互換層（テーブル分割 #11 の移行のためだけ。docs/DECISIONS.md の D9）
//
//   DB のテーブル（正規化・ID が中心）
//     ↓ この層で変換
//   互換の st（今の画面と計算のためだけ。今の user_data の JSON と同じ形）
//     ↓
//   今の画面・計算
//
// - 新しい機能はここに積まない。Phase 4 などで画面と計算が DB のモデルを直接読むようにしたら、この層は消す
// - 変換は DB の逆の変換（private.export_to_user_data）と同じ。テスト（tests/compat.test.mjs）で一致を確かめている
// - st の各記録には、元の行の id を `_id` として持たせる（編集で ID を引き継ぐため）。
//   削除済みのカード・バイト先は `_deleted: true` を持つ（計算には使い続け、選択肢からは外す）
(function (root) {
  'use strict';

  // position, id の順（DB の読み込みと同じ）
  const byPosition = (a, b) => (a.position - b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sorted = list => [...(list || [])].sort(byPosition);

  // '10:00:00' → '10:00'
  const hhmm = t => (t == null ? null : t.slice(0, 5));

  // 登録日時をミリ秒にする（DB の (extract(epoch from created_at) * 1000)::bigint と同じく、マイクロ秒を四捨五入）
  function createdMs(ts) {
    const m = /\.(\d+)/.exec(ts);
    const micro = m ? Number((m[1] + '000000').slice(0, 6)) : 0;
    return Date.parse(ts.replace(/\.\d+/, '')) + Math.round(micro / 1000);
  }

  // jsonb_strip_nulls と同じ（値が null・undefined の項目を消す）
  function stripNulls(obj) {
    for (const k of Object.keys(obj)) if (obj[k] == null) delete obj[k];
    return obj;
  }

  // 互換の st の記録に、元の行の情報を持たせる
  function withMeta(item, row) {
    item._id = row.id;
    if (row.deleted_at) item._deleted = true;
    return item;
  }

  // テーブルの行（{settings: [...], cards: [...], ...}）から、互換の st を組み立てる。
  // 設定の行がなければ null を返す（まだ移行していない）。
  function rowsToSt(rows) {
    const settings = (rows.settings || [])[0];
    if (!settings) return null;

    // カードは削除済みも含める（記録が参照しているため）。配列の番号が今の cardIdx になる
    const cards = sorted(rows.cards);
    const cardIndex = new Map(cards.map((c, i) => [c.id, i]));
    const cardById = new Map(cards.map(c => [c.id, c]));
    const jobs = sorted(rows.jobs);
    const jobById = new Map(jobs.map(j => [j.id, j]));
    const categories = sorted(rows.categories);
    const categoryById = new Map(categories.map(c => [c.id, c]));

    const actuals = [
      ...(rows.card_bill_actuals || []).map(a => ({ row: a, kindOrder: 0 })),
      ...(rows.salary_actuals || []).map(a => ({ row: a, kindOrder: 1 })),
    ].sort((x, y) => (x.row.position - y.row.position) || (x.kindOrder - y.kindOrder)
      || (x.row.id < y.row.id ? -1 : x.row.id > y.row.id ? 1 : 0));

    return {
      acctBase: settings.acct_base,
      baseDate: settings.base_date,
      budget: settings.budget,
      otherIncome: settings.other_income,
      shiftCloseDay: settings.shift_close_day,
      shiftPayDay: settings.shift_pay_day,
      fuyouLimit: settings.fuyou_limit,

      // 今のアプリはカードの締め日・引き落とし日を文字列で保存している
      cards: cards.map(c => withMeta({ name: c.name, closeDay: String(c.close_day), billDay: String(c.bill_day) }, c)),

      jobs: jobs.map(j => withMeta(stripNulls({
        name: j.name, wage: j.wage, color: j.color,
        nightStart: hhmm(j.night_start), nightRate: j.night_rate, transport: j.transport,
        closeDay: j.close_day, payDay: j.pay_day,
      }), j)),

      // カテゴリの一覧には削除済みを含めない（記録には名前だけが残る）
      catExp: categories.filter(c => c.kind === 'expense' && !c.deleted_at).map(c => c.name),
      catInc: categories.filter(c => c.kind === 'income' && !c.deleted_at).map(c => c.name),

      ledger: sorted(rows.ledger_entries).map(l => {
        const card = l.card_id ? cardById.get(l.card_id) : null;
        return withMeta(stripNulls({
          date: l.date, amount: l.amount, name: l.name, cat: categoryById.get(l.category_id).name, type: l.kind,
          pay: l.payment_method === 'card' ? card.name : '現金',
          memo: l.memo,
          cardIdx: card ? cardIndex.get(card.id) : null,
          receive: l.kind === 'income' ? (l.payment_method === 'bank' ? '口座振込' : '現金') : null,
        }), l);
      }),

      shifts: sorted(rows.shifts).map(s => withMeta({
        job: jobById.get(s.job_id).name, date: s.date,
        start: hhmm(s.start_time), end: hhmm(s.end_time), rest: s.rest_minutes, wage: s.wage,
      }, s)),

      plans: sorted(rows.plans).map(p => withMeta(stripNulls({
        id: p.legacy_id != null ? p.legacy_id : createdMs(p.created_at),
        title: p.title,
        date: p.start_date, dateStart: p.start_date, dateEnd: p.end_date,
        timeStart: hhmm(p.start_time) || '', timeEnd: hhmm(p.end_time) || '',
        budget: p.budget, memo: p.memo, color: p.color, done: p.done,
        planCardIdx: p.card_id ? cardIndex.get(p.card_id) : null,
      }), p)),

      fixedCosts: sorted(rows.fixed_costs).map(f => withMeta({
        id: f.legacy_id != null ? f.legacy_id : createdMs(f.created_at),
        name: f.name, amount: f.amount, day: f.day, type: f.kind,
        pay: f.kind === 'income' ? 'income' : f.payment_method === 'card' ? `card-${cardIndex.get(f.card_id)}` : f.payment_method,
      }, f)),

      // 今のアプリは固定収入の金額と日を文字列で保存している
      fixedIncs: sorted(rows.fixed_incomes).map(f => withMeta({ name: f.name, amount: String(f.amount), day: String(f.day) }, f)),

      wds: sorted(rows.withdrawals).map(w => withMeta({ date: w.date, amount: w.amount }, w)),

      actualInputs: actuals.map(({ row: a, kindOrder }) => kindOrder === 0
        ? withMeta({
          type: 'card',
          cardKey: `card-${cardIndex.get(a.card_id)}-${a.bill_month.slice(0, 7)}`,
          cardIdx: cardIndex.get(a.card_id),
          billY: Number(a.bill_month.slice(0, 4)),
          billM: Number(a.bill_month.slice(5, 7)) - 1,
          actualAmount: a.actual_amount,
          estimatedAmount: a.estimated_amount,
        }, a)
        : withMeta({
          type: 'shift',
          job: jobById.get(a.job_id).name,
          salaryKey: `${jobById.get(a.job_id).name}|${a.pay_month.slice(0, 7)}`,
          date: a.paid_on,
          actualAmount: a.actual_amount,
          estimatedAmount: a.estimated_amount,
        }, a)),
    };
  }

  // 互換の st から、行の情報（_id など）を除いた、今の JSON の形を返す（照らし合わせに使う）
  function stripMeta(st) {
    return JSON.parse(JSON.stringify(st, (k, v) => (k.startsWith('_') ? undefined : v)));
  }

  const MoneyCompat = { rowsToSt, stripMeta, createdMs };
  root.MoneyCompat = MoneyCompat;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyCompat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
