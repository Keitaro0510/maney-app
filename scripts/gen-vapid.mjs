// Web Push の VAPID 鍵（P-256）を作る（Issue #189・D36）。
// 使い方: node scripts/gen-vapid.mjs <秘密鍵を書き出すファイル>
// - 公開鍵は、画面に出す（アプリの src/push.ts の VAPID_PUBLIC_KEY にそのまま書く。秘密ではない）
// - 秘密鍵は、指定したファイルにだけ書く（リポジトリに入れない。Supabase の secret VAPID_PRIVATE_KEY に入れたら、ファイルは消す）
// 鍵を作り直すと、いま登録されている端末は、通知を登録し直すまで届かなくなる
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('使い方: node scripts/gen-vapid.mjs <秘密鍵を書き出すファイル>'); process.exit(1); }

const b64url = bytes => Buffer.from(bytes).toString('base64url');
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)); // 65 バイト（0x04 + x + y）
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey); // d が 32 バイトの秘密鍵

writeFileSync(out, jwk.d, { flag: 'wx' }); // 既にあるファイルは上書きしない
console.log('公開鍵（VAPID_PUBLIC_KEY）:', b64url(pub));
console.log('秘密鍵は', out, 'に書きました。Supabase の secret VAPID_PRIVATE_KEY に入れたら、このファイルを消してください');
