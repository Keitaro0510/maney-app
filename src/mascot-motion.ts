// ホームの棒人間の動き（D41・D42）。呼吸・つつくと反応・ときどき小ワザ・記録したらコインのお祝い・夜は座って眠る・朝はのび・王冠・着せ替え。
// 何をいつ出すかの決め事は src/mascot-play.ts、骨組みと動きの計算は src/mascot-rig.ts（どちらもテストあり）。ここは、画面の要素を動かすだけ。
// 動きを減らす設定（prefers-reduced-motion）のときは、動かさない（止まった姿勢と、タップのひとこと・王冠・Zzz の表示だけ出す）
import type { Mood } from './mascot.ts';
import {
  pickTrick, nextIdleDelayMs, isNight, isMorning, hasCrown, nextTapCount, tapLine, tapPlay, celebrateLine, coinBurst, nightClip,
  type PlayName,
} from './mascot-play.ts';
import {
  basePose, clipPose, blendPose, figureOf, linesPath, flipTransform, segment, lerpPt, f, clamp01, EASE, CLIPS, NIGHT_CLIPS,
  type Pose, type Clip,
} from './mascot-rig.ts';
import { ITEMS, NO_OUTFIT, CROWN_SVG, CROWN_LIFT_WITH_HEAD_ITEM, type Outfit } from './mascot-outfit.ts';
import { elementById, svgById } from './ui.ts';

type Deps = {
  /** 吹き出しのセリフを入れ替える（1文字ずつ出す動きつき。src/screens/home.ts の setMascotLine） */
  setLine(text: string): void;
};

let deps: Deps | null = null;
let hour = 12;
let baseLine = '';
let baseMood: Mood = 'normal'; // いまの状況の表情（姿勢）
let shownMood: Mood = 'normal'; // 表示している表情（お祝いのあいだだけ、うれしい）
let night = false;
let outfit: Outfit = NO_OUTFIT;
let crown = false;
let tapCount = 0, tapAt = 0;
let lineTimer: ReturnType<typeof setTimeout> | undefined;
let moodTimer: ReturnType<typeof setTimeout> | undefined;
let moodHold = false; // お祝いの表情を出しているあいだ
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let morningDone = false; // 朝ののびは、アプリを開いてから1回だけ
let pendingAt = 0; // 記録した時刻（お祝いを待っているとき。0なら待っていない）
const PENDING_MS = 120000; // 記録してから、この時間（2分）をすぎたら、お祝いはしない

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = (): boolean => !!reducedQuery?.matches;
const button = (): HTMLElement => elementById('home-mascot-btn');
const homeActive = (): boolean => elementById('sec-home').classList.contains('active') && !elementById('home-mascot').hidden;
const svgEl = svgById;

// ---- 描く ----
type Playing = { name: PlayName; def: Clip; start: number };
let playing: Playing | null = null;
let blendFrom: { pose: Pose; start: number } | null = null; // 動きの途中で別の動きに替わったとき、なめらかにつなぐ
let lastPose: Pose = basePose('normal', false, 0);
let raf = 0;
let lastDrawAt = 0;
const BLEND_MS = 170;
const IDLE_FRAME_MS = 40; // 動きのないあいだの描き直しの間隔（25fps。電池を使いすぎない）

/** いまの姿勢（動いていなければ呼吸、動きの最中ならその動き） */
function poseAt(ts: number): Pose {
  const base = basePose(shownMood, night, ts);
  let pose = playing ? clipPose(playing.def, ts - playing.start, base) : base;
  if (blendFrom) {
    const k = clamp01((ts - blendFrom.start) / BLEND_MS);
    if (k >= 1) blendFrom = null; else pose = blendPose(blendFrom.pose, pose, EASE.out(k));
  }
  return pose;
}

