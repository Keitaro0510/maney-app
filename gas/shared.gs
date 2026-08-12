/**
 * maney-app-sync / gas/shared.gs
 *
 * AI機能(categorize.gs / advice.gs)とLINE通知(notify.gs)が共通で使うヘルパー。
 * main.gsのgetConfig_()/logFailure_()/flushFailureNotifications_()はここでは
 * 再定義せず、そのままグローバルスコープ経由で利用する。
 */

// ============================================================
// user_data（st全体）の読み取り
// ============================================================
/**
 * Supabaseのuser_dataテーブルからst全体(value列、jsonb)を1回GETする。
 * main.gsのpostToSupabase_と同じapikey+Authorization: Bearerヘッダー方式。
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
 * （例外を投げない）。カテゴリ判定・月次アドバイスはこれがnullのとき
 * 何もせず静かにスキップし、既存のカード取り込み処理を巻き添えで壊さない。
 * @return {string|null}
 */
function getGeminiKey_(){
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || null;
}
