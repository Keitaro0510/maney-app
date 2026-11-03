// アプリの入口（D4 の手順4・D17）。src/ の ES モジュールを読み、まだふつうの <script> の js/ から使えるように window に出す。
// - js/ の <script> は index.html の <body> に defer で置いてあり、このモジュールのあとで、書いた順に動く
// - トップレベルの await は使わない（待っている間に js/ が先に動いてしまう。ビルドが止めるようにしてある。vite.config.mjs）
// - 出すのは、モジュールの関数を入れたふつうのオブジェクト（前の js/ のファイルが出していたものと同じ形）
import * as data from './data.ts';
import * as compat from './compat.ts';
import * as clock from './clock.ts';
import * as money from './money.ts';
import * as tasks from './tasks.ts';
import * as monthly from './monthly.ts';
import * as backup from './backup.ts';
import { ENV } from './env.ts';
import { exposeLegacyState } from './state.ts';
import * as sync from './sync.ts';
import * as auth from './auth.ts';
import { createSupa } from './supa.ts';
import * as dates from './dates.ts';
import { LEGACY_PALETTE } from './palette.ts';
import * as ui from './ui.ts';
import { LEGACY_TASKS } from './screens/tasks.ts';
import { LEGACY_BACKUP } from './screens/backup.ts';
import { LEGACY_CARDS } from './cards.ts';
import { LEGACY_SETTINGS } from './screens/settings.ts';
import { LEGACY_CARD_SCREEN } from './screens/cards.ts';
import { LEGACY_ATM } from './screens/atm.ts';
import { LEGACY_SHIFTS } from './shifts.ts';
import { LEGACY_SHIFT_SCREEN } from './screens/shift.ts';
import { LEGACY_PLANS } from './plans.ts';
import { LEGACY_PLAN_SCREEN } from './screens/plans.ts';
import { LEGACY_LEDGER } from './ledger.ts';
import { LEGACY_MONTHLY_SCREEN } from './screens/monthly.ts';
import { LEGACY_LEDGER_SCREEN } from './screens/ledger.ts';
import { LEGACY_HOME } from './screens/home.ts';
import { LEGACY_CALENDAR, getSelectedCalDay } from './screens/calendar.ts';
import { mountLocalLogin } from './local-login.ts';

window.MoneyData = { ...data };
window.MoneyCompat = { ...compat };
window.MoneyClock = { ...clock };
window.MoneyCalc = { ...money };
window.MoneyTasks = { ...tasks };
window.MoneyMonthly = { ...monthly };
window.MoneyBackup = { ...backup };
window.MoneyEnv = ENV;

// データと同期の状態（D19 の手順3）。js/ の画面は st・server などの名前で、src/state.ts の入れ物を読み書きする
exposeLegacyState(window);

// 日付の補助と今の日時（_now・TODAY）、色と最初のカテゴリ（D20 の 1）。js/ は名前で使う（期限付きの互換の層）
window.MoneyDates = { ...dates };
dates.exposeLegacyDates(window);
Object.assign(window, LEGACY_PALETTE);

// 画面の部品（D20 の 2。js/ui.js から移した）。js/ の画面は MoneyUI.〜 で使う
window.MoneyUI = { ...ui };

// 画面（D20 の 2〜）。src/screens/ のモジュールのうち、js/ と index.html が名前で呼ぶものを window に出す（期限付きの互換の層）
Object.assign(window, LEGACY_TASKS, LEGACY_BACKUP, LEGACY_CARDS, LEGACY_SETTINGS, LEGACY_CARD_SCREEN, LEGACY_ATM);
Object.assign(window, LEGACY_SHIFTS);
Object.assign(window, LEGACY_SHIFT_SCREEN);
Object.assign(window, LEGACY_PLANS);
Object.assign(window, LEGACY_PLAN_SCREEN);
Object.assign(window, LEGACY_LEDGER);
Object.assign(window, LEGACY_MONTHLY_SCREEN);
Object.assign(window, LEGACY_LEDGER_SCREEN);
Object.assign(window, LEGACY_HOME);
Object.assign(window, LEGACY_CALENDAR);
Object.defineProperty(window, 'selDay', { get: getSelectedCalDay, enumerable: true });

// 保存・送信・読み込みの流れ（D19 の手順4）。js/app-core.js が MoneySync.initSync で画面の関数を渡す。
// まだ js/ の画面が名前で呼ぶもの（save・currentRows など）は、同じ名前で window に出す（期限付きの互換の層）
window.MoneySync = { ...sync };
Object.assign(window, sync.LEGACY_SYNC);

// Supabase のクライアントと、ログインと起動の流れ（D19 の手順5）。js/app-core.js が MoneyAuth.initAuth で画面の関数を渡す。
// js/ と index.html が名前で呼ぶもの（supa・loginWithGoogle・logout・loadData）は、同じ名前で window に出す（期限付きの互換の層）
window.supa = createSupa(ENV);
window.MoneyAuth = { ...auth };
Object.assign(window, auth.LEGACY_AUTH);

// ローカルの Supabase につなぐビルドのときだけ、メールとパスワードのログインの入口を出す（D19）。
// 条件は ENV.target ではなく置き換えられる文字で書く（本番のビルドで、この行と local-login.ts を取り除けるように）
if (__MANEY_TARGET__ === 'local') mountLocalLogin(ENV);
