// 日付の更新、入力画面の補助、Service Worker 登録と起動（D20 の 10）。
import { ENV } from './env.ts';
import { getNow, setNow } from './dates.ts';
import { createDayWatcher, msUntilNextDay } from './clock.ts';
import { state } from './state.ts';
import { resyncRemote } from './sync.ts';
import { loadData, loginWithGoogle, logout } from './auth.ts';
import { bindNavigation, renderCurrentSection } from './navigation.ts';
import { bindCalendarControls, onCalendarDayChanged } from './screens/calendar.ts';
import { bindShiftControls, onShiftDayChanged } from './screens/shift.ts';
import { bindLedgerControls, onLedgerDayChanged } from './screens/ledger.ts';
import { bindTaskControls, maybeShowStartupTasks } from './screens/tasks.ts';
import { bindBackupControls } from './screens/backup.ts';
import { bindHomeControls } from './screens/home.ts';
import { bindAtmControls } from './screens/atm.ts';
import { bindMonthlyControls } from './screens/monthly.ts';
import { bindSettingsControls } from './screens/settings.ts';
import { bindCardControls } from './screens/cards.ts';
import { bindPlanControls } from './screens/plans.ts';
import { elementById } from './ui.ts';

function onDayChange(now: Date): void {
  const prev = getNow();
  setNow(now);
  onCalendarDayChanged(prev, now);
  onShiftDayChanged(prev, now);
  onLedgerDayChanged(prev, now);
  if (state.currentUser) { renderCurrentSection(); maybeShowStartupTasks(); }
}

const CHOICE_SELECTOR = 'button.pay-chip,button.chip,button.color-swatch,button.chk-day,#dmt-single,#dmt-range,#plan-mode-allday,#plan-mode-timed';
const syncPressed = (button: Element): void => button.setAttribute('aria-pressed', button.classList.contains('sel') || button.classList.contains('active') ? 'true' : 'false');
function syncChoicePressed(root: ParentNode): void { root.querySelectorAll(CHOICE_SELECTOR).forEach(syncPressed); }

function linkFormLabels(): void {
  document.querySelectorAll('.fg').forEach(group => {
    const label = group.querySelector<HTMLLabelElement>(':scope > label');
    if (!label) return;
    const fields = group.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=hidden]),select,textarea');
    if (!label.htmlFor && fields.length === 1 && fields[0].id) label.htmlFor = fields[0].id;
    const choices = group.querySelector<HTMLElement>(':scope > .pay-chips, :scope > .cat-chips, :scope > .color-swatches');
    if (choices && !fields.length) { choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', label.textContent || ''); }
  });
}

export function startBootstrap(): void {
  bindNavigation();
  bindCalendarControls();
  bindLedgerControls();
  bindTaskControls();
  bindBackupControls();
  bindHomeControls();
  bindAtmControls();
  bindMonthlyControls();
  bindSettingsControls();
  bindCardControls();
  bindPlanControls();
  bindShiftControls();
  elementById('google-login-btn').addEventListener('click', () => { void loginWithGoogle(); });
  elementById('logout-btn').addEventListener('click', () => { void logout(); });
  if ('serviceWorker' in navigator && ENV.target === 'prod') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(() => console.log('SW registered'))
        .catch(error => console.log('SW registration failed:', error));
    });
  }

  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const target = mutation.target;
      if (!(target instanceof Element)) continue;
      if (mutation.type === 'attributes') { if (target.matches(CHOICE_SELECTOR)) syncPressed(target); }
      else syncChoicePressed(target);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  syncChoicePressed(document);
  linkFormLabels();

  const watcher = createDayWatcher(() => new Date(), onDayChange);
  const scheduleDayCheck = (): void => {
    setTimeout(() => { watcher.check(); scheduleDayCheck(); }, msUntilNextDay(new Date()) + 1000);
  };
  scheduleDayCheck();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    watcher.check();
    void resyncRemote().then(() => maybeShowStartupTasks(true));
  });
  window.addEventListener('focus', () => watcher.check());
  window.addEventListener('online', resyncRemote);
  void loadData();
}
