/**
 * maney-app / sync/gas/advice.gs
 *
 * 月次支出アドバイス。カテゴリ別の前月比などの数値計算はGAS側で決定論的に
 * 行い、Geminiにはその数値を渡して自然文の助言だけを書かせる
 * （数値をAIに計算させない＝ハレーション防止）。
 * 詳細設計は docs/design.md「拡張: AI機能」節の「機能B」を参照。
 *
 * ── セットアップ ──────────────────────────────────────────
 * installMonthlyAdviceTrigger を一度だけ手動実行すると、毎月1日の朝8時頃に
 * monthlyAdvice が自動実行されるようになる。GEMINI_API_KEY未設定の間は
 * 何も生成せず静かにスキップする。
 * ────────────────────────────────────────────────────────────
 */

/**
 * 多重登録防止のため、既存の monthlyAdvice トリガーを一旦全部消してから
 * 作り直す。
 */
function installMonthlyAdviceTrigger(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'monthlyAdvice') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monthlyAdvice')
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .create();
  console.log('トリガーを設定しました（毎月1日の朝8時頃に monthlyAdvice を実行）');
}

function monthlyAdvice(){
  try{
    const cfg = getConfig_();
    const apiKey = getGeminiKey_();
    if (!apiKey) return; // AI未設定なら何もしない

    const st = fetchUserData_(cfg);
    if (!st || !st.ledger) return;

    const stats = computeMonthlyStats_(st); // 決定論的な集計。数値はここで確定し、AIには渡すだけ
    if (!stats) return;

    const message = writeAdviceWithGemini_(apiKey, stats);
    if (!message) return;

    postAiInsight_(cfg, stats.period, message);
  }catch(e){
    logFailure_('月次アドバイス生成に失敗しました', `${e}\n\n${e.stack || '(stack trace なし)'}`);
  }finally{
    flushFailureNotifications_();
  }
}

/**
 * 今月・先月の支出をカテゴリ別に集計し、増加額が大きい上位カテゴリだけ
 * 抜き出す。カード引き落とし予測・給料日残高計算などの複雑ロジック
 * （PWA側のcycle()/upcomingFixed()/daysToP()等）は意図的に対象外とする
 * （PWA側を直したときに助言だけ古い数字を出す事故を避けるため）。
 * @return {{period:string, changes:Array, totalThis:number, budget:number}|null}
 */
function computeMonthlyStats_(st){
  const now = new Date();
  const period = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');

  const catSumsForMonth = (monthKey) => {
    const sums = {};
    st.ledger.forEach(l => {
      if (l.type !== 'expense') return;
      if (!l.date || l.date.slice(0, 7) !== monthKey) return;
      sums[l.cat] = (sums[l.cat] || 0) + parseInt(l.amount, 10);
    });
    return sums;
  };

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = Utilities.formatDate(lastMonthDate, 'Asia/Tokyo', 'yyyy-MM');
  const thisSums = catSumsForMonth(period), lastSums = catSumsForMonth(lastMonthKey);

  const changes = Object.keys(thisSums).map(cat => {
    const cur = thisSums[cat], prev = lastSums[cat] || 0;
    return { cat, cur, prev, diff: cur - prev, pct: prev > 0 ? Math.round((cur - prev) / prev * 100) : null };
  }).filter(c => c.diff >= 3000) // ノイズ除去: 増加額3000円未満は無視
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  const totalThis = Object.values(thisSums).reduce((a, b) => a + b, 0);
  if (changes.length === 0 && !(st.budget > 0)) return null; // 報告すべき変化がなければ生成しない

  return { period, changes, totalThis, budget: st.budget || 0 };
}

/**
 * 計算済みの数値をプロンプトに埋め込み、数値を新たに創作しないよう
 * 明示的に指示した上でGeminiに2〜3文の助言を書かせる。
 * @return {string|null} 助言本文。失敗時null
 */
function writeAdviceWithGemini_(apiKey, stats){
  const changesText = stats.changes.map(c =>
    `${c.cat}: 今月¥${c.cur} 先月¥${c.prev}(${c.pct !== null ? (c.pct > 0 ? '+' : '') + c.pct + '%' : '新規'})`
  ).join('\n');
  const budgetText = stats.budget > 0 ? `今月の予算: ¥${stats.budget}、現在の支出: ¥${stats.totalThis}` : '';

  const prompt = `以下は家計簿アプリの今月の支出データです。この数値だけを使って(新しい数値を作らずに)、
親しみやすい日本語で2〜3文の気づき・アドバイスを書いてください。説教くさくせず、軽い調子で。

${changesText}
${budgetText}

出力は本文のみ(見出し・箇条書き不要)。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    logFailure_('月次アドバイスのGemini生成に失敗しました', `status:${res.getResponseCode()} body:${res.getContentText()}`);
    return null;
  }
  try {
    return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text.trim();
  } catch (e) {
    logFailure_('月次アドバイス応答のパースに失敗しました', String(e));
    return null;
  }
}

/**
 * ai_insightsに1行INSERTする。kindは常に'monthly_advice'固定
 * （PWA側は最新1件をkindでフィルタして表示する）。
 */
function postAiInsight_(cfg, period, message){
  const url = `${cfg.SUPABASE_URL}/rest/v1/ai_insights`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: cfg.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${cfg.SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
      'User-Agent': 'maney-app-sync-gas/1.0'
    },
    payload: JSON.stringify({ user_id: cfg.USER_ID, kind: 'monthly_advice', period, message }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    logFailure_('ai_insightsへの書き込みに失敗しました', `status:${code} body:${res.getContentText()}`);
  }
}
