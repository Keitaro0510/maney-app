// 通知の設定（src/push.ts）の、画面を使わない部分。Issue #189・D36。実行: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPush, urlBase64ToBytes, VAPID_PUBLIC_KEY } from '../src/push.ts'; // Node が型を消して読む（D17）

const base = { hasApi: true, isIos: false, standalone: false, permission: 'default', subscribed: false };

test('classifyPush: 使える環境では、登録の有無で off・on', () => {
  assert.equal(classifyPush({ ...base }), 'off');
  assert.equal(classifyPush({ ...base, permission: 'granted', subscribed: true }), 'on');
});

test('classifyPush: 許可が取り消されていれば、登録が残っていても on にしない', () => {
  assert.equal(classifyPush({ ...base, permission: 'default', subscribed: true }), 'off');
  assert.equal(classifyPush({ ...base, permission: 'denied', subscribed: true }), 'denied');
});

test('classifyPush: iPhone で、ホーム画面に追加していなければ、追加を案内する', () => {
  assert.equal(classifyPush({ ...base, hasApi: false, isIos: true, standalone: false }), 'needs-install');
  assert.equal(classifyPush({ ...base, hasApi: false, isIos: true, standalone: true }), 'unsupported'); // 追加済みでも使えない（iOS 16.3 以前など）
  assert.equal(classifyPush({ ...base, hasApi: false, isIos: false }), 'unsupported');
});

test('urlBase64ToBytes: 公開鍵は 65 バイトで、0x04 から始まる', () => {
  const bytes = urlBase64ToBytes(VAPID_PUBLIC_KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

test('urlBase64ToBytes: - と _ を、+ と / として読む', () => {
  assert.deepEqual([...urlBase64ToBytes('-_8')], [251, 255]);
});

import { tabFromSearch, tabFromMessage } from '../src/push.ts';

test('tabFromSearch: 通知から開いたときの ?tab= を、決まった画面だけ受け付ける', () => {
  assert.equal(tabFromSearch('?tab=task'), 'task');
  assert.equal(tabFromSearch('?x=1&tab=home'), 'home');
  assert.equal(tabFromSearch('?tab=set'), null); // 設定は開かない
  assert.equal(tabFromSearch('?tab=%3Cscript%3E'), null);
  assert.equal(tabFromSearch(''), null);
});

test('tabFromMessage: Service Worker からの open-tab だけ受け付ける', () => {
  assert.equal(tabFromMessage({ type: 'open-tab', tab: 'cal' }), 'cal');
  assert.equal(tabFromMessage({ type: 'open-tab', tab: 'nope' }), null);
  assert.equal(tabFromMessage({ type: 'other', tab: 'home' }), null);
  assert.equal(tabFromMessage(null), null);
  assert.equal(tabFromMessage('home'), null);
});
