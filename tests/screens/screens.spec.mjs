// 画面を比べる道具（D20 の 0）。画面ごとの DOM の写しと、主な画面の写真を、基準と比べる。
// 画面を src/ に移す PR（D20）は「表示を変えない」ので、基準と同じになるはず。違ったら、その PR で表示が変わっている。
// 基準を変える（表示をわざと変えた）ときは --update-snapshots で作り直し、差分を PR で見る（D20）。
// 比べる所は expect.soft（違っても最後まで続け、違いを一度に全部出す）
import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD, NOW, HOLIDAYS } from './constants.mjs';

// 時刻を固定し、祝日の取得を固定の答えにして、テスト用のユーザーでログインする
async function open(page, path = '/', { anyScreen = false } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.route('https://www.googleapis.com/**', route => route.fulfill({ json: HOLIDAYS }));
  await page.goto(path);
  const form = page.locator('[data-maney-local-login]');
  await form.locator('input[name=email]').fill(EMAIL);
  await form.locator('input[name=password]').fill(PASSWORD);
  await form.locator('button[value=signin]').click();
  // ログインできたら読み込み直して起動する。サーバーから読み終えるまで待つ
  // ホーム以外の画面を最初に開いたとき（通知から開いた場合など）は、ホームは描き直されないので、使えるお金は待たない
  await page.waitForFunction(anyScreen => {
    const login = document.getElementById('login-screen');
    const spendable = document.getElementById('home-spendable');
    return !!login && !!spendable && getComputedStyle(login).display === 'none' && (anyScreen || spendable.textContent !== '¥0');
  }, anyScreen);
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
    // 共有コード（D39）は毎回変わるので、固定の文字にそろえる
    return copy.outerHTML.replace(/>\s*</g, '>\n<').replace(/\b[0-9a-f]{4}(?:-[0-9a-f]{4}){3}\b/g, 'xxxx-xxxx-xxxx-xxxx') + '\n';
  });
}

const shot = (page, name, options = {}) =>
  expect.soft(page).toHaveScreenshot(name, { fullPage: true, mask: [page.locator('canvas')], ...options });

test('開いたときのタスクと、ホーム', async ({ page }) => {
  await open(page);
  await expect(page.locator('#task-startup')).toBeVisible();
  const notice = await page.locator('#task-startup').boundingBox();
  expect(notice).not.toBeNull();
  if (notice) {
    expect(notice.y).toBeGreaterThan(40);
    expect(notice.y + notice.height).toBeLessThan(804);
  }
  expect.soft(await dom(page, '#task-startup')).toMatchSnapshot('task-startup.html');
  await shot(page, 'task-startup.png', { fullPage: false });
  const longList = await page.locator('#task-startup').evaluate(dialog => {
    const extra = document.createElement('div');
    extra.style.height = '2000px';
    dialog.querySelector('#task-startup-list').append(extra);
    const result = { withinScreen: dialog.getBoundingClientRect().bottom < innerHeight, scrollable: dialog.scrollHeight > dialog.clientHeight };
    extra.remove();
    return result;
  });
  expect(longList).toEqual({ withinScreen: true, scrollable: true });
  await closeAll(page);

  expect.soft(await dom(page, '#sec-home')).toMatchSnapshot('home.html');
  await shot(page, 'home.png');

  await page.locator('#home-more-btn').click();
  await settle(page);
  expect.soft(await dom(page, '#home-more')).toMatchSnapshot('home-more.html');
  await shot(page, 'home-more.png', { fullPage: false });
});

