// 型の検査（checkJs。D4 の手順3・D16）のための宣言。js/ はふつうの <script> なので、ファイルどうしは window の名前でつながっている

// CDN から読むもの（index.html の <script>）。型の定義を入れていないので any
declare const supabase: any;
declare const Chart: any;

// window に出す名前。型は、src/ のものは export から（src/main.ts が出す。D17）、js/ のものは module.exports（Node のテスト用）から読む
declare var MoneyData: typeof import('../js/data.js');
declare var MoneyCompat: typeof import('../js/compat.js');
declare var MoneyClock: typeof import('../src/clock.ts');
declare var MoneyCalc: typeof import('../src/money.ts');
declare var MoneyUI: typeof import('../js/ui.js');
declare var MoneyTasks: typeof import('../js/tasks.js');
declare var MoneyMonthly: typeof import('../js/monthly.js');
declare var MoneyBackup: typeof import('../js/backup.js');
