// 棒人間（D42）の骨組みと動き。画面を使わない関数だけ置く（テストできるように）。画面の要素を動かすのは src/mascot-motion.ts。
//
// - 姿勢（Pose）は関節の角度の組。角度は度で、「真下 = 0、右（+x）= 90、真上 = 180、左 = -90」
// - 骨盤の高さは、いちばん低い足が床に着くように決まる（しゃがむと、勝手に腰が下がる）。lift は、足が床から浮いている高さ
// - 腕は、体（胴）に付いて動く。肩の角度 a は胴の「下向き」から測り、ひじ e は「外向きに曲げる」を正とする
//   （右腕: 前腕 = 上腕 + e、左腕: 前腕 = 上腕 - e。左右で同じ数を入れれば、左右対称の動きになる）
// - 脚は、骨盤から世界の真下を 0 として測る。ひざ k は、すねを後ろへ折る（すね = 太もも - k）。左右で同じ向きに折れる（横から見た脚）
// - 顔は丸だけ（向きがない）なので、横向きの歩きと正面の万歳が、ひとつの絵の中で混ざっても変にならない
import type { Mood } from './mascot.ts';

export const POSE_KEYS = ['x', 'lift', 'lean', 'head', 'flip', 'aL', 'eL', 'aR', 'eR', 'hL', 'kL', 'hR', 'kR'] as const;
export type PoseKey = typeof POSE_KEYS[number];
/** x: 右へ（px）／ lift: 床から浮く高さ（px）／ lean: 胴を右へ倒す角度／ head: 頭を胴に対して右へ倒す角度／ flip: 左右の向き（1 = そのまま、-1 = 反転、0 = 真横を向いた瞬間） */
export type Pose = Record<PoseKey, number>;
export type Pt = { x: number; y: number };

/** 絵の大きさ（SVG の viewBox は 0 0 64 70） */
export const VIEW = { w: 64, h: 70 };
export const CX = 32;
export const FLOOR = 66;
/** 骨の長さ（px） */
export const BONE = { torso: 15, neck: 2, headR: 6.5, upper: 9, fore: 9, thigh: 11.5, shin: 11.5 };

const rad = (d: number): number => d * Math.PI / 180;
const step = (p: Pt, deg: number, len: number): Pt => ({ x: p.x + Math.sin(rad(deg)) * len, y: p.y + Math.cos(rad(deg)) * len });

const mk = (v: Partial<Pose>): Pose => ({ x: 0, lift: 0, lean: 0, head: 0, flip: 1, aL: 0, eL: 0, aR: 0, eR: 0, hL: 0, kL: 0, hR: 0, kR: 0, ...v });

/** 立っているときの、力を抜いた姿勢 */
export const STAND: Pose = mk({ aL: -22, eL: -4, aR: 22, eR: -4, hL: -8, hR: 8 });

// ---- 骨組み ----
export type Figure = {
  pelvis: Pt; shoulder: Pt; neckTop: Pt; head: Pt;
  /** 頭の世界での傾き（度。右へ倒れるほど正） */
  headAngle: number;
  /** 胴の世界での傾き（度） */
  torsoAngle: number;
  elbowL: Pt; handL: Pt; elbowR: Pt; handR: Pt;
  kneeL: Pt; footL: Pt; kneeR: Pt; footR: Pt;
  flip: number;
  /** 床からどれだけ浮いているか（影の大きさに使う） */
  lift: number;
};

