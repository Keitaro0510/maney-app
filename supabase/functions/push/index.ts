// 通知（Web Push）を送る（Issue #189・D36）。
// - action=test: ログインした本人の、登録した端末すべてに、テスト通知を送る（アプリの設定の「テスト通知を送る」）
// 暗号化と送信は _shared/webpush.ts（Node のテストあり）。送り先が「切れた」（404・410）と返したら、その購読を消す。
// 鍵: secret は VAPID_PRIVATE_KEY（秘密鍵）だけ。公開鍵・連絡先（アプリの URL）は既定値を持つ（VAPID_PUBLIC_KEY・VAPID_SUBJECT で上書きもできる）
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

import { sendWebPush, type Subscription, type Vapid } from './webpush.ts'

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

  return json({ error: '知らない操作です' }, 400)
})
