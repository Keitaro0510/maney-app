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
  await page.waitForFunction(() => {
    const login = document.getElementById('login-screen');
    const spendable = document.getElementById('home-spendable');
    return !!login && !!spendable && getComputedStyle(login).display === 'none' && spendable.textContent !== '¥0';
  });
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

// 要素の DOM の写し。canvas（グラフ）の大きさなどは描くたびに変わるので外す。差分を読みやすいように、タグごとに改行する。
// style 属性は、ブラウザの書き方（cssText）にそろえ、空なら消す（写真を撮ると、Playwright が入力欄の style を書き直すため）
async function dom(page, selector) {
  return page.locator(selector).evaluate(el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('canvas').forEach(c => { for (const a of [...c.attributes]) if (a.name !== 'id') c.removeAttribute(a.name); });
    for (const e of [copy, ...copy.querySelectorAll('[style]')]) {
      if (!e.hasAttribute('style')) continue;
      const css = e.style.cssText;
      if (css) e.setAttribute('style', css); else e.removeAttribute('style');
    }
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

  await page.locator('#home-more-btn').click();
  await settle(page);
  expect.soft(await dom(page, '#home-more')).toMatchSnapshot('home-more.html');
  await shot(page, 'home-more.png', { fullPage: false });
});

test('カレンダー（月・週・日と、日の詳細）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  await settle(page);
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-month.html');
  await shot(page, 'cal-month.png');

  await page.locator('#cal-body .cday[data-day="2026-11-12"]').click();
  await settle(page);
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-day-detail.html');

  for (const view of ['week', 'day']) {
    await page.locator(`#cvt-${view}`).click();
    await settle(page);
    expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot(`cal-${view}.html`);
  }
});

test('家計簿（記録・グラフ・毎月のお金）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-ledger').click();
  await settle(page);
  expect.soft(await dom(page, '#sec-ledger')).toMatchSnapshot('ledger-list.html');
  await shot(page, 'ledger-list.png');
  for (const tab of ['graph', 'monthly']) {
    await page.locator('#ldg-main-tabs button').nth(['list', 'graph', 'monthly'].indexOf(tab)).click();
    await settle(page);
    expect.soft(await dom(page, '#sec-ledger')).toMatchSnapshot(`ledger-${tab}.html`);
  }
});

test('シフト・設定・タスク', async ({ page }) => {
  await open(page);
  await closeAll(page);
  for (const sec of ['shift', 'set', 'task']) {
    await page.locator(sec === 'set' ? '#settings-btn' : `#nav-${sec}`).click();
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
    ['atm', () => document.getElementById('home-open-atm').click(), '#wd-mbg', false],
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

test('固定のナビ・期間ボタンで画面を切り替える', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  await expect(page.locator('#sec-cal')).toHaveClass(/active/);
  await expect(page.locator('#nav-cal')).toHaveAttribute('aria-current', 'page');
  const calTitle = await page.locator('#cal-title').textContent();
  await page.locator('.cal-nav button').first().click();
  await expect(page.locator('#cal-title')).not.toHaveText(calTitle);
  await page.locator('.cal-nav button').last().click();
  await expect(page.locator('#cal-title')).toHaveText(calTitle);

  await page.locator('#nav-ledger').click();
  const monthLabel = await page.locator('#ldg-month-label').textContent();
  await page.locator('#ldg-month-nav button').first().click();
  await expect(page.locator('#ldg-month-label')).not.toHaveText(monthLabel);
  await page.locator('#ldg-month-nav button').last().click();
  await expect(page.locator('#ldg-month-label')).toHaveText(monthLabel);
  await page.locator('#ldg-main-tabs button').nth(1).click();
  await page.locator('#ldg-graph-mode-tabs button').nth(1).click();
  await expect(page.locator('#cat-chart-title')).toHaveText('カテゴリ別支出（年間）');
  await page.locator('#settings-btn').click();
  await expect(page.locator('#sec-set')).toHaveClass(/active/);
  await expect(page.locator('#settings-btn')).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => 'sw' in window)).toBe(false);
});

