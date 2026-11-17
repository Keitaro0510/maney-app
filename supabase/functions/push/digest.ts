// 朝の通知の文面（Issue #189・D36）。DB や送信に触れない部分だけ置く（Node のテストあり）。
// 渡すのは、予定とタスクの「題名・日付・時刻・済みか」だけ。**金額（予算など）は、型の上で受け取らない**（ロック画面に出るため。D36）
// Node 22 以降はこのファイルを型を消して読める（D17）ので、enum・namespace は使わない

export type DigestPlan = { title: string; start_date: string; end_date: string; start_time?: string | null; done?: boolean }
export type DigestTask = { title: string; due_date: string | null; completed_at: string | null }

export type Digest = {
  title: string
  body: string
  /** 通知を押したときに開く画面（予定があればホーム、なければタスク） */
  tab: 'home' | 'task'
}

/** 日本時間の今日（'YYYY-MM-DD'） */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10)
}

/** 通知に出す題名は短くする（長いと、ロック画面で切れる） */
export function shorten(s: string, max = 14): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return [...t].length > max ? [...t].slice(0, max).join('') + '…' : t
}

/** 今日の予定・今日が期限のタスク・期限切れのタスクから、朝の通知を作る。どれも無ければ null（送らない） */
export function buildDigest(input: { today: string; plans: DigestPlan[]; tasks: DigestTask[] }): Digest | null {
  const { today } = input
  // 済みにした予定は、数えない。終日（時刻なし）を先に、時刻のある予定は早い順
  const plans = input.plans
    .filter(p => !p.done && p.start_date <= today && today <= p.end_date)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  const open = input.tasks.filter(t => !t.completed_at && t.due_date)
  const dueToday = open.filter(t => t.due_date === today).length
  const overdue = open.filter(t => (t.due_date as string) < today).length

  const parts: string[] = []
  if (plans.length) parts.push(`予定${plans.length}件（${shorten(plans[0].title)}${plans.length > 1 ? 'ほか' : ''}）`)
  if (dueToday) parts.push(`今日が期限のタスク${dueToday}件`)
  if (overdue) parts.push(`期限切れ${overdue}件`)
  if (!parts.length) return null
  return { title: '今日の予定とタスク', body: parts.join('・'), tab: plans.length ? 'home' : 'task' }
}

/** 通知を押したときに開く URL（相対。Service Worker が、アプリの場所に直す） */
export const tabUrl = (tab: Digest['tab']): string => `./?tab=${tab}`
