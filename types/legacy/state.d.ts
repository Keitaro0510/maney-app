// js/ から見た、データと同期の状態（D19 の手順3）。js/ の型の検査（tsconfig.json）だけが読む（src/tsconfig.json は読まない）。
// 中身は src/state.ts の入れ物で、js/ は window の getter・setter を通して名前でそのまま読み書きする。
// 型は、js/ に let で書いていたときに推論されていた型のまま（st は defaultSt() の形、ほかは any）。
// src/state.ts の厳しい型にすると、js/ の書き方（数と文字の混在など）と59か所が合わない。js/ は書き換えず（D18）、画面を src/ に移すときに直す
declare var st: ReturnType<typeof defaultSt>;
declare var server: any;
declare var outbox: any[];
declare var currentUser: any;
declare var remoteReady: boolean;
declare var loadingRemote: boolean;
declare var sending: boolean;
declare var sendBlocked: any;

// 保存・送信・読み込みの流れ（src/sync.ts。D19 の手順4）。src/main.ts が window に同じ名前で出す。
// 行は js/ では今までどおり any として扱う（src/ の行の型は厳しく、js/ の書き方と合わない）
declare var TABLE_LABELS: Record<string, string>;
declare function currentRows(): any;
declare function loadStored(name: string): any;
declare var rebuildSt: typeof import('../../src/sync.ts').rebuildSt;
declare var save: typeof import('../../src/sync.ts').save;
declare var saveRows: typeof import('../../src/sync.ts').saveRows;
declare var flushOutbox: typeof import('../../src/sync.ts').flushOutbox;
declare var loadRemote: typeof import('../../src/sync.ts').loadRemote;
declare var resyncRemote: typeof import('../../src/sync.ts').resyncRemote;

// ログインと起動の流れ（src/auth.ts。D19 の手順5）。src/main.ts が window に同じ名前で出す
declare var loginWithGoogle: typeof import('../../src/auth.ts').loginWithGoogle;
declare var logout: typeof import('../../src/auth.ts').logout;
declare var loadData: typeof import('../../src/auth.ts').loadData;