test('タスクの追加・編集・削除をボタンとフォームで行う', async ({ page }) => {
  await open(page);
  await page.locator('#task-startup [data-task-action="close"]').click();
  await expect(page.locator('#task-startup')).not.toBeVisible();
  await page.locator('#home-tasks').click();
  await expect(page.locator('#task-startup')).toBeVisible();
  await page.locator('#task-startup [data-task-action="all"]').click();
  await expect(page.locator('#sec-task')).toHaveClass(/active/);
  await page.locator('#task-add-due input[type="date"]').fill('2026-11-15');
  await expect(page.locator('#task-add-due [data-due="pick"]')).toHaveClass(/on/);
  await page.locator('#task-add-due button[data-due="today"]').click();
  await expect(page.locator('#task-add-due button[data-due="today"]')).toHaveAttribute('aria-pressed', 'true');

  const title = 'イベント登録の確認';
  await page.locator('#task-add-title').fill(title);
  await page.locator('#task-add-title').press('Enter');
  const row = page.locator('#task-list .check-row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.locator('.task-edit').click();
  await page.locator('#task-sheet [data-task-action="close"]').first().click();
  await expect(page.locator('#task-sheet')).not.toBeVisible();
  await row.locator('.task-edit').click();
  await page.locator('#task-sheet .task-sheet-due button[data-due="tomorrow"]').click();
  await expect(page.locator('#task-due')).not.toHaveValue('');
  await page.locator('#task-sheet [data-task-action="save"]').click();
  await expect(page.locator('#task-sheet')).not.toBeVisible();
  await row.locator('.task-edit').click();
  await page.locator('#task-sheet [data-task-action="delete"]').click();
  await expect(row).toHaveCount(0);
});

test('書き出したファイルを読み込みの確認画面で開いて閉じる', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#settings-btn').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backup-export-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^maney-export-\d{4}-\d{2}-\d{2}\.json$/);
  const filePath = await download.path();
  const chooseExport = async () => {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#backup-import-btn').click();
    await (await chooserPromise).setFiles(filePath);
  };
  await chooseExport();
  await expect(page.locator('#import-sheet')).toBeVisible();
  await expect(page.locator('#import-file')).toContainText('書き出したファイル');
  await page.locator('#import-cancel').click();
  await expect(page.locator('#import-sheet')).not.toBeVisible();
  await chooseExport();
  await expect(page.locator('#import-sheet')).toBeVisible();
  await page.locator('#import-close').click();
  await expect(page.locator('#import-sheet')).not.toBeVisible();
  expect(await page.evaluate(() => 'exportBackup' in window)).toBe(false);
});

test('ホームの操作ボタンとログアウト', async ({ page }) => {
  await open(page);
  await closeAll(page);
  for (const [button, modal] of [
    ['#home-add-ledger', '#ldg-mbg'],
    ['#home-add-plan', '#plan-mbg'],
    ['#home-open-atm', '#wd-mbg'],
  ]) {
    await page.locator(button).click();
    await expect(page.locator(modal)).toHaveClass(/open/);
    await closeAll(page);
  }
  await page.locator('#home-more-btn').click();
  await expect(page.locator('#home-more')).toBeVisible();
  await page.locator('#home-more-close').click();
  await expect(page.locator('#home-more')).not.toBeVisible();
  await page.locator('#settings-btn').click();
  await page.locator('#logout-btn').click();
  await expect(page.locator('#login-screen')).toBeVisible();
  expect(await page.evaluate(() => 'loginWithGoogle' in window || 'logout' in window)).toBe(false);
});

test('カレンダーの描画後に作るボタンとキーボード操作', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  const cell = page.locator('#cal-body .cday[data-day="2026-11-12"]');
  await cell.focus();
  await cell.press('Enter');
  await expect(page.locator('#day-detail')).toBeVisible();
  await page.locator('#day-detail [data-cal-action="close-detail"]').click();
  await expect(page.locator('#day-detail')).not.toBeVisible();
  await cell.focus();
  await cell.press('Space');
  await expect(page.locator('#day-detail')).toBeVisible();

  const deletePlanButton = page.locator('#day-detail [data-cal-action="delete-plan"]');
  const planId = await deletePlanButton.getAttribute('data-id');
  await deletePlanButton.evaluate(button => { button.dataset.id = 'old-record'; });
  await deletePlanButton.click();
  await expect(page.locator('#day-detail [data-cal-action="delete-plan"]')).toHaveAttribute('data-id', planId);

  await page.locator('#day-detail [data-cal-action="edit-plan"]').click();
  await expect(page.locator('#plan-mbg')).toHaveClass(/open/);
  await closeAll(page);
  await page.locator('#day-detail [data-cal-action="edit-ledger"]').click();
  await expect(page.locator('#ldg-edit-mbg')).toHaveClass(/open/);
  await closeAll(page);

  const done = page.locator('#day-detail input[data-cal-action="toggle-plan"]');
  const wasDone = await done.isChecked();
  await done.click();
  await expect(done).toBeChecked({ checked: !wasDone });
  await done.click();
  await expect(done).toBeChecked({ checked: wasDone });

  await page.locator('#day-detail [data-cal-action="add-plan"]').click();
  await expect(page.locator('#plan-date')).toHaveValue('2026-11-12');
  await closeAll(page);
  await page.locator('#day-detail [data-cal-action="jump-day"]').click();
  await expect(page.locator('#cvt-day')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#cal-list [data-cal-action="add-ledger"]').click();
  await expect(page.locator('#ldg-date')).toHaveValue('2026-11-12');
  await closeAll(page);
  expect(await page.evaluate(() => 'dayCellClick' in window || 'sameRecord' in window)).toBe(false);
});

