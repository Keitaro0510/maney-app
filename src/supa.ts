// Supabase のクライアントを作る（D19 の手順5）。接続先は src/env.ts（ビルドのときに決まる）。
// ライブラリは CDN の <script>（index.html。版は固定。D19）が出す大域の supabase を使う。
// モジュールを読んだだけでは作らない（Node のテストが、ここを import する別のモジュールを読めるように）。src/main.ts が1回呼ぶ
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env.ts';

let client: SupabaseClient | null = null;

/** Supabase のクライアント（src/main.ts が作ったあと。画面のモジュールが使う） */
export function getSupa(): SupabaseClient {
  if (!client) throw new Error('Supabase のクライアントを、作る前に使いました（src/main.ts の createSupa より前）');
  return client;
}

export function createSupa(env: Env): SupabaseClient {
  client = supabase.createClient(env.supaUrl, env.supaKey, {
    auth: {
      persistSession: true,
      storageKey: env.authStorageKey, // 本番は money-app-auth（src/env.ts）
      storage: window.localStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
