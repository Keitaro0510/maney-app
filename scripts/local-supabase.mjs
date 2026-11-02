// ローカルの Supabase につないで、コマンドを動かす（D19）。
//   node scripts/local-supabase.mjs <コマンド…>
// 先に Docker Desktop を起動し、npx supabase start でローカルの Supabase を立てておく。
// npx supabase status から接続先とキーを読み、次の環境変数を入れてからコマンドを動かす:
//   MANEY_TARGET=local（vite.config.mjs がローカルにつなぐ）・MANEY_LOCAL_*（API_URL・PUBLISHABLE_KEY・SERVICE_ROLE_KEY など。結合テストも使う）
// 読めなければ（立てていない・Docker が動いていない）、コマンドを動かさずに失敗する。
import { execSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('使い方: node scripts/local-supabase.mjs <コマンド…>');
  process.exit(2);
}

let out;
try {
  out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  console.error('ローカルの Supabase の接続先を読めませんでした。Docker Desktop を起動し、npx supabase start で立ててから動かしてください（docs/db/LOCAL.md）。');
  console.error(String(e.stderr || e.message).trim());
  process.exit(1);
}

const env = { ...process.env, MANEY_TARGET: 'local' };
for (const line of out.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) env[`MANEY_LOCAL_${m[1]}`] = m[2];
}
if (!env.MANEY_LOCAL_API_URL || !env.MANEY_LOCAL_PUBLISHABLE_KEY) {
  console.error('npx supabase status に API_URL・PUBLISHABLE_KEY がありませんでした:\n' + out);
  process.exit(1);
}

const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env, shell: true });
process.exit(r.status ?? 1);
