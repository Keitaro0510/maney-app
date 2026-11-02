// 結合テストの共通の部分（D19）。ローカルの Supabase の接続先・supabase-js の代わり・テスト用のユーザーを作る。
// 接続先は npm run test:integration（scripts/local-supabase.mjs）が環境変数で入れる。
// 環境変数がなければ skip に理由が入る（MANEY_INTEGRATION_REQUIRED=1 のときは、飛ばさずに止める）。
export const URL_ = process.env.MANEY_LOCAL_API_URL;
export const ANON = process.env.MANEY_LOCAL_PUBLISHABLE_KEY || process.env.MANEY_LOCAL_ANON_KEY;
export const SERVICE = process.env.MANEY_LOCAL_SERVICE_ROLE_KEY;
export const skip = !(URL_ && ANON && SERVICE) && 'ローカルの Supabase の環境変数がない';
if (skip && process.env.MANEY_INTEGRATION_REQUIRED === '1') {
  throw new Error(`結合テストを流せません: ${skip}（npm run test:integration から動かす。D19）`);
}

// ---------- supabase-js の代わり（src/data.ts が使う分だけ） ----------
export function client(token) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    from(table) {
      const query = { orders: [] };
      const api = {
        select() { return api; },
        order(column) { query.orders.push(`${column}.asc`); return api; },
        async range(from, to) {
          const res = await fetch(`${URL_}/rest/v1/${table}?select=*&order=${query.orders.join(',')}`, {
            headers: { ...headers, Range: `${from}-${to}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
          });
          const body = await res.json();
          if (!res.ok) return { data: null, error: body, count: null };
          return { data: body, error: null, count: Number(res.headers.get('content-range').split('/')[1]) };
        },
        async maybeSingle() {
          const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, { headers });
          const body = await res.json();
          return res.ok ? { data: body[0] || null, error: null } : { data: null, error: body };
        },
      };
      return api;
    },
    async rpc(fn, args) {
      const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
      const body = await res.json();
      return res.ok ? { data: body, error: null, status: res.status } : { data: null, error: body, status: res.status };
    },
  };
}

export async function createUser(name) {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'local-test-password';
  const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
  }).then(r => r.json());
  const session = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  return { id: created.id, supa: client(session.access_token) };
}

