/**
 * maney-app / sync/gas/notify.gs
 *
 * 毎朝7時頃、その日の予定・シフト・お金のイベントをLINEへpush通知する。詳細設計は docs/design.md「拡張: AI機能」節の
 * 「機能C」を参照。無料のLINE Messaging API（LINE Notifyは2025年3月末で
 * 終了済み）を使う。
 *
 * ── セットアップ手順 ──────────────────────────────────────────
 * 1. https://developers.line.biz/ でプロバイダー→Messaging APIチャネルを作成
 * 2. Messaging APIタブでチャネルアクセストークン(長期)を発行
 * 3. 同画面の「あなたのユーザーID」を控える
 * 4. 発行されたLINE公式アカウントを自分のLINEで友だち追加
 *    （未追加だとpushが届かない）
 * 5. GASのスクリプトプロパティに LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID を追加
 * 6. installDigestTrigger を一度だけ手動実行する
 * ────────────────────────────────────────────────────────────
 */

const DAYS_JA_ = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 多重登録防止のため、既存の dailyDigest トリガーを一旦全部消してから
 * 作り直す。GASの時間主導トリガーは
 * 厳密な時刻指定ができず、実際の発火は7:00〜7:15頃にばらつく点は許容する。
 */
function installDigestTrigger(){
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyDigest')
    .timeBased()
    .atHour(7)
    .nearMinute(0)
    .everyDays(1)
    .create();
  console.log('トリガーを設定しました（毎朝7時頃に dailyDigest を実行）');
}

// ============================================================
// LINE用設定（getConfig_()には混ぜない。LINE未設定時に月次アドバイスまで
// 巻き添えで落ちるのを防ぐため、専用の設定読み込み関数にする）
// ============================================================
function getLineConfig_(){
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    TOKEN: p.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    TO: p.getProperty('LINE_USER_ID')
  };
  const missing = Object.keys(cfg).filter(k => !cfg[k]);
  if (missing.length) {
    throw new Error('LINE用スクリプトプロパティが未設定です: ' + missing.join(', '));
  }
  return cfg;
}

// ============================================================
// エントリポイント（時間主導トリガーから呼ばれる）
// ============================================================
function dailyDigest(){
  try{
    const cfg = getConfig_();
    const ds = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const st = fetchUserData_(cfg);
    if (!st) {
      logFailure_('毎朝のLINE通知に失敗しました', 'user_dataが取得できませんでした（st is null）');
      return;
    }
    const text = buildDigestText_(st, ds);
    pushLine_(text);
  }catch(e){
    logFailure_('毎朝のLINE通知に失敗しました', `${e}\n\n${e.stack || '(stack trace なし)'}`);
    throw e;
  }finally{
    flushFailureNotifications_();
  }
}

// ============================================================
// 本文組み立て
// ============================================================
/**
 * PWA側のbuildDay()（index.html、日/週カレンダー表示のイベント収集ロジック）
 * と似た内容を出すが、あちらはHTML生成でDOM前提のため共有できない。
 * 派生計算（cycle()によるカード請求額・calcShiftInc()による日給・残高）は
 * ここに移植しない（PWA側を直したときに通知だけ古い数字を出す事故を
 * 避けるため）。移植するのはstにリテラルで入っている値の整形だけ。
 */