/** 姿勢から、関節の位置を求める */
export function figureOf(p: Pose): Figure {
  const leg = (h: number, k: number): { knee: Pt; foot: Pt } => {
    const knee = step({ x: 0, y: 0 }, h, BONE.thigh);
    return { knee, foot: step(knee, h - k, BONE.shin) };
  };
  const L = leg(p.hL, p.kL), R = leg(p.hR, p.kR);
  const lowest = Math.max(0, L.knee.y, L.foot.y, R.knee.y, R.foot.y);
  const pelvis: Pt = { x: CX + p.x, y: FLOOR - lowest - p.lift };
  const shoulder: Pt = { x: pelvis.x + Math.sin(rad(p.lean)) * BONE.torso, y: pelvis.y - Math.cos(rad(p.lean)) * BONE.torso };
  const headAngle = p.lean + p.head;
  const up = (from: Pt, deg: number, len: number): Pt => ({ x: from.x + Math.sin(rad(deg)) * len, y: from.y - Math.cos(rad(deg)) * len });
  const neckTop = up(shoulder, headAngle, BONE.neck);
  const head = up(shoulder, headAngle, BONE.neck + BONE.headR);
  const down = -p.lean; // 胴の「下向き」の世界の角度
  const elbowL = step(shoulder, down + p.aL, BONE.upper), elbowR = step(shoulder, down + p.aR, BONE.upper);
  const handL = step(elbowL, down + p.aL - p.eL, BONE.fore), handR = step(elbowR, down + p.aR + p.eR, BONE.fore);
  const at = (o: Pt): Pt => ({ x: pelvis.x + o.x, y: pelvis.y + o.y });
  return {
    pelvis, shoulder, neckTop, head, headAngle, torsoAngle: p.lean, elbowL, handL, elbowR, handR,
    kneeL: at(L.knee), footL: at(L.foot), kneeR: at(R.knee), footR: at(R.foot), flip: p.flip, lift: p.lift,
  };
}

/** 小数点以下2けたに丸めた文字（SVG の座標用） */
export const f = (n: number): string => (Math.round(n * 100) / 100).toString();
const pt = (q: Pt): string => `${f(q.x)} ${f(q.y)}`;
/** 線で描く部分（胴・首・腕・脚）の path の d。頭の丸は別 */
export function linesPath(g: Figure): string {
  return [
    `M${pt(g.pelvis)}L${pt(g.shoulder)}L${pt(g.neckTop)}`,
    `M${pt(g.shoulder)}L${pt(g.elbowL)}L${pt(g.handL)}`,
    `M${pt(g.shoulder)}L${pt(g.elbowR)}L${pt(g.handR)}`,
    `M${pt(g.pelvis)}L${pt(g.kneeL)}L${pt(g.footL)}`,
    `M${pt(g.pelvis)}L${pt(g.kneeR)}L${pt(g.footR)}`,
  ].join('');
}
/** 2点の間の線（服の袖・胴の上塗りなど） */
export const segment = (a: Pt, b: Pt): string => `M${pt(a)}L${pt(b)}`;
/** 線の途中の点（from から to へ、割合 k のところ） */
export const lerpPt = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
/** 図全体の左右反転（向きを変える動き）の transform。骨盤の x を軸に、横に縮める */
export const flipTransform = (g: Figure): string => `translate(${f(g.pelvis.x)} 0) scale(${f(g.flip)} 1) translate(${f(-g.pelvis.x)} 0)`;

// ---- 動きのつなぎ方 ----
export type EaseName = 'linear' | 'inOut' | 'out' | 'in' | 'back' | 'snap';
export const EASE: Record<EaseName, (k: number) => number> = {
  linear: k => k,
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k * k,
  /** 目標を少し行き過ぎて、戻る（ふくらみ） */
  back: k => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  /** 最初に勢いよく動いて、あとはゆっくり */
  snap: k => 1 - Math.pow(1 - k, 5),
};

export const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);

