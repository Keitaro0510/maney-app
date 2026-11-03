// アプリの入口。依存する機能を準備して起動する。
import { ENV } from './env.ts';
import { defaultSt, fixDefaults } from './state.ts';
import { initSync } from './sync.ts';
import { initAuth } from './auth.ts';
import { createSupa } from './supa.ts';
import { appUi } from './navigation.ts';
import { startBootstrap } from './bootstrap.ts';
import { mountLocalLogin } from './local-login.ts';

const supaClient = createSupa(ENV);
initSync({ supa: supaClient, storagePrefix: ENV.storagePrefix, defaultSt, fixDefaults, ui: appUi });
initAuth({ supa: supaClient, storagePrefix: ENV.storagePrefix, fixDefaults, ui: appUi });

if (__MANEY_TARGET__ === 'local') mountLocalLogin(ENV);
startBootstrap();
