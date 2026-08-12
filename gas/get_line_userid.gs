/**
 * maney-app-sync / gas/get_line_userid.gs
 *
 * LINE_USER_ID（notify.gsのdailyDigestが送信先として使う、自分自身のLINEユーザーID）
 * を取得するための一時的な補助ツール。
 *
 * 【背景】LINE Developersコンソールには以前「あなたのユーザーID」という
 * 自己参照フィールドがあると思われていたが、2026-08時点のUIには存在しない
 * （Messaging API settingsタブ・Channel basic settingsタブいずれにも無い
 * ことを実機で確認済み）。そのためLINEの標準的な方法である「Webhookで
 * 受信したイベントからsource.userIdを読み取る」方式でしか取得できない。
 *
 * ── 使い方 ──────────────────────────────────────────
 * 1. このファイルを保存した状態で、GASエディタ右上「デプロイ」→
 *    「新しいデプロイ」→ 種類「ウェブアプリ」、実行するユーザー「自分」、
 *    アクセスできるユーザー「全員」でデプロイし、発行されたURLを控える
 * 2. LINE Developersの対象チャネル →「Messaging API settings」タブ →
 *    「Webhook URL」に1のURLを貼り付けて「Update」→「Use webhook」をEnabled
 * 3. 友だち追加済みのLINE公式アカウントへ、スマホから何かメッセージを送る
 * 4. Script Propertiesの USER_ID（既存の楽天カード取り込み用）と同じ
 *    Gmailアドレス宛に「LINE userId取得」という件名でメールが届く。
 *    本文の U から始まる文字列を LINE_USER_ID としてScript Propertiesに登録する
 * 5. 取得できたら、LINE Developersの「Use webhook」をDisabledに戻す
 *    （このアプリは送信専用で、Webhookの常時受信は不要なため）
 * ────────────────────────────────────────────────────────────
 */
function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const userId = body.events && body.events[0] && body.events[0].source && body.events[0].source.userId;
    if (userId) {
      MailApp.sendEmail(Session.getActiveUser().getEmail(), '[maney-app-sync] LINE userId取得', 'あなたのLINE userId: ' + userId);
    }
  }catch(err){
    // Webhookは200を返す必要があるため、ここでのエラーは握りつぶす
    // （LINE Developers側の「Verify」ボタンが送る接続確認用の空リクエストもここを通る）
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
}
