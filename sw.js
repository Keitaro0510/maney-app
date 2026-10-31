const CACHE_NAME = 'money-app-v45';
const ASSETS = [
  './',
  './index.html',
  './js/data.js',
  './js/compat.js',
  './js/clock.js',
  './js/ui.js',
  './js/tasks.js',
  './js/tasks-ui.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

self.addEventListener('install', e => {
  // 新しい版のファイルは、ブラウザが覚えている分（GitHub Pages は10分）を使わず、必ずサーバーから取り直す。
  // そうしないと、出した直後に開いたとき、古い index.html を新しいキャッシュに入れてしまうことがある
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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

  e.respondWith(
    caches.match(e.request).then(cached => {
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
