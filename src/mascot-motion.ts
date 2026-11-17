// ホームのキリンの動き（D41）。つつくと「ぽよん」・ときどき小ワザ・記録したらコインのお祝い・夜は眠そう・朝はのび・王冠。
// 何をいつ出すかの決め事は src/mascot-play.ts（テストあり）。ここは、画面の要素を動かすだけ。
// 動きを減らす設定（prefers-reduced-motion）のときは、動かさない（タップのひとことと、王冠・Zzz の表示だけ出す）
import { MASCOT_IMAGE, type Mood } from './mascot.ts';
import {
  pickTrick, nextIdleDelayMs, isNight, isMorning, hasCrown, nextTapCount, tapLine, tapPlay, celebrateLine, coinBurst,
} from './mascot-play.ts';
import { elementById, imageById } from './ui.ts';

type Deps = {
  /** 吹き出しのセリフを入れ替える（1文字ずつ出す動きつき。src/screens/home.ts の setMascotLine） */
  setLine(text: string): void;
};

let deps: Deps | null = null;
let hour = 12;
let baseLine = '';
let baseMood: Mood = 'normal';
let tapCount = 0, tapAt = 0;
let lineTimer: ReturnType<typeof setTimeout> | undefined;
let moodTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let morningDone = false; // 朝ののびは、アプリを開いてから1回だけ
let pendingAt = 0; // 記録した時刻（お祝いを待っているとき。0なら待っていない）
const PENDING_MS = 120000; // 記録してから、この時間（2分）をすぎたら、お祝いはしない

const PLAY_CLASSES = ['play-poyon', 'play-spin', 'play-tilt', 'play-stretch', 'play-hop'];

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const button = (): HTMLElement => elementById('home-mascot-btn');
const homeActive = (): boolean => elementById('sec-home').classList.contains('active') && !elementById('home-mascot').hidden;

/** 動きを1つ出す。いまの動きが残っていれば、止めて、最初からやり直す。動きが終われば、クラスは外れる（animationend） */
function play(name: string): void {
  if (reduced()) return;
  const b = button();
  b.classList.remove(...PLAY_CLASSES);
  void b.offsetWidth; // 同じ動きを続けて出せるように、描き直しを挟む
  b.classList.add(`play-${name}`);
}

/** 吹き出しに、ひとこと出す。しばらくしたら、ふだんのセリフに戻す */
function showLine(text: string, ms = 4500): void {
  if (!deps) return;
  deps.setLine(text);
  clearTimeout(lineTimer);
  lineTimer = setTimeout(() => deps?.setLine(baseLine), ms);
}

/** しばらく別の表情にする（お祝いのとき）。しばらくしたら、ふだんの表情に戻す */
function showMood(mood: Mood, ms: number): void {
  imageById('home-mascot-img').setAttribute('src', MASCOT_IMAGE[mood]);
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => imageById('home-mascot-img').setAttribute('src', MASCOT_IMAGE[baseMood]), ms);
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
  play('hop');
  spawnCoins(6);
}

/** 家計簿に記録を足したとき（新しい記録だけ。直したり消したりは数えない）に呼ぶ。キリンが見えているときに、お祝いをする（見えていなければ、ホームに戻ったとき） */
export function queueCelebration(): void { pendingAt = Date.now(); }

/** 表情・セリフが決まったあとに呼ぶ（renderMascot）。夜・王冠の飾りと、朝ののび・お祝いの順番待ちを見る */
export function decorateMascot(i: { hour: number; streak: number; mood: Mood; line: string }): void {
  hour = i.hour; baseMood = i.mood; baseLine = i.line;
  const night = isNight(hour);
  elementById('home-mascot').classList.toggle('night', night);
  elementById('home-mascot-zzz').hidden = !night;
  elementById('home-mascot-crown').hidden = !hasCrown(i.streak);
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

function scheduleIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (canIdle()) play(pickTrick(Math.random()));
    scheduleIdle();
  }, nextIdleDelayMs(Math.random()));
}

/** 起動時に一度だけ登録する */
export function initMascotMotion(d: Deps): void {
  deps = d;
  const b = button();
  b.addEventListener('animationend', event => { if (event.target === b) b.classList.remove(...PLAY_CLASSES); });
  b.addEventListener('click', () => {
    const now = Date.now();
    tapCount = nextTapCount(tapCount, tapAt, now);
    tapAt = now;
    const kind = tapPlay(tapCount);
    showLine(tapLine(tapCount, hour, Math.random()));
    play(kind);
    if (kind === 'spin') tapCount = 0; // 回ったら、また1から数える
    scheduleIdle(); // つついた直後に、勝手な小ワザを重ねない
  });
  scheduleIdle();
}
