// 画面を比べる道具（D20 の 0）の準備。テストの前に1回動く（playwright.config.mjs の globalSetup）。
// ローカルの Supabase に、テスト用のユーザー（tests/screens/constants.mjs）を作り直し、架空のデータ（seed.sql）を入れる。
// ユーザーを消すと、その人の行もすべて消える（on delete cascade）ので、毎回同じデータから始まる。
// 接続先は npm run test:screens（scripts/local-supabase.mjs）が環境変数で入れる。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EMAIL, PASSWORD } from './constants.mjs';

export default async function globalSetup() {
  const url = process.env.MANEY_LOCAL_API_URL;
  const service = process.env.MANEY_LOCAL_SERVICE_ROLE_KEY;
  if (!url || !service || process.env.MANEY_TARGET !== 'local') {
    throw new Error('画面を比べる道具は、ローカルの Supabase につないで動かす（npm run test:screens。D20）');
  }
  const admin = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };

  // 前のテスト用のユーザーを消す（行も消える）
  const list = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: admin }).then(r => r.json());
  for (const u of list.users || []) {
    if (u.email === EMAIL) {
      const res = await fetch(`${url}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: admin });
      if (!res.ok) throw new Error(`テスト用のユーザーを消せませんでした: ${res.status}`);
    }
  }

  // 作り直す
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin, body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  }).then(r => r.json());
  if (!created.id) throw new Error('テスト用のユーザーを作れませんでした: ' + JSON.stringify(created));

  // 架空のデータを入れる（DB のコンテナの psql で）
  const sql = readFileSync(new URL('./seed.sql', import.meta.url), 'utf8');
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_maney-app', 'psql', '-U', 'postgres', '-q', '-v', `uid=${created.id}`],
    { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('架空のデータを入れられませんでした:\n' + (r.stderr || r.stdout || r.error));
}
