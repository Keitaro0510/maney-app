// 接続先（D19）。ビルドのときに vite.config.mjs が MANEY_TARGET（prod か local）から決めて、__MANEY_*__ を文字に置き換える。
// - 本番（prod）とローカルの Supabase（local）で、端末の保存場所の名前を分ける（同じ 127.0.0.1:8765 で開いても、本番のログインや送信待ちと混ざらない）
// - 本番の値は、切り替える前の js/app-core.js と同じ（maney:prod:・money-app-auth）
export type Target = 'prod' | 'local';

export interface Env {
  readonly target: Target;
  readonly supaUrl: string;
  readonly supaKey: string;
  /** 端末に保存するサーバーの写し・送信待ちのキーの頭 */
  readonly storagePrefix: string;
  /** Supabase のログインの状態を保存するキー */
  readonly authStorageKey: string;
}

export const ENV: Env = Object.freeze({
  target: __MANEY_TARGET__,
  supaUrl: __MANEY_SUPA_URL__,
  supaKey: __MANEY_SUPA_KEY__,
  storagePrefix: `maney:${__MANEY_TARGET__}:`,
  authStorageKey: __MANEY_TARGET__ === 'prod' ? 'money-app-auth' : 'money-app-auth-local',
});
