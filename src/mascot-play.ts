// キリンの動き（D41）の決め事。画面を使わない関数だけ置く（テストできるように）。動かす部分は src/mascot-motion.ts。
// 守ること（D33）: お金の状況で責めたり笑ったりしない。セリフは短く、画像に文字は入れない。動きを減らす設定では動かさない

/** ときどき勝手に出す小ワザ */
export const TRICKS = ['tilt', 'stretch', 'hop'] as const;
export type Trick = typeof TRICKS[number];

/** 0以上1未満の乱数 r から、小ワザを選ぶ */
export function pickTrick(r: number): Trick {
  return TRICKS[Math.min(TRICKS.length - 1, Math.floor(r * TRICKS.length))];
}

/** 次の小ワザまでの間（7〜16秒） */
export const nextIdleDelayMs = (r: number): number => Math.round(7000 + r * 9000);

/** 夜（21時〜4時台）は眠そう。朝（5〜9時台）は、開いたときにのびをする */
export const isNight = (hour: number): boolean => hour >= 21 || hour < 5;
export const isMorning = (hour: number): boolean => hour >= 5 && hour < 10;

/** 記録が連続して続いている日数が、この日数以上なら、頭に王冠を付ける */
export const CROWN_STREAK = 7;
export const hasCrown = (streak: number): boolean => streak >= CROWN_STREAK;

// ---- タップ ----
/** この時間（ミリ秒）以内に続けて押すと、連続のタップとして数える */
export const TAP_COMBO_MS = 1500;
/** この回数つづけて押すと、くるくる回る */
export const SPIN_TAPS = 5;

/** タップの回数を数える。前の回から TAP_COMBO_MS 以内なら続き、それより空いたら1から */
export function nextTapCount(prevCount: number, prevAt: number, now: number): number {
  return prevCount > 0 && now - prevAt <= TAP_COMBO_MS ? prevCount + 1 : 1;
}

const TAP_LINES = [
  'わっ！くすぐったいよ〜',
  'なあに？',
  'えへへ、もっとつついてもいいよ',
  '首が長いから、つつきやすいでしょ',
  'ぽよん！',
  '今日もいっしょにがんばろ',
  'おさんぽ行きたいなあ',
  'ちょっとだけならコインあげるよ',
];
const SLEEPY_LINES = ['ふあぁ…ねむいよ〜', 'むにゃ…あと5分…', 'zzz…（ねがえり）'];
const SPIN_LINES = ['目が回る〜！', 'くるくる〜！'];

/** つついたときのひとこと。5回続けたら回るセリフ、夜は眠そうなセリフ */
export function tapLine(count: number, hour: number, r: number): string {
  const pool = count >= SPIN_TAPS ? SPIN_LINES : isNight(hour) ? SLEEPY_LINES : TAP_LINES;
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}

export type TapPlay = 'poyon' | 'spin';
/** タップの動き。続けて SPIN_TAPS 回めで回る。そのあとは1から数え直す（呼ぶ側で） */
export const tapPlay = (count: number): TapPlay => (count >= SPIN_TAPS ? 'spin' : 'poyon');

// ---- 記録したときのお祝い ----
const CELEBRATE_LINES = ['記録できたね！えらい！', 'コツコツ、いいね！', 'ナイス記録！', 'その調子〜！'];
export function celebrateLine(r: number): string {
  return CELEBRATE_LINES[Math.min(CELEBRATE_LINES.length - 1, Math.floor(r * CELEBRATE_LINES.length))];
}

export type Coin = { dx: number; rise: number; delay: number; spin: number };
/** コインが跳ねる向きと高さ。n 個。rand は 0以上1未満を返す関数（テストでは固定の列を渡す） */
export function coinBurst(n: number, rand: () => number): Coin[] {
  return Array.from({ length: n }, (_, i) => ({
    dx: Math.round((rand() - 0.5) * 90), // 左右に -45〜45px
    rise: Math.round(40 + rand() * 32), // 上に 40〜72px
    delay: i * 70, // 1つずつ、少しずらす
    spin: Math.round((rand() - 0.5) * 720), // くるくる回る角度
  }));
}
