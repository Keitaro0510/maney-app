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
// js/ の画面からは window.MoneyCompat で使う（src/main.ts。D17）
import type { Row, Rows } from './data.ts';
import type { CardBillActualRow, CategoryRow, DbRows, LedgerEntryRow, PlanRow, SalaryActualRow, ShiftRow } from './rows.ts';

// ---------- 互換の st の形 ----------
/** 元の行の id（_id）と、削除済みか（_deleted） */
type Meta = { _id?: string; _deleted?: boolean };
export type StCard = Meta & { name: string; closeDay: string; billDay: string };
export type StJob = Meta & {
  name: string; wage?: number; color?: string; nightStart?: string; nightRate?: number; transport?: number; closeDay?: number; payDay?: number;
};
export type StLedger = Meta & {
  date: string; amount: number; name: string; cat: string; type: string; pay: string; memo?: string; cardIdx?: number; receive?: string;
};
export type StShift = Meta & { job: string; date: string; start: string | null; end: string | null; rest: number; wage: number };
export type StPlan = Meta & {
  id: number; title: string; date: string; dateStart: string; dateEnd: string; timeStart: string; timeEnd: string;
  budget?: number; memo?: string; color?: string; done?: boolean; planCardIdx?: number;
};
export type StWithdrawal = Meta & { date: string; amount: number };
export type StCardActual = Meta & {
  type: 'card'; cardKey: string; cardIdx: number | undefined; billY: number; billM: number; actualAmount: number; estimatedAmount: number;
};
export type StShiftActual = Meta & { type: 'shift'; job: string; salaryKey: string; date: string; actualAmount: number; estimatedAmount: number };
export type St = {
  acctBase: number; baseDate: string; budget: number; otherIncome: number; shiftCloseDay: number; shiftPayDay: number; fuyouLimit: string;
  cards: StCard[]; jobs: StJob[]; catExp: string[]; catInc: string[]; ledger: StLedger[]; shifts: StShift[]; plans: StPlan[];
  wds: StWithdrawal[]; actualInputs: (StCardActual | StShiftActual)[];
};

