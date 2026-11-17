// Web Push の暗号化と送信（supabase/functions/_shared/webpush.ts）。Issue #189・D36。実行: node --test "tests/*.test.mjs"
// 受け取る側（ブラウザ）の復号を、ここで書いて確かめる。RFC 8291 の付録の例とも比べる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization, sendWebPush,
} from '../supabase/functions/_shared/webpush.ts'; // Node が型を消して読む（D17）

const subtle = globalThis.crypto.subtle;
const dec = new TextDecoder();
const enc = new TextEncoder();
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

async function hkdf(ikm, salt, info, bytes) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** ブラウザの側: 購読の秘密鍵と auth で、届いた本体を復号する */
async function decryptAsBrowser(body, uaPublic, uaPrivateJwk, auth) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPriv = await subtle.importKey('jwk', uaPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const ikm = await hkdf(ecdh, auth, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  assert.equal(plain[plain.length - 1], 2, '最後の記録の区切り');
  return plain.slice(0, -1);
}

async function newSubscription() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { pub, jwk, auth };
}

async function newVapid() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return { vapid: { publicKey: bytesToB64url(pub), privateKey: jwk.d, subject: 'mailto:test@example.com' }, verifyKey: pair.publicKey };
}

test('base64url: 往復できる（パディングなし・+/ を使わない）', () => {
  const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3]);
  const s = bytesToB64url(bytes);
  assert.ok(!/[+/=]/.test(s));
  assert.deepEqual(b64urlToBytes(s), bytes);
});

test('encryptPayload: 受け取る側の鍵で復号すると、元の文字に戻る（日本語も）', async () => {
  const sub = await newSubscription();
  const text = JSON.stringify({ title: 'きょう', body: '予定2件・タスク3件' });
  const body = await encryptPayload(enc.encode(text), sub.pub, sub.auth);
  assert.equal(body[20], 65); // 送る側の公開鍵の長さ
  assert.equal(dec.decode(await decryptAsBrowser(body, sub.pub, sub.jwk, sub.auth)), text);
});

test('encryptPayload: 毎回、違う暗号文になる（salt と一時的な鍵が毎回変わる）', async () => {
  const sub = await newSubscription();
  const a = await encryptPayload(enc.encode('同じ文'), sub.pub, sub.auth);
  const b = await encryptPayload(enc.encode('同じ文'), sub.pub, sub.auth);
  assert.notDeepEqual(a, b);
});

test('encryptPayload: 別の auth では復号できない', async () => {
  const sub = await newSubscription();
  const body = await encryptPayload(enc.encode('秘密'), sub.pub, sub.auth);
  await assert.rejects(decryptAsBrowser(body, sub.pub, sub.jwk, globalThis.crypto.getRandomValues(new Uint8Array(16))));
});

test('encryptPayload: 長すぎる本文・短い auth は断る', async () => {
  const sub = await newSubscription();
  await assert.rejects(encryptPayload(new Uint8Array(4000), sub.pub, sub.auth), /長すぎ/);
  await assert.rejects(encryptPayload(enc.encode('a'), sub.pub, new Uint8Array(8)), /16/);
});

// RFC 8291 付録 A の例（固定の鍵と salt で、決まった暗号文になる）
test('encryptPayload: RFC 8291 の例と同じ結果になる', async () => {
  const body = await encryptPayload(
    enc.encode('When I grow up, I want to be a watermelon'),
    b64urlToBytes('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
    b64urlToBytes('BTBZMqHH6r4Tts7J_aSIgg'),
    {
      ephemeral: {
        publicKey: b64urlToBytes('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
        privateKey: b64urlToBytes('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      },
      salt: b64urlToBytes('DGv6ra1nlYgDCS1FRnbzlw'),
    },
  );
  assert.equal(
    bytesToB64url(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('vapidAuthorization: JWT の中身と署名を、公開鍵で確かめられる', async () => {
  const { vapid, verifyKey } = await newVapid();
  const header = await vapidAuthorization('https://web.push.apple.com/abc/def', vapid, 1_700_000_000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], vapid.publicKey);
  const claims = JSON.parse(dec.decode(b64urlToBytes(m[2])));
  assert.deepEqual(claims, { aud: 'https://web.push.apple.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:test@example.com' });
  assert.deepEqual(JSON.parse(dec.decode(b64urlToBytes(m[1]))), { typ: 'JWT', alg: 'ES256' });
  const sig = b64urlToBytes(m[3]);
  assert.equal(sig.length, 64);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, sig, enc.encode(`${m[1]}.${m[2]}`)));
});

// 模擬の Push サービス（ローカルの HTTP サーバー）に送り、届いた本体を、ブラウザの側で復号する
async function withPushServer(handler, run) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${server.address().port}/push/abc`); } finally { server.close(); }
}

test('sendWebPush: ヘッダーと本体が正しく、受け取る側が復号できる', async () => {
  const sub = await newSubscription();
  const { vapid } = await newVapid();
  let got;
  await withPushServer((req, body, res) => { got = { headers: req.headers, body: new Uint8Array(body), method: req.method }; res.writeHead(201).end(); }, async endpoint => {
    const r = await sendWebPush({ endpoint, p256dh: bytesToB64url(sub.pub), auth: bytesToB64url(sub.auth) }, '{"title":"テスト"}', vapid, { ttl: 600, urgency: 'high' });
    assert.deepEqual(r, { ok: true, status: 201 });
  });
  assert.equal(got.method, 'POST');
  assert.equal(got.headers['content-encoding'], 'aes128gcm');
  assert.equal(got.headers['content-type'], 'application/octet-stream');
  assert.equal(got.headers.ttl, '600');
  assert.equal(got.headers.urgency, 'high');
  assert.match(got.headers.authorization, /^vapid t=.+, k=/);
  assert.equal(dec.decode(await decryptAsBrowser(got.body, sub.pub, sub.jwk, sub.auth)), '{"title":"テスト"}');
});

test('sendWebPush: 404・410 は「購読が切れた」、それ以外の失敗は切れていない', async () => {
  const sub = await newSubscription();
  const { vapid } = await newVapid();
  const s = { p256dh: bytesToB64url(sub.pub), auth: bytesToB64url(sub.auth) };
  for (const [status, gone] of [[410, true], [404, true], [413, false], [500, false]]) {
    await withPushServer((req, body, res) => { res.writeHead(status).end('error body'); }, async endpoint => {
      const r = await sendWebPush({ endpoint, ...s }, 'x', vapid);
      assert.deepEqual(r, { ok: false, status, gone, detail: 'error body' });
    });
  }
});
