// Claude から予定・タスクを入れる・変える MCP サーバー（Issue #190・D37）。
// 認証は、Supabase Auth を OAuth 2.1 の認可サーバーにする。この関数は、トークンを確かめて、その人として動く（RLS が効く）。
// 触れるのは、予定（plans）・タスク（tasks）・シフト（shifts）と、カード・バイト先の名前だけ。時給は、Claude に返さない（シフトを作るとき、バイト先の時給をコピーするだけ）。家計簿の記録・残高・設定は、読めない・書けない。
// 書き込みは、アプリと同じ apply_op（履歴・競合の検知・二重保存の防止つき）を通す。削除も履歴に残り、戻せる（docs/db/RESTORE.md）。
// DB や MCP に触れない部分は logic.ts（Node のテストあり）。
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

import {
  addDays, applyOpProblem, buildNewPlan, buildNewTask, buildPlanUpdate, buildTaskUpdate, describePlan, describeTask,
  findDuplicatePlan, findDuplicateTask, formatPlan, formatTask, formatShift, describeShift, buildNewShift, buildShiftUpdate, findDuplicateShift, norm, todayJst, MAX_BUDGET,
  type CardRef, type JobFull, type JobRef, type Row,
} from './logic.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const text = (message: string, data?: unknown) => ({
  content: [{ type: 'text' as const, text: data === undefined ? message : `${message}\n${JSON.stringify(data, null, 2)}` }],
})
const problem = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] })

/** 移行の番号（アプリと同じ。行がなければ 1） */
async function epochOf(db: Db): Promise<number> {
  const { data } = await db.from('sync_state').select('epoch').maybeSingle()
  return (data?.epoch as number | undefined) ?? 1
}

/** apply_op で保存する。成功なら null、だめなら、Claude に返す文面 */
async function applyOp(db: Db, changes: Row[]): Promise<string | null> {
  const { data, error } = await db.rpc('apply_op', { op: { id: crypto.randomUUID(), epoch: await epochOf(db), changes } })
  if (error) return `保存できませんでした: ${error.message}`
  return applyOpProblem(data)
}

async function cardsOf(db: Db): Promise<CardRef[]> {
  const { data, error } = await db.from('cards').select('id, name').is('deleted_at', null).order('position').order('id')
  if (error) throw new Error(error.message)
  return data as CardRef[]
}

/** 使えるバイト先（削除していないもの。時給つき。時給は、シフトを作るときのコピー元で、Claude には返さない） */
async function jobsOf(db: Db): Promise<JobFull[]> {
  const { data, error } = await db.from('jobs').select('id, name, wage').is('deleted_at', null).order('position').order('id')
  if (error) throw new Error(error.message)
  return data as JobFull[]
}

/** 名前を引くためのバイト先（削除済みも。過去のシフトの表示のため） */
async function jobNamesOf(db: Db): Promise<JobRef[]> {
  const { data } = await db.from('jobs').select('id, name')
  return (data as JobRef[]) ?? []
}