// position, id の順（DB の読み込みと同じ）
const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }): number =>
  (a.position - b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = <T extends { position: number; id: string }>(list: T[] | undefined): T[] => [...(list || [])].sort(byPosition);

// '10:00:00' → '10:00'
const hhmm = (t: string | null | undefined): string | null => (t == null ? null : t.slice(0, 5));

// 登録日時をミリ秒にする（DB の (extract(epoch from created_at) * 1000)::bigint と同じく、マイクロ秒を四捨五入）
export function createdMs(ts: string): number {
  const m = /\.(\d+)/.exec(ts);
  const micro = m ? Number((m[1] + '000000').slice(0, 6)) : 0;
  return Date.parse(ts.replace(/\.\d+/, '')) + Math.round(micro / 1000);
}

// jsonb_strip_nulls と同じ（値が null・undefined の項目を消す）
function stripNulls<T extends object>(obj: T): T {
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
  return obj;
}

// 互換の st の記録に、元の行の情報を持たせる
function withMeta<T extends object>(item: T, row: { id: string; deleted_at?: string | null }): T & Meta {
  const out = item as T & Meta;
  out._id = row.id;
  if (row.deleted_at) out._deleted = true;
  return out;
}

// テーブルの行（{settings: [...], cards: [...], ...}）から、互換の st を組み立てる。
// 設定の行がなければ null を返す（まだ移行していない）。
// 参照先（カテゴリ・バイト先・カード）は DB の外部キーで必ずある（なければ前の js/compat.js と同じく、ここで止まる）
export function rowsToSt(rows: DbRows): St | null {
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

  type Actual = { row: CardBillActualRow; kindOrder: 0 } | { row: SalaryActualRow; kindOrder: 1 };
  const actuals: Actual[] = [
    ...(rows.card_bill_actuals || []).map(a => ({ row: a, kindOrder: 0 as const })),
    ...(rows.salary_actuals || []).map(a => ({ row: a, kindOrder: 1 as const })),
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
    }), j) as StJob),

    // カテゴリの一覧には削除済みを含めない（記録には名前だけが残る）
    catExp: categories.filter(c => c.kind === 'expense' && !c.deleted_at).map(c => c.name),
    catInc: categories.filter(c => c.kind === 'income' && !c.deleted_at).map(c => c.name),

    ledger: sorted(rows.ledger_entries).map(l => {
      const card = l.card_id ? cardById.get(l.card_id) : null;
      return withMeta(stripNulls({
        date: l.date, amount: l.amount, name: l.name, cat: categoryById.get(l.category_id)!.name, type: l.kind,
        // 口座から直接払う支出（D11）は「口座」。収入は今までどおり「現金」（受け取り方は receive）
        pay: l.payment_method === 'card' ? card!.name : (l.kind === 'expense' && l.payment_method === 'bank') ? '口座' : '現金',
        memo: l.memo,
        cardIdx: card ? cardIndex.get(card.id) : null,
        receive: l.kind === 'income' ? (l.payment_method === 'bank' ? '口座振込' : '現金') : null,
      }), l) as StLedger;
    }),

    shifts: sorted(rows.shifts).map(s => withMeta({
      job: jobById.get(s.job_id)!.name, date: s.date,
      start: hhmm(s.start_time), end: hhmm(s.end_time), rest: s.rest_minutes, wage: s.wage,
    }, s)),

    plans: sorted(rows.plans).map(p => withMeta(stripNulls({
      id: p.legacy_id != null ? p.legacy_id : createdMs(p.created_at!),
      title: p.title,
      date: p.start_date, dateStart: p.start_date, dateEnd: p.end_date,
      timeStart: hhmm(p.start_time) || '', timeEnd: hhmm(p.end_time) || '',
      budget: p.budget, memo: p.memo, color: p.color, done: p.done,
      planCardIdx: p.card_id ? cardIndex.get(p.card_id) : null,
    }), p) as StPlan),

    // 固定費（毎月のお金）は st に入れない。画面が行を直接読み書きする（D14。js/monthly-ui.js）。
    // 固定収入（fixed_incomes）は固定費の「収入」にまとめた

    wds: sorted(rows.withdrawals).map(w => withMeta({ date: w.date, amount: w.amount }, w)),

    actualInputs: actuals.map((x): StCardActual | StShiftActual => x.kindOrder === 0
      ? withMeta({
        type: 'card' as const,
        cardKey: `card-${cardIndex.get(x.row.card_id)}-${x.row.bill_month.slice(0, 7)}`,
        cardIdx: cardIndex.get(x.row.card_id),
        billY: Number(x.row.bill_month.slice(0, 4)),
        billM: Number(x.row.bill_month.slice(5, 7)) - 1,
        actualAmount: x.row.actual_amount,
        estimatedAmount: x.row.estimated_amount,
      }, x.row)
      : withMeta({
        type: 'shift' as const,
        job: jobById.get(x.row.job_id)!.name,
        salaryKey: `${jobById.get(x.row.job_id)!.name}|${x.row.pay_month.slice(0, 7)}`,
        date: x.row.paid_on,
        actualAmount: x.row.actual_amount,
        estimatedAmount: x.row.estimated_amount,
      }, x.row)),
  };
}

// 互換の st から、行の情報（_id など）を除いた、今の JSON の形を返す（照らし合わせに使う）
export function stripMeta(st: unknown): unknown {
  return JSON.parse(JSON.stringify(st, (k, v) => (k.startsWith('_') ? undefined : v)));
}

// ============================================================
// 逆向き: 画面で変えた互換の st → テーブルの行
// ============================================================

const pad2 = (n: number): string => String(n).padStart(2, '0');

// 'HH:MM' → 'HH:MM:SS'（DB の time の形にそろえる）。空なら null
const toTime = (t: string | null | undefined): string | null => (t ? (t.length === 5 ? `${t}:00` : t) : null);

// 数値にする。数値にできなければエラー（DB に変な値を送らない）。
// parseInt(String(value), 10) は parseInt(value, 10) と同じ（parseInt は中で文字に直す）
function toInt(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw new Error(`${label} が数値ではありません: ${value}`);
  return n;
}

const nextPosition = (list: { position?: unknown }[] | undefined): number =>
  (list || []).reduce((max, r) => Math.max(max, r.position as number), -1) + 1;

/** 組み立て中の行（中身はテーブルによって違う） */
type Built = Row & { position?: number; name?: unknown; kind?: unknown; deleted_at?: unknown };

