/**
 * maney-app-sync / gas/categorize.gs
 *
 * 楽天カード明細の初見の店名を、無料のGoogle Gemini APIでカテゴリ分類する。
 * 詳細設計は docs/design.md「拡張: AI機能」節の「機能A」を参照。
 *
 * 呼び出し元は main() の importRakutenMails_ 成功後（main.gs側で追加）。
 * st.merchantRules に学習済みの店名は対象外にするため、AIは同じ店について
 * 一生に一度しか呼ばれない（2回目以降は学習済みルールだけで処理される）。
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_CAT_EXP = ['食費', '交通費', '外食', '娯楽', '日用品', '通信費', '固定費', 'その他'];

/**
 * main()から呼ばれるエントリポイント。GEMINI_API_KEY未設定・分類対象なし・
 * Gemini呼び出し失敗のいずれの場合も、例外を投げず静かに戻る
 * （main()全体を巻き添えで落とさないため。main.gs側でもtry/catchする）。
 */
function categorizeNewCardTx_(cfg){
  const apiKey = getGeminiKey_();
  if (!apiKey) return; // AI未設定 = 静的ルール+デフォルトカテゴリのままPWA側で表示される

  const pending = fetchPendingUncategorized_(cfg);
  if (!pending.length) return;

  const st = fetchUserData_(cfg);
  const catExp = (st && st.catExp && st.catExp.length) ? st.catExp : DEFAULT_CAT_EXP;
  const merchantRules = (st && st.merchantRules) || {};

  // 既に学習済みの店名はAIを呼ぶ必要がない（PWA側resolveCardTxCategory_が優先的に使う）
  const targets = pending.filter(r => !merchantRules[r.merchant_norm || r.merchant_raw]);
  const distinctKeys = [...new Set(targets.map(r => r.merchant_norm || r.merchant_raw))];
  if (!distinctKeys.length) return;

  const mapping = classifyMerchantsWithGemini_(apiKey, distinctKeys, catExp);
  if (!mapping) return; // 失敗時は何も書き込まない。次回main()実行時に再トライされる

  pending.forEach(r => {
    const key = r.merchant_norm || r.merchant_raw;
    if (mapping[key]) updateCardTxAiCat_(cfg, r.id, mapping[key]);
  });
}

/**
 * status='pending' かつ ai_suggested_cat が未設定の行を取得する。
 * @return {Array<{id:string, merchant_raw:string, merchant_norm:string}>}
 */
function fetchPendingUncategorized_(cfg){
  const url = `${cfg.SUPABASE_URL}/rest/v1/card_tx?status=eq.pending&ai_suggested_cat=is.null&select=id,merchant_raw,merchant_norm`;
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
    logFailure_('未分類card_txの取得に失敗しました', `status:${res.getResponseCode()} body:${res.getContentText()}`);
    return [];
  }
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    logFailure_('未分類card_tx応答のパースに失敗しました', String(e));
    return [];
  }
}

/**
 * card_tx 1行の ai_suggested_cat を更新する。
 */
function updateCardTxAiCat_(cfg, id, cat){
  const url = `${cfg.SUPABASE_URL}/rest/v1/card_tx?id=eq.${id}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: cfg.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${cfg.SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
      'User-Agent': 'maney-app-sync-gas/1.0'
    },
    payload: JSON.stringify({ ai_suggested_cat: cat }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    logFailure_('card_tx.ai_suggested_catの更新に失敗しました', `id:${id} status:${code} body:${res.getContentText()}`);
  }
}

/**
 * 店名リストをまとめて1回のリクエストでGeminiに分類させる（店名ごとに個別
 * リクエストしない＝無料枠のRPM/RPDを節約）。返ってきたカテゴリがcatExpに
 * 実在するかを検証してから採用する（ハレーション対策）。
 * @return {Object<string,string>|null} { 店名: カテゴリ名 }。失敗時null
 */
function classifyMerchantsWithGemini_(apiKey, keys, catExp){
  const prompt = `クレジットカード明細の店舗名を分類してください。カテゴリ: ${catExp.join('、')}
店舗名:
${keys.map((k, i) => `${i + 1}. ${k}`).join('\n')}
出力形式(他のテキストは含めない): [{"merchant":"店舗名","category":"カテゴリ名"}, ...]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    logFailure_('Geminiカテゴリ分類に失敗しました', `status:${res.getResponseCode()} body:${res.getContentText()}`);
    return null;
  }
  try {
    const text = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
    const arr = JSON.parse(text);
    const map = {};
    arr.forEach(item => { if (catExp.includes(item.category)) map[item.merchant] = item.category; });
    return map;
  } catch (e) {
    logFailure_('Geminiカテゴリ分類の応答パースに失敗しました', String(e));
    return null;
  }
}
