// 通知（Web Push）を送る（Issue #189・D36）。
// - action=test: ログインした本人の、登録した端末すべてに、テスト通知を送る（アプリの設定の「テスト通知を送る」）
// - action=daily: 毎朝8:00（日本時間）に、pg_cron から呼ばれる。通知を登録した人ごとに、今日の予定・期限のタスクを1本にまとめて、全端末に送る（D36）。
//   呼び出しの合言葉は DB（private.push_cron）が持ち、関数 verify_push_cron_secret で確かめる（新しい secret は要らない）
// 暗号化と送信は webpush.ts（Node のテストあり）。送り先が「切れた」（404・410）と返したら、その購読を消す。
// 鍵: secret は VAPID_PRIVATE_KEY（秘密鍵）だけ。公開鍵・連絡先（アプリの URL）は既定値を持つ（VAPID_PUBLIC_KEY・VAPID_SUBJECT で上書きもできる）
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

import { sendWebPush, type Subscription, type Vapid } from './webpush.ts'
import { buildDigest, tabUrl, todayJst } from './digest.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// 公開鍵と連絡先は秘密ではないので、既定値を持つ（公開鍵は、アプリの src/push.ts の VAPID_PUBLIC_KEY と同じ）。秘密鍵だけが secret
const DEFAULT_PUBLIC_KEY = 'BMRZljhF3U1xZHWrTvG2p4H5EGF8QrZ-wpSMETgAwTLZeiQHeHZuyLsML4iauIUG_ZxwlEJPh9QLlk85cUFgIqM'
const DEFAULT_SUBJECT = 'https://keitaro0510.github.io/maney-app/'

function vapidFromEnv(): Vapid | null {
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!privateKey) return null
  return { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || DEFAULT_PUBLIC_KEY, privateKey, subject: Deno.env.get('VAPID_SUBJECT') || DEFAULT_SUBJECT }
}

type Row = Subscription & { id: string }

/** 何台かに送る。切れた購読は消す。返すのは、送れた数・失敗した数・消した数 */
// deno-lint-ignore no-explicit-any
async function sendAll(admin: any, rows: Row[], payload: string, vapid: Vapid) {
  let sent = 0, failed = 0
  const gone: string[] = []
  await Promise.all(rows.map(async (r) => {
    try {
      const res = await sendWebPush(r, payload, vapid)
      if (res.ok) sent++
      else { failed++; if (res.gone) gone.push(r.id); console.warn('通知を送れませんでした', res.status, res.detail) }
    } catch (e) {
      failed++
      console.warn('通知の送信で例外', String(e))
    }
  }))
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone)
  return { sent, failed, removed: gone.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST だけです' }, 405)

  const vapid = vapidFromEnv()
  if (!vapid) return json({ error: '通知の鍵が設定されていません' }, 500)
  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: { action?: string } = {}
  try { body = await req.json() } catch { /* 本文なし */ }

  if (body.action === 'test') {
    // ログインした本人かを確かめる（ゲートウェイの検証は切ってあるので、ここで）
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'ログインが必要です' }, 401)
    const { data: auth, error } = await admin.auth.getUser(token)
    if (error || !auth?.user) return json({ error: 'ログインが必要です' }, 401)
    const { data: rows, error: readError } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', auth.user.id)
    if (readError) return json({ error: '登録を読めませんでした' }, 500)
    const payload = JSON.stringify({ title: 'お金管理', body: 'テスト通知です。これが見えれば、通知は届いています', url: './', tag: 'test' })
    return json(await sendAll(admin, (rows || []) as Row[], payload, vapid))
  }

  if (body.action === 'daily') {
    const { data: ok } = await admin.rpc('verify_push_cron_secret', { p_secret: req.headers.get('x-cron-secret') || '' })
    if (ok !== true) return json({ error: '許可がありません' }, 401)
    const today = todayJst()
    const { data: subs, error: subsError } = await admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth')
    if (subsError) return json({ error: '登録を読めませんでした' }, 500)
    const byUser = new Map<string, Row[]>()
    for (const r of (subs || []) as (Row & { user_id: string })[]) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r])
    const total = { users: byUser.size, sent: 0, failed: 0, removed: 0, skipped: 0 }
    for (const [userId, rows] of byUser) {
      try {
        // 予算・メモなどの列は、読まない（通知に金額を入れないため。D36）
        const [{ data: plans }, { data: tasks }] = await Promise.all([
          admin.from('plans').select('title, start_date, end_date, start_time, done').eq('user_id', userId).lte('start_date', today).gte('end_date', today),
          admin.from('tasks').select('title, due_date, completed_at').eq('user_id', userId).is('completed_at', null).not('due_date', 'is', null).lte('due_date', today),
        ])
        const digest = buildDigest({ today, plans: plans || [], tasks: tasks || [] })
        if (!digest) { total.skipped++; continue }
        const payload = JSON.stringify({ title: digest.title, body: digest.body, url: tabUrl(digest.tab), tab: digest.tab, tag: 'daily' })
        const r = await sendAll(admin, rows, payload, vapid)
        total.sent += r.sent; total.failed += r.failed; total.removed += r.removed
      } catch (e) {
        total.failed += rows.length
        console.warn('朝の通知でこの人の分を送れませんでした', String(e))
      }
    }
    return json(total)
  }

  return json({ error: '知らない操作です' }, 400)
})
