// GASのパース関数(main.gs)をNode.jsで動作検証するためのテストスクリプト。
// GAS固有API(GmailApp等)を含まない純粋関数だけを抜き出してテストする。

const RAKUTEN_START_MARKER = '<カードご利用情報>';
const RAKUTEN_END_MARKER = '■ご利用明細のご確認';

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
    const sectionMatch = block.match(/《(.+?)》/);
    if (sectionMatch) currentSection = sectionMatch[1];
    const dict = {};
    block.split('\n').forEach(line => {
      const m = line.match(/^■(.+?)\s*[:：]\s*(.*)$/);
      if (m) dict[m[1].trim()] = m[2].trim();
    });
    if (dict['利用日'] && dict['利用先'] && dict['利用金額']) {
      records.push({
        blockIndex, section: currentSection,
        usedOnRaw: dict['利用日'], merchantRaw: dict['利用先'],
        userType: dict['利用者'] || '', payMethod: dict['支払方法'] || '',
        amountRaw: dict['利用金額'], billMonthRaw: dict['支払月'] || ''
      });
    }
  });
  return records;
}

function toIsoDate_(s) { const m = String(s).match(/(\d{4})\/(\d{2})\/(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
function toIsoMonth_(s) { const m = String(s).match(/(\d{4})\/(\d{2})/); return m ? `${m[1]}-${m[2]}` : null; }
function parseAmount_(s) { const cleaned = String(s).replace(/[,\s円]/g, ''); const n = parseInt(cleaned, 10); return isNaN(n) ? null : n; }
function normalizeMerchant_(raw) { return String(raw).normalize('NFKC').replace(/-/g, 'ー').replace(/\s+/g, '').toUpperCase(); }

function buildRow_(userId, messageId, block) {
  const usedOn = toIsoDate_(block.usedOnRaw);
  const amount = parseAmount_(block.amountRaw);
  if (!usedOn || amount === null) return null;
  return {
    user_id: userId, dedupe_key: `${messageId}#${block.blockIndex}`, gmail_msg_id: messageId,
    source: 'rakuten_mail', section: block.section || null, used_on: usedOn,
    merchant_raw: block.merchantRaw, merchant_norm: normalizeMerchant_(block.merchantRaw),
    user_type: block.userType || null, pay_method: block.payMethod || null,
    amount: amount, bill_month: toIsoMonth_(block.billMonthRaw)
  };
}

// ---- テストケース1: 確定版メール（複数件入り）。形式は実際のメールを再現し、日付・店名・金額は架空 ----
const sample1 = `
カードのご利用をお知らせいたします。

<カードご利用情報>
《ショッピングご利用分》
■利用日: 2026/01/05
■利用先: ﾛｰｿﾝ
■利用者: 本人
■支払方法: 1回
■利用金額: 500 円
■支払月: 2026/02

■利用日: 2026/01/06
■利用先: ﾃｽﾄｼｮｸﾄﾞｳ ﾎﾝﾃﾝ
■利用者: 本人
■支払方法: 1回
■利用金額: 12,340 円
■支払月: 2026/02

■利用日: 2026/01/12
■利用先: ﾐｽﾀ-ﾄﾞ-ﾅﾂ ﾃｽﾄﾃﾝ
■利用者: 本人
■支払方法: 1回
■利用金額: 1,234 円
■支払月: 2026/02

■利用日: 2026/01/10
■利用先: Ｓｕｉｃａ（携帯決済）
■利用者: 本人
■支払方法: 1回
■利用金額: 1,000 円
■支払月: 2026/02

■ご利用明細のご確認
https://www.rakuten-card.co.jp/e-navi/members/statement/index.xhtml?scid=su_795

≪本メール掲載ご利用分の獲得予定ポイント数≫
　10ポイント
`;

console.log('=== テスト1: 複数件入りメール ===');
const blocks1 = parseRakutenBody_(sample1);
console.log(`検出ブロック数: ${blocks1.length}（期待値: 4）`);
const rows1 = blocks1.map(b => buildRow_('test-user-id', 'msg001', b));
rows1.forEach(r => console.log(JSON.stringify(r)));

console.log('');
console.log('=== 個別チェック ===');
const checks = [
  [rows1[0].merchant_raw, 'ﾛｰｿﾝ'],
  [rows1[0].merchant_norm, 'ローソン'],
  [rows1[0].used_on, '2026-01-05'],
  [rows1[0].amount, 500],
  [rows1[0].bill_month, '2026-02'],
  [rows1[1].merchant_norm, 'テストショクドウホンテン'],
  [rows1[1].amount, 12340],
  [rows1[2].merchant_raw, 'ﾐｽﾀ-ﾄﾞ-ﾅﾂ ﾃｽﾄﾃﾝ'],
  [rows1[2].merchant_norm, 'ミスタードーナツテストテン'], // ハイフン→長音符補正の確認
  [rows1[3].merchant_raw, 'Ｓｕｉｃａ（携帯決済）'],
  [rows1[3].merchant_norm, 'SUICA(携帯決済)'.toUpperCase()], // NFKC変換の確認
  [rows1[3].amount, 1000],
  [rows1.every(r => r.dedupe_key.startsWith('msg001#')), true],
];
let pass = 0, fail = 0;
checks.forEach(([actual, expected]) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
});

// ---- テストケース2: 速報版は事前にJS側で除外される想定なので、ここでは
//      「■ご利用明細のご確認」以外の非明細ブロックが誤検出されないことを確認 ----
console.log('');
console.log('=== テスト2: 非明細ブロックが誤検出されないか ===');
const sample2 = `
<カードご利用情報>
《ショッピングご利用分》
■利用日: 2026/07/01
■利用先: テスト店舗
■利用者: 本人
■支払方法: 1回
■利用金額: 500 円
■支払月: 2026/08

■ご利用明細のご確認
https://example.com

■お支払金額を調整したい方へ
≪本メール掲載ご利用分の調整可能な金額≫
500円
`;
const blocks2 = parseRakutenBody_(sample2);
console.log(`検出ブロック数: ${blocks2.length}（期待値: 1、末尾の非明細ブロックは除外されるべき）`);
if (blocks2.length === 1) pass++; else fail++;

console.log('');
console.log(`=== 結果: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