export function blendPose(a: Pose, b: Pose, k: number): Pose {
  const out = { ...a };
  for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

/** キーフレーム: [時刻(ms), 姿勢のうち決めたい所だけ, その時刻へ向かうときの緩急] */
export type Keyframe = readonly [t: number, v: Partial<Pose>, e?: EaseName];

export type Clip = {
  /** 動きの長さ（ms） */
  duration: number;
  keys: readonly Keyframe[];
  /** 姿勢を、時刻に合わせて計算で足す（歩く・踊るなど、くり返す動き）。env は、始めと終わりでなめらかに 0↔1 になる係数 */
  proc?: (t: number, p: Pose, env: number, base: Pose) => void;
};

/** 動きの始めと終わりに、なめらかに 0 から 1 へ（くり返す動きを、急に始めたり止めたりしない） */
export function envelope(t: number, duration: number, ramp = 220): number {
  const a = clamp01(t / ramp), b = clamp01((duration - t) / ramp);
  const s = (k: number): number => k * k * (3 - 2 * k);
  return s(a) * s(b);
}

/** 動き clip の、時刻 t（ms）の姿勢。決めていない部分は、そのときの基本の姿勢（base）のまま。始めと終わりは base につながる */
export function clipPose(clip: Clip, t: number, base: Pose): Pose {
  const out = { ...base };
  const tt = Math.max(0, Math.min(clip.duration, t));
  const keys = clip.keys;
  for (const key of POSE_KEYS) {
    // その部分を初めて指定するキーフレームの、ひとつ前のキーフレームの時刻までは、基本の値のまま待つ（例: しゃがんでいるあいだは、まだ浮かない）
    const first = keys.findIndex(k => k[1][key] !== undefined);
    if (first < 0) continue;
    let prevT = first > 0 ? keys[first - 1][0] : 0, prevV = base[key];
    let lastIdx = first, found = false;
    for (let i = first; i < keys.length; i++) {
      const v = keys[i][1][key];
      if (v === undefined) continue;
      const kt = keys[i][0];
      if (tt <= kt) {
        const span = Math.max(1, kt - prevT);
        out[key] = prevV + (v - prevV) * EASE[keys[i][2] ?? 'inOut'](clamp01((tt - prevT) / span));
        found = true;
        break;
      }
      prevT = kt; prevV = v; lastIdx = i;
    }
    if (!found) { // 最後の指定の、次のキーフレーム（なければ、そこ）から、動きの終わりまでかけて、基本の姿勢へ戻る
      const from = keys[lastIdx + 1]?.[0] ?? prevT;
      if (tt <= from) out[key] = prevV;
      else out[key] = prevV + (base[key] - prevV) * EASE.inOut(clamp01((tt - from) / Math.max(1, clip.duration - from)));
    }
  }
  if (clip.proc) clip.proc(tt, out, envelope(tt, clip.duration), base);
  return out;
}

// ---- 基本の姿勢（動いていないとき）----
/** 気分ごとの姿勢。表情の代わりに、体で表す */
const MOOD_POSE: Record<Mood, Pose> = {
  normal: STAND,
  // うれしい: 胸を張って、腕を軽く開く
  happy: mk({ lean: -2, head: -3, aL: -38, eL: 12, aR: 38, eR: 12, hL: -9, hR: 9 }),
  // 心配: 肩を落として、うつむき、両手をそわそわ合わせる
  worried: mk({ lean: 7, head: 16, aL: -42, eL: -60, aR: 42, eR: -60, hL: 2, kL: 8, hR: 8, kR: 9 }),
  // 応援: 両手をぐっと握って、胸の前へ（ガッツポーズ）
  cheer: mk({ lean: -2, head: -2, aL: -108, eL: 72, aR: 108, eR: 72, hL: -2, kL: 14, hR: 8, kR: 18 }),
};

/** 夜の、座って眠っている姿勢（体育座りで、ひざに顔をうずめる） */
export const SLEEP: Pose = mk({ lean: 12, head: 38, aL: -18, eL: -6, aR: 18, eR: -6, hL: 118, kL: 66, hR: 112, kR: 62 });

/** 動いていないときの姿勢。呼吸・重心のゆれ・気分ごとの体の動きを足す。t は時刻（ms） */
export function basePose(mood: Mood, night: boolean, t: number): Pose {
  const s = (period: number, phase = 0): number => Math.sin((t / period) * Math.PI * 2 + phase);
  if (night) { // ゆっくりした寝息。体が少し上下して、ときどき頭が揺れる
    const p = { ...SLEEP };
    p.lean += 1.6 * s(5200);
    p.head += 2.2 * s(5200, 0.6) + 1.2 * s(11300);
    p.aL += 1.2 * s(5200); p.aR -= 1.2 * s(5200);
    return p;
  }
  const p = { ...MOOD_POSE[mood] };
  // 呼吸と、ゆっくりした重心の移動（人間は、じっと止まらない）
  p.lean += 0.9 * s(3600) + 0.8 * s(8300);
  p.x += 0.9 * s(8300, 1.2);
  p.head += 1.4 * s(4700, 0.5) + 0.8 * s(9100);
  p.aL -= 1.6 * s(3600, 0.3); p.aR += 1.6 * s(3600, 0.3);
  p.hL += 0.8 * s(8300, 1.2); p.hR -= 0.8 * s(8300, 1.2);
  if (mood === 'happy') { // うきうき。ひざを軽くはずませる
    const b = 0.5 + 0.5 * Math.sin((t / 1300) * Math.PI * 2);
    p.kL += 6 * b; p.kR += 6 * b; p.hL += 3 * b; p.hR += 3 * b;
  } else if (mood === 'cheer') { // 応援。リズムをとって、ぐっぐっと拳を引く
    const b = 0.5 + 0.5 * Math.sin((t / 860) * Math.PI * 2);
    p.kL += 8 * b; p.kR += 8 * b; p.hL += 4 * b; p.hR += 4 * b;
    p.eL += 6 * b; p.eR += 6 * b; p.aL -= 3 * b; p.aR += 3 * b;
  } else if (mood === 'worried') { // そわそわ。手をもじもじ、足をすこし踏みかえる
    p.eL += 7 * s(1700); p.eR += 7 * s(1700, 1.4);
    p.x += 0.8 * s(2300);
  }
  return p;
}

// ---- 動きの一覧 ----
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const osc = (t: number, period: number, phase = 0): number => Math.sin((t / period) * Math.PI * 2 + phase);
const CROUCH = { lean: 12, head: 4, hL: 40, kL: 80, hR: 44, kR: 84 } as const;

/** 立っているときの動き（基本の姿勢が座っているとき＝夜は、夜用の動きを使う） */
export const CLIPS = {
  // 手を振る: 手を上げて、ひじを軸にふる。もう片方の手はそのまま
  wave: {
    duration: 2300,
    keys: [
      [260, { aR: 108, eR: 70, lean: -2, head: 8 }, 'back'],
      [2000, { aR: 126, eR: 46, lean: -1, head: 8 }, 'linear'],
    ],
    proc(t, p, env) {
      p.eR += env * 30 * osc(t, 430);
      p.lean += env * 1.5 * osc(t, 860, 1);
      p.x += env * 0.6 * osc(t, 860);
    },
  },
  // 拍手: 胸の前で、手を打ち合わせる。体も軽く弾む
  clap: {
    duration: 2200,
    keys: [
      [220, { aL: -50, eL: -118, aR: 50, eR: -118, lean: 3, head: 6 }, 'out'],
      [1980, { aL: -50, eL: -118, aR: 50, eR: -118, lean: 3, head: 6 }, 'linear'],
    ],
    proc(t, p, env) {
      const c = 0.5 + 0.5 * osc(t, 340);
      const open = (1 - c) * 26 * env;
      p.eL += open; p.eR += open;
      p.aL += open * 0.35; p.aR -= open * 0.35;
      const b = Math.max(0, osc(t, 340, 0.4)) * env;
      p.hL += 5 * b; p.hR += 5 * b; p.kL += 9 * b; p.kR += 9 * b;
      p.head += 3 * osc(t, 680) * env;
    },
  },
  // ぴょん: しゃがんで（予備動作）、跳ねて、ひざで着地する
  hop: {
    duration: 1050,
    keys: [
      [150, { ...CROUCH, aL: -26, eL: -6, aR: 26, eR: -6 }, 'out'],
      [330, { lift: 14, lean: -4, head: -4, hL: 34, kL: 58, hR: 40, kR: 64, aL: -62, eL: 8, aR: 62, eR: 8 }, 'snap'],
      [470, { lift: 14, lean: -4, head: -4, hL: 34, kL: 58, hR: 40, kR: 64, aL: -66, eL: 10, aR: 66, eR: 10 }, 'linear'],
      [640, { lift: 0, ...CROUCH, aL: -20, eL: -4, aR: 20, eR: -4 }, 'in'],
      [780, { lean: 2, aL: -14, aR: 14 }, 'back'],
    ],
  },
  // 万歳（記録のお祝い）: しゃがんで、両手を上げて跳び、もう一度小さく跳ねる
  banzai: {
    duration: 2000,
    keys: [
      [200, { ...CROUCH, lean: 14, aL: -34, eL: -4, aR: 34, eR: -4 }, 'out'],
      [420, { lift: 16, lean: -6, head: -3, hL: 28, kL: 50, hR: 34, kR: 56, aL: -118, eL: 14, aR: 118, eR: 14 }, 'snap'],
      [560, { lift: 16, lean: -6, head: -3, hL: 28, kL: 50, hR: 34, kR: 56, aL: -118, eL: 14, aR: 118, eR: 14 }, 'linear'],
      [740, { lift: 0, lean: 4, head: -3, hL: 36, kL: 70, hR: 40, kR: 74, aL: -118, eL: 14, aR: 118, eR: 14 }, 'in'],
      [900, { lift: 0, lean: -3, head: -3, hL: 4, kL: 6, hR: 6, kR: 8, aL: -118, eL: 14, aR: 118, eR: 14 }, 'back'],
      [1130, { lift: 7, lean: -3, head: -3, hL: 20, kL: 34, hR: 24, kR: 38, aL: -118, eL: 14, aR: 118, eR: 14 }, 'out'],
      [1330, { lift: 0, lean: 3, head: -3, hL: 30, kL: 56, hR: 34, kR: 60, aL: -118, eL: 14, aR: 118, eR: 14 }, 'in'],
      [1560, { lean: 0, head: 0, hL: 2, kL: 4, hR: 4, kR: 6, aL: -100, eL: 14, aR: 100, eR: 14 }, 'out'],
    ],
    proc(t, p, env) { p.x += env * 0.5 * osc(t, 300); },
  },
  // のび: 両手を頭の上へ。背をそらして、つま先立ちになり、ふっと力を抜く
  stretch: {
    duration: 2800,
    keys: [
      [260, { lean: 5, head: 8, aL: -24, eL: -6, aR: 24, eR: -6 }, 'out'],
      [1000, { lean: -7, head: -4, lift: 1.6, hL: 0, kL: 0, hR: 0, kR: 0, aL: -118, eL: 14, aR: 118, eR: 14 }, 'out'],
      [1750, { lean: -9, head: -5, lift: 2, hL: 0, kL: 0, hR: 0, kR: 0, aL: -118, eL: 14, aR: 118, eR: 14 }, 'linear'],
      [2150, { lean: 6, head: 12, lift: 0, hL: 6, kL: 10, hR: 8, kR: 12, aL: -48, eL: -14, aR: 48, eR: -14 }, 'in'],
      [2450, { lean: 3, head: 6, aL: -18, eL: -10, aR: 18, eR: -10 }, 'back'],
    ],
    proc(t, p, env) { p.aL -= env * 1.4 * osc(t, 190); p.aR += env * 1.4 * osc(t, 190); },
  },
  // あくび: 手を口に当てて、のけぞり、はぁっと力を抜く
  yawn: {
    duration: 2700,
    keys: [
      [420, { aR: 136, eR: 98, lean: -4, head: -16, aL: -16, eL: -2 }, 'out'],
      [1500, { aR: 136, eR: 104, lean: -7, head: -22, aL: -40, eL: -6 }, 'inOut'],
      [1900, { aR: 138, eR: 100, lean: 4, head: 12, aL: -14, eL: -8 }, 'in'],
      [2200, { aR: 40, eR: -12, lean: 5, head: 14, aL: -10, eL: -8 }, 'out'],
    ],
  },
  // 足踏み: ひざを交互に上げて、腕をふる
  march: {
    duration: 2500,
    keys: [[250, { lean: 2, aL: -28, eL: -78, aR: 28, eR: -78 }, 'out']],
    proc(t, p, env) {
      const ph = osc(t, 620);
      const l = Math.max(0, ph), r = Math.max(0, -ph);
      p.hL = lerp(p.hL, 56 * l + 2, env); p.kL = lerp(p.kL, 92 * l + 8, env);
      p.hR = lerp(p.hR, 56 * r + 2, env); p.kR = lerp(p.kR, 92 * r + 8, env);
      p.aL += env * 24 * ph; p.aR += env * 24 * ph; // 左のひざが上がるとき、右の腕が前へ
      p.lean += env * 1.6 * ph; p.x += env * 0.8 * ph;
      p.head -= env * 2.2 * Math.abs(ph);
    },
  },
  // 散歩: 右へ歩いて、くるっと向きを変えて、もどる
  walk: {
    duration: 4600,
    keys: [
      [300, { lean: 4, aL: -14, eL: -45, aR: 14, eR: -45 }, 'out'],
      [1650, { x: 11 }, 'inOut'],
      [2050, { x: 11, flip: -1 }, 'inOut'],
      [3650, { x: 0, flip: -1 }, 'inOut'],
      [4050, { x: 0, flip: 1 }, 'inOut'],
    ],
    proc(t, p, env) {
      const moving = (t > 150 && t < 1850) || (t > 2250 && t < 3850);
      const sway = (moving ? 1 : 0.12) * env;
      const w = (t / 560) * Math.PI * 2;
      p.hL = lerp(p.hL, 30 * Math.sin(w) + 2, sway); p.hR = lerp(p.hR, -30 * Math.sin(w) - 2, sway);
      p.kL = lerp(p.kL, 6 + 40 * Math.max(0, -Math.cos(w)), sway); p.kR = lerp(p.kR, 6 + 40 * Math.max(0, Math.cos(w)), sway);
      p.aL = lerp(p.aL, -14 - 26 * Math.sin(w), sway); p.aR = lerp(p.aR, 14 - 26 * Math.sin(w), sway);
      p.lean += 3 * sway; p.head -= 1.2 * sway;
    },
  },
  // ダンス: ノリノリで、ひざをはずませて、腕を交互にふり上げる
  dance: {
    duration: 3600,
    keys: [[300, { lean: 0 }, 'out']],
    proc(t, p, env) {
      const beat = osc(t, 520), half = osc(t, 1040);
      const bounce = 0.5 + 0.5 * Math.cos((t / 520) * Math.PI * 2);
      p.hL = lerp(p.hL, 18 + 8 * bounce, env); p.kL = lerp(p.kL, 20 + 30 * bounce, env);
      p.hR = lerp(p.hR, 22 + 8 * bounce, env); p.kR = lerp(p.kR, 24 + 30 * bounce, env);
      p.aR = lerp(p.aR, 100 + 62 * half, env); p.aL = lerp(p.aL, -(100 - 62 * half), env);
      p.eR = lerp(p.eR, 18 - 22 * beat, env); p.eL = lerp(p.eL, 18 + 22 * beat, env);
      p.x += env * 2.6 * half; p.lean += env * (4 * half); p.head += env * (-7 * half + 3 * beat);
    },
  },
  // 体操: 腕をまわして、両手を上げて体を横にたおす
  exercise: {
    duration: 4600,
    keys: [
      [240, { aL: -18, eL: 0, aR: 18, eR: 0, hL: -6, hR: 6 }, 'out'],
      [2060, { eL: 0, eR: 0 }, 'linear'],
      [2500, { aL: -122, eL: 0, aR: 122, eR: 0, lean: 0, head: 0, hL: -10, hR: 10 }, 'out'],
      [3000, { lean: 17, head: 6, aL: -118, aR: 126 }, 'inOut'],
      [3500, { lean: -17, head: -6, aL: -126, aR: 118 }, 'inOut'],
      [4000, { lean: 0, head: 0, aL: -122, aR: 122 }, 'inOut'],
      [4300, { aL: -30, aR: 30, hL: -3, hR: 3 }, 'in'],
    ],
    proc(t, p, env, base) {
      if (t >= 240 && t < 2060) { // 腕を大きくまわす（2回転）
        const k = EASE.inOut(clamp01((t - 240) / 1820));
        p.aR = base.aR + 18 + 720 * k;
        p.aL = base.aL - 18 - 720 * k;
        p.lean += 2.5 * Math.sin(k * Math.PI * 4);
      }
    },
  },
  // 首をかしげて、考える
  tilt: {
    duration: 2100,
    keys: [
      [380, { head: 15, lean: 3, aR: 60, eR: -146, aL: -12, eL: -8 }, 'out'],
      [1500, { head: 18, lean: 4, aR: 60, eR: -150 }, 'linear'],
    ],
    proc(t, p, env) { p.head += env * 2 * osc(t, 1500); },
  },
  // 頭をかく（照れる）
  scratch: {
    duration: 1900,
    keys: [
      [300, { aR: 136, eR: 104, head: 8, lean: 3, aL: -16, eL: -8 }, 'back'],
      [1600, { aR: 136, eR: 104, head: 8, lean: 3 }, 'linear'],
    ],
    proc(t, p, env) {
      p.eR += env * 11 * osc(t, 210);
      p.x += env * 1.2 * osc(t, 640); p.lean += env * 2.4 * osc(t, 640);
      p.hL += env * 3 * osc(t, 640); p.hR -= env * 3 * osc(t, 640);
    },
  },
  // くるくる回る（5回つつく）。ジャンプして2回転して、目が回ってふらつく
  spin: {
    duration: 2300,
    keys: [
      [170, { ...CROUCH, aL: -20, aR: 20, eL: 0, eR: 0 }, 'out'],
      [420, { lift: 10, lean: 0, head: 0, hL: 20, kL: 34, hR: 24, kR: 38, aL: -88, eL: 0, aR: 88, eR: 0 }, 'snap'],
      [1030, { lift: 10, hL: 20, kL: 34, hR: 24, kR: 38, aL: -88, aR: 88 }, 'linear'],
      [1230, { lift: 0, lean: 8, head: 12, hL: 22, kL: 42, hR: 26, kR: 46, aL: -50, eL: 0, aR: 50, eR: 0 }, 'in'],
    ],
    proc(t, p, env) {
      if (t >= 330 && t < 1180) { const k = EASE.inOut(clamp01((t - 330) / 850)); p.flip = Math.cos(k * Math.PI * 4); }
      if (t >= 1180) { // 目が回って、ふらふら
        const k = (t - 1180) / 1100, decay = 1 - clamp01(k);
        p.lean += 11 * decay * osc(t, 520);
        p.x += 3.2 * decay * osc(t, 520, 0.8);
        p.head += 14 * decay * osc(t, 520, 1.6);
        p.aL += 22 * decay * osc(t, 520, 1); p.aR -= 22 * decay * osc(t, 520);
      }
    },
  },
} satisfies Record<string, Clip>;

/** 座って眠っているとき（夜）の動き */
export const NIGHT_CLIPS = {
  // こくりと、舟をこぐ。はっと顔を上げて、また沈む
  nod: {
    duration: 2800,
    keys: [
      [700, { head: 56, lean: 36 }, 'inOut'],
      [900, { head: 56, lean: 36 }, 'linear'],
      [1150, { head: 14, lean: 14, aL: -40, aR: 40 }, 'snap'],
      [1650, { head: 18, lean: 16 }, 'linear'],
    ],
  },
  // つつかれて、目を覚ます。顔を上げて、のびとあくびをして、また丸まる
  wake: {
    duration: 3300,
    keys: [
      [260, { lean: 4, head: -4, hL: 118, kL: 66, hR: 112, kR: 62, aL: -30, eL: -10, aR: 30, eR: -10 }, 'snap'],
      [1100, { lean: -4, head: -5, aL: -118, eL: 14, aR: 118, eR: 14 }, 'out'],
      [1900, { lean: -5, head: -6, aL: -118, eL: 14, aR: 118, eR: 14 }, 'linear'],
      [2400, { lean: 12, head: 14, aL: -40, eL: -20, aR: 40, eR: -20 }, 'in'],
    ],
  },
  // 万歳（夜）: 座ったまま、両手を上げてよろこぶ
  cheer: {
    duration: 2200,
    keys: [
      [260, { lean: 0, head: -6, hL: 118, kL: 66, hR: 112, kR: 62, aL: -118, eL: 14, aR: 118, eR: 14 }, 'back'],
      [1700, { lean: -2, head: -8, aL: -132, aR: 132 }, 'linear'],
    ],
    proc(t, p, env) { p.aL += env * 8 * osc(t, 360); p.aR -= env * 8 * osc(t, 360); p.lean += env * 1.8 * osc(t, 360, 1); },
  },
  // くるくる（夜）: 座ったまま回る
  spin: {
    duration: 1800,
    keys: [[300, { lean: 0, head: -4, hL: 118, kL: 66, hR: 112, kR: 62, aL: -88, eL: 0, aR: 88, eR: 0 }, 'out']],
    proc(t, p) {
      if (t >= 300 && t < 1250) p.flip = Math.cos(EASE.inOut(clamp01((t - 300) / 950)) * Math.PI * 4);
      if (t >= 1250) { const d = 1 - clamp01((t - 1250) / 550); p.lean += 8 * d * osc(t, 480); p.head += 10 * d * osc(t, 480, 1.5); }
    },
  },
} satisfies Record<string, Clip>;

export type ClipName = keyof typeof CLIPS;
export type NightClipName = keyof typeof NIGHT_CLIPS;