test('カレンダー（月と日の詳細）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  await settle(page);
  const taskDay = page.locator('#cal-body .cday[data-day="2026-11-12"]');
  await expect(taskDay.locator('.task-mark')).toHaveText('1');
  await expect(page.locator('#cal-body .pill.task')).toHaveCount(0);
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-month.html');
  await shot(page, 'cal-month.png');

  await taskDay.click();
  await settle(page);
  await expect(page.locator('#day-detail .task-ri-title')).toBeVisible();
  expect.soft(await dom(page, '#sec-cal')).toMatchSnapshot('cal-day-detail.html');

  await page.locator('.cal-nav button').last().click();
  await expect(page.locator('#cal-title')).toHaveText('2026年12月');
  await expect(page.locator('#day-detail')).not.toBeVisible();
  await page.locator('.cal-nav button').first().click();
  await expect(page.locator('#cal-title')).toHaveText('2026年11月');
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
    if (sec === 'set') await expect(page.locator('#share-code')).toHaveText(/^[0-9a-f]{4}-/); // 共有コードを読み終えるまで待つ（D39）
    expect.soft(await dom(page, `#sec-${sec}`)).toMatchSnapshot(`${sec}.html`);
    // 共有コードは毎回変わるので、写真では隠す
    await shot(page, `${sec}.png`, sec === 'set' ? { mask: [page.locator('canvas'), page.locator('#share-code')] } : {});
  }
});

