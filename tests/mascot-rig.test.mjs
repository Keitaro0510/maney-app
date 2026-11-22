// 棒人間の骨組みと動き（src/mascot-rig.ts）・着せ替え（src/mascot-outfit.ts）。D42。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSE_KEYS, STAND, SLEEP, FLOOR, BONE, CLIPS, NIGHT_CLIPS, figureOf, linesPath, clipPose, basePose, blendPose, envelope, EASE,
} from '../src/mascot-rig.ts'; // Node が型を消して読む（D17）
import { ITEMS, NO_OUTFIT, parseOutfit } from '../src/mascot-outfit.ts';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b}`);
const lowest = g => Math.max(g.footL.y, g.footR.y, g.kneeL.y, g.kneeR.y, g.pelvis.y);

test('figureOf: 立っているとき、いちばん低い足が床に着く。骨の長さが合っている', () => {
  const g = figureOf(STAND);
  near(lowest(g), FLOOR);
  near(Math.hypot(g.shoulder.x - g.pelvis.x, g.shoulder.y - g.pelvis.y), BONE.torso);
  near(Math.hypot(g.elbowR.x - g.shoulder.x, g.elbowR.y - g.shoulder.y), BONE.upper);
  near(Math.hypot(g.handR.x - g.elbowR.x, g.handR.y - g.elbowR.y), BONE.fore);
  near(Math.hypot(g.kneeL.x - g.pelvis.x, g.kneeL.y - g.pelvis.y), BONE.thigh);
  near(Math.hypot(g.footL.x - g.kneeL.x, g.footL.y - g.kneeL.y), BONE.shin);
  assert.ok(g.head.y < g.shoulder.y); // 頭は肩の上
});

test('figureOf: しゃがむと、腰が下がっても足は床に着く。lift の分だけ、足が床から浮く', () => {
  const squat = figureOf({ ...STAND, hL: 40, kL: 80, hR: 44, kR: 84 });
  near(lowest(squat), FLOOR);
  assert.ok(squat.pelvis.y > figureOf(STAND).pelvis.y);
  const jump = figureOf({ ...STAND, lift: 10 });
  near(lowest(jump), FLOOR - 10);
  near(jump.lift, 10);
});

test('figureOf: 座る姿勢（夜）は、腰が床の近くにある。左右の腕は左右対称に出る（符号の約束）', () => {
  const sit = figureOf(SLEEP);
  near(lowest(sit), FLOOR);
  assert.ok(FLOOR - sit.pelvis.y < 8);
  const arms = figureOf({ ...STAND, aL: -120, eL: 10, aR: 120, eR: 10 });
  near(arms.handL.x - arms.shoulder.x, -(arms.handR.x - arms.shoulder.x), 1e-6);
  near(arms.handL.y, arms.handR.y);
});

test('linesPath: 数値だけの path を返す（NaN を含まない）', () => {
  const d = linesPath(figureOf(STAND));
  assert.match(d, /^M[-\d. LM]+$/);
  assert.ok(!d.includes('NaN'));
});

test('EASE・envelope: 0 から 1 へ。端で外れない。envelope は始めと終わりが 0', () => {
  for (const name of Object.keys(EASE)) { near(EASE[name](0), 0); near(EASE[name](1), 1, 1e-9); }
  near(envelope(0, 2000), 0); near(envelope(2000, 2000), 0); near(envelope(1000, 2000), 1);
});

test('blendPose: 0 なら a、1 なら b', () => {
  const b = { ...STAND, lean: 10, flip: -1 };
  assert.deepEqual(blendPose(STAND, b, 0), STAND);
  assert.deepEqual(blendPose(STAND, b, 1), b);
  near(blendPose(STAND, b, 0.5).lean, 5);
});

test('basePose: どの気分でも、昼夜でも、有限の数で、足が床に着く。気分で姿勢が違う', () => {
  const seen = new Set();
  for (const mood of ['normal', 'happy', 'worried', 'cheer']) for (const night of [false, true]) for (const t of [0, 777, 5000, 123456]) {
    const p = basePose(mood, night, t);
    for (const k of POSE_KEYS) assert.ok(Number.isFinite(p[k]), `${mood} ${k}`);
    near(lowest(figureOf(p)), FLOOR);
    if (!night && t === 0) seen.add(JSON.stringify(p));
  }
  assert.equal(seen.size, 4); // 4つの気分は、別々の姿勢
});

test('動き: どの動きも、始めと終わりが基本の姿勢につながり、途中は有限の数で、地面の下へはもぐらない', () => {
  const sets = [[CLIPS, false], [NIGHT_CLIPS, true]];
  for (const [clips, night] of sets) {
    for (const [name, clip] of Object.entries(clips)) {
      assert.ok(clip.duration >= 800 && clip.duration <= 5000, `${name} の長さ`);
      for (const mood of ['normal', 'happy', 'worried', 'cheer']) {
        const base = basePose(mood, night, 1000);
        for (const edge of [0, clip.duration]) {
          const p = clipPose(clip, edge, base);
          for (const k of POSE_KEYS) near(p[k], base[k], 1e-6 + (k === 'flip' ? 1e-6 : 0)); // 端は基本の姿勢（proc は envelope で 0）
        }
      }
      const base = basePose('normal', night, 1000);
      for (let t = 0; t <= clip.duration; t += 25) {
        const p = clipPose(clip, t, base);
        for (const k of POSE_KEYS) assert.ok(Number.isFinite(p[k]), `${name} ${t} ${k}`);
        assert.ok(p.flip >= -1.0001 && p.flip <= 1.0001, `${name} ${t} flip`);
        const g = figureOf(p);
        near(lowest(g), FLOOR - p.lift, 1e-6);
        assert.ok(g.head.y > -12 && g.head.y < FLOOR, `${name} ${t} 頭の高さ ${g.head.y}`); // 枠からはみ出しすぎない
        assert.ok(g.head.x > -8 && g.head.x < 72, `${name} ${t} 頭の横 ${g.head.x}`);
      }
    }
  }
});

test('動き: ジャンプは、しゃがんでから跳ぶ（予備動作）。跳んだあとは着地でひざを曲げる', () => {
  const base = STAND;
  const hop = CLIPS.hop;
  const crouch = figureOf(clipPose(hop, 150, base)).pelvis.y;
  const air = clipPose(hop, 400, base);
  assert.ok(crouch > figureOf(base).pelvis.y + 3, 'まず腰が下がる');
  assert.ok(air.lift > 8, '跳ぶ');
  const land = figureOf(clipPose(hop, 640, base));
  assert.ok(land.pelvis.y > figureOf(base).pelvis.y + 3, '着地でしゃがむ');
});

test('動き: 散歩は、行って向きを変え（flip が 0 を通って -1 へ）、もどって、また向きを戻す。体操の腕は2回転', () => {
  const walk = CLIPS.walk;
  const flips = [];
  const xs = [];
  for (let t = 0; t <= walk.duration; t += 50) { const p = clipPose(walk, t, STAND); flips.push(p.flip); xs.push(p.x); }
  assert.ok(Math.min(...flips) <= -0.99 && Math.max(...flips) >= 0.99);
  assert.ok(Math.max(...xs) > 9 && Math.min(...xs) > -1);
  const ex = CLIPS.exercise;
  const a = [];
  for (let t = 240; t <= 2060; t += 20) a.push(clipPose(ex, t, STAND).aR);
  assert.ok(Math.max(...a) - Math.min(...a) > 600); // ぐるぐる回している
});

test('着せ替え: parseOutfit は、知っている小物だけ通す。壊れた値・知らない id は、何も付けない', () => {
  assert.deepEqual(parseOutfit(undefined), NO_OUTFIT);
  assert.deepEqual(parseOutfit('x'), NO_OUTFIT);
  assert.deepEqual(parseOutfit({ head: 'cap', neck: 'scarf', top: 'blue', shoes: 'brown' }), { head: 'cap', neck: 'scarf', top: 'blue', shoes: 'brown' });
  assert.deepEqual(parseOutfit({ head: 'ufo', neck: 3, top: '__proto__', shoes: 'toString', extra: 1 }), NO_OUTFIT);
});

test('着せ替え: 頭・首の小物は絵（SVG）を、服・靴は色を持つ。none はどの枠にもある', () => {
  for (const slot of Object.keys(NO_OUTFIT)) assert.ok('none' in ITEMS[slot], slot);
  for (const [id, item] of Object.entries(ITEMS.head).concat(Object.entries(ITEMS.neck))) if (id !== 'none') assert.match(item.svg, /^</, id);
  for (const slot of ['top', 'shoes']) for (const [id, item] of Object.entries(ITEMS[slot])) if (id !== 'none') assert.match(item.color, /^#[0-9A-Fa-f]{6}$/, `${slot} ${id}`);
});