/** 姿勢を、画面の要素に反映する */
function draw(pose: Pose): void {
  lastPose = pose;
  const g = figureOf(pose);
  svgEl('mf-lines').setAttribute('d', linesPath(g));
  const head = svgEl('mf-head');
  head.setAttribute('cx', f(g.head.x)); head.setAttribute('cy', f(g.head.y));
  svgEl('mf-body').setAttribute('transform', flipTransform(g));
  svgEl('mf-head-grp').setAttribute('transform', `translate(${f(g.head.x)} ${f(g.head.y)}) rotate(${f(g.headAngle)})`);
  svgEl('mf-neck-grp').setAttribute('transform', `translate(${f(g.shoulder.x)} ${f(g.shoulder.y)}) rotate(${f(g.torsoAngle)})`);
  // 服（胴と袖を、色の太い線で重ねる）と靴
  if (outfit.top !== 'none') {
    svgEl('mf-top').setAttribute('d', segment(g.pelvis, g.shoulder)
      + segment(g.shoulder, lerpPt(g.shoulder, g.elbowL, 0.72)) + segment(g.shoulder, lerpPt(g.shoulder, g.elbowR, 0.72)));
  }
  if (outfit.shoes !== 'none') {
    for (const [id, p] of [['mf-shoe-l', g.footL], ['mf-shoe-r', g.footR]] as const) {
      const c = svgEl(id); c.setAttribute('cx', f(p.x)); c.setAttribute('cy', f(p.y));
    }
  }
  // 影（跳んでいるあいだは小さく薄く）
  const sh = svgEl('mf-shadow');
  const up = Math.min(1, g.lift / 18);
  sh.setAttribute('cx', f(g.pelvis.x)); sh.setAttribute('rx', f(11 - 5 * up)); sh.style.opacity = String(0.14 - 0.08 * up);
}

function drawStatic(): void { draw(basePose(shownMood, night, 0)); }

const shouldAnimate = (): boolean => !reduced() && document.visibilityState === 'visible' && homeActive();

function frame(ts: number): void {
  raf = 0;
  if (!shouldAnimate()) return; // 見えていないあいだは止める。見えたら ensureLoop で再開する
  if (playing || ts - lastDrawAt >= IDLE_FRAME_MS) {
    lastDrawAt = ts;
    draw(poseAt(ts));
    if (playing && ts - playing.start >= playing.def.duration) endPlay();
  }
  raf = requestAnimationFrame(frame);
}

/** 描く動きを（まだ動いていなければ）始める。動かせないとき（動きを減らす設定など）は、止まった姿勢を描く */
function ensureLoop(): void {
  if (reduced()) { drawStatic(); return; }
  if (!raf && shouldAnimate()) raf = requestAnimationFrame(frame);
}

function endPlay(): void {
  playing = null;
  button().classList.remove(...[...button().classList].filter(c => c.startsWith('play-')));
}

/** 動きを1つ出す。いまの動きが残っていれば、いまの姿勢から、なめらかにつなぐ。夜は、座ったままの動きに置き換える */
function play(name: PlayName): void {
  if (reduced()) return;
  const ts = performance.now();
  if (playing) blendFrom = { pose: lastPose, start: ts };
  const def: Clip = night ? NIGHT_CLIPS[nightClip(name)] : name === 'nod' ? CLIPS.tilt : CLIPS[name];
  playing = { name, def, start: ts };
  const b = button();
  b.classList.remove(...[...b.classList].filter(c => c.startsWith('play-')));
  b.classList.add(`play-${name}`);
  ensureLoop();
}

// ---- 着せ替え・王冠 ----
const group = (slot: 'head' | 'neck'): string => ITEMS[slot][outfit[slot]]?.svg ?? '';

/** 着せ替えを反映する（小物を入れ替え、服・靴の色を付ける） */
export function setOutfit(next: Outfit): void {
  outfit = next;
  svgEl('mf-head-acc').innerHTML = group('head');
  svgEl('mf-neck-acc').innerHTML = group('neck');
  const top = ITEMS.top[outfit.top]?.color, shoe = ITEMS.shoes[outfit.shoes]?.color;
  const topEl = svgEl('mf-top');
  if (top) topEl.setAttribute('stroke', top);
  topEl.toggleAttribute('hidden', !top);
  for (const id of ['mf-shoe-l', 'mf-shoe-r']) {
    const c = svgEl(id);
    if (shoe) c.setAttribute('fill', shoe);
    c.toggleAttribute('hidden', !shoe);
  }
  svgEl('home-mascot-crown').setAttribute('transform', `translate(0 ${outfit.head === 'none' ? 0 : -CROWN_LIFT_WITH_HEAD_ITEM})`);
  if (!playing) { if (reduced() || !raf) drawStatic(); }
}

