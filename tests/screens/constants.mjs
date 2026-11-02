// 画面を比べる道具（D20 の 0）で使う値。ローカルの Supabase の中だけのテスト用のアカウント（本番とは関係ない）。
export const EMAIL = 'screens@example.test';
export const PASSWORD = 'screens-local-password';
// 画面を見る「今」（seed.sql のデータは、この日に合わせてある）
export const NOW = new Date('2026-11-12T10:00:00+09:00');
// 祝日（Google カレンダーの API の代わりに返す）
export const HOLIDAYS = {
  items: [
    { start: { date: '2026-11-03' }, summary: '文化の日' },
    { start: { date: '2026-11-23' }, summary: '勤労感謝の日' },
  ],
};