test('入力画面', async ({ page }) => {
  await open(page);
  await closeAll(page);
  // [名前, 画面の操作, 写す要素, 写真も撮るか]
  const modals = [
    ['ledger-add', async () => { await page.locator('#home-add-ledger').click(); }, '#ldg-mbg', false],
    ['ledger-edit', async () => { await page.locator('#nav-ledger').click(); await page.locator('#ldg-list .ldg-day-header').first().click(); await page.locator('#ldg-list [data-ledger-action="list-edit"]').first().click(); }, '#ldg-edit-mbg', false],
    ['plan-add', async () => { await page.locator('#nav-home').click(); await page.locator('#home-add-plan').click(); }, '#plan-mbg', true],
    ['shift-add', async () => { await page.locator('#nav-shift').click(); await page.locator('#sec-shift [data-shift-action="open-add"]').click(); }, '#shift-mbg', false],
    ['job-edit', async () => { await page.locator('#nav-shift').click(); await page.locator('#job-list [data-shift-action="edit-job"]').first().click(); }, '#job-edit-mbg', false],
    ['card-edit', async () => { await page.locator('#settings-btn').click(); await page.locator('#card-list-sec [data-card-action="edit"]').first().click(); }, '#card-edit-mbg', false],
    ['atm', async () => { await page.locator('#nav-home').click(); await page.locator('#home-open-atm').click(); }, '#wd-mbg', false],
    ['task-edit', async () => { await page.locator('#nav-task').click(); await page.locator('#task-list .task-edit').first().click(); }, '#task-sheet', false],
    ['monthly-edit', async () => { await page.locator('#nav-ledger').click(); await page.locator('#ldg-main-tabs button').nth(2).click(); await page.locator('#monthly-list .monthly-row').first().click(); }, '#monthly-sheet', false],
  ];
  for (const [name, openIt, selector, withShot] of modals) {
    await openIt();
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

test('タスクの複数タグを付け外し、タグで一覧を絞る', async ({ page }) => {
  await open(page);
  await page.locator('#task-startup [data-task-action="all"]').click();
  await page.locator('#task-add-title').fill('タグの確認');
  await page.locator('#task-add-tags').fill('仕事、就活、仕事');
  await page.locator('#sec-task .task-add button[type="submit"]').click();
  const row = page.locator('#task-list .check-row').filter({ hasText: 'タグの確認' });
  await expect(row.locator('.task-tag')).toHaveText(['仕事', '就活']);
  await expect(page.locator('#task-add-tag-suggestions button').filter({ hasText: '仕事' })).toBeVisible();
  await page.locator('#task-filter button').filter({ hasText: '就活' }).click();
  await expect(row).toBeVisible();
  await page.locator('#task-filter button').filter({ hasText: '仕事' }).click();
  await expect(row).toBeVisible();
  await row.locator('.task-edit').click();
  await page.locator('#task-edit-tag-suggestions button').filter({ hasText: '仕事' }).click();
  await expect(page.locator('#task-tags')).toHaveValue('就活');
  await page.locator('#task-tags').fill('お金');
  await page.locator('#task-sheet [data-task-action="save"]').click();
  await expect(page.locator('#task-filter button').filter({ hasText: '仕事' })).toHaveCount(0);
  await page.locator('#task-filter button').filter({ hasText: 'お金' }).click();
  await expect(row).toBeVisible();
  await expect(row.locator('.task-tag')).toHaveText('お金');
  await row.locator('.task-edit').click();
  await page.locator('#task-sheet [data-task-action="delete"]').click();
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
  // ログアウトは signOut のあとに画面を読み込み直す。ログイン画面が見えた直後は、まだ読み込み直しの途中のことがあり、
  // evaluate が「実行の場所が消えた」で落ちる。読み込み直しが終わるまで、値を取り直して待つ
  await expect.poll(() => page.evaluate(() => 'loginWithGoogle' in window || 'logout' in window).catch(() => null)).toBe(false);
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
  await page.locator('#day-detail [data-cal-action="add-ledger"]').click();
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

test('設定のカテゴリとカードを実際の操作で追加・編集・削除する', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#settings-btn').click();
  await page.locator('#new-cat-exp').fill('操作テストのカテゴリ');
  await page.locator('#add-cat-exp').click();
  const category = page.locator('#cat-exp-tags .cat-tag').filter({ hasText: '操作テストのカテゴリ' });
  await expect(category).toBeVisible();
  await category.locator('button').click();
  await expect(category).toHaveCount(0);

  await page.locator('#cn-name').fill('操作テストのカード');
  await page.locator('#cn-close-eom').check();
  await expect(page.locator('#cn-close')).toBeDisabled();
  await page.locator('#cn-bill').fill('27');
  await page.locator('#add-card').click();
  const card = page.locator('#card-list-sec > div').filter({ hasText: '操作テストのカード' });
  await expect(card).toBeVisible();
  await card.locator('[data-card-action="edit"]').click();
  await expect(page.locator('#card-edit-mbg')).toHaveClass(/open/);
  await page.locator('#ce-name').fill('操作テストのカード編集');
  await page.locator('#card-edit-mbg [data-card-action="save-edit"]').click();
  await expect(page.locator('#card-edit-mbg')).not.toHaveClass(/open/);
  const edited = page.locator('#card-list-sec > div').filter({ hasText: '操作テストのカード編集' });
  await expect(edited).toBeVisible();
  await edited.locator('[data-card-action="bill-change"]').first().fill('1234');
  await edited.locator('[data-card-action="bill-change"]').first().dispatchEvent('change');
  await expect(edited.locator('[data-card-action="bill-change"]').first()).toHaveValue('1234');
  await edited.locator('[data-card-action="delete"]').click();
  await expect(edited).toHaveCount(0);
  expect(await page.evaluate(() => 'addCatExp' in window || 'addCard' in window)).toBe(false);
});

test('予定の入力画面で日付（複数）・時刻・色・支払いを選ぶ', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#home-add-plan').click();
  await expect(page.locator('#plan-mbg')).toHaveClass(/open/);
  // 新しい予定は、シフトと同じく日付を複数選ぶ（D40）。はじめは今日だけが選ばれている。「1日／期間」のタブはない
  await expect(page.locator('#date-multi-wrap')).toBeVisible();
  await expect(page.locator('#plan-sel-count')).toHaveText('1日');
  await expect(page.locator('#plan-mbg [data-plan-action="date-range"]')).toHaveCount(0);
  await page.locator('#plan-cal-grid [data-date="2026-11-20"]').click();
  await expect(page.locator('#plan-sel-count')).toHaveText('2日');
  await page.locator('#plan-cal-grid [data-date="2026-11-20"]').click(); // もう一度押すと外れる
  await expect(page.locator('#plan-sel-count')).toHaveText('1日');
  await page.locator('#plan-mbg [data-plan-action="cal-next"]').click();
  await expect(page.locator('#plan-cal-lbl')).toHaveText('2026年12月');
  await page.locator('#plan-mbg [data-plan-action="timed"]').click();
  await expect(page.locator('#plan-time-wrap')).not.toHaveClass(/is-all-day/);
  await page.locator('#plan-color-swatches [data-plan-action="color"]').nth(1).click();
  await expect(page.locator('#plan-color-swatches [data-plan-action="color"]').nth(1)).toHaveClass(/sel/);
  await page.locator('#plan-pay-chips [data-plan-action="pay"]').nth(1).click();
  await expect(page.locator('#plan-pay-chips [data-plan-action="pay"]').nth(1)).toHaveClass(/sel/);
  await page.locator('#plan-mbg [data-plan-action="close"]').click();
  await expect(page.locator('#plan-mbg')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => 'setDateMode' in window || 'savePlan' in window)).toBe(false);
});

test('予定を、選んだ日ごとに1日の予定として入れる（予算は最初の日だけ）', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  await settle(page);
  await page.locator('#cal-add-row [data-cal-action="add-plan"]').click();
  await page.locator('#plan-title').fill('お休み');
  await page.locator('#plan-cal-grid [data-date="2026-11-18"]').click();
  await page.locator('#plan-cal-grid [data-date="2026-11-25"]').click();
  await expect(page.locator('#plan-sel-count')).toHaveText('3日'); // 今日（11/12）と、18日・25日
  await page.locator('#plan-budget').fill('3000');
  await expect(page.locator('#plan-multi-hint')).toContainText('最初の日 11/12 だけ');
  await page.locator('#plan-mbg [data-plan-action="save"]').click();
  await expect(page.locator('#plan-mbg')).not.toHaveClass(/open/);
  for (const d of ['2026-11-12', '2026-11-18', '2026-11-25']) {
    await expect(page.locator(`#cal-body .cday[data-day="${d}"]`)).toContainText('お休み');
  }
  await expect(page.locator('#cal-body .cday[data-day="2026-11-19"]')).not.toContainText('お休み');
  // 日ごとに別々の予定なので、1日だけ消せる。予算は最初の日だけに入っている
  await page.locator('#cal-body .cday[data-day="2026-11-18"]').click();
  await expect(page.locator('#day-detail-content')).toContainText('お休み');
  await expect(page.locator('#day-detail-content')).not.toContainText('3,000');
  await page.locator('#cal-body .cday[data-day="2026-11-12"]').click();
  await expect(page.locator('#day-detail-content')).toContainText('3,000');
});

test('シフトとバイト先の操作をボタンから行う', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-shift').click();
  const month = await page.locator('#shift-list-month-label').textContent();
  await page.locator('#sec-shift [data-shift-action="list-prev"]').click();
  await expect(page.locator('#shift-list-month-label')).not.toHaveText(month);
  await page.locator('#sec-shift [data-shift-action="list-next"]').click();
  await expect(page.locator('#shift-list-month-label')).toHaveText(month);

  await page.locator('#job-add-toggle').click();
  await expect(page.locator('#job-add-form')).toBeVisible();
  await page.locator('#job-name').fill('操作テストのバイト先');
  await page.locator('#job-wage').fill('1200');
  await page.locator('#job-color-swatches [data-shift-action="add-color"]').nth(1).click();
  await page.locator('#job-add-form [data-shift-action="add-job"]').click();
  const job = page.locator('#job-list .ri').filter({ hasText: '操作テストのバイト先' });
  await expect(job).toBeVisible();
  await job.locator('[data-shift-action="edit-job"]').click();
  await page.locator('#je-name').fill('操作テストのバイト先編集');
  await page.locator('#je-color-swatches [data-shift-action="edit-color"]').nth(2).click();
  await page.locator('#job-edit-mbg [data-shift-action="save-job-edit"]').click();
  const edited = page.locator('#job-list .ri').filter({ hasText: '操作テストのバイト先編集' });
  await expect(edited).toBeVisible();

  await page.locator('#sec-shift [data-shift-action="open-add"]').click();
  await expect(page.locator('#shift-mbg')).toHaveClass(/open/);
  await page.locator('#m-job').selectOption({ label: '操作テストのバイト先編集' });
  await page.locator('#m-rest-chips [data-shift-action="rest"]').nth(2).click();
  await expect(page.locator('#m-rest')).toHaveValue('60');
  await page.locator('#shift-mbg [data-shift-action="cal-next"]').click();
  await expect(page.locator('#m-month-lbl')).toContainText('12月');
  await page.locator('#shift-mbg [data-shift-action="cal-prev"]').click();
  await page.locator('#shift-cal-grid .chk-day:not(.off)').first().click();
  await expect(page.locator('#sel-days-count')).toHaveText('1日');
  await page.locator('#shift-mbg [data-shift-action="save-shift"]').click();
  await expect(page.locator('#shift-mbg')).not.toHaveClass(/open/);
  const shift = page.locator('#shift-list .ri').filter({ hasText: '操作テストのバイト先編集' });
  await expect(shift).toBeVisible();
  const salary = page.locator('#salary-table > div').filter({ hasText: '操作テストのバイト先編集' }).locator('.salary-input:visible').first();
  await salary.fill('1234');
  await salary.dispatchEvent('change');
  await expect(salary).toHaveValue('1234');
  await salary.fill('');
  await salary.dispatchEvent('change');
  await shift.locator('[data-shift-action="delete-shift"]').click();
  await expect(shift).toHaveCount(0);
  await edited.locator('[data-shift-action="delete-job"]').click();
  await expect(edited).toHaveCount(0);
  expect(await page.evaluate(() => 'openShiftModal' in window && 'saveShift' in window)).toBe(false);
});

