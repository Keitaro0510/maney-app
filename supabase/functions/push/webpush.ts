// Web Push を送る（Issue #189・D36）。依存を増やさず、WebCrypto だけで書く（Deno の Edge Function でも Node のテストでも動く）。
// - 暗号化: RFC 8291（aes128gcm）。1通は1つの記録に収まる大きさだけ（通知の文面は短いので足りる）
// - 送信元の証明: RFC 8292（VAPID）。ES256 の JWT を Authorization に付ける
// 鍵は、公開鍵が 65 バイト（0x04 + x + y）、秘密鍵が 32 バイト。どちらも base64url の文字で持つ。
// Node 22 以降はこのファイルを型を消して読める（D17）ので、enum・namespace は使わない

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// WebCrypto に渡す Uint8Array は、ArrayBuffer の上のものにそろえる（型の都合）
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, bytes * 8))
}

function ecJwk(pub: Uint8Array, priv?: Uint8Array): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('公開鍵は 65 バイト（0x04 から始まる）にしてください')
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)) }
  if (priv) jwk.d = bytesToB64url(priv)
  return jwk
}

export type EncryptOptions = {
  /** テスト用: 送る側の一時的な鍵（RFC 8291 の例と同じ値で確かめるため）。ふだんは毎回つくる */
  ephemeral?: { publicKey: Uint8Array; privateKey: Uint8Array }
  /** テスト用: 16 バイトの salt。ふだんは毎回ランダム */
  salt?: Uint8Array
}

/** 本文を、受け取る側（ブラウザの購読情報）の鍵で暗号化する。返すのは、そのまま POST する本体 */
export async function encryptPayload(
  plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opts: EncryptOptions = {},
): Promise<Uint8Array> {
  if (authSecret.length !== 16) throw new Error('auth は 16 バイトです')
  if (plaintext.length > 3993) throw new Error('通知の本文が長すぎます') // 4096 - 16(タグ) - 1(区切り) - 86(ヘッダー)
  let asPublic: Uint8Array
  let asPrivateKey: CryptoKey
  if (opts.ephemeral) {
    asPublic = opts.ephemeral.publicKey
    asPrivateKey = await crypto.subtle.importKey('jwk', ecJwk(asPublic, opts.ephemeral.privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    asPrivateKey = pair.privateKey
  }
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256))
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const ikm = await hkdf(ecdh, authSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aes, buf(concat(plaintext, new Uint8Array([2])))))

  const rs = new Uint8Array([0, 0, 0x10, 0]) // 記録の大きさ 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

export type Vapid = {
  /** 65 バイトの公開鍵（base64url） */
  publicKey: string
  /** 32 バイトの秘密鍵（base64url） */
  privateKey: string
  /** 連絡先（mailto: か https:） */
  subject: string
}

/** VAPID の Authorization ヘッダーの値 */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: vapid.subject })))
  const input = `${header}.${claims}`
  const key = await crypto.subtle.importKey('jwk', ecJwk(b64urlToBytes(vapid.publicKey), b64urlToBytes(vapid.privateKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input))) // r と s を並べた 64 バイト（JWS の形）
  return `vapid t=${input}.${bytesToB64url(sig)}, k=${vapid.publicKey}`
}

export type Subscription = { endpoint: string; p256dh: string; auth: string }

export type PushResult =
  | { ok: true; status: number }
  /** gone=true は、購読が切れている（404・410）。保存した購読情報を消してよい */
  | { ok: false; status: number; gone: boolean; detail: string }

/** 1通送る。payload は JSON の文字（service worker の push イベントが読む） */
export async function sendWebPush(
  sub: Subscription, payload: string, vapid: Vapid, opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(payload), b64urlToBytes(sub.p256dh), b64urlToBytes(sub.auth))
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 3600),
      Urgency: opts.urgency ?? 'normal',
    },
    body: buf(body),
  })
  if (res.ok) return { ok: true, status: res.status }
  const detail = (await res.text().catch(() => '')).slice(0, 200)
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, detail }
}
