// 画面を比べる道具（D20 の 0）。画面ごとの DOM の写しと、主な画面の写真を、基準と比べる。
// 画面を src/ に移す PR（D20）は「表示を変えない」ので、基準と同じになるはず。違ったら、その PR で表示が変わっている。
// 基準を変える（表示をわざと変えた）ときは --update-snapshots で作り直し、差分を PR で見る（D20）。
// 比べる所は expect.soft（違っても最後まで続け、違いを一度に全部出す）
import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD, NOW, HOLIDAYS } from './constants.mjs';

// 時刻を固定し、祝日の取得を固定の答えにして、テスト用のユーザーでログインする
async function open(page) {
  await page.clock.setFixedTime(NOW);
  await page.route('https://www.googleapis.com/**', route => route.fulfill({ json: HOLIDAYS }));
  await page.goto('/');
  const form = page.locator('[data-maney-local-login]');
  await form.locator('input[name=email]').fill(EMAIL);
  await form.locator('input[name=password]').fill(PASSWORD);
  await form.locator('button[value=signin]').click();
  // ログインできたら読み込み直して起動する。サーバーから読み終えるまで待つ
  await page.waitForFunction(() => window.remoteReady === true && !window.loadingRemote && !window.sending
    && getComputedStyle(document.getElementById('login-screen')).display === 'none');
  await settle(page);
}

// 描き終わるのを待つ（祝日の取得・フォント）
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

// 開いている入力画面・シートを閉じる
async function closeAll(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.mbg.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
  });
}

// 要素の DOM の写し。canvas（グラフ）の大きさなどは描くたびに変わるので外す。差分を読みやすいように、タグごとに改行する
async function dom(page, selector) {
  return page.locator(selector).evaluate(el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('canvas').forEach(c => { for (const a of [...c.attributes]) if (a.name !== 'id') c.removeAttribute(a.name); });
    return copy.outerHTML.replace(/>\s*</g, '>\n<') + '\n';
  });
}

const shot = (page, name, options = {}) =>
  expect.soft(page).toHaveScreenshot(name, { fullPage: true, mask: [page.locator('canvas')], ...options });

test('開いたときのタスクと、ホーム', async ({ page }) => {
  await open(page);
  await expect(page.locator('#task-startup')).toBeVisible();
  expect.soft(await dom(page, '#task-startup')).toMatchSnapshot('task-startup.html');
  await shot(page, 'task-startup.png', { fullPage: false });
  await closeAll(page);

  expect.soft(await dom(page, '#sec-home')).toMatchSnapshot('home.html');
  await shot(page, 'home.png');

  await page.evaluate(() => openHomeMore(document.body));
  await settle(page);
  expect.soft(await dom(page, '#home-more')).toMatchSnapshot('home-more.html');
  await shot(page, 'home-more.png', { fullPage: false });
});

test('カレンダー（月・週・日と、日の詳細）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.evaluate(() => sw('cal'));
  await settle(page);
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-month.html');
  await shot(page, 'cal-month.png');

  await page.evaluate(() => dayClick('2026-11-12'));
  await settle(page);
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-day-detail.html');

  for (const view of ['week', 'day']) {
    await page.evaluate(v => setCalView(v), view);
    await settle(page);
    expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot(`cal-${view}.html`);
  }
});

test('家計簿（記録・グラフ・毎月のお金）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.evaluate(() => sw('ledger'));
  await settle(page);
  expect.soft(await dom(page, '#sec-ledger')).toMatchSnapshot('ledger-list.html');
  await shot(page, 'ledger-list.png');
  for (const tab of ['graph', 'monthly']) {
    await page.evaluate(t => ldgTab(t), tab);
    await settle(page);
    expect.soft(await dom(page, '#sec-ledger')).toMatchSnapshot(`ledger-${tab}.html`);
  }
});

test('シフト・設定・タスク', async ({ page }) => {
  await open(page);
  await closeAll(page);
  for (const sec of ['shift', 'set', 'task']) {
    await page.evaluate(s => sw(s), sec);
    await settle(page);
    expect.soft(await dom(page, `#sec-${sec}`)).toMatchSnapshot(`${sec}.html`);
    await shot(page, `${sec}.png`);
  }
});

test('入力画面', async ({ page }) => {
  await open(page);
  await closeAll(page);
  // [名前, 開く処理, 写す要素, 写真も撮るか]
  const modals = [
    ['ledger-add', () => openLedgerModal(), '#ldg-mbg', true],
    ['ledger-edit', () => openLdgEdit(0), '#ldg-edit-mbg', false],
    ['plan-add', () => openPlanModal('2026-11-12'), '#plan-mbg', true],
    ['shift-add', () => openShiftModal('2026-11-12'), '#shift-mbg', false],
    ['job-edit', () => openJobEdit(0), '#job-edit-mbg', false],
    ['card-edit', () => openCardEdit(0), '#card-edit-mbg', false],
    ['atm', () => openWd(), '#wd-mbg', false],
    ['task-add', () => openTaskSheet(null, document.body), '#task-sheet', true],
    ['monthly-add', () => openMonthlySheet(null, document.body), '#monthly-sheet', false],
  ];
  for (const [name, openIt, selector, withShot] of modals) {
    await page.evaluate(openIt);
    await settle(page);
    expect.soft(await dom(page, selector)).toMatchSnapshot(`modal-${name}.html`);
    if (withShot) await shot(page, `modal-${name}.png`, { fullPage: false });
    await closeAll(page);
  }
});
