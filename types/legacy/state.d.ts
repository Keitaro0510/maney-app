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

// ATM（src/screens/atm.ts）
declare var openWd: typeof import('../../src/screens/atm.ts').openWd;
declare var closeWd: typeof import('../../src/screens/atm.ts').closeWd;
declare var nk: typeof import('../../src/screens/atm.ts').nk;
declare var nd: typeof import('../../src/screens/atm.ts').nd;
declare var updWd: typeof import('../../src/screens/atm.ts').updWd;
declare var doWd: typeof import('../../src/screens/atm.ts').doWd;
declare var renderWdHist: typeof import('../../src/screens/atm.ts').renderWdHist;
declare var delWd: typeof import('../../src/screens/atm.ts').delWd;

// シフト・給与の計算と実績（src/shifts.ts）
declare var monthShifts: typeof import('../../src/shifts.ts').monthShifts;
declare var closeDay: typeof import('../../src/shifts.ts').closeDay;
declare var jobPayDay: typeof import('../../src/shifts.ts').jobPayDay;
declare var jobCloseDayNum: typeof import('../../src/shifts.ts').jobCloseDayNum;
declare var salaryKeyForShiftMonth: typeof import('../../src/shifts.ts').salaryKeyForShiftMonth;
declare var getActualSalary: (...args: any[]) => any;
declare var setActualSalary: typeof import('../../src/shifts.ts').setActualSalary;
declare var calcShiftInc: typeof import('../../src/shifts.ts').calcShiftInc;
declare var totalShiftInc: typeof import('../../src/shifts.ts').totalShiftInc;
declare var totalShiftIncNoTransport: typeof import('../../src/shifts.ts').totalShiftIncNoTransport;
declare var totalTransport: typeof import('../../src/shifts.ts').totalTransport;
declare var jobMonthShifts: typeof import('../../src/shifts.ts').jobMonthShifts;
declare var totalShiftIncForJob: typeof import('../../src/shifts.ts').totalShiftIncForJob;
declare var totalShiftIncNoTransportForJob: typeof import('../../src/shifts.ts').totalShiftIncNoTransportForJob;

// タスクの画面（src/screens/tasks.ts。D20 の 2）。src/main.ts が window に同じ名前で出す
declare var taskRows: typeof import('../../src/screens/tasks.ts').taskRows;
declare var renderTaskTab: typeof import('../../src/screens/tasks.ts').renderTaskTab;
declare var renderHomeTasks: typeof import('../../src/screens/tasks.ts').renderHomeTasks;
declare var maybeShowStartupTasks: typeof import('../../src/screens/tasks.ts').maybeShowStartupTasks;
declare var openStartupTasks: typeof import('../../src/screens/tasks.ts').openStartupTasks;

// シフト画面（src/screens/shift.ts）。ナビと HTML のイベントが使うため window に残す
declare var openShiftModal: typeof import('../../src/screens/shift.ts').openShiftModal;
declare var renderRestChips: typeof import('../../src/screens/shift.ts').renderRestChips;
declare var setRestMin: typeof import('../../src/screens/shift.ts').setRestMin;
declare var checkShiftTime: typeof import('../../src/screens/shift.ts').checkShiftTime;
declare var updateShiftPreview: typeof import('../../src/screens/shift.ts').updateShiftPreview;
declare var renderShiftCal: typeof import('../../src/screens/shift.ts').renderShiftCal;
declare var toggleShiftDay: typeof import('../../src/screens/shift.ts').toggleShiftDay;
declare var shiftCalPrev: typeof import('../../src/screens/shift.ts').shiftCalPrev;
declare var shiftCalNext: typeof import('../../src/screens/shift.ts').shiftCalNext;
declare var saveShift: typeof import('../../src/screens/shift.ts').saveShift;
declare var closeShiftModal: typeof import('../../src/screens/shift.ts').closeShiftModal;
declare var shiftListPrev: typeof import('../../src/screens/shift.ts').shiftListPrev;
declare var shiftListNext: typeof import('../../src/screens/shift.ts').shiftListNext;
declare var renderShiftList: typeof import('../../src/screens/shift.ts').renderShiftList;
declare var renderShiftSection: typeof import('../../src/screens/shift.ts').renderShiftSection;
declare var renderSalaryTable: typeof import('../../src/screens/shift.ts').renderSalaryTable;
declare var onSalaryChangeByPayMonth: typeof import('../../src/screens/shift.ts').onSalaryChangeByPayMonth;
declare var yearConfirmedIncome: typeof import('../../src/screens/shift.ts').yearConfirmedIncome;
declare var yearEstimatedIncome: typeof import('../../src/screens/shift.ts').yearEstimatedIncome;
declare var renderFuyou: typeof import('../../src/screens/shift.ts').renderFuyou;
declare var renderMonthBars: typeof import('../../src/screens/shift.ts').renderMonthBars;
declare var ensureJobAddColor: typeof import('../../src/screens/shift.ts').ensureJobAddColor;
declare var renderJobAddColorSwatches: typeof import('../../src/screens/shift.ts').renderJobAddColorSwatches;
declare var selJobAddColor: typeof import('../../src/screens/shift.ts').selJobAddColor;
declare var renderJobList: typeof import('../../src/screens/shift.ts').renderJobList;
declare var addJob: typeof import('../../src/screens/shift.ts').addJob;
declare var toggleJobAdd: typeof import('../../src/screens/shift.ts').toggleJobAdd;
declare var openJobEdit: typeof import('../../src/screens/shift.ts').openJobEdit;
declare var closeJobEdit: typeof import('../../src/screens/shift.ts').closeJobEdit;
declare var renderJobEditColorSwatches: typeof import('../../src/screens/shift.ts').renderJobEditColorSwatches;
declare var selJobEditColor: typeof import('../../src/screens/shift.ts').selJobEditColor;
declare var saveJobEdit: typeof import('../../src/screens/shift.ts').saveJobEdit;
declare var delJob: typeof import('../../src/screens/shift.ts').delJob;
declare var delShift: typeof import('../../src/screens/shift.ts').delShift;
declare var onShiftDayChanged: typeof import('../../src/screens/shift.ts').onShiftDayChanged;

