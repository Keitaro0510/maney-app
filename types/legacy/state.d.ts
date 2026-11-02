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
