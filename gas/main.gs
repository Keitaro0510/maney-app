/**
 * maney-app-sync / gas/main.gs
 *
 * 楽天カードの「カード利用のお知らせ(本人ご利用分)」確定版メールを検索・パースし、
 * Supabaseの card_tx テーブルへ取り込む。詳細設計は docs/design.md を参照。
 *
 * ── セットアップ手順 ──────────────────────────────────────────
 * 1. https://script.google.com/ で新規プロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」で以下を設定する
 *      SUPABASE_URL              例: https://xxxxx.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY  Supabase の service_role キー（絶対にコードに書かない）
 *      USER_ID                    maney-app 側の auth.users.id（自分のユーザーUUID）
 * 3. sql/card_tx.sql を Supabase の SQL Editor で実行し、テーブルを作成しておく
 * 4. エディタ上部の関数選択で installTrigger を選び、一度だけ手動実行する
 *    （実行時に「このアプリは確認されていません」と出たら「詳細」→続行で許可する。
 *      Gmail・外部リクエスト・トリガー管理の権限を求められるので許可する）
 * 5. 以降は15分おきに main() が自動実行される。動作確認は importRakutenMails を
 *    直接実行し、実行ログ（表示 → ログ）でエラーが出ていないか確認する
 * 6. 過去分をまとめて取り込みたい場合は backfill() を手動実行する（対象期間は下記で調整）
 * ────────────────────────────────────────────────────────────
 */

const RAKUTEN_SENDER = 'info@mail.rakuten-card.co.jp';
const RAKUTEN_LABEL_NAME = 'maney/rakuten-imported';
const RAKUTEN_START_MARKER = '<カードご利用情報>';
const RAKUTEN_END_MARKER = '■ご利用明細のご確認';

// ============================================================
// エントリポイント（時間主導トリガーから呼ばれる）
// ============================================================
function main() {
  try {
    const query = `from:${RAKUTEN_SENDER} -label:${RAKUTEN_LABEL_NAME} newer_than:14d`;
    const result = importRakutenMails_(query);
    recordLastRun_(true, `imported=${result.imported} skipped=${result.skipped} threads=${result.threadsLabeled}/${result.threadsTotal}`);

    // AI機能(カテゴリ自動判定、gas/categorize.gs)。GEMINI_API_KEY未設定の間は
    // categorizeNewCardTx_ 内部で何もせず戻る。万一失敗してもカード取り込み
    // 自体は既に成功しているため、ここだけ個別にtry/catchしてmain()全体を
    // 巻き添えにしない。
    try {
      categorizeNewCardTx_(getConfig_());
    } catch (e) {
      logFailure_('カテゴリ自動判定の実行中に例外が発生しました', `${e}\n\n${e.stack || '(stack trace なし)'}`);
    }
  } catch (e) {
    recordLastRun_(false, String(e));
    logFailure_('GAS実行中に例外が発生しました', `${e}\n\n${e.stack || '(stack trace なし)'}`);
    throw e; // Apps Script の実行ログにも残す
  } finally {
    flushFailureNotifications_();
  }
}

/**
 * 過去分をまとめて取り込みたいときに手動実行する。
 * newer_than の日数はここで直接書き換えて使う（例: 400日分をバックフィルしたいなら 400d）。
 */
function backfill() {
  try {
    const query = `from:${RAKUTEN_SENDER} -label:${RAKUTEN_LABEL_NAME} newer_than:400d`;
    const result = importRakutenMails_(query);
    console.log(`backfill done: imported=${result.imported} skipped=${result.skipped} threads=${result.threadsLabeled}/${result.threadsTotal}`);
  } finally {
    flushFailureNotifications_();
  }
}

// ============================================================
// 初回セットアップ用（installTrigger だけ手動で1回実行する）
// ============================================================
function installTrigger() {
  // 多重登録防止のため、既存の main トリガーを一旦全部消してから作り直す
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(15)
    .create();
  console.log('トリガーを設定しました（15分おきに main() を実行）');
}