function buildDigestText_(st, ds){
  const [y, mm, day] = ds.split('-').map(Number); // mmは1-indexed（表示用）
  const m0 = mm - 1; // JS Dateの月は0-indexed
  const dateObj = new Date(y, m0, day);
  const dow = dateObj.getDay();
  const holidayName = getHolidayName_(ds);
  const header = `【${mm}/${day}(${DAYS_JA_[dow]})${holidayName ? ' ' + holidayName : ''}】`;

  const planLines = getPlansForDay_(st, ds)
    .filter(p => !p.done)
    .map(p => ({ p, t: planTimeOnDay_(p, ds) }))
    .sort((a, b) => a.t.min - b.t.min)
    .map(({ p, t }) => {
      const label = t.start && t.end ? `${t.start}〜${t.end}` : t.start ? t.start : t.end ? `〜${t.end}` : '終日';
      return ` ${label} ${p.title}`;
    });

  const shiftLines = (st.shifts || [])
    .filter(s => s.date === ds)
    .slice()
    .sort((a, b) => hm2min_(a.start) - hm2min_(b.start))
    .map(s => ` ${s.start}〜${s.end} ${s.job}${s.rest ? ` (休憩${s.rest}分)` : ''}`);

  const moneyLines = [];
  (st.fixedCosts || []).forEach(fc => {
    if (parseInt(fc.day, 10) !== day) return;
    const amt = parseInt(fc.amount, 10);
    if (!amt) return;
    moneyLines.push(` ・${fc.name} ${fc.type === 'income' ? '+' : '-'}¥${amt.toLocaleString()}`);
  });
  (st.cards || []).forEach(card => {
    if (parseInt(card.closeDay, 10) === day) moneyLines.push(` ・${card.name} 締め日`);
    if (parseInt(card.billDay, 10) === day) moneyLines.push(` ・${card.name} 引き落とし日`);
  });
  (st.jobs || []).forEach(job => {
    const jPayD = jobPayDay_(st, job);
    const jShimeD = jobCloseDayNum_(st, job, y, m0);
    if (day === jPayD) moneyLines.push(` ・${job.name} 給料日`);
    if (day === jShimeD && day !== jPayD) moneyLines.push(` ・${job.name} 締め日`);
  });

  const sections = [];
  if (planLines.length) sections.push(`■ 予定\n${planLines.join('\n')}`);
  if (shiftLines.length) sections.push(`■ シフト\n${shiftLines.join('\n')}`);
  if (moneyLines.length) sections.push(`■ お金\n${moneyLines.join('\n')}`);

  // 全セクションが空でも毎日1通は送る（動いているかどうかの目印として）
  const body = sections.length ? sections.join('\n\n') : '今日は特に予定なしです';

  return `${header}\n\n${body}`;
}

/**
 * 祝日名を取得する。GASなのでAPIキー不要（PWA側のGoogle Calendar APIとは
 * 別経路）。取得に失敗しても通知本体は送りたいので例外は握りつぶす。
 */
function getHolidayName_(ds){
  try{
    const cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com');
    if (!cal) return '';
    const [y, m, d] = ds.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 1);
    const events = cal.getEvents(start, end);
    return events.length ? events[0].getTitle() : '';
  }catch(e){
    return '';
  }
}

// ============================================================
// LINE Messaging API送信
// ============================================================
function pushLine_(text){
  const cfg = getLineConfig_();
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.TOKEN },
    payload: JSON.stringify({ to: cfg.TO, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`LINE push失敗 status=${code} body=${res.getContentText()}`);
  }
}

// ============================================================
// index.htmlから移植した小さなヘルパー（派生計算は含まない、単純な整形のみ）
// ============================================================

/** 'HH:MM' → 分（時刻なしは-1）。index.htmlのhm2minを移植したもの */
function hm2min_(t){
  if (!t) return -1;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 指定日における予定の時刻情報を返す。index.htmlのplanTimeOnDay()を移植
 * したもの。期間予定は「初日=timeStart、最終日=timeEnd、中日=終日」という
 * Googleカレンダー準拠のセマンティクス。
 */
function planTimeOnDay_(p, ds){
  const s = p.dateStart || p.date, e = p.dateEnd || p.date;
  if (!p.timeStart) return { start: '', end: '', min: -1 };
  if (s === e) return { start: p.timeStart, end: p.timeEnd || '', min: hm2min_(p.timeStart) };
  if (ds === s) return { start: p.timeStart, end: '', min: hm2min_(p.timeStart) };
  if (ds === e) return { start: '', end: p.timeEnd || '', min: p.timeEnd ? hm2min_(p.timeEnd) : -1 };
  return { start: '', end: '', min: -1 };
}

/** index.htmlのgetPlansForDay()を移植したもの */
function getPlansForDay_(st, ds){
  return (st.plans || []).filter(p => {
    const s = p.dateStart || p.date, e = p.dateEnd || p.date;
    return ds >= s && ds <= e;
  });
}

/** index.htmlのjobPayDay()を移植したもの */
function jobPayDay_(st, job){
  return parseInt(job && job.payDay, 10) || parseInt(st.shiftPayDay, 10) || 10;
}

/** index.htmlのjobCloseDayNum()を移植したもの。mは0-indexed（JS Date準拠） */
function jobCloseDayNum_(st, job, y, m){
  const cl = parseInt(job && job.closeDay, 10) || parseInt(st.shiftCloseDay, 10) || 31;
  return cl >= 28 ? new Date(y, m + 1, 0).getDate() : cl;
}
