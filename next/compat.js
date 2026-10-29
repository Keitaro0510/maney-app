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

  // ============================================================
  // 逆向き: 画面で変えた互換の st → テーブルの行
  // ============================================================

  const pad2 = n => String(n).padStart(2, '0');

  // 'HH:MM' → 'HH:MM:SS'（DB の time の形にそろえる）。空なら null
  const toTime = t => (t ? (t.length === 5 ? `${t}:00` : t) : null);

  // 数値にする。数値にできなければエラー（DB に変な値を送らない）
  function toInt(value, label) {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) throw new Error(`${label} が数値ではありません: ${value}`);
    return n;
  }

  const nextPosition = list => (list || []).reduce((max, r) => Math.max(max, r.position), -1) + 1;

  // 互換の st を、テーブルの行に戻す。base は今の行（サーバーの写しに送信待ちを重ねたもの）。
  // - st の記録の _id で、どの行かを見分ける。_id がない記録は新しい行（id を作る）
  // - 参照（カード・バイト先・カテゴリ）は ID にする。名前で参照している記録は、名前が変わっていなければ今の参照のまま
  // - カード・バイト先・カテゴリは消さず、削除済み（deleted_at）にする。削除済みと同じ名前で追加したら、その行を戻す
  // - 行の並び（position）は今の行のまま。新しい行は最後に付ける
  // options: { newId: () => uuid, now: ISO の日時 }
  function stToRows(st, base, options) {
    const { newId, now } = options;
    const byId = list => new Map((list || []).map(r => [r.id, r]));
    const out = {};

    // 同じ _id が2回出てきたら、2回目は新しい行として扱う（同じ行を二重に作らない）
    const usedIds = new Set();
    const existing = (rowsById, item) => {
      const row = item && item._id ? rowsById.get(item._id) : null;
      if (!row || usedIds.has(row.id)) return null;
      usedIds.add(row.id);
      return row;
    };
    const newRow = position => {
      const id = newId();
      usedIds.add(id);
      return { id, position, created_at: now };
    };

    // ---------- 設定 ----------
    const settings = (base.settings || [])[0] || { id: newId(), created_at: now };
    out.settings = [{
      ...settings,
      acct_base: toInt(st.acctBase, '口座残高'),
      base_date: st.baseDate,
      budget: toInt(st.budget, '予算'),
      other_income: toInt(st.otherIncome, 'その他の収入'),
      shift_close_day: toInt(st.shiftCloseDay, 'シフトの締め日'),
      shift_pay_day: toInt(st.shiftPayDay, 'シフトの給料日'),
      fuyou_limit: String(st.fuyouLimit),
    }];

    // ---------- カード・バイト先（配列の番号 → ID） ----------
    // 削除済みにする・戻すを共通で扱う
    function keepDeletable(items, baseRows, toFields) {
      const rowsById = byId(baseRows);
      const result = new Map();
      const ids = [];
      let position = nextPosition(baseRows);
      // 1) 今ある行
      items.forEach((item, i) => {
        const row = existing(rowsById, item);
        if (!row) return;
        ids[i] = row.id;
        result.set(row.id, { ...row, ...toFields(item), deleted_at: item._deleted ? (row.deleted_at || now) : null });
      });
      // 2) 新しい記録。削除済みの行と同じ名前なら、その行を戻す
      items.forEach((item, i) => {
        if (ids[i]) return;
        const fields = toFields(item);
        const dead = item._deleted ? null : [...result.values()].find(r => r.deleted_at && r.name === fields.name);
        if (dead) {
          result.set(dead.id, { ...dead, ...fields, deleted_at: null });
          ids[i] = dead.id;
        } else {
          const row = newRow(position++);
          result.set(row.id, { ...row, ...fields, deleted_at: item._deleted ? now : null });
          ids[i] = row.id;
        }
      });
      // 3) st から消えた行も、削除済みとして残す（記録が参照しているかもしれないため）
      for (const row of baseRows || []) {
        if (!result.has(row.id)) result.set(row.id, { ...row, deleted_at: row.deleted_at || now });
      }
      return { rows: result, ids };
    }

    const cards = keepDeletable(st.cards, base.cards, c => ({
      name: c.name, close_day: toInt(c.closeDay, 'カードの締め日'), bill_day: toInt(c.billDay, 'カードの引き落とし日'),
    }));
    out.cards = [...cards.rows.values()];
    const cardIdAt = (index, label) => {
      const id = cards.ids[index];
      if (!id) throw new Error(`${label}: カード ${index} がありません`);
      return id;
    };

    const jobs = keepDeletable(st.jobs, base.jobs, j => ({
      name: j.name, color: j.color, wage: toInt(j.wage, '時給'),
      night_start: toTime(j.nightStart || '22:00'), night_rate: toInt(j.nightRate ?? 25, '深夜の割増率'),
      transport: toInt(j.transport ?? 0, '交通費'),
      close_day: j.closeDay == null ? null : toInt(j.closeDay, 'バイト先の締め日'),
      pay_day: j.payDay == null ? null : toInt(j.payDay, 'バイト先の給料日'),
    }));
    out.jobs = [...jobs.rows.values()];
    // バイト先を名前から探す。今の参照の名前が変わっていなければ、そのまま
    const jobIdFor = (name, currentId) => {
      const current = currentId && jobs.rows.get(currentId);
      if (current && current.name === name) return currentId;
      const all = [...jobs.rows.values()];
      const found = all.find(r => !r.deleted_at && r.name === name) || all.find(r => r.name === name);
      if (!found) throw new Error(`バイト先「${name}」がありません`);
      return found.id;
    };

    // ---------- カテゴリ（catExp・catInc の名前の並び） ----------
    const categories = new Map((base.categories || []).map(r => [r.id, { ...r }]));
    const nextCategoryPosition = kind => nextPosition([...categories.values()].filter(r => r.kind === kind));
    for (const [kind, names] of [['expense', st.catExp || []], ['income', st.catInc || []]]) {
      const listed = new Set();
      for (const name of names) {
        const all = [...categories.values()].filter(r => r.kind === kind && r.name === name);
        const active = all.find(r => !r.deleted_at && !listed.has(r.id));
        if (active) { listed.add(active.id); continue; }
        const dead = all.find(r => r.deleted_at);
        if (dead) {
          categories.set(dead.id, { ...dead, deleted_at: null, position: nextCategoryPosition(kind) });
          listed.add(dead.id);
          continue;
        }
        const row = { ...newRow(nextCategoryPosition(kind)), kind, name, deleted_at: null };
        categories.set(row.id, row);
        listed.add(row.id);
      }
      // 一覧から消したカテゴリは、削除済みにする
      for (const row of categories.values()) {
        if (row.kind === kind && !row.deleted_at && !listed.has(row.id)) categories.set(row.id, { ...row, deleted_at: now });
      }
    }
    // 記録のカテゴリを名前から探す。一覧にない名前は、削除済みのカテゴリとして作る
    const categoryIdFor = (kind, name, currentId) => {
      const current = currentId && categories.get(currentId);
      if (current && current.kind === kind && current.name === name) return currentId;
      const all = [...categories.values()].filter(r => r.kind === kind && r.name === name);
      const found = all.find(r => !r.deleted_at) || all[0];
      if (found) return found.id;
      const row = { ...newRow(nextCategoryPosition(kind)), kind, name, deleted_at: now };
      categories.set(row.id, row);
      return row.id;
    };

    // ---------- 家計簿 ----------
    const ledgerRows = byId(base.ledger_entries);
    let ledgerPosition = nextPosition(base.ledger_entries);
    out.ledger_entries = (st.ledger || []).map(l => {
      const row = existing(ledgerRows, l) || newRow(ledgerPosition++);
      const kind = l.type;
      const byCard = kind === 'expense' && l.cardIdx != null && l.cardIdx >= 0;
      return {
        ...row,
        date: l.date, kind, amount: toInt(l.amount, '金額'), name: l.name, memo: l.memo ?? '',
        category_id: categoryIdFor(kind, l.cat, row.category_id),
        // 収入で受け取り方法がないものは、今のアプリの残高の計算と同じく口座
        payment_method: kind === 'expense' ? (byCard ? 'card' : 'cash') : (l.receive === '現金' ? 'cash' : 'bank'),
        card_id: byCard ? cardIdAt(l.cardIdx, '家計簿') : null,
      };
    });
    out.categories = [...categories.values()];

    // ---------- シフト ----------
    const shiftRows = byId(base.shifts);
    let shiftPosition = nextPosition(base.shifts);
    out.shifts = (st.shifts || []).map(s => {
      const row = existing(shiftRows, s) || newRow(shiftPosition++);
      return {
        ...row,
        date: s.date, job_id: jobIdFor(s.job, row.job_id),
        start_time: toTime(s.start), end_time: toTime(s.end),
        wage: toInt(s.wage, 'シフトの時給'), rest_minutes: toInt(s.rest || 0, '休憩'),
      };
    });

    // ---------- 予定 ----------
    const planRows = byId(base.plans);
    let planPosition = nextPosition(base.plans);
    out.plans = (st.plans || []).map(p => {
      const row = existing(planRows, p) || newRow(planPosition++);
      const start = p.dateStart || p.date;
      return {
        ...row,
        title: p.title, start_date: start, end_date: p.dateEnd || start,
        start_time: toTime(p.timeStart), end_time: p.timeStart ? toTime(p.timeEnd) : null,
        budget: toInt(p.budget || 0, '予定の予算'), done: !!p.done, memo: p.memo ?? '', color: p.color,
        card_id: p.planCardIdx != null && p.planCardIdx >= 0 ? cardIdAt(p.planCardIdx, '予定') : null,
        legacy_id: row.legacy_id ?? null,
      };
    });

    // ---------- 固定費（pay: bank・cash・card-<番号>・income） ----------
    const fixedRows = byId(base.fixed_costs);
    let fixedPosition = nextPosition(base.fixed_costs);
    out.fixed_costs = (st.fixedCosts || []).map(f => {
      const row = existing(fixedRows, f) || newRow(fixedPosition++);
      const card = /^card-(\d+)$/.exec(f.pay || '');
      return {
        ...row,
        name: f.name, amount: toInt(f.amount, '固定費の金額'), day: toInt(f.day, '固定費の日'), kind: f.type,
        payment_method: f.type === 'income' ? null : card ? 'card' : f.pay,
        card_id: f.type !== 'income' && card ? cardIdAt(Number(card[1]), '固定費') : null,
        legacy_id: row.legacy_id ?? null,
      };
    });

    // ---------- 固定収入・引き出し ----------
    const incomeRows = byId(base.fixed_incomes);
    let incomePosition = nextPosition(base.fixed_incomes);
    out.fixed_incomes = (st.fixedIncs || []).map(f => ({
      ...(existing(incomeRows, f) || newRow(incomePosition++)),
      name: f.name, amount: toInt(f.amount, '固定収入の金額'), day: toInt(f.day, '固定収入の日'),
    }));

    const withdrawalRows = byId(base.withdrawals);
    let withdrawalPosition = nextPosition(base.withdrawals);
    out.withdrawals = (st.wds || []).map(w => ({
      ...(existing(withdrawalRows, w) || newRow(withdrawalPosition++)),
      date: w.date, amount: toInt(w.amount, '引き出しの金額'),
    }));

    // ---------- 実績（2つのテーブルで position を共通にする） ----------
    // _id がない記録でも、同じキー（カードと引き落としの月、バイト先と支払月）の行があれば、その行の更新にする
    const cardBillRows = byId(base.card_bill_actuals);
    const salaryRows = byId(base.salary_actuals);
    let actualPosition = Math.max(nextPosition(base.card_bill_actuals), nextPosition(base.salary_actuals));
    out.card_bill_actuals = [];
    out.salary_actuals = [];
    for (const a of st.actualInputs || []) {
      if (a.type === 'card') {
        const card_id = cardIdAt(a.cardIdx, 'カードの実績');
        const bill_month = `${a.billY}-${pad2(a.billM + 1)}-01`;
        const row = existing(cardBillRows, a)
          || existing(cardBillRows, { _id: (base.card_bill_actuals || []).find(r => r.card_id === card_id && r.bill_month === bill_month)?.id })
          || newRow(actualPosition++);
        out.card_bill_actuals.push({
          ...row, card_id, bill_month,
          actual_amount: toInt(a.actualAmount, 'カードの実額'), estimated_amount: toInt(a.estimatedAmount, 'カードの見込み額'),
        });
      } else if (a.type === 'shift') {
        const pay_month = `${a.salaryKey.slice(-7)}-01`;
        const current = existing(salaryRows, a);
        const job_id = jobIdFor(a.job, current && current.job_id);
        const row = current
          || existing(salaryRows, { _id: (base.salary_actuals || []).find(r => r.job_id === job_id && r.pay_month === pay_month)?.id })
          || newRow(actualPosition++);
        out.salary_actuals.push({
          ...row, job_id, pay_month, paid_on: a.date,
          actual_amount: toInt(a.actualAmount, '給与の実額'), estimated_amount: toInt(a.estimatedAmount, '給与の見込み額'),
        });
      } else {
        throw new Error(`実績の種類が違います: ${a.type}`);
      }
    }

    return out;
  }

  const MoneyCompat = { rowsToSt, stripMeta, createdMs, stToRows };
  root.MoneyCompat = MoneyCompat;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyCompat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
