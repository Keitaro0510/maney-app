// 型の検査（checkJs。D4 の手順3・D16）のための宣言。js/ はふつうの <script> なので、ファイルどうしは window の名前でつながっている

// CDN から読むもの（index.html の <script>）。
// supabase は SDK の型（@supabase/supabase-js。index.html の CDN の版と同じ版を、開発用の依存に入れてある。D19）。Chart は型の定義を入れていないので any
declare const supabase: typeof import('@supabase/supabase-js');
declare const Chart: any;

// window に出す名前。型は、src/ のものは export から（src/main.ts が出す。D17）、js/ のものは module.exports（Node のテスト用）から読む
declare var MoneyData: typeof import('../src/data.ts');
declare var MoneyCompat: typeof import('../src/compat.ts');
declare var MoneyClock: typeof import('../src/clock.ts');
declare var MoneyCalc: typeof import('../src/money.ts');
declare var MoneyUI: typeof import('../js/ui.js');
declare var MoneyTasks: typeof import('../src/tasks.ts');
declare var MoneyMonthly: typeof import('../src/monthly.ts');
declare var MoneyBackup: typeof import('../src/backup.ts');
