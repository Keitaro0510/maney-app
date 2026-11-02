// ビルドのときに vite.config.mjs が置き換える文字（D19）。src/env.ts だけが使う
declare const __MANEY_TARGET__: 'prod' | 'local';
declare const __MANEY_SUPA_URL__: string;
declare const __MANEY_SUPA_KEY__: string;