// ---- 吹き出し・表情 ----
/** 吹き出しに、ひとこと出す。しばらくしたら、ふだんのセリフに戻す */
function showLine(text: string, ms = 4500): void {
  if (!deps) return;
  deps.setLine(text);
  clearTimeout(lineTimer);
  lineTimer = setTimeout(() => deps?.setLine(baseLine), ms);
}

/** しばらく別の表情（姿勢）にする（お祝いのとき）。しばらくしたら、ふだんに戻す */
function showMood(mood: Mood, ms: number): void {
  shownMood = mood;
  clearTimeout(moodTimer);
  moodHold = true;
  moodTimer = setTimeout(() => { moodHold = false; shownMood = baseMood; ensureLoop(); }, ms);
}

function spawnCoins(n: number): void {
  if (reduced()) return;
  const box = elementById('home-mascot-coins');
  for (const c of coinBurst(n, Math.random)) {
    const el = document.createElement('span');
    el.className = 'mascot-coin';
    el.style.setProperty('--dx', `${c.dx}px`);
    el.style.setProperty('--rise', `${c.rise}px`);
    el.style.setProperty('--spin', `${c.spin}deg`);
    el.style.setProperty('--d', `${c.delay}ms`);
    el.addEventListener('animationend', () => el.remove());
    box.appendChild(el);
  }
}

function celebrate(): void {
  showMood('happy', 2800);
  showLine(celebrateLine(Math.random()));
  play('banzai');
  spawnCoins(6);
}

/** 家計簿に記録を足したとき（新しい記録だけ。直したり消したりは数えない）に呼ぶ。棒人間が見えているときに、お祝いをする（見えていなければ、ホームに戻ったとき） */
export function queueCelebration(): void { pendingAt = Date.now(); }

/** 表情・セリフが決まったあとに呼ぶ（renderMascot）。夜・王冠の飾りと、朝ののび・お祝いの順番待ちを見る */
export function decorateMascot(i: { hour: number; streak: number; mood: Mood; line: string }): void {
  hour = i.hour; baseMood = i.mood; baseLine = i.line;
  if (!moodHold) shownMood = baseMood;
  const nowNight = isNight(hour);
  if (nowNight !== night) { night = nowNight; if (playing) endPlay(); }
  crown = hasCrown(i.streak);
  elementById('home-mascot').classList.toggle('night', night);
  elementById('home-mascot-zzz').hidden = !night;
  svgEl('home-mascot-crown').toggleAttribute('hidden', !crown);
  ensureLoop();
  if (!homeActive()) return;
  if (pendingAt) {
    const fresh = Date.now() - pendingAt <= PENDING_MS;
    pendingAt = 0;
    if (fresh) { celebrate(); return; }
  }
  if (!morningDone && isMorning(hour)) { morningDone = true; setTimeout(() => play('stretch'), 700); }
}

const canIdle = (): boolean =>
  !reduced() && document.visibilityState === 'visible' && homeActive() && !document.querySelector('.mbg.open');

let lastTrick: string | undefined;
function scheduleIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (canIdle() && !playing) { const t = pickTrick(Math.random(), night, lastTrick); lastTrick = t; play(t); }
    ensureLoop();
    scheduleIdle();
  }, nextIdleDelayMs(Math.random()));
}

/** 起動時に一度だけ登録する */
export function initMascotMotion(d: Deps): void {
  deps = d;
  const b = button();
  b.addEventListener('click', () => {
    const now = Date.now();
    tapCount = nextTapCount(tapCount, tapAt, now);
    tapAt = now;
    const kind = tapPlay(tapCount, Math.random());
    showLine(tapLine(tapCount, hour, Math.random()));
    play(kind);
    if (kind === 'spin') tapCount = 0; // 回ったら、また1から数える
    scheduleIdle(); // つついた直後に、勝手な小ワザを重ねない
  });
  document.addEventListener('visibilitychange', ensureLoop);
  reducedQuery?.addEventListener('change', () => { if (reduced()) { if (playing) endPlay(); drawStatic(); } else ensureLoop(); });
  svgEl('home-mascot-crown').innerHTML = CROWN_SVG;
  setOutfit(outfit);
  drawStatic();
  scheduleIdle();
}