// 予定の日別表示（src/plans.ts）
declare var getPlansForDay: typeof import('../../src/plans.ts').getPlansForDay;
declare var planTimeOnDay: typeof import('../../src/plans.ts').planTimeOnDay;
declare var hm2min: typeof import('../../src/plans.ts').hm2min;

// 予定の入力画面（src/screens/plans.ts）
declare var renderColorSwatches: typeof import('../../src/screens/plans.ts').renderColorSwatches;
declare var selPlanColor: typeof import('../../src/screens/plans.ts').selPlanColor;
declare var setDateMode: typeof import('../../src/screens/plans.ts').setDateMode;
declare var updateRangePreview: typeof import('../../src/screens/plans.ts').updateRangePreview;
declare var renderPlanPayChips: typeof import('../../src/screens/plans.ts').renderPlanPayChips;
declare var selPlanPay: typeof import('../../src/screens/plans.ts').selPlanPay;
declare var setPlanTimeMode: typeof import('../../src/screens/plans.ts').setPlanTimeMode;
declare var togglePlanAllDay: typeof import('../../src/screens/plans.ts').togglePlanAllDay;
declare var openPlanModal: typeof import('../../src/screens/plans.ts').openPlanModal;
declare var openPlanEdit: typeof import('../../src/screens/plans.ts').openPlanEdit;
declare var closePlanModal: typeof import('../../src/screens/plans.ts').closePlanModal;
declare var savePlan: typeof import('../../src/screens/plans.ts').savePlan;

// 家計簿の記録（src/ledger.ts）
declare var monthLedger: (...args: any[]) => any[];
declare var getLedgerForDay: (...args: any[]) => any[];
declare var ledgerPayLabel: typeof import('../../src/ledger.ts').ledgerPayLabel;

// 毎月のお金の画面（src/screens/monthly.ts）
declare var monthlyRowsIn: typeof import('../../src/screens/monthly.ts').monthlyRowsIn;
declare var monthlyPayLabel: typeof import('../../src/screens/monthly.ts').monthlyPayLabel;
declare var openMonthlyTab: typeof import('../../src/screens/monthly.ts').openMonthlyTab;
declare var renderMonthlyTab: typeof import('../../src/screens/monthly.ts').renderMonthlyTab;
declare var monthlyRow: typeof import('../../src/screens/monthly.ts').monthlyRow;
declare var openMonthlySheet: typeof import('../../src/screens/monthly.ts').openMonthlySheet;
declare var closeMonthlySheet: typeof import('../../src/screens/monthly.ts').closeMonthlySheet;
declare var saveMonthly: typeof import('../../src/screens/monthly.ts').saveMonthly;
declare var changeMonthlyAmount: typeof import('../../src/screens/monthly.ts').changeMonthlyAmount;
declare var stopMonthly: typeof import('../../src/screens/monthly.ts').stopMonthly;
declare var deleteMonthly: typeof import('../../src/screens/monthly.ts').deleteMonthly;
declare var saveMonthlyFromLedger: typeof import('../../src/screens/monthly.ts').saveMonthlyFromLedger;
declare var moveMonthlyOffCard: typeof import('../../src/screens/monthly.ts').moveMonthlyOffCard;