// ============================================================
// 設定読み込み
// ============================================================
/**
 * SUPABASE_URL に誤って /rest/v1 や末尾スラッシュ付きの値が設定されていても、
 * postToSupabase_ 側で "https://xxx.supabase.co/rest/v1//rest/v1/card_tx" の
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
// メイン処理: Gmail検索 → パース → Supabase送信 → ラベル付与
// ============================================================
function importRakutenMails_(query) {
  const cfg = getConfig_();
  const label = getOrCreateLabel_(RAKUTEN_LABEL_NAME);
  const threads = GmailApp.search(query, 0, 50);

  let imported = 0, skipped = 0, threadsLabeled = 0;

  threads.forEach(thread => {
    let threadOk = true; // このスレッド内の全メッセージを問題なく処理できたか

    thread.getMessages().forEach(message => {
      // 件名で確定版のみに絞る（速報版は店名が無いので対象外）
      const subject = message.getSubject();
      if (subject.indexOf('速報版') !== -1) return;
      if (subject.indexOf('カード利用のお知らせ') === -1) return;

      const body = message.getPlainBody();
      if (body.indexOf(RAKUTEN_START_MARKER) === -1) return;

      const blocks = parseRakutenBody_(body);
      if (blocks.length === 0) {
        // 確定版と判定したのに明細が1件も取れない＝フォーマット変更等の疑いがあるので記録して停止
        logFailure_(
          '楽天カードメールのパース結果が0件でした（フォーマット変更の可能性）',
          `messageId: ${message.getId()}\nsubject: ${subject}\n\n--- 本文冒頭300文字 ---\n${body.slice(0, 300)}`
        );
        threadOk = false;
        return;
      }

      const messageId = message.getId();
      const rows = blocks
        .map(b => buildRow_(cfg.USER_ID, messageId, b))
        .filter(r => r !== null);

      if (rows.length === 0) {
        logFailure_(
          '楽天カードメールの日付/金額パースに失敗しました',
          `messageId: ${message.getId()}\nsubject: ${subject}`
        );
        threadOk = false;
        return;
      }

      const ok = postToSupabase_(cfg.SUPABASE_URL, cfg.SERVICE_ROLE_KEY, rows);
      if (ok) {
        imported += rows.length;
      } else {
        skipped += rows.length;
        threadOk = false; // 書き込み失敗時はラベルを付けない → 次回リトライされる
      }
    });

    // Supabaseへの書き込みが全部成功した場合のみラベルを付ける
    // （逆にすると「ラベルは付いたがDBには無い」という恒久的な取りこぼしが起きるため）
    if (threadOk) {
      thread.addLabel(label);
      threadsLabeled++;
    }
  });

  return { imported, skipped, threadsLabeled, threadsTotal: threads.length };
}

// ============================================================
// パース: 本文 → ブロック分割 → 辞書化 → 明細抽出
// ============================================================
/**
 * 楽天カード確定版メールの本文から明細ブロックを抽出する。
 * 固定順の正規表現ではなく「■項目名: 値」を辞書として拾う方式にしているため、
 * 楽天側が項目を増減・並べ替えても、利用日/利用先/利用金額の3項目さえ
 * 残っていればパースが継続する。
 *
 * @return {Array<{blockIndex:number, section:string, usedOnRaw:string,
 *                  merchantRaw:string, userType:string, payMethod:string,
 *                  amountRaw:string, billMonthRaw:string}>}
 */
function parseRakutenBody_(body) {
  const normalized = body.replace(/\r\n?/g, '\n');

  const startIdx = normalized.indexOf(RAKUTEN_START_MARKER);
  if (startIdx === -1) return [];
  let text = normalized.slice(startIdx + RAKUTEN_START_MARKER.length);

  const endIdx = text.indexOf(RAKUTEN_END_MARKER);
  if (endIdx !== -1) text = text.slice(0, endIdx);

  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);

  const records = [];
  let currentSection = '';

  blocks.forEach((block, blockIndex) => {
    // 《ショッピングご利用分》のようなセクション見出しを検知（以降のブロックにも引き継ぐ）
    const sectionMatch = block.match(/《(.+?)》/);
    if (sectionMatch) currentSection = sectionMatch[1];

    const dict = {};
    block.split('\n').forEach(line => {
      // 全角コロン・半角コロンどちらにも対応
      const m = line.match(/^■(.+?)\s*[:：]\s*(.*)$/);
      if (m) dict[m[1].trim()] = m[2].trim();
    });

    // 利用日・利用先・利用金額が揃っているブロックだけを明細とみなす
    // （揃っていない「■ご利用明細のご確認」等の宣伝ブロックはここで自動的に除外される）
    if (dict['利用日'] && dict['利用先'] && dict['利用金額']) {
      records.push({
        blockIndex,
        section: currentSection,
        usedOnRaw: dict['利用日'],
        merchantRaw: dict['利用先'],
        userType: dict['利用者'] || '',
        payMethod: dict['支払方法'] || '',
        amountRaw: dict['利用金額'],
        billMonthRaw: dict['支払月'] || ''
      });
    }
  });

  return records;
}

