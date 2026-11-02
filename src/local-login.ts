// ローカルの Supabase 用のログインの入口（D19）。メールとパスワードでログインする（ローカルでは Google でログインできないので）。
// main.ts が、ローカルにつなぐビルド（MANEY_TARGET=local）のときだけ呼ぶ。本番のビルドでは、ビルドのときに取り除かれる。
// 取り除かれたことは、公開の手順（scripts/build-pages.sh）が data-maney-local-login の有無で確かめる。
// - ここではトップレベルで何も動かさない（動かすと、本番のビルドから取り除けなくなる）
// - ログインできたら読み込み直す。アプリ（js/app-core.js）は、同じ保存場所からログインの状態を読んで起動する
import type { Env } from './env.ts';

export function mountLocalLogin(env: Env): void {
  const box = document.querySelector('#login-screen .login-box');
  if (!box) return;
  const form = document.createElement('form');
  form.setAttribute('data-maney-local-login', '');
  form.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px dashed #ccc;display:grid;gap:8px;text-align:left';
  form.innerHTML = `
    <div style="font-size:12px;color:#993556">ローカルの Supabase（${env.supaUrl}）につないでいます。本番のデータではありません</div>
    <label style="font-size:12px">メール<input name="email" type="email" required autocomplete="username" style="width:100%"></label>
    <label style="font-size:12px">パスワード（6文字以上）<input name="password" type="password" required minlength="6" autocomplete="current-password" style="width:100%"></label>
    <div style="display:flex;gap:8px">
      <button type="submit" name="mode" value="signin">ログイン</button>
      <button type="submit" name="mode" value="signup">作ってログイン</button>
    </div>
    <div data-role="msg" style="font-size:12px;color:#c00"></div>`;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(form);
    const email = String(fd.get('email'));
    const password = String(fd.get('password'));
    const msg = form.querySelector<HTMLElement>('[data-role="msg"]');
    const client = supabase.createClient(env.supaUrl, env.supaKey, {
      auth: { persistSession: true, storageKey: env.authStorageKey, storage: window.localStorage },
    });
    const { error } = submitter?.value === 'signup'
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (error) { if (msg) msg.textContent = error.message; return; }
    location.reload();
  });
  box.append(form);
}