test('HTML 特殊文字を含むカード名を文字として表示する', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#settings-btn').click();
  const name = '試験 <img src=x onerror=alert(1)> & "カード"';
  await page.locator('#cn-name').fill(name);
  await page.locator('#cn-close').fill('15');
  await page.locator('#cn-bill').fill('27');
  await page.locator('#add-card').click();
  const list = page.locator('#card-list-sec');
  await expect(list.getByText(name, { exact: true })).toBeVisible();
  await expect(list.locator('img')).toHaveCount(0);
});

// カレンダーの共有（D39）。サーバーの共有用の関数は、DB のテスト（supabase/tests/database/14_calendar_share.test.sql）で確かめた。
// ここでは、画面（切り替え・見るだけ・自分の分と混ざらない）を、関数の答えを固定して確かめる
test('相手のカレンダー（見るだけ。自分のとは混ぜない）', async ({ page }) => {
  const owner = 'a0000000-0000-4000-8000-0000000000aa';
  await page.route('**/rest/v1/rpc/list_calendar_shares', route => route.fulfill({ json: [
    { id: 'b0000000-0000-4000-8000-0000000000b1', direction: 'viewing', status: 'approved', nickname: '彼女', other_name: '', owner_id: owner },
  ] }));
  await page.route('**/rest/v1/rpc/shared_calendar', route => route.fulfill({ json: {
    plans: [{ id: 'p1', title: '映画', start_date: '2026-11-14', end_date: '2026-11-14', start_time: '18:00:00', end_time: '20:00:00', color: 'pink' }],
    shifts: [{ id: 's1', date: '2026-11-14', start_time: '10:00:00', end_time: '15:00:00', job: 'ドーナツ屋' }],
  } }));
  await open(page);
  await closeAll(page);
  await page.locator('#nav-cal').click();
  await settle(page);

  // はじめは自分のカレンダー。切り替えは「自分」と「彼女」
  await expect(page.locator('#cal-who .cal-who-btn')).toHaveText(['自分', '彼女']);
  await expect(page.locator('#cal-add-row')).toBeVisible();
  await expect(page.locator('#cal-body')).not.toContainText('映画');

  await page.locator('#cal-who [data-cal-who]', { hasText: '彼女' }).click();
  await settle(page);
  const day = page.locator('#cal-body .cday[data-day="2026-11-14"]');
  await expect(day).toContainText('18:00 映画');
  await expect(day).toContainText('10:00');
  await expect(page.locator('#cal-who-note')).toContainText('見るだけ');
  await expect(page.locator('#cal-add-row')).toBeHidden(); // 追加のボタンは出さない
  // 自分のタスク・お金は出ない（11/12 は自分にはタスクの印が付く日）
  await expect(page.locator('#cal-body .task-mark')).toHaveCount(0);

  await day.click();
  await expect(page.locator('#day-detail-content')).toContainText('映画');
  await expect(page.locator('#day-detail-content')).toContainText('ドーナツ屋');
  await expect(page.locator('#day-detail-content')).toContainText('10:00〜15:00');
  await expect(page.locator('#day-detail-content button.edit, #day-detail-content button.del')).toHaveCount(0); // 編集・削除なし
  await expect(page.locator('#cal-day-add')).toBeHidden();

  // 自分に戻すと、自分のカレンダーに戻る
  await page.locator('#cal-who [data-cal-who="me"]').click();
  await settle(page);
  await expect(page.locator('#cal-body .task-mark').first()).toBeVisible();
  await expect(page.locator('#cal-body')).not.toContainText('映画');
  await expect(page.locator('#cal-add-row')).toBeVisible();
});

