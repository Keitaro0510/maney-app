// 版の名前。リポジトリでは「money-app-dev」のまま手で変えない。
// 公開するときに scripts/finalize-sw.mjs が、ビルドしたファイルの一覧と版を入れる（D4 の手順6）。
// アプリのファイルが変わったときだけ版が変わり、端末のキャッシュが新しくなる
const CACHE_NAME = 'money-app-dev';
// 置き換えていない（手元で開いた）ときは、キャッシュより通信を先に見る（直したファイルがすぐ出るように）
const DEV = CACHE_NAME.endsWith('-dev');
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];
// 手元の開発サーバーではこの静的ファイルだけを先読みする。公開時には指紋付きのビルド成果物を加える
const PRECACHE = DEV ? ASSETS.filter(url => !url.startsWith('./assets/')) : ASSETS;
// キャッシュから取り出すときは、サーバーの Vary を見ない（D17）。指紋付きモジュールの <script> は Origin 付きで読まれるが、
// 先読みしたときは Origin がない。サーバーが Vary: Origin を返すと、別のものと見なされてオフラインで読めなくなる。
// キャッシュには1つの URL に1つしか入れないので、見なくてよい
const MATCH = { ignoreVary: true };

self.addEventListener('install', e => {
  // 新しい版のファイルは、ブラウザが覚えている分（GitHub Pages は10分）を使わず、必ずサーバーから取り直す。
  // そうしないと、出した直後に開いたとき、古い index.html を新しいキャッシュに入れてしまうことがある
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Supabase・Google認証はキャッシュしない（毎回通信）
  if(e.request.url.includes('supabase.co') ||
     e.request.url.includes('accounts.google.com') ||
     e.request.url.includes('googleapis.com')){
    e.respondWith(fetch(e.request));
    return;
  }

  if(DEV){
    // ブラウザが覚えている分も、サーバーに確かめ直す（no-cache）。ページを開くときは、そのまま読む
    const req = e.request.mode === 'navigate' || e.request.method !== 'GET' ? e.request : new Request(e.request.url, { cache: 'no-cache' });
    e.respondWith(fetch(req).catch(() => caches.match(e.request, MATCH).then(cached => cached || Response.error())));
    return;
  }

  e.respondWith(
    caches.match(e.request, MATCH).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res && res.status === 200 && e.request.method === 'GET'){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        // 通信できないときは、ページを開くときだけ本番の画面を出す（画像やスクリプトの代わりにはしない）
        e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      );
    })
  );
});

// 通知（Web Push。Issue #189・D36）。サーバーが送った JSON（title・body・url・tag）を、そのまま通知にする。
// iOS は、push を受けたら必ず通知を出す約束（userVisibleOnly）。出さないと、そのうち購読が止められる
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'お金管理', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: './icon-192.png',
    data: { url: data.url || './', tab: data.tab || '' }
  }));
});

// 通知を押したら、開いているアプリがあればそれを前に出して、その画面を開くよう知らせる。なければ、?tab=〇〇 付きで開く
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const target = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) {
        if (d.tab) c.postMessage({ type: 'open-tab', tab: d.tab });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
