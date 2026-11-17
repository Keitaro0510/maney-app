import { factLines, type MascotFacts } from './mascot-facts.ts';

// マスコット（キリン）の表情とセリフ（D33・D34）。ホームに出す。画面を使わない関数だけ置く（テストできるように）。
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
  /** セリフの材料（給料日・予算のペース・曜日の傾向。D34）。ふだんと今日記録したときの文に混ぜる。なければ決まった文だけ */
  facts?: MascotFacts;
  /** 今日（'YYYY-MM-DD'）。セリフを日替わりにするために使う */
  today: string;
};
export type MascotView = { mood: Mood; situation: Situation; text: string };

/** 連続記録を「すごい」と言いはじめる日数 */
export const STREAK_CHEER = 3;
/** 記録のない日が何日あいたら「おかえり」と迎えるか */
export const AWAY_DAYS = 3;

const LINES: Record<Situation, string[]> = {
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
  greeting: [
    'こんにちは！今日の支出を記録しようね',
    '今日もおつかれさま。使ったお金はあるかな？',
    '今日も一緒にやっていこうね',
  ],
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

/** 表情とセリフ。セリフは状況ごとに数種類あり、日替わりで選ぶ（同じ日は同じ文） */
export function mascotView(i: MascotInput): MascotView {
  const situation = situationOf(i);
  // 材料から作れる文は、ふだんと今日記録したときの文の前に足す（足りない・連続・おかえりのときは、決まった文だけ）
  const extra = i.facts && (situation === 'greeting' || situation === 'recorded') ? factLines(i.facts) : [];
  const lines = [...extra, ...LINES[situation]];
  const text = lines[dayNo(i.today) % lines.length].replace('{n}', String(i.streak));
  return { mood: MOOD_OF[situation], situation, text };
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