test('設定の共有: コードが出て、知らないコードの申請はエラーになる', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#settings-btn').click();
  await settle(page);
  await expect(page.locator('#share-code')).toHaveText(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  await expect(page.locator('#share-list')).toContainText('まだ誰ともつながっていません');
  await page.locator('#share-code-input').fill('0000-0000-0000-0000');
  await page.locator('#share-request').click();
  await expect(page.locator('#share-msg')).toContainText('コードが見つかりません');
  // 名前を保存できる（申請を受けた人には、この名前だけが見える）。空では保存できない
  await page.locator('#share-name').fill('  ');
  await page.locator('#share-name-save').click();
  await expect(page.locator('#share-msg')).toContainText('名前を入れてください');
  await page.locator('#share-name').fill('テスト太郎');
  await page.locator('#share-name-save').click();
  await expect(page.locator('#share-msg')).toBeHidden();
  // 入力欄を空にして、別のタブから設定に戻ると、サーバーに保存した名前が戻る
  await page.locator('#share-name').fill('');
  await page.locator('#nav-cal').click();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#share-name')).toHaveValue('テスト太郎');
});

// 通知（Issue #189・D36）。手元の開発サーバーには Service Worker がないので、「使えません」の案内が出て、ボタンは出ない。
// 実際に届くことは、実機（iPhone）で確かめる
test('設定の通知: Service Worker のない環境では、案内だけが出る', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#settings-btn').click();
  await settle(page);
  await expect(page.locator('#push-status')).toContainText('この環境では通知を使えません');
  await expect(page.locator('#push-actions')).toBeHidden();
});