/**
 * パース済みブロック1件を Supabase card_tx の1行分のオブジェクトに変換する。
 * 日付/金額が解釈できなければ null を返す。
 */
function buildRow_(userId, messageId, block) {
  const usedOn = toIsoDate_(block.usedOnRaw);
  const amount = parseAmount_(block.amountRaw);
  if (!usedOn || amount === null) return null;

  return {
    user_id: userId,
    dedupe_key: `${messageId}#${block.blockIndex}`,
    gmail_msg_id: messageId,
    source: 'rakuten_mail',
    section: block.section || null,
    used_on: usedOn,
    merchant_raw: block.merchantRaw,
    merchant_norm: normalizeMerchant_(block.merchantRaw),
    user_type: block.userType || null,
    pay_method: block.payMethod || null,
    amount: amount,
    bill_month: toIsoMonth_(block.billMonthRaw)
  };
}

/** '2026/07/04' → '2026-07-04' */
function toIsoDate_(s) {
  const m = String(s).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** '2026/08' → '2026-08' */
function toIsoMonth_(s) {
  const m = String(s).match(/(\d{4})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** '12,150 円' → 12150 */
function parseAmount_(s) {
  const cleaned = String(s).replace(/[,\s円]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

/**
 * 店名の表記ゆれを正規化する。
 *   ﾛｰｿﾝ            → ローソン        (NFKCで半角カナ→全角カナ)
 *   Ｓｕｉｃａ（携帯決済） → SUICA(携帯決済) (NFKCで全角英数→半角英数、全角記号→半角記号)
 *   ﾐｽﾀ-ﾄﾞ-ﾅﾂ         → ミスタードーナツ (ASCIIハイフン→長音符の補正込み)
 * カテゴリ自動推定はこの正規化後の文字列に対して行う想定（PWA側）。
 */
function normalizeMerchant_(raw) {
  return String(raw)
    .normalize('NFKC')
    .replace(/-/g, 'ー')
    .replace(/\s+/g, '')
    .toUpperCase();
}

// ============================================================
// Supabase送信
// ============================================================
/**
 * card_tx へ INSERT する。dedupe_key のユニーク制約 + ignore-duplicates で、
 * 同じメールを何度処理しても重複挿入されない（冪等）。
 * @return {boolean} 成功したか
 */
function postToSupabase_(supabaseUrl, serviceRoleKey, rows) {
  const url = `${supabaseUrl}/rest/v1/card_tx?on_conflict=user_id,dedupe_key`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'resolution=ignore-duplicates,return=minimal',
      // UrlFetchAppの既定User-Agentには"Mozilla/5.0 (compatible; Google-Apps-Script; ...)"が
      // 入っており、Supabaseの新しいsecret API key（sb_secret_...）はUser-Agentを見て
      // 「ブラウザからの利用」と誤検知し 401 Forbidden use of secret API key in browser を返す。
      // 明示的に上書きして回避する。
      'User-Agent': 'maney-app-sync-gas/1.0'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code >= 200 && code < 300) return true;

  logFailure_(
    'Supabaseへの書き込みに失敗しました',
    `status: ${code}\nbody: ${res.getContentText()}\n\nrows:\n${JSON.stringify(rows, null, 2)}`
  );
  return false;
}

// ============================================================
// Gmailラベル
// ============================================================
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ============================================================
// 失敗通知・実行記録
// ============================================================
/**
 * 実行中に発生した失敗を溜めておくバッファ。個別にメールを送らず、
 * 1回の実行（main/backfill）の最後に flushFailureNotifications_ で
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
 * main()/backfill() の finally から必ず呼ぶ。
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

/**
 * 最終実行時刻・結果をScript Propertiesに記録する。
 * PWA側の設定画面から「最終取り込み: N時間前」として参照する想定
 * （PWAからこのプロパティを直接読むことはできないため、将来的にはSupabaseの
 *   別テーブル or card_tx の最新created_atから代替表示することも検討する）。
 */
function recordLastRun_(success, detail) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_RUN_AT', new Date().toISOString());
  props.setProperty('LAST_RUN_STATUS', success ? 'ok' : 'error');
  props.setProperty('LAST_RUN_DETAIL', detail);
}
