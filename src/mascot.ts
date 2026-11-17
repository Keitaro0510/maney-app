import { factLines, noticeLines, ambientLines, periodOf, type MascotFacts, type Period } from './mascot-facts.ts';

// マスコット（キリン）の表情とセリフ（D33・D34・D35）。ホームに出す。画面を使わない関数だけ置く（テストできるように）。
// 表情は「ふつう」「うれしい」「心配」「応援」の4つ。足りないときは泣き顔の「心配」だが、セリフは責めずに一緒に考える言い方にする（D33）。

export type Mood = 'normal' | 'happy' | 'worried' | 'cheer';
export type Situation = 'short' | 'streak' | 'recorded' | 'away' | 'greeting';
export type MascotInput = {
  /** 使えるお金（この先の残高の最低点。マイナスなら足りなくなりそう） */
  spendable: number;
  /** いま何日連続で記録しているか（今日か昨日まで続いていれば数える） */
  streak: number;
  /** 今日、家計簿に記録したか */
  recordedToday: boolean;
  /** 最後に記録した日から、何日たったか（今日記録していれば 0。記録が1件もなければ null。今日より先の日付は数えない） */
  daysSinceRecord: number | null;
  /** セリフの材料（給料日・予算のペース・曜日の傾向・今日の予定とシフト・祝日・先月との比べ。D34・D35）。なければ決まった文だけ */
  facts?: MascotFacts;
  /** 今の時（0〜23）。時間帯のあいさつと、夜の「明日のシフト」に使う。省くと昼（12時）として扱う */
  hour?: number;
  /** 今日（'YYYY-MM-DD'）。セリフを日替わりにするために使う */
  today: string;
};
export type MascotView = { mood: Mood; situation: Situation; text: string };

/** 連続記録を「すごい」と言いはじめる日数 */
export const STREAK_CHEER = 3;
/** 記録のない日が何日あいたら「おかえり」と迎えるか */
export const AWAY_DAYS = 3;

const LINES: Record<Exclude<Situation, 'greeting'>, string[]> = {
  short: [
    'ちょっと足りなくなりそう。一緒に見てみよう',
    '大丈夫、まだ間に合うよ。「くわしく見る」で確かめよう',
    'あわてなくて平気。いつ足りなくなるか見てみよう',
  ],
  streak: [
    '{n}日連続で記録中！すごいね',
    '{n}日つづいてるよ。いい調子！',
    'コツコツ{n}日。えらい！',
  ],
  recorded: [
    '今日の記録、ありがとう！',
    '記録できたね。ばっちり！',
    '今日も付けられたね。いいぞ！',
  ],
  away: [
    'おかえり！また一緒に記録していこうね',
    '久しぶり！ゆっくりで大丈夫、少しずつ付けよう',
    'また会えてうれしいな。思い出せる分だけで大丈夫',
  ],
};

/** ふだんのあいさつ。時間帯で変える（夜に「こんにちは」と言わないように） */
const GREETING: Record<Period, string[]> = {
  morning: ['おはよう！今日も一緒にやっていこうね', 'おはよう。ゆっくりスタートしようね', '朝だね！今日の支出も、あとで記録しようね'],
  day: ['こんにちは！今日の支出を記録しようね', '今日もおつかれさま。使ったお金はあるかな？', '今日も一緒にやっていこうね'],
  evening: ['こんばんは。今日の分、記録しておこうね', 'おつかれさま！今日はどんな1日だった？', '夕方だね。今日使ったお金を記録しようね'],
  night: ['夜おそいね。今日もおつかれさま', '今日もよくがんばったね。ゆっくり休んでね', '記録は明日でも大丈夫。ゆっくり休もうね'],
};

/** 'YYYY-MM-DD' を、1970-01-01 からの通し日にする（日替わりの番号に使う） */
const dayNo = (ds: string): number => { const [y, m, d] = ds.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

/** 今日までの日数 */
export function daysSinceRecord(dates: string[], today: string): number | null {
  const t = dayNo(today);
  let last: number | null = null;
  for (const d of dates) { const n = dayNo(d); if (n <= t && (last === null || n > last)) last = n; }
  return last === null ? null : t - last;
}

/** 状況（足りない → 連続記録 → 今日記録した → 久しぶり → ふだん の順に強い）。
 *  足りないときは、連続記録を喜ぶより先に、やさしく知らせる */
export function situationOf(i: MascotInput): Situation {
  if (i.spendable < 0) return 'short';
  if (i.streak >= STREAK_CHEER) return 'streak';
  if (i.recordedToday) return 'recorded';
  if (i.daysSinceRecord !== null && i.daysSinceRecord >= AWAY_DAYS) return 'away';
  return 'greeting';
}

/** 状況ごとの表情。足りないときは泣き顔（心配）、記録できた・連続のときはうれしい顔 */
const MOOD_OF: Record<Situation, Mood> = { short: 'worried', streak: 'happy', recorded: 'happy', away: 'cheer', greeting: 'normal' };

/** 表情とセリフ。
 *  1. 足りない（心配）・おかえり（応援）のときは、その場面の決まった文だけ（気持ちを優先する）
 *  2. 今日のお知らせ（夜おそいときの明日のシフト → 今日のシフト・予定・祝日）があれば、それを言う（連続記録・今日記録した・ふだんのとき）。
 *     夜の明日のシフトがあれば必ずそれ。ほかは時間帯（6時間ごと）で順に入れ替える
 *  3. なければ、状況の決まった文を、日替わりで選ぶ。ふだんは、材料の文（給料日・予算・曜日）と、ひとこと（先月との比べ・貯まった額・季節）、
 *     時間帯のあいさつを混ぜる。今日記録したときは、材料の文だけ混ぜる。連続記録のときは決まった文だけ */
export function mascotView(i: MascotInput): MascotView {
  const situation = situationOf(i);
  const hour = i.hour ?? 12;
  const base = { mood: MOOD_OF[situation], situation };
  const fill = (text: string): string => text.replace('{n}', String(i.streak));
  if (situation === 'short' || situation === 'away') {
    const lines = LINES[situation];
    return { ...base, text: fill(lines[dayNo(i.today) % lines.length]) };
  }
  if (i.facts) {
    const { urgent, today } = noticeLines(i.facts, hour);
    if (urgent) return { ...base, text: urgent };
    if (today.length) return { ...base, text: today[Math.floor(hour / 6) % today.length] };
  }
  const [, m, d] = i.today.split('-').map(Number);
  const facts = i.facts ? factLines(i.facts) : [];
  const lines = situation === 'greeting' ? [...facts, ...ambientLines(i.facts, m, d), ...GREETING[periodOf(hour)]]
    : situation === 'recorded' ? [...facts, ...LINES.recorded]
    : LINES[situation];
  return { ...base, text: fill(lines[dayNo(i.today) % lines.length]) };
}

/** セリフを1文字ずつ出すときの、1文字あたりの間隔（ミリ秒）。短い文はゆっくり、長い文は全体が 1.6 秒に収まるように速くする。上限 40、下限 15 */
export function charDelayMs(length: number): number {
  return Math.max(15, Math.min(40, Math.floor(1600 / Math.max(length, 1))));
}

/** 表情ごとの絵（public ではなく、公開するときにそのままコピーする img/ の中）。ビルドの対象にしないよう、文字として持つ */
export const MASCOT_IMAGE: Record<Mood, string> = {
  normal: 'img/giraffe-normal.webp',
  happy: 'img/giraffe-happy.webp',
  worried: 'img/giraffe-worried.webp',
  cheer: 'img/giraffe-cheer.webp',
};
