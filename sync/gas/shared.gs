/**
 * maney-app / sync/gas/shared.gs
 *
 * 月次アドバイス(advice.gs)とLINE通知(notify.gs)が共通で使うヘルパー。
 * 設定の読み込み・失敗通知は、以前は楽天カード取り込み用の main.gs にあったが、
 * 取り込み機能の削除(2026-10-24)に合わせてここへ移した。
 */

const GEMINI_MODEL = 'gemini-2.5-flash';

// ============================================================
// 設定読み込み
// ============================================================
/**
 * SUPABASE_URL に誤って /rest/v1 や末尾スラッシュ付きの値が設定されていても、
 * REST呼び出しで "https://xxx.supabase.co/rest/v1//rest/v1/ai_insights" の
 * ような二重パスになって PGRST125 (Invalid path specified in request URL) に
 * ならないよう、ここで必ずベースURL（末尾スラッシュなし）に正規化する。
 */
function normalizeSupabaseUrl_(url) {
  if (!url) return url;
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    SUPABASE_URL: normalizeSupabaseUrl_(props.getProperty('SUPABASE_URL')),
    SERVICE_ROLE_KEY: props.getProperty('SUPABASE_SERVICE_ROLE_KEY'),
    USER_ID: props.getProperty('USER_ID')
  };
  const missing = Object.keys(cfg).filter(k => !cfg[k]);
  if (missing.length) {
    throw new Error('スクリプトプロパティが未設定です: ' + missing.join(', '));
  }
  return cfg;
}

// ============================================================
// 失敗通知
// ============================================================
/**
 * 実行中に発生した失敗を溜めておくバッファ。個別にメールを送らず、
 * 1回の実行（monthlyAdvice/dailyDigest）の最後に flushFailureNotifications_ で
 * まとめて1通だけ送る。GASのメール送信は消費者アカウントで約100通/日の
 * クォータしかなく、デバッグ中に大量の失敗が起きると即座に枯渇するため
 * （実際に起きた: 69→106→124件の失敗で "Service invoked too many times
 * for one day: email" となり、以後は通知メールすら送れなくなった）。
 */
let FAILURE_LOG_ = [];

/**
 * 失敗を記録する。メール送信の成否に関わらず必ず実行ログ（console.error）
 * に残るので、メールクォータが切れていても Apps Script エディタの
 * 「実行数」画面から原因を追える。
 */
function logFailure_(subject, body) {
  console.error(`${subject}\n${body}`);
  FAILURE_LOG_.push({ subject, body });
}

/**
 * 溜まった失敗をまとめて1通のメールで通知する。件数が多い場合は先頭数件の
 * 詳細だけを載せ、残りは件数のみ（詳細は実行ログを参照）とする。
 * 各エントリポイントの finally から必ず呼ぶ。
 */
function flushFailureNotifications_() {
  if (FAILURE_LOG_.length === 0) return;
  const count = FAILURE_LOG_.length;
  const MAX_DETAIL = 5;
  const detail = FAILURE_LOG_.slice(0, MAX_DETAIL)
    .map((f, i) => `--- ${i + 1}/${count}: ${f.subject} ---\n${f.body}`)
    .join('\n\n');
  const omitted = count > MAX_DETAIL
    ? `\n\n...ほか${count - MAX_DETAIL}件（詳細はGASの実行ログを参照してください）`
    : '';

  try {
    const email = Session.getActiveUser().getEmail();
    MailApp.sendEmail(email, `[maney-app-sync] ${count}件のエラーが発生しました`, detail + omitted);
  } catch (e) {
    // メールクォータ切れ等で通知自体が送れなくても、詳細は上でconsole.errorに出力済み
    console.error('通知メール送信に失敗（実行ログの内容を確認してください）: ' + e);
  }

  FAILURE_LOG_ = [];
}


// ============================================================
// user_data（st全体）の読み取り
// ============================================================
/**
 * Supabaseのuser_dataテーブルからst全体(value列、jsonb)を1回GETする。
 * apikey+Authorization: Bearerヘッダー方式（service_roleキー）。
 * 失敗時・データなし時はnullを返す（呼び出し側で「AI機能を静かにスキップする」
 * 判断に使えるよう、例外は投げない）。
 * @return {Object|null} st（PWA側の全状態オブジェクト）
 */
function fetchUserData_(cfg){
  const url = `${cfg.SUPABASE_URL}/rest/v1/user_data?user_id=eq.${cfg.USER_ID}&select=value`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      apikey: cfg.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${cfg.SERVICE_ROLE_KEY}`,
      'User-Agent': 'maney-app-sync-gas/1.0'
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    logFailure_('user_dataの取得に失敗しました', `status:${res.getResponseCode()} body:${res.getContentText()}`);
    return null;
  }
  try {
    const rows = JSON.parse(res.getContentText());
    return rows.length ? rows[0].value : null;
  } catch (e) {
    logFailure_('user_data応答のパースに失敗しました', String(e));
    return null;
  }
}

// ============================================================
// Gemini APIキー
// ============================================================
/**
 * GEMINI_API_KEYをスクリプトプロパティから読む。未設定ならnullを返す
 * （例外を投げない）。月次アドバイスはこれがnullのとき何もせず静かにスキップする。
 * @return {string|null}
 */
function getGeminiKey_(){
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || null;
}
