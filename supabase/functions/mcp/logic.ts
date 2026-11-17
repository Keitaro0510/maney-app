// Claude から予定・タスクを入れる・変える MCP の、DB や MCP に触れない部分（Issue #190・D37）。
// npm:・jsr: の import を持たない（Node のテストが、そのまま読めるように）。tests/mcp-logic.test.mjs。
// 文面は、責めずに、確かめやすい言い方にする（D33）。

export type Row = Record<string, unknown>;
export type CardRef = { id: string; name: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

/** アプリの新しい予定の色（src/screens/plans.ts の既定と同じ）。Claude からは指定しない（D37） */
export const PLAN_DEFAULT_COLOR = 'pink';
export const MAX_BUDGET = 10_000_000;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---------------- 日付・時刻 ----------------

/** 実在する日付か（'YYYY-MM-DD'。2月30日などは false） */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 'HH:MM' か（24時間。秒は受けない） */
export const isValidTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** DB の time（'HH:MM:SS'）を 'HH:MM' にする。なければ null */
export const hm = (t: unknown): string | null => (typeof t === 'string' && t ? t.slice(0, 5) : null);

const dayMs = (ds: string): number => { const [y, m, d] = ds.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const dsOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** ds に n 日足した日付 */
export const addDays = (ds: string, n: number): string => dsOf(dayMs(ds) + n * 86400000);
/** 日本時間の今日（'YYYY-MM-DD'） */
export const todayJst = (now: Date = new Date()): string => dsOf(now.getTime() + 9 * 3600000);
/** 曜日（'日'〜'土'） */
export const weekdayOf = (ds: string): string => DAYS[new Date(dayMs(ds)).getUTCDay()];

/** 時刻の言い方: '09:00' → '9時'、'09:30' → '9時30分' */
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return m ? `${h}時${m}分` : `${h}時`;
}
const yen = (n: number): string => `¥${n.toLocaleString('ja-JP')}`;

// ---------------- 文字・タグ・カード ----------------

/** 比べるための正規化（全角半角・大文字小文字・前後の空白を無視） */
export const norm = (s: string): string => s.normalize('NFKC').trim().toLowerCase();

/** タグを整える: 前後の空白を除く・空を捨てる・重複を除く。多すぎる・長すぎるものは誤り */
export function normalizeTags(tags: string[]): Result<string[]> {
  const out = [...new Set(tags.map(t => t.normalize('NFKC').trim()).filter(Boolean))];
  if (out.length > MAX_TAGS) return fail(`タグは${MAX_TAGS}個までです`);
  if (out.some(t => [...t].length > MAX_TAG_LENGTH)) return fail(`タグは1つ${MAX_TAG_LENGTH}文字までです`);
  return ok(out);
}

/** 名前から、1つ選ぶ（カード・バイト先）。完全に同じ名前が優先。なければ、名前の一部が合うものが1つだけのとき。ないときは、登録の一覧を教える */
function resolveNamed<T extends { name: string }>(items: T[], name: string, label: string): Result<T> {
  const want = norm(name);
  const names = items.length ? items.map(c => `「${c.name}」`).join('、') : `（${label}が登録されていません）`;
  const exact = items.filter(c => norm(c.name) === want);
  if (exact.length === 1) return ok(exact[0]);
  const partial = items.filter(c => want && norm(c.name).includes(want));
  if (partial.length === 1) return ok(partial[0]);
  if (partial.length > 1) return fail(`「${name}」に合う${label}が複数あります（${partial.map(c => `「${c.name}」`).join('、')}）。どれか教えてください`);
  return fail(`${label}「${name}」が見つかりません。登録されている${label}: ${names}`);
}
export const resolveCard = (cards: CardRef[], name: string): Result<CardRef> => resolveNamed(cards, name, 'カード');

// ---------------- 予定 ----------------

export type PlanInput = {
  title: string; start_date: string; end_date?: string;
  start_time?: string | null; end_time?: string | null;
  budget?: number; payment?: 'cash' | 'card'; card?: string; memo?: string;
};
export type PlanPatch = Partial<PlanInput> & { done?: boolean };

function checkPlanShape(row: { title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; budget: number; memo: string }): string | null {
  if (!row.title.trim()) return 'タイトルが空です';
  if (!isValidDate(row.start_date)) return `日付が正しくありません（${row.start_date}）。YYYY-MM-DD の形で、実在する日にしてください`;
  if (!isValidDate(row.end_date)) return `終わりの日が正しくありません（${row.end_date}）`;
  if (row.end_date < row.start_date) return `終わりの日（${row.end_date}）が、はじめの日（${row.start_date}）より前です`;
  if (row.start_time !== null && !isValidTime(row.start_time)) return `開始時刻が正しくありません（${row.start_time}）。HH:MM の形にしてください`;
  if (row.end_time !== null && !isValidTime(row.end_time)) return `終了時刻が正しくありません（${row.end_time}）。HH:MM の形にしてください`;
  if (row.end_time !== null && row.start_time === null) return '終了時刻だけの指定はできません。開始時刻も指定してください';
  if (!Number.isInteger(row.budget) || row.budget < 0 || row.budget > MAX_BUDGET) return `予算は 0〜${MAX_BUDGET.toLocaleString()} 円の整数にしてください`;
  return null;
}

/** 払い方から card_id を決める。payment が cash なら null。card なら、カード名で選ぶ（名前がなく、元のカードがあれば、それを使う） */
function resolvePayment(payment: 'cash' | 'card' | undefined, cardName: string | undefined, current: string | null, cards: CardRef[]): Result<string | null> {
  if (payment === 'cash') return cardName ? fail('現金払い（cash）とカードの名前は、同時には指定できません') : ok(null);
  if (cardName) {
    if (payment === undefined || payment === 'card') { const c = resolveCard(cards, cardName); return c.ok ? ok(c.value.id) : c; }
  }
  if (payment === 'card') {
    if (current) return ok(current);
    return fail(`カードで払う予定です。どのカードか教えてください（登録されているカード: ${cards.map(c => `「${c.name}」`).join('、') || 'なし'}）`);
  }
  return ok(current);
}

/** 新しい予定の行（apply_op の insert の row）を作る */
export function buildNewPlan(input: PlanInput, cards: CardRef[], position: number): Result<Row> {
  const row = {
    title: input.title.trim(), start_date: input.start_date, end_date: input.end_date ?? input.start_date,
    start_time: input.start_time ?? null, end_time: input.end_time ?? null, budget: input.budget ?? 0, memo: (input.memo ?? '').trim(),
  };
  const bad = checkPlanShape(row);
  if (bad) return fail(bad);
  const card = resolvePayment(input.payment, input.card, null, cards);
  if (!card.ok) return card;
  return ok({ ...row, done: false, color: PLAN_DEFAULT_COLOR, card_id: card.value, position });
}

/** 予定を変える。変えた列だけを返す。はじめの日だけを変えて、終わりの日を指定しないときは、期間の長さを保って終わりの日もずらす。
 *  開始時刻を消すときは、終了時刻も消す（DB の制約） */
export function buildPlanUpdate(current: Row, patch: PlanPatch, cards: CardRef[]): Result<{ changes: Row; merged: Row }> {
  const cur = {
    title: String(current.title), start_date: String(current.start_date), end_date: String(current.end_date),
    start_time: hm(current.start_time), end_time: hm(current.end_time), budget: Number(current.budget), memo: String(current.memo ?? ''),
    done: Boolean(current.done), card_id: (current.card_id as string | null) ?? null,
  };
  const start_date = patch.start_date ?? cur.start_date;
  let end_date = patch.end_date ?? cur.end_date;
  if (patch.start_date !== undefined && patch.end_date === undefined && isValidDate(patch.start_date) && isValidDate(cur.start_date) && isValidDate(cur.end_date)) {
    end_date = addDays(patch.start_date, (dayMs(cur.end_date) - dayMs(cur.start_date)) / 86400000);
  }
  const start_time = patch.start_time !== undefined ? patch.start_time : cur.start_time;
  // 終了時刻の指定があればそれ（開始時刻がなければ、checkPlanShape が誤りにする）。なければ、開始時刻を消したときだけ、元の終了時刻も消す
  const end_time = patch.end_time !== undefined ? patch.end_time : start_time === null ? null : cur.end_time;
  const next = {
    title: patch.title !== undefined ? patch.title.trim() : cur.title, start_date, end_date, start_time, end_time,
    budget: patch.budget ?? cur.budget, memo: patch.memo !== undefined ? patch.memo.trim() : cur.memo,
  };
  const bad = checkPlanShape(next);
  if (bad) return fail(bad);
  const card = resolvePayment(patch.payment, patch.card, cur.card_id, cards);
  if (!card.ok) return card;
  const merged: Row = { ...next, done: patch.done ?? cur.done, card_id: card.value };
  const changes: Row = {};
  const before: Row = { ...cur };
  for (const k of Object.keys(merged)) if (merged[k] !== before[k]) changes[k] = merged[k];
  return ok({ changes, merged });
}

/** 同じタイトル・同じ日の予定が、すでにあるか（二重に入れないため。比べるのは、はじめの日） */
export function findDuplicatePlan(existing: Row[], title: string, start_date: string): Row | null {
  const t = norm(title);
  return existing.find(p => norm(String(p.title)) === t && String(p.start_date) === start_date) ?? null;
}

// ---------------- タスク ----------------

export type TaskInput = { title: string; due_date?: string | null; memo?: string; tags?: string[] };
export type TaskPatch = Partial<TaskInput>;

export function buildNewTask(input: TaskInput, position: number): Result<Row> {
  const title = input.title.trim();
  if (!title) return fail('タイトルが空です');
  const due = input.due_date ?? null;
  if (due !== null && !isValidDate(due)) return fail(`期限が正しくありません（${due}）。YYYY-MM-DD の形で、実在する日にしてください`);
  const tags = normalizeTags(input.tags ?? []);
  if (!tags.ok) return tags;
  return ok({ title, due_date: due, memo: (input.memo ?? '').trim(), tags: tags.value, position, completed_at: null });
}

/** タスクを変える。変えた列だけを返す。期限に null を渡すと、期限なしにする */
export function buildTaskUpdate(current: Row, patch: TaskPatch): Result<{ changes: Row; merged: Row }> {
  const cur = { title: String(current.title), due_date: (current.due_date as string | null) ?? null, memo: String(current.memo ?? ''), tags: ((current.tags as string[] | null) ?? []) };
  const title = patch.title !== undefined ? patch.title.trim() : cur.title;
  if (!title) return fail('タイトルが空です');
  const due = patch.due_date !== undefined ? patch.due_date : cur.due_date;
  if (due !== null && !isValidDate(due)) return fail(`期限が正しくありません（${due}）。YYYY-MM-DD の形で、実在する日にしてください`);
  const tags = patch.tags !== undefined ? normalizeTags(patch.tags) : ok(cur.tags);
  if (!tags.ok) return tags;
  const merged: Row = { title, due_date: due, memo: patch.memo !== undefined ? patch.memo.trim() : cur.memo, tags: tags.value };
  const changes: Row = {};
  for (const k of Object.keys(merged)) {
    const a = JSON.stringify(merged[k]), b = JSON.stringify((cur as Row)[k]);
    if (a !== b) changes[k] = merged[k];
  }
  return ok({ changes, merged });
}

/** 同じタイトル・同じ期限の、まだ終えていないタスクが、すでにあるか */
export function findDuplicateTask(existing: Row[], title: string, due_date: string | null): Row | null {
  const t = norm(title);
  return existing.find(x => !x.completed_at && norm(String(x.title)) === t && ((x.due_date as string | null) ?? null) === due_date) ?? null;
}

// ---------------- 返す内容 ----------------

/** 予定を、Claude が読みやすい形にする（時刻は HH:MM、カードは名前） */
export function formatPlan(row: Row, cards: CardRef[]): Row {
  const card = cards.find(c => c.id === row.card_id);
  return {
    id: row.id, title: row.title, start_date: row.start_date, end_date: row.end_date,
    start_time: hm(row.start_time), end_time: hm(row.end_time), budget: row.budget,
    payment: row.card_id ? 'card' : 'cash', card: card?.name ?? null, done: row.done, memo: row.memo, updated_at: row.updated_at,
  };
}

export function formatTask(row: Row): Row {
  return { id: row.id, title: row.title, due_date: row.due_date ?? null, done: !!row.completed_at, completed_at: row.completed_at ?? null, memo: row.memo, tags: row.tags ?? [], updated_at: row.updated_at };
}

/** 予定の1行の説明（確認用）: 2026-11-20（金）19時〜20時30分「飲み会」予算 ¥4,000・カード「楽天」 */
export function describePlan(p: Row): string {
  const start = String(p.start_date), end = String(p.end_date);
  const date = start === end ? `${start}（${weekdayOf(start)}）` : `${start}（${weekdayOf(start)}）〜${end}（${weekdayOf(end)}）`;
  const st = hm(p.start_time), et = hm(p.end_time);
  const time = st ? (et ? `${fmtTime(st)}〜${fmtTime(et)}` : `${fmtTime(st)}から`) : '終日';
  const budget = Number(p.budget) > 0 ? ` 予算 ${yen(Number(p.budget))}` : '';
  const pay = p.payment === 'card' ? `・カード${p.card ? `「${p.card}」` : ''}` : Number(p.budget) > 0 ? '・現金' : '';
  return `${date} ${time}「${p.title}」${budget}${pay}${p.done ? '（済み）' : ''}`;
}

export function describeTask(t: Row): string {
  const due = t.due_date ? `期限 ${t.due_date}（${weekdayOf(String(t.due_date))}）` : '期限なし';
  return `「${t.title}」${due}${t.done ? '（済み）' : ''}`;
}

/** apply_op の結果が競合・移行の番号の違いなどのとき、その旨の文面にする。成功なら null */
export function applyOpProblem(result: unknown): string | null {
  const r = result as { status?: string; conflicts?: { reason?: string }[] } | null;
  if (!r || r.status === 'applied') return null;
  if (r.status === 'stale_epoch') return 'データの移行があったため保存できませんでした。アプリを開き直してから、もう一度お願いします';
  if (r.status === 'conflict') {
    const reasons = new Set((r.conflicts ?? []).map(c => c.reason));
    if (reasons.has('missing')) return 'その項目は、すでに削除されています（アプリや別の操作で消されました）。一覧を取り直してください';
    if (reasons.has('changed')) return 'その項目は、あとからアプリなどで変更されています。一覧を取り直して、最新の内容で、もう一度お願いします';
    if (reasons.has('exists')) return '同じ項目がすでにあります。もう一度お願いします';
    return '保存できませんでした（競合）。一覧を取り直して、もう一度お願いします';
  }
  return `保存できませんでした（${String(r.status)}）`;
}

// ---------------- シフト（読むだけ） ----------------

export type JobRef = { id: string; name: string };
/** バイト先（時給つき。シフトを作るとき、その日の時給としてコピーする）。時給は、Claude には返さない */
export type JobFull = JobRef & { wage: number };
export const resolveJob = (jobs: JobFull[], name: string): Result<JobFull> => resolveNamed(jobs, name, 'バイト先');

const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** 実働の時間（時間。休憩を引く。終わりが開始より前なら、日をまたぐシフト＝翌日の終わり）。小数第2位まで */
export function shiftHours(start: string, end: string, restMinutes: number): number {
  const s = toMin(start), e = toMin(end);
  const span = e > s ? e - s : e + 24 * 60 - s;
  return Math.round((Math.max(0, span - restMinutes) / 60) * 100) / 100;
}

/** シフトを、Claude が読みやすい形にする。時給は出さない（金額の情報は、ツールの対象外） */
export function formatShift(row: Row, jobs: JobRef[]): Row {
  const start = hm(row.start_time) ?? '', end = hm(row.end_time) ?? '';
  const rest = Number(row.rest_minutes) || 0;
  return {
    id: row.id, date: row.date, weekday: weekdayOf(String(row.date)), job: jobs.find(j => j.id === row.job_id)?.name ?? null,
    start_time: start, end_time: end, overnight: toMin(end) <= toMin(start), rest_minutes: rest, hours: shiftHours(start, end, rest),
  };
}

/** シフトの1行の説明: 2026-11-20（金）カフェ 17時〜22時（休憩30分・実働4.5時間） */
export function describeShift(s: Row): string {
  const rest = Number(s.rest_minutes) > 0 ? `休憩${s.rest_minutes}分・` : '';
  const next = s.overnight ? '（翌日）' : '';
  return `${s.date}（${s.weekday}）${s.job ?? 'バイト先不明'} ${fmtTime(String(s.start_time))}〜${next}${fmtTime(String(s.end_time))}（${rest}実働${s.hours}時間）`;
}

// ---------------- シフト（追加・変更・削除） ----------------

export type ShiftInput = { job: string; date: string; start_time: string; end_time: string; rest_minutes?: number };
export type ShiftPatch = Partial<ShiftInput>;
export const MAX_REST_MINUTES = 720;

/** シフトの形の検査。アプリの入力と同じく、終わりは開始より後（日をまたぐシフトは受け付けない）。休憩は、働く時間より短く */
function checkShiftShape(row: { date: string; start_time: string; end_time: string; rest_minutes: number }): string | null {
  if (!isValidDate(row.date)) return `日付が正しくありません（${row.date}）。YYYY-MM-DD の形で、実在する日にしてください`;
  if (!isValidTime(row.start_time)) return `出勤の時刻が正しくありません（${row.start_time}）。HH:MM の形にしてください`;
  if (!isValidTime(row.end_time)) return `退勤の時刻が正しくありません（${row.end_time}）。HH:MM の形にしてください`;
  if (toMin(row.end_time) <= toMin(row.start_time)) return '退勤は、出勤より後の時刻にしてください（日をまたぐシフトは、アプリでも入れられません）';
  if (!Number.isInteger(row.rest_minutes) || row.rest_minutes < 0 || row.rest_minutes > MAX_REST_MINUTES) return `休憩は 0〜${MAX_REST_MINUTES} 分の整数にしてください`;
  if (row.rest_minutes >= toMin(row.end_time) - toMin(row.start_time)) return '休憩が、働く時間と同じか、それより長くなっています';
  return null;
}

/** 新しいシフトの行（apply_op の insert の row）。時給は、バイト先の今の時給をコピーする（アプリと同じ） */
export function buildNewShift(input: ShiftInput, jobs: JobFull[], position: number): Result<Row> {
  const row = { date: input.date, start_time: input.start_time, end_time: input.end_time, rest_minutes: input.rest_minutes ?? 0 };
  const bad = checkShiftShape(row);
  if (bad) return fail(bad);
  const job = resolveJob(jobs, input.job);
  if (!job.ok) return job;
  return ok({ ...row, job_id: job.value.id, wage: job.value.wage, position });
}

/** シフトを変える。変えた列だけを返す。バイト先を変えたときだけ、時給も新しいバイト先のものにする */
export function buildShiftUpdate(current: Row, patch: ShiftPatch, jobs: JobFull[]): Result<{ changes: Row; merged: Row }> {
  const cur = {
    date: String(current.date), start_time: hm(current.start_time) ?? '', end_time: hm(current.end_time) ?? '',
    rest_minutes: Number(current.rest_minutes) || 0, job_id: String(current.job_id), wage: Number(current.wage) || 0,
  };
  const next = {
    date: patch.date ?? cur.date, start_time: patch.start_time ?? cur.start_time, end_time: patch.end_time ?? cur.end_time,
    rest_minutes: patch.rest_minutes ?? cur.rest_minutes,
  };
  const bad = checkShiftShape(next);
  if (bad) return fail(bad);
  let job_id = cur.job_id, wage = cur.wage;
  if (patch.job !== undefined) {
    const job = resolveJob(jobs, patch.job);
    if (!job.ok) return job;
    if (job.value.id !== cur.job_id) { job_id = job.value.id; wage = job.value.wage; }
  }
  const merged: Row = { ...next, job_id, wage };
  const changes: Row = {};
  for (const k of Object.keys(merged)) if (merged[k] !== (cur as Row)[k]) changes[k] = merged[k];
  return ok({ changes, merged });
}

/** 同じバイト先・同じ日・同じ時間のシフトが、すでにあるか */
export function findDuplicateShift(existing: Row[], job_id: string, date: string, start_time: string, end_time: string): Row | null {
  return existing.find(s => s.job_id === job_id && s.date === date && hm(s.start_time) === start_time && hm(s.end_time) === end_time) ?? null;
}
