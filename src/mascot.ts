// マスコット（キリン）の表情とセリフ（D33）。ホームに出す。画面を使わない関数だけ置く（テストできるように）。
// 表情は今は「ふつう」と「うれしい」の2つ。「心配」「応援」の絵ができるまでは、足りないときも「ふつう」の顔で、やさしい言い方にする。
// お金の状況で責めない（D33）。

export type Mood = 'normal' | 'happy';
export type Situation = 'short' | 'streak' | 'recorded' | 'greeting';
export type MascotInput = {
  /** 使えるお金（この先の残高の最低点。マイナスなら足りなくなりそう） */
  spendable: number;
  /** いま何日連続で記録しているか（今日か昨日まで続いていれば数える） */
  streak: number;
  /** 今日、家計簿に記録したか */
  recordedToday: boolean;
  /** 今日（'YYYY-MM-DD'）。セリフを日替わりにするために使う */
  today: string;
};
export type MascotView = { mood: Mood; situation: Situation; text: string };

/** 連続記録を「すごい」と言いはじめる日数 */
export const STREAK_CHEER = 3;

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
  greeting: [
    'こんにちは！今日の支出を記録しようね',
    '今日もおつかれさま。使ったお金はあるかな？',
    '今日も一緒にやっていこうね',
  ],
};

/** 'YYYY-MM-DD' を、1970-01-01 からの通し日にする（日替わりの番号に使う） */
const dayNo = (ds: string): number => { const [y, m, d] = ds.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

/** 状況（足りない → 連続記録 → 今日記録した → ふだん の順に強い）。
 *  足りないときは、連続記録を喜ぶより先に、やさしく知らせる */
export function situationOf(i: MascotInput): Situation {
  if (i.spendable < 0) return 'short';
  if (i.streak >= STREAK_CHEER) return 'streak';
  if (i.recordedToday) return 'recorded';
  return 'greeting';
}

/** 表情とセリフ。セリフは状況ごとに数種類あり、日替わりで選ぶ（同じ日は同じ文） */
export function mascotView(i: MascotInput): MascotView {
  const situation = situationOf(i);
  const lines = LINES[situation];
  const text = lines[dayNo(i.today) % lines.length].replace('{n}', String(i.streak));
  return { mood: situation === 'streak' || situation === 'recorded' ? 'happy' : 'normal', situation, text };
}

/** 表情ごとの絵（public ではなく、公開するときにそのままコピーする img/ の中）。ビルドの対象にしないよう、文字として持つ */
export const MASCOT_IMAGE: Record<Mood, string> = {
  normal: 'img/giraffe-normal.webp',
  happy: 'img/giraffe-happy.webp',
};
