// アプリの入口。画面の関数だけを HTML の onclick に公開し、起動する（D20 の 10）。
import { ENV } from './env.ts';
import { defaultSt, fixDefaults } from './state.ts';
import { initSync, LEGACY_SYNC } from './sync.ts';
import { initAuth, LEGACY_AUTH } from './auth.ts';
import { createSupa } from './supa.ts';
import { appUi } from './navigation.ts';
import { startBootstrap } from './bootstrap.ts';
import { LEGACY_TASKS } from './screens/tasks.ts';
import { LEGACY_CARDS } from './cards.ts';
import { LEGACY_SETTINGS } from './screens/settings.ts';
import { LEGACY_CARD_SCREEN } from './screens/cards.ts';
import { LEGACY_ATM } from './screens/atm.ts';
import { LEGACY_SHIFTS } from './shifts.ts';
import { LEGACY_SHIFT_SCREEN } from './screens/shift.ts';
import { LEGACY_PLANS } from './plans.ts';
import { LEGACY_PLAN_SCREEN } from './screens/plans.ts';
import { LEGACY_LEDGER } from './ledger.ts';
import { LEGACY_MONTHLY_SCREEN } from './screens/monthly.ts';
import { LEGACY_LEDGER_SCREEN } from './screens/ledger.ts';
import { LEGACY_HOME } from './screens/home.ts';
import { LEGACY_CALENDAR } from './screens/calendar.ts';
import { mountLocalLogin } from './local-login.ts';

const supaClient = createSupa(ENV);
initSync({ supa: supaClient, storagePrefix: ENV.storagePrefix, defaultSt, fixDefaults, ui: appUi });
initAuth({ supa: supaClient, storagePrefix: ENV.storagePrefix, fixDefaults, ui: appUi });

// HTML の onclick がある間は、関数名を window に出す（D18 の手順5まで）。
Object.assign(window, LEGACY_SYNC, LEGACY_AUTH, LEGACY_TASKS, LEGACY_CARDS,
  LEGACY_SETTINGS, LEGACY_CARD_SCREEN, LEGACY_ATM, LEGACY_SHIFTS, LEGACY_SHIFT_SCREEN,
  LEGACY_PLANS, LEGACY_PLAN_SCREEN, LEGACY_LEDGER, LEGACY_MONTHLY_SCREEN, LEGACY_LEDGER_SCREEN,
  LEGACY_HOME, LEGACY_CALENDAR);

if (__MANEY_TARGET__ === 'local') mountLocalLogin(ENV);
startBootstrap();