test('ATM の数字キーと引き出し履歴の削除', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#home-open-atm').click();
  await page.locator('#wd-mbg [data-atm-key="1"]').click();
  await page.locator('#wd-mbg [data-atm-action="close"]').click();
  await expect(page.locator('#wd-mbg')).not.toHaveClass(/open/);
  await page.locator('#home-open-atm').click();
  await expect(page.locator('#wd-display')).toHaveText('¥0');
  for (const key of ['1', '2', '3', 'backspace', '000']) {
    await page.locator(`#wd-mbg [data-atm-key="${key}"]`).click();
  }
  await expect(page.locator('#wd-display')).toHaveText('¥12,000');
  await page.locator('#wd-mbg [data-atm-action="withdraw"]').click();
  await expect(page.locator('#wd-mbg')).not.toHaveClass(/open/);
  await page.locator('#settings-btn').click();
  const first = page.locator('#wd-hist .wd-hist-item').first();
  await expect(first).toContainText('-¥12,000');
  await first.locator('[data-atm-index]').click();
  await expect(page.locator('#wd-hist .wd-hist-item').first()).not.toContainText('-¥12,000');
  expect(await page.evaluate(() => 'nk' in window || 'delWd' in window)).toBe(false);
});

test('家計簿の選択肢と毎月のお金の編集シート', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-ledger').click();
  const header = page.locator('#ldg-list .ldg-day-header').first();
  await header.focus();
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.press('Space');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await header.click();
  await page.locator('#ldg-list [data-ledger-action="list-edit"]').first().click();
  await expect(page.locator('#ldg-edit-mbg')).toHaveClass(/open/);
  await page.locator('#ldg-edit-mbg [data-ledger-action="edit-type-income"]').click();
  await page.locator('#lde-receive-chips [data-value="口座振込"]').click();
  await expect(page.locator('#lde-receive-chips [data-value="口座振込"]')).toHaveClass(/sel/);
  await page.locator('#ldg-edit-mbg [data-ledger-action="close-edit"]').click();

  await page.locator('#sec-ledger [data-ledger-action="open-add"]').click();
  await expect(page.locator('#ldg-mbg')).toHaveClass(/open/);
  await page.locator('#ldg-mbg [data-ledger-action="type-income"]').click();
  await page.locator('#ldg-receive-chips [data-value="口座振込"]').click();
  await expect(page.locator('#ldg-receive-chips [data-value="口座振込"]')).toHaveClass(/sel/);
  await page.locator('#ldg-mbg [data-ledger-action="type-expense"]').click();
  await page.locator('#cat-chips [data-ledger-action="select-cat"]').last().click();
  await expect(page.locator('#cat-chips [data-ledger-action="select-cat"]').last()).toHaveClass(/sel/);
  await page.locator('#ldg-pay-chips [data-ledger-action="select-pay"]').nth(1).click();
  await expect(page.locator('#ldg-pay-chips [data-ledger-action="select-pay"]').nth(1)).toHaveClass(/sel/);
  await page.locator('#ldg-repeat').check();
  await expect(page.locator('#ldg-repeat-hint')).toBeVisible();
  await page.locator('#ldg-mbg [data-ledger-action="close-add"]').click();

  await page.locator('#sec-ledger [data-ledger-action="open-add"]').click();
  await page.locator('#ldg-amount').fill('123');
  await page.locator('#ldg-name').fill('イベント登録の家計簿確認');
  await page.locator('#ldg-mbg [data-ledger-action="save-add"]').click();
  await expect(page.locator('#ldg-mbg')).not.toHaveClass(/open/);
  const addedGroup = page.locator('#ldg-list .ldg-day-group').filter({ hasText: 'イベント登録の家計簿確認' });
  await addedGroup.locator('.ldg-day-header').click();
  await addedGroup.locator('.ri').filter({ hasText: 'イベント登録の家計簿確認' }).locator('[data-ledger-action="list-delete"]').click();
  await expect(page.locator('#ldg-list')).not.toContainText('イベント登録の家計簿確認');

  await page.locator('#ldg-main-tabs button').nth(2).click();
  await page.locator('#sec-ledger [data-ledger-action="open-monthly-add"]').click();
  await expect(page.locator('#ldg-repeat')).toBeChecked();
  await page.locator('#ldg-mbg [data-ledger-action="close-add"]').click();
  await page.locator('#monthly-list .monthly-row').first().click();
  await expect(page.locator('#monthly-sheet')).toBeVisible();
  await page.locator('#monthly-sheet [data-monthly-action="change-amount"]').click();
  await expect(page.locator('#monthly-amount-err')).toBeVisible();
  await page.locator('#monthly-sheet [data-monthly-action="close"]').click();
  await expect(page.locator('#monthly-sheet')).not.toBeVisible();
  await page.locator('#settings-btn').click();
  await page.locator('#settings-open-monthly').click();
  await expect(page.locator('#ldg-monthly-sec')).toBeVisible();
  expect(await page.evaluate(() => 'selLdgType' in window || 'stopMonthly' in window)).toBe(false);
});
