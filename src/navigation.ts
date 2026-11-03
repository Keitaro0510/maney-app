// 画面の切り替えと、同期・ログイン画面への入口（D20 の 10）。
import type { User } from '@supabase/supabase-js';
import type { AuthUi } from './auth.ts';
import type { UiPort, BannerAction } from './sync.ts';
import { state } from './state.ts';
import { downloadJson, elementById } from './ui.ts';
import { renderHome } from './screens/home.ts';
import { renderCal } from './screens/calendar.ts';
import { renderLedger, renderLedgerMetrics, updateLdgNav_ } from './screens/ledger.ts';
import { renderMonthlyTab } from './screens/monthly.ts';
import { renderShiftSection } from './screens/shift.ts';
import { renderTaskTab, maybeShowStartupTasks } from './screens/tasks.ts';
import { initSettingTab } from './screens/settings.ts';

export function sw(tab: string): void {
  ['home','cal','ledger','shift','task','set'].forEach(name => {
    elementById('sec-' + name).classList.toggle('active', name === tab);
    const nav = document.getElementById('nav-' + name);
    if (nav) {
      nav.classList.toggle('active', name === tab);
      if (name === tab) nav.setAttribute('aria-current', 'page');
      else nav.removeAttribute('aria-current');
    }
  });
  const settings = elementById('settings-btn');
  settings.classList.toggle('active', tab === 'set');
  if (tab === 'set') settings.setAttribute('aria-current', 'page');
  else settings.removeAttribute('aria-current');
  if (tab === 'home') renderHome();
  else if (tab === 'cal') void renderCal();
  else if (tab === 'ledger') {
    updateLdgNav_(); renderLedger(); renderLedgerMetrics();
    if (elementById('ldg-monthly-sec').style.display !== 'none') renderMonthlyTab();
  }
  else if (tab === 'shift') renderShiftSection();
  else if (tab === 'task') renderTaskTab();
  else if (tab === 'set') initSettingTab();
}

/** 固定のナビボタンをモジュールの関数につなぐ。HTML の onclick は使わない。 */
export function bindNavigation(): void {
  for (const tab of ['home', 'cal', 'ledger', 'shift', 'task', 'set']) {
    const id = tab === 'set' ? 'settings-btn' : `nav-${tab}`;
    elementById(id).addEventListener('click', () => sw(tab));
  }
}

export function renderCurrentSection(): void {
  const current = document.querySelector<HTMLElement>('.sec.active');
  sw(current ? current.id.replace('sec-', '') : 'home');
}

function showLoginScreen(): void {
  elementById('login-screen').style.display = 'flex';
  document.querySelector<HTMLElement>('.app')!.style.display = 'none';
  document.querySelector<HTMLElement>('.bottom-nav')!.style.display = 'none';
  elementById('top-actions').hidden = true;
}

function hideLoginScreen(user: User): void {
  elementById('login-screen').style.display = 'none';
  document.querySelector<HTMLElement>('.app')!.style.display = 'block';
  document.querySelector<HTMLElement>('.bottom-nav')!.style.display = 'flex';
  elementById('top-actions').hidden = false;
  elementById('account-email').textContent = user.email || '';
}

function updateSyncStatus(): void {
  const pill = elementById('sync-pill');
  pill.hidden = !state.outbox.length;
  pill.textContent = `送信待ち ${state.outbox.length}件`;
}

function showSyncBanner(message: string, actions: BannerAction[]): void {
  elementById('sync-banner-msg').textContent = message;
  const box = elementById('sync-banner-actions');
  box.innerHTML = '';
  actions.forEach(action => {
    const button = document.createElement('button');
    button.className = 'btn sm' + (action.primary ? ' primary' : '');
    button.textContent = action.label;
    button.onclick = action.onclick;
    box.appendChild(button);
  });
  elementById('sync-banner').classList.add('show');
}

function hideSyncBanner(): void { elementById('sync-banner').classList.remove('show'); }

export const appUi: UiPort & AuthUi = {
  showBanner: showSyncBanner, hideBanner: hideSyncBanner, renderCurrentSection, updateSyncStatus,
  hasOpenModal: () => !!document.querySelector('.mbg.open'), downloadJson,
  showLogin: showLoginScreen, hideLogin: hideLoginScreen,
  renderFirst: () => { renderHome(); void renderCal(); },
  showStartupTasks: () => maybeShowStartupTasks(),
  reload: () => location.reload(),
};
