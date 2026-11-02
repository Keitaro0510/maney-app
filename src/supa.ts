// Supabase のクライアントを作る（D19 の手順5）。接続先は src/env.ts（ビルドのときに決まる）。
// ライブラリは CDN の <script>（index.html。版は固定。D19）が出す大域の supabase を使う。
// モジュールを読んだだけでは作らない（Node のテストが、ここを import する別のモジュールを読めるように）。src/main.ts が1回呼ぶ
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env.ts';

export function createSupa(env: Env): SupabaseClient {
  return supabase.createClient(env.supaUrl, env.supaKey, {
    auth: {
      persistSession: true,
      storageKey: env.authStorageKey, // 本番は money-app-auth（src/env.ts）
      storage: window.localStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