// 家計簿の画面（src/screens/ledger.ts）
declare var openLedgerModal: typeof import('../../src/screens/ledger.ts').openLedgerModal;
declare var selLdgType: typeof import('../../src/screens/ledger.ts').selLdgType;
declare var renderLdgType: typeof import('../../src/screens/ledger.ts').renderLdgType;
declare var renderCatChips: typeof import('../../src/screens/ledger.ts').renderCatChips;
declare var selCat: typeof import('../../src/screens/ledger.ts').selCat;
declare var payOptions: typeof import('../../src/screens/ledger.ts').payOptions;
declare var payChipsHtml: typeof import('../../src/screens/ledger.ts').payChipsHtml;
declare var renderPayChips: typeof import('../../src/screens/ledger.ts').renderPayChips;
declare var selReceive: typeof import('../../src/screens/ledger.ts').selReceive;
declare var selPayAt: typeof import('../../src/screens/ledger.ts').selPayAt;
declare var renderLdgRepeat: typeof import('../../src/screens/ledger.ts').renderLdgRepeat;
declare var saveLedger: typeof import('../../src/screens/ledger.ts').saveLedger;
declare var closeLdgModal: typeof import('../../src/screens/ledger.ts').closeLdgModal;
declare var openLdgEdit: typeof import('../../src/screens/ledger.ts').openLdgEdit;
declare var closeLdgEdit: typeof import('../../src/screens/ledger.ts').closeLdgEdit;
declare var selLdeType: typeof import('../../src/screens/ledger.ts').selLdeType;
declare var renderLdeType: typeof import('../../src/screens/ledger.ts').renderLdeType;
declare var renderLdeCatChips: typeof import('../../src/screens/ledger.ts').renderLdeCatChips;
declare var selLdeCat: typeof import('../../src/screens/ledger.ts').selLdeCat;
declare var renderLdePayChips: typeof import('../../src/screens/ledger.ts').renderLdePayChips;
declare var selLdeReceive: typeof import('../../src/screens/ledger.ts').selLdeReceive;
declare var selLdePayAt: typeof import('../../src/screens/ledger.ts').selLdePayAt;
declare var saveLdgEdit: typeof import('../../src/screens/ledger.ts').saveLdgEdit;
declare var ldgTab: typeof import('../../src/screens/ledger.ts').ldgTab;
declare var updateLdgNav_: typeof import('../../src/screens/ledger.ts').updateLdgNav_;
declare var ldgMonthPrev: typeof import('../../src/screens/ledger.ts').ldgMonthPrev;
declare var ldgMonthNext: typeof import('../../src/screens/ledger.ts').ldgMonthNext;
declare var ldgYearPrev: typeof import('../../src/screens/ledger.ts').ldgYearPrev;
declare var ldgYearNext: typeof import('../../src/screens/ledger.ts').ldgYearNext;
declare var setLdgGraphMode: typeof import('../../src/screens/ledger.ts').setLdgGraphMode;
declare var renderLedgerAll_: typeof import('../../src/screens/ledger.ts').renderLedgerAll_;
declare var renderLedgerMetrics: typeof import('../../src/screens/ledger.ts').renderLedgerMetrics;
declare var renderLedger: typeof import('../../src/screens/ledger.ts').renderLedger;
declare var toggleLdgGroup: typeof import('../../src/screens/ledger.ts').toggleLdgGroup;
declare var delLedger: typeof import('../../src/screens/ledger.ts').delLedger;
declare var renderCatChart_: typeof import('../../src/screens/ledger.ts').renderCatChart_;
declare var renderChartsMonth_: typeof import('../../src/screens/ledger.ts').renderChartsMonth_;
declare var renderChartsYear_: typeof import('../../src/screens/ledger.ts').renderChartsYear_;
declare var renderCharts: typeof import('../../src/screens/ledger.ts').renderCharts;
declare var onLedgerDayChanged: typeof import('../../src/screens/ledger.ts').onLedgerDayChanged;

// ホーム（src/screens/home.ts。ナビ・カレンダーと HTML が呼ぶ）
declare var renderHome: typeof import('../../src/screens/home.ts').renderHome;
declare var openHomeMore: typeof import('../../src/screens/home.ts').openHomeMore;
declare var closeHomeMore: typeof import('../../src/screens/home.ts').closeHomeMore;

// カレンダー（src/screens/calendar.ts。ナビ・起動・HTML が呼ぶ）
declare var selDay: string | null;
declare var renderCal: typeof import('../../src/screens/calendar.ts').renderCal;
declare var refreshDayViews: typeof import('../../src/screens/calendar.ts').refreshDayViews;
declare var prevM: typeof import('../../src/screens/calendar.ts').prevM;
declare var nextM: typeof import('../../src/screens/calendar.ts').nextM;
declare var setCalView: typeof import('../../src/screens/calendar.ts').setCalView;
declare var jumpToDay: typeof import('../../src/screens/calendar.ts').jumpToDay;
declare var closeDayDetail: typeof import('../../src/screens/calendar.ts').closeDayDetail;
declare var sameRecord: typeof import('../../src/screens/calendar.ts').sameRecord;
declare var dayClick: typeof import('../../src/screens/calendar.ts').dayClick;
declare var dayCellClick: typeof import('../../src/screens/calendar.ts').dayCellClick;
declare var togglePlanDone: typeof import('../../src/screens/calendar.ts').togglePlanDone;
declare var deletePlan: typeof import('../../src/screens/calendar.ts').deletePlan;
declare var onCalendarDayChanged: typeof import('../../src/screens/calendar.ts').onCalendarDayChanged;