// 通知を押してアプリが開いたとき（?tab=〇〇）、その画面を開く（D36）。開いたら URL から消す。知らない名前は無視する
test('通知から開いたとき: ?tab=task でタスクの画面が開く', async ({ page }) => {
  await open(page, '/?tab=task', { anyScreen: true });
  await expect(page.locator('#sec-task')).toHaveClass(/active/);
  await expect(page.locator('#sec-home')).not.toHaveClass(/active/);
  expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
});

test('通知から開いたとき: 知らない画面の名前は無視して、ホームのまま', async ({ page }) => {
  await open(page, '/?tab=set');
  await expect(page.locator('#sec-home')).toHaveClass(/active/);
});

// シフトタブの「今年の収入」は、上のカード（確定申告用）に1か所だけ。下のサマリーには、同じ数字を出さない（D38）
test('シフトタブ: 今年の収入の数字が重ならない', async ({ page }) => {
  await open(page);
  await closeAll(page);
  await page.locator('#nav-shift').click();
  await settle(page);
  await expect(page.locator('#income-content')).toContainText('今までに受け取った額');
  await expect(page.locator('#income-content')).toContainText('今年の合計（シフト通りなら）');
  await expect(page.locator('#sec-shift')).not.toContainText('今年の確定収入');
  await expect(page.locator('#sec-shift')).not.toContainText('今年のシフト予想');
  await expect(page.locator('#sec-shift')).toContainText('今月と月別の収入');
  await expect(page.locator('#year-this-month')).toBeVisible();
  await expect(page.locator('#year-transport')).toBeVisible();
});
