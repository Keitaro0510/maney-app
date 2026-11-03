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

// 日付の補助と今の日時（src/dates.ts）・色と最初のカテゴリ（src/palette.ts）。D20 の 1。src/main.ts が window に同じ名前で出す
declare var _now: Date;
declare var TODAY: string;
declare var DAYS: typeof import('../../src/dates.ts').DAYS;
declare var gY: typeof import('../../src/dates.ts').gY;
declare var gM: typeof import('../../src/dates.ts').gM;
declare var gD: typeof import('../../src/dates.ts').gD;
declare var toDS: typeof import('../../src/dates.ts').toDS;
declare var fmtMD: typeof import('../../src/dates.ts').fmtMD;
declare var addM: typeof import('../../src/dates.ts').addM;
declare var ds2d: typeof import('../../src/dates.ts').ds2d;
declare var monthDay: typeof import('../../src/dates.ts').monthDay;
declare var monthDate: typeof import('../../src/dates.ts').monthDate;
declare var calcH: typeof import('../../src/dates.ts').calcH;
declare var COLOR_NAMES: typeof import('../../src/palette.ts').COLOR_NAMES;
declare var PLAN_COLORS: typeof import('../../src/palette.ts').PLAN_COLORS;
declare var planColor: typeof import('../../src/palette.ts').planColor;
declare var jobColorObj: (job: any) => import('../../src/palette.ts').PlanColor;
declare var jobColorByName: typeof import('../../src/palette.ts').jobColorByName;
declare var DEF_EXP: typeof import('../../src/palette.ts').DEF_EXP;
declare var DEF_INC: typeof import('../../src/palette.ts').DEF_INC;
declare var CAT_COL: typeof import('../../src/palette.ts').CAT_COL;
declare var DOTC: typeof import('../../src/palette.ts').DOTC;

// カードの集計と実績（src/cards.ts。D20 の 4）
declare var cardActualKey: typeof import('../../src/cards.ts').cardActualKey;
declare var getActualCard: (...args: any[]) => any;
declare var setActualCard: typeof import('../../src/cards.ts').setActualCard;
declare var cardRowOf: typeof import('../../src/cards.ts').cardRowOf;
declare var cardCloseDay: typeof import('../../src/cards.ts').cardCloseDay;
declare var cardCycleForBillMonth: typeof import('../../src/cards.ts').cardCycleForBillMonth;
declare var cycle: typeof import('../../src/cards.ts').cycle;
declare var cardBillForGraphDate: typeof import('../../src/cards.ts').cardBillForGraphDate;
declare var cardBillForDate: typeof import('../../src/cards.ts').cardBillForDate;
declare var cardBillAmount: typeof import('../../src/cards.ts').cardBillAmount;

// 設定タブ（src/screens/settings.ts）。ナビが initSettingTab を呼ぶため window に残す
declare var addCatExp: typeof import('../../src/screens/settings.ts').addCatExp;
declare var addCatInc: typeof import('../../src/screens/settings.ts').addCatInc;
declare var delCatExp: typeof import('../../src/screens/settings.ts').delCatExp;
declare var delCatInc: typeof import('../../src/screens/settings.ts').delCatInc;
declare var renderCatTags: typeof import('../../src/screens/settings.ts').renderCatTags;
declare var initSettingTab: typeof import('../../src/screens/settings.ts').initSettingTab;
declare var updateShiftCyclePreview: typeof import('../../src/screens/settings.ts').updateShiftCyclePreview;
declare var saveSettingFields: typeof import('../../src/screens/settings.ts').saveSettingFields;

// カードの画面（src/screens/cards.ts）
declare var toggleCardCloseEom: typeof import('../../src/screens/cards.ts').toggleCardCloseEom;
declare var previewCycle: typeof import('../../src/screens/cards.ts').previewCycle;
declare var addCard: typeof import('../../src/screens/cards.ts').addCard;
declare var renderCardBillHistory: typeof import('../../src/screens/cards.ts').renderCardBillHistory;
declare var onCardBillChange: typeof import('../../src/screens/cards.ts').onCardBillChange;
declare var renderCardList: typeof import('../../src/screens/cards.ts').renderCardList;
declare var delCard: typeof import('../../src/screens/cards.ts').delCard;
declare var openCardEdit: typeof import('../../src/screens/cards.ts').openCardEdit;
declare var closeCardEdit: typeof import('../../src/screens/cards.ts').closeCardEdit;
declare var saveCardEdit: typeof import('../../src/screens/cards.ts').saveCardEdit;

// タスクの画面（src/screens/tasks.ts。D20 の 2）。src/main.ts が window に同じ名前で出す
declare var taskRows: typeof import('../../src/screens/tasks.ts').taskRows;
declare var renderTaskTab: typeof import('../../src/screens/tasks.ts').renderTaskTab;
declare var renderHomeTasks: typeof import('../../src/screens/tasks.ts').renderHomeTasks;
declare var maybeShowStartupTasks: typeof import('../../src/screens/tasks.ts').maybeShowStartupTasks;
declare var openStartupTasks: typeof import('../../src/screens/tasks.ts').openStartupTasks;
