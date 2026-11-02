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
import { mountLocalLogin } from './local-login.ts';

window.MoneyData = { ...data };
window.MoneyCompat = { ...compat };
window.MoneyClock = { ...clock };
window.MoneyCalc = { ...money };
window.MoneyTasks = { ...tasks };
window.MoneyMonthly = { ...monthly };
window.MoneyBackup = { ...backup };
window.MoneyEnv = ENV;

// ローカルの Supabase につなぐビルドのときだけ、メールとパスワードのログインの入口を出す（D19）。
// 条件は ENV.target ではなく置き換えられる文字で書く（本番のビルドで、この行と local-login.ts を取り除けるように）
if (__MANEY_TARGET__ === 'local') mountLocalLogin(ENV);