async function nextPosition(db: Db, table: 'plans' | 'tasks' | 'shifts'): Promise<number> {
  const { data, error } = await db.from(table).select('position').order('position', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  return ((data?.[0]?.position as number | undefined) ?? -1) + 1
}

async function getRow(db: Db, table: 'plans' | 'tasks' | 'shifts', id: string): Promise<Row | null> {
  const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as Row | null
}

const notFound = (what: string, tool: string): ReturnType<typeof problem> =>
  problem(`その${what}が見つかりません（消されたか、id が違います）。${tool} で、id を確かめてください`)

// ---------------- 入力の形 ----------------
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形で')
const time = z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM の形で（24時間）')
const id = z.string().uuid().describe('list_plans / list_tasks で確かめた id')
const tags = z.array(z.string().min(1).max(60)).max(20)

const PLAN_ASK = '時間（開始・終了）、予算（金額）、払い方（現金かカードか。カードならどのカードか）を、ユーザーが言っていないときは、呼ぶ前に必ず聞くこと。聞いて「なし」「決まっていない」と言われたら、省いて呼ぶ。'

function registerTools(server: McpServer, db: Db): void {
  // ---------- 読む ----------
  server.registerTool('list_cards', {
    description: '登録されているカードの名前の一覧（予定の払い方で、カード払いのときに、どのカードか確かめるため）。',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const cards = await cardsOf(db)
    return text(cards.length ? `カードは ${cards.length} 枚です。` : 'カードは登録されていません。', cards.map(c => c.name))
  })

  server.registerTool('list_plans', {
    description: '予定の一覧（変える・消す・済みにする相手の id を調べるときにも使う）。期間は、その期間に重なる予定。省くと、今日から60日先まで。',
    inputSchema: z.object({
      from: date.optional().describe('この日から（省くと今日）'),
      to: date.optional().describe('この日まで（省くと from の60日後）'),
      query: z.string().max(100).optional().describe('タイトル・メモに含まれる言葉'),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ from, to, query, limit }) => {
    const start = from ?? todayJst()
    const end = to ?? addDays(start, 60)
    const { data, error } = await db.from('plans').select('*').lte('start_date', end).gte('end_date', start)
      .order('start_date').order('start_time', { nullsFirst: true }).limit(200)
    if (error) return problem(`予定を読めませんでした: ${error.message}`)
    const cards = await cardsOf(db)
    const q = query ? norm(query) : ''
    const rows = (data as Row[]).filter(p => !q || norm(`${p.title} ${p.memo}`).includes(q)).slice(0, limit).map(p => formatPlan(p, cards))
    return text(`${start}〜${end} の予定は ${rows.length} 件です。`, rows)
  })

  server.registerTool('list_tasks', {
    description: 'タスクの一覧（変える・消す・済みにする相手の id を調べるときにも使う）。省くと、まだ終えていないタスクを、期限の近い順に。',
    inputSchema: z.object({
      include_done: z.boolean().default(false).describe('済みのタスクも含める'),
      due_before: date.optional().describe('この日までが期限のもの（期限なしは含めない）'),
      query: z.string().max(100).optional().describe('タイトル・メモに含まれる言葉'),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ include_done, due_before, query, limit }) => {
    let q = db.from('tasks').select('*')
    if (!include_done) q = q.is('completed_at', null)
    if (due_before) q = q.lte('due_date', due_before)
    const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false }).order('position').limit(200)
    if (error) return problem(`タスクを読めませんでした: ${error.message}`)
    const w = query ? norm(query) : ''
    const rows = (data as Row[]).filter(t => !w || norm(`${t.title} ${t.memo}`).includes(w)).slice(0, limit).map(formatTask)
    return text(`タスクは ${rows.length} 件です。`, rows)
  })

  server.registerTool('list_shifts', {
    description: 'バイトのシフトの一覧（バイト先の名前・日付・曜日・開始と終了・休憩・実働時間）。「バイト」「シフト」の予定は、list_plans ではなく、こちら。id は、変える・消すときに使う。期間は、その期間のシフト。省くと、今日から30日先まで。',
    inputSchema: z.object({
      from: date.optional().describe('この日から（省くと今日）'),
      to: date.optional().describe('この日まで（省くと from の30日後）'),
      limit: z.number().int().min(1).max(100).default(60),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ from, to, limit }) => {
    const start = from ?? todayJst()
    const end = to ?? addDays(start, 30)
    const { data, error } = await db.from('shifts').select('id, date, job_id, start_time, end_time, rest_minutes')
      .gte('date', start).lte('date', end).order('date').order('start_time').limit(limit)
    if (error) return problem(`シフトを読めませんでした: ${error.message}`)
    const jobNames = await jobNamesOf(db)
    const rows = (data as Row[]).map(s => formatShift(s, jobNames))
    return text(`${start}〜${end} のシフトは ${rows.length} 件です。`, rows.map(r => ({ ...r, summary: describeShift(r) })))
  })

  server.registerTool('list_jobs', {
    description: 'バイト先の名前の一覧（シフトを入れるとき、どのバイト先か確かめるため）。時給などは返さない。',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const jobs = await jobsOf(db)
    return text(jobs.length ? `バイト先は ${jobs.length} 件です。` : 'バイト先は登録されていません。', jobs.map(j => j.name))
  })

  // ---------- シフト ----------
  const SHIFT_ASK = '休憩（分）を、ユーザーが言っていないときは、呼ぶ前に聞くこと（「なし」と言われたら 0）。バイト先が1つだけなら、聞かずにそれでよい。複数あって指定がないときは、list_jobs で確かめて聞く。'
  server.registerTool('add_shift', {
    description: `バイトのシフトを1件追加する。${SHIFT_ASK} 時給は指定しない（バイト先の時給が自動で入る）。退勤は、出勤より後の時刻にする（日をまたぐシフトは、アプリでも入れられない）。日付は YYYY-MM-DD（今日の日付から計算して渡す）。同じバイト先・同じ日・同じ時間のシフトがすでにあるときは、入れずに知らせる。シフトを入れると、今年の収入の予想が変わる。`,
    inputSchema: z.object({
      job: z.string().min(1).max(100).describe('バイト先の名前'),
      date: date,
      start_time: time.describe('出勤'),
      end_time: time.describe('退勤（出勤より後）'),
      rest_minutes: z.number().int().min(0).max(720).optional().describe('休憩（分）。省くと 0'),
      allow_duplicate: z.boolean().default(false),
    }),
  }, async (input) => {
    const jobs = await jobsOf(db)
    const built = buildNewShift(input, jobs, await nextPosition(db, 'shifts'))
    if (!built.ok) return problem(built.error)
    if (!input.allow_duplicate) {
      const { data } = await db.from('shifts').select('id, job_id, date, start_time, end_time').eq('date', input.date)
      const dup = findDuplicateShift((data as Row[]) ?? [], String(built.value.job_id), input.date, input.start_time, input.end_time)
      if (dup) return text(`同じシフトがすでにあるので、入れませんでした（id: ${dup.id}）。別のシフトとして入れるなら allow_duplicate を true にして、もう一度呼んでください。`)
    }
    const rowId = crypto.randomUUID()
    const failed = await applyOp(db, [{ table: 'shifts', action: 'insert', id: rowId, row: built.value }])
    if (failed) return problem(failed)
    return text(`シフトを追加しました: ${describeShift(formatShift({ ...built.value, id: rowId }, await jobNamesOf(db)))}`, { id: rowId })
  })

  server.registerTool('update_shift', {
    description: 'シフトを変える（バイト先・日付・出勤・退勤・休憩）。変えたい項目だけ渡す。時間を変えるときは、出勤と退勤の両方がそろって、退勤が出勤より後になること。バイト先を変えると、時給も新しいバイト先のものになる。id は list_shifts で確かめる。シフトを変えると、今年の収入の予想が変わる。',
    inputSchema: z.object({
      id,
      job: z.string().min(1).max(100).optional().describe('バイト先の名前'),
      date: date.optional(),
      start_time: time.optional(),
      end_time: time.optional(),
      rest_minutes: z.number().int().min(0).max(720).optional(),
    }),
    annotations: { idempotentHint: true },
  }, async ({ id: shiftId, ...patch }) => {
    const current = await getRow(db, 'shifts', shiftId)
    if (!current) return notFound('シフト', 'list_shifts')
    const built = buildShiftUpdate(current, patch, await jobsOf(db))
    if (!built.ok) return problem(built.error)
    const names = await jobNamesOf(db)
    if (!Object.keys(built.value.changes).length) return text(`変更はありません: ${describeShift(formatShift(current, names))}`)
    const failed = await applyOp(db, [{ table: 'shifts', action: 'update', id: shiftId, base: current.updated_at, row: built.value.changes }])
    if (failed) return problem(failed)
    return text(`シフトを変えました: ${describeShift(formatShift({ ...current, ...built.value.merged }, names))}`)
  })

  server.registerTool('delete_shift', {
    description: 'シフトを削除する。削除は履歴に残り、あとから戻せるが、ユーザーに、どのシフトを消すか確かめてから呼ぶこと。シフトを消すと、今年の収入の予想が変わる。id は list_shifts で確かめる。',
    inputSchema: z.object({ id }),
    annotations: { destructiveHint: true },
  }, async ({ id: shiftId }) => {
    const current = await getRow(db, 'shifts', shiftId)
    if (!current) return notFound('シフト', 'list_shifts')
    const failed = await applyOp(db, [{ table: 'shifts', action: 'delete', id: shiftId, base: current.updated_at }])
    if (failed) return problem(failed)
    return text(`シフトを削除しました: ${describeShift(formatShift(current, await jobNamesOf(db)))}`)
  })

  // ---------- 予定 ----------
  server.registerTool('add_plan', {
    description: `予定を1件追加する。${PLAN_ASK} カードで払うときは、先に list_cards でカードの名前を確かめる。日付は YYYY-MM-DD（今日の日付から計算して渡す）。同じタイトル・同じ日の予定がすでにあるときは、入れずに知らせる。`,
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      start_date: date.describe('はじめの日'),
      end_date: date.optional().describe('終わりの日（複数日のとき。省くと1日だけ）'),
      start_time: time.optional().describe('開始時刻（省くと終日）'),
      end_time: time.optional().describe('終了時刻（開始時刻があるときだけ）'),
      budget: z.number().int().min(0).max(MAX_BUDGET).optional().describe('予算（円）。省くと 0'),
      payment: z.enum(['cash', 'card']).optional().describe('払い方。cash＝現金、card＝カード'),
      card: z.string().max(100).optional().describe('カードの名前（カード払いのとき）'),
      memo: z.string().max(2000).optional(),
      allow_duplicate: z.boolean().default(false).describe('同じ予定がすでにあっても、別の予定として入れる'),
    }),
  }, async (input) => {
    const cards = await cardsOf(db)
    const built = buildNewPlan(input, cards, await nextPosition(db, 'plans'))
    if (!built.ok) return problem(built.error)
    if (!input.allow_duplicate) {
      const { data } = await db.from('plans').select('id, title, start_date').eq('start_date', input.start_date)
      const dup = findDuplicatePlan((data as Row[]) ?? [], input.title, input.start_date)
      if (dup) return text(`同じ予定がすでにあるので、入れませんでした（id: ${dup.id}）。別の予定として入れるなら allow_duplicate を true にして、もう一度呼んでください。`)
    }
    const rowId = crypto.randomUUID()
    const failed = await applyOp(db, [{ table: 'plans', action: 'insert', id: rowId, row: built.value }])
    if (failed) return problem(failed)
    return text(`予定を追加しました: ${describePlan(formatPlan({ ...built.value, id: rowId }, cards))}`, { id: rowId })
  })

  server.registerTool('update_plan', {
    description: `予定を変える（日付・時間・予算・払い方・タイトル・メモ・済み）。変えたい項目だけ渡す。はじめの日だけ変えると、期間の長さを保って終わりの日もずれる。時間を消して終日にするときは start_time に null。カード払いから現金にするときは payment を cash に。id は list_plans で確かめる。時間・予算・払い方を足したり変えたりするとき、ユーザーが具体的に言っていなければ、聞いてから呼ぶこと。`,
    inputSchema: z.object({
      id,
      title: z.string().min(1).max(200).optional(),
      start_date: date.optional(),
      end_date: date.optional(),
      start_time: time.nullable().optional().describe('null で時間を消す（終日）'),
      end_time: time.nullable().optional().describe('null で終了時刻を消す'),
      budget: z.number().int().min(0).max(MAX_BUDGET).optional(),
      payment: z.enum(['cash', 'card']).optional(),
      card: z.string().max(100).optional(),
      memo: z.string().max(2000).optional(),
      done: z.boolean().optional().describe('済みにする（予算に含めなくなる）／戻す'),
    }),
    annotations: { idempotentHint: true },
  }, async ({ id: planId, ...patch }) => {
    const current = await getRow(db, 'plans', planId)
    if (!current) return notFound('予定', 'list_plans')
    const cards = await cardsOf(db)
    const built = buildPlanUpdate(current, patch, cards)
    if (!built.ok) return problem(built.error)
    if (!Object.keys(built.value.changes).length) return text(`変更はありません: ${describePlan(formatPlan(current, cards))}`)
    const failed = await applyOp(db, [{ table: 'plans', action: 'update', id: planId, base: current.updated_at, row: built.value.changes }])
    if (failed) return problem(failed)
    return text(`予定を変えました: ${describePlan(formatPlan({ ...current, ...built.value.merged }, cards))}`)
  })

  server.registerTool('delete_plan', {
    description: '予定を削除する。削除は履歴に残り、あとから戻せるが、ユーザーに、どの予定を消すか確かめてから呼ぶこと。id は list_plans で確かめる。',
    inputSchema: z.object({ id }),
    annotations: { destructiveHint: true },
  }, async ({ id: planId }) => {
    const current = await getRow(db, 'plans', planId)
    if (!current) return notFound('予定', 'list_plans')
    const cards = await cardsOf(db)
    const failed = await applyOp(db, [{ table: 'plans', action: 'delete', id: planId, base: current.updated_at }])
    if (failed) return problem(failed)
    return text(`予定を削除しました: ${describePlan(formatPlan(current, cards))}`)
  })

  // ---------- タスク ----------
  server.registerTool('add_task', {
    description: 'タスク（やること）を1件追加する。期限（日付）は、ユーザーが言っていなければ、聞いてよい（なければ省く）。日付は YYYY-MM-DD（今日の日付から計算して渡す）。同じタイトル・同じ期限の、まだ終えていないタスクがあるときは、入れずに知らせる。',
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      due_date: date.optional().describe('期限（省くと期限なし）'),
      memo: z.string().max(2000).optional(),
      tags: tags.optional().describe('用途のタグ（例: 就活）'),
      allow_duplicate: z.boolean().default(false),
    }),
  }, async (input) => {
    const built = buildNewTask(input, await nextPosition(db, 'tasks'))
    if (!built.ok) return problem(built.error)
    if (!input.allow_duplicate) {
      const { data } = await db.from('tasks').select('id, title, due_date, completed_at').is('completed_at', null)
      const dup = findDuplicateTask((data as Row[]) ?? [], input.title, input.due_date ?? null)
      if (dup) return text(`同じタスクがすでにあるので、入れませんでした（id: ${dup.id}）。別のタスクとして入れるなら allow_duplicate を true にして、もう一度呼んでください。`)
    }
    const rowId = crypto.randomUUID()
    const failed = await applyOp(db, [{ table: 'tasks', action: 'insert', id: rowId, row: built.value }])
    if (failed) return problem(failed)
    return text(`タスクを追加しました: ${describeTask(formatTask({ ...built.value, id: rowId }))}`, { id: rowId })
  })

  server.registerTool('update_task', {
    description: 'タスクを変える（タイトル・期限・メモ・タグ）。変えたい項目だけ渡す。期限をなくすときは due_date に null。id は list_tasks で確かめる。済みにするときは complete_task を使う。',
    inputSchema: z.object({
      id,
      title: z.string().min(1).max(200).optional(),
      due_date: date.nullable().optional().describe('null で期限なし'),
      memo: z.string().max(2000).optional(),
      tags: tags.optional(),
    }),
    annotations: { idempotentHint: true },
  }, async ({ id: taskId, ...patch }) => {
    const current = await getRow(db, 'tasks', taskId)
    if (!current) return notFound('タスク', 'list_tasks')
    const built = buildTaskUpdate(current, patch)
    if (!built.ok) return problem(built.error)
    if (!Object.keys(built.value.changes).length) return text(`変更はありません: ${describeTask(formatTask(current))}`)
    const failed = await applyOp(db, [{ table: 'tasks', action: 'update', id: taskId, base: current.updated_at, row: built.value.changes }])
    if (failed) return problem(failed)
    return text(`タスクを変えました: ${describeTask(formatTask({ ...current, ...built.value.merged }))}`)
  })

  server.registerTool('complete_task', {
    description: 'タスクを済みにする（done を false にすると、未完了に戻す）。id は list_tasks で確かめる。',
    inputSchema: z.object({ id, done: z.boolean().default(true) }),
    annotations: { idempotentHint: true },
  }, async ({ id: taskId, done }) => {
    const current = await getRow(db, 'tasks', taskId)
    if (!current) return notFound('タスク', 'list_tasks')
    if (!!current.completed_at === done) return text(`すでに${done ? '済み' : '未完了'}です: ${describeTask(formatTask(current))}`)
    const completed_at = done ? new Date().toISOString() : null
    const failed = await applyOp(db, [{ table: 'tasks', action: 'update', id: taskId, base: current.updated_at, row: { completed_at } }])
    if (failed) return problem(failed)
    return text(`タスクを${done ? '済みにしました' : '未完了に戻しました'}: ${describeTask(formatTask({ ...current, completed_at }))}`)
  })

  server.registerTool('delete_task', {
    description: 'タスクを削除する。削除は履歴に残り、あとから戻せるが、ユーザーに、どのタスクを消すか確かめてから呼ぶこと。終えたタスクは、消さずに complete_task で済みにするのがふつう。id は list_tasks で確かめる。',
    inputSchema: z.object({ id }),
    annotations: { destructiveHint: true },
  }, async ({ id: taskId }) => {
    const current = await getRow(db, 'tasks', taskId)
    if (!current) return notFound('タスク', 'list_tasks')
    const failed = await applyOp(db, [{ table: 'tasks', action: 'delete', id: taskId, base: current.updated_at }])
    if (failed) return problem(failed)
    return text(`タスクを削除しました: ${describeTask(formatTask(current))}`)
  })

  // ---------- 動作確認 ----------
  server.registerTool('whoami', {
    description: '動作確認用。ログインしている人のメールアドレスを返す。データには触れない',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    const { data, error } = await db.auth.getUser()
    if (error) throw new Error(error.message)
    return text(data.user?.email ?? '(メールなし)')
  })
}

Deno.serve(
  pipeline(
    // 1. MCP クライアントに「どこで認証するか」を教える 2. その人のトークンを確かめ、その人として動くクライアントを渡す
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase }) => {
      // Edge Functions は状態を持たないので、リクエストごとにサーバーを作る
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'maney', version: '0.1.0' })
        registerTools(server, supabase)
        return server
      })
      return handler.fetch(req)
    },
  ),
)