// 互換の st を、テーブルの行に戻す。base は今の行（サーバーの写しに送信待ちを重ねたもの）。
// - st の記録の _id で、どの行かを見分ける。_id がない記録は新しい行（id を作る）
// - 参照（カード・バイト先・カテゴリ）は ID にする。名前で参照している記録は、名前が変わっていなければ今の参照のまま
// - カード・バイト先・カテゴリは消さず、削除済み（deleted_at）にする。削除済みと同じ名前で追加したら、その行を戻す
// - 行の並び（position）は今の行のまま。新しい行は最後に付ける
// options: { newId: () => uuid, now: ISO の日時 }
export function stToRows(st: St, base: DbRows, options: { newId: () => string; now: string }): Rows {
  const { newId, now } = options;
  const byId = <T extends { id: string }>(list: T[] | undefined): Map<string, T> => new Map((list || []).map(r => [r.id, r]));
  const out: Rows = {};

  // 同じ _id が2回出てきたら、2回目は新しい行として扱う（同じ行を二重に作らない）
  const usedIds = new Set<string>();
  const existing = <T extends { id: string }>(rowsById: Map<string, T>, item: Meta | null | undefined): T | null => {
    const row = item && item._id ? rowsById.get(item._id) : null;
    if (!row || usedIds.has(row.id)) return null;
    usedIds.add(row.id);
    return row;
  };
  const newRow = (position: number): { id: string; position: number; created_at: string } => {
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
  function keepDeletable<I extends Meta, R extends Built>(items: I[], baseRows: R[] | undefined, toFields: (item: I) => { name: string } & Record<string, unknown>): { rows: Map<string, Built>; ids: string[] } {
    const rowsById = byId(baseRows);
    const result = new Map<string, Built>();
    const ids: string[] = [];
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
  const cardIdAt = (index: number, label: string): string => {
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
  const jobIdFor = (name: string, currentId: string | null | undefined): string => {
    const current = currentId && jobs.rows.get(currentId);
    if (current && current.name === name) return currentId;
    const all = [...jobs.rows.values()];
    const found = all.find(r => !r.deleted_at && r.name === name) || all.find(r => r.name === name);
    if (!found) throw new Error(`バイト先「${name}」がありません`);
    return found.id;
  };

  // ---------- カテゴリ（catExp・catInc の名前の並び） ----------
  const categories = new Map<string, Built>((base.categories || []).map((r: CategoryRow) => [r.id, { ...r }]));
  const nextCategoryPosition = (kind: string): number => nextPosition([...categories.values()].filter(r => r.kind === kind));
  for (const [kind, names] of [['expense', st.catExp || []], ['income', st.catInc || []]] as const) {
    const listed = new Set<string>();
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
  const categoryIdFor = (kind: string, name: string, currentId: unknown): string => {
    const current = typeof currentId === 'string' && currentId ? categories.get(currentId) : undefined;
    if (current && current.kind === kind && current.name === name) return currentId as string;
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
    const row: Partial<LedgerEntryRow> & { id: string } = existing(ledgerRows, l) || newRow(ledgerPosition++);
    const kind = l.type;
    const byCard = kind === 'expense' && l.cardIdx != null && l.cardIdx >= 0;
    return {
      ...row,
      date: l.date, kind, amount: toInt(l.amount, '金額'), name: l.name, memo: l.memo ?? '',
      category_id: categoryIdFor(kind, l.cat, row.category_id),
      // 収入で受け取り方法がないものは、今のアプリの残高の計算と同じく口座
      payment_method: kind === 'expense' ? (byCard ? 'card' : l.pay === '口座' ? 'bank' : 'cash') : (l.receive === '現金' ? 'cash' : 'bank'),
      card_id: byCard ? cardIdAt(l.cardIdx!, '家計簿') : null,
    };
  });
  out.categories = [...categories.values()];

  // ---------- シフト ----------
  const shiftRows = byId(base.shifts);
  let shiftPosition = nextPosition(base.shifts);
  out.shifts = (st.shifts || []).map(s => {
    const row: Partial<ShiftRow> & { id: string } = existing(shiftRows, s) || newRow(shiftPosition++);
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
    const row: Partial<PlanRow> & { id: string } = existing(planRows, p) || newRow(planPosition++);
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

  // ---------- 引き出し（固定費は st を通さない。D14） ----------
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
      const card_id = cardIdAt(a.cardIdx!, 'カードの実績');
      const bill_month = `${a.billY}-${pad2(a.billM + 1)}-01`;
      const row: Partial<CardBillActualRow> & { id: string } = existing(cardBillRows, a)
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
      const row: Partial<SalaryActualRow> & { id: string } = current
        || existing(salaryRows, { _id: (base.salary_actuals || []).find(r => r.job_id === job_id && r.pay_month === pay_month)?.id })
        || newRow(actualPosition++);
      out.salary_actuals.push({
        ...row, job_id, pay_month, paid_on: a.date,
        actual_amount: toInt(a.actualAmount, '給与の実額'), estimated_amount: toInt(a.estimatedAmount, '給与の見込み額'),
      });
    } else {
      throw new Error(`実績の種類が違います: ${(a as { type: unknown }).type}`);
    }
  }

  return out;
}
