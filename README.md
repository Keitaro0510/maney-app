# iOS PWA + Supabase 連携の注意点

## 発生した問題と解決策

---

### 1. Service Workerが古いキャッシュを返す

**症状**
- index.htmlを更新してもスマホに反映されない
- Supabaseへのリクエストがキャッシュから返される

**原因**
- Service Workerがindex.htmlやAPIレスポンスをキャッシュしている
- iOSのPWA（ホーム画面追加）はキャッシュが特に強力に残る

**解決策**
1. `sw.js` の `CACHE_NAME` のバージョンを上げる（例: `v1` → `v2`）
2. Supabase・Google認証のリクエストはキャッシュしない

```javascript
// sw.js
self.addEventListener('fetch', e => {
  // Supabase・Google認証はキャッシュしない（毎回通信）
  if(e.request.url.includes('supabase.co') ||
     e.request.url.includes('accounts.google.com') ||
     e.request.url.includes('googleapis.com')){
    e.respondWith(fetch(e.request));
    return;
  }
  // 通常のキャッシュ処理...
});
```

**ルール: index.htmlを更新したら必ずsw.jsのバージョンも上げる**

---

### 2. iOSのPWAでSupabase保存が途中から効かなくなる

**症状**
- 最初の数回は保存できるが、その後保存されなくなる
- タスク切り→再起動後も保存できない
- Safariブラウザからは正常に動作する

**原因**
- `save()` の中で `saveRemote()` を `await` なしで呼んでいた
- iOSのPWAはバックグラウンドで非同期処理が完了する前に処理が打ち切られることがある

**NG（動かない）**
```javascript
function save(){
  saveLocal();
  saveRemote(); // awaitなし → iOSのPWAで途中で打ち切られる
}
```

**OK（動く）**
```javascript
// 保存ボタンの処理でsaveRemote().then()を使う
function saveSetting(){
  // ...データをstに反映...
  saveLocal();
  renderHome();
  saveRemote().then(()=>{
    alert('設定を保存しました！');
  });
}
```

**ポイント: 重要な保存処理は `saveRemote().then()` で完了を待つ**

---

### 3. iOSのPWAとSafariブラウザはlocalStorageが別管理

**症状**
- Safariブラウザでログインしても、ホーム画面のPWAではログインされていない
- セッションが共有されない

**原因**
- iOSではPWA（ホーム画面追加）のlocalStorageはSafariブラウザと完全に別
- Supabaseのセッション情報がPWA側に存在しない

**解決策**
Supabaseクライアントの初期化時に認証設定を明示する

```javascript
const supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'money-app-auth',
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
```

---

### 4. Googleログイン後のリダイレクト先がlocalhostになる

**症状**
- ログイン後に「サーバに接続できなかった」画面になる
- URLバーに `localhost` と表示される

**原因**
- Supabaseの `Site URL` が `localhost` のままになっている

**解決策**
Supabase → Authentication → URL Configuration で以下を設定する

- **Site URL**: `https://ユーザー名.github.io/アプリ名/`
- **Redirect URLs**: `https://ユーザー名.github.io/アプリ名/`

---

### 5. Googleログインで「Unsupported provider」エラー

**原因**
- SupabaseのGoogleプロバイダーが有効になっていない

**解決策**
Supabase → Authentication → Providers → Google → Enable をオンにする

---

### 6. upsertが400エラーになる

**原因**
- `onConflict` に指定したカラムにユニーク制約がない

**解決策**
```sql
alter table user_data add constraint user_data_user_id_unique unique (user_id);
```

---

## Supabaseテーブル設計（ユーザーごとのデータ分離）

```sql
create table user_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table user_data enable row level security;

create policy "自分のデータのみ" on user_data
  for all using (auth.uid() = user_id);

alter table user_data add constraint user_data_user_id_unique unique (user_id);
```

---

## デバッグTips

### スマホのConsoleを確認する方法

**vConsoleを一時的に追加する**
```html
<!-- </body>の直前に追加 -->
<script src="https://cdn.jsdelivr.net/npm/vconsole@latest/dist/vconsole.min.js"></script>
<script>new VConsole();</script>
```
→ スマホ画面右下に緑のボタンが出てConsoleが確認できる
→ デバッグ後は必ず削除する

**MacのSafariでiPhoneのConsoleを確認する**
1. iPhoneの設定 → Safari → 詳細 → Webインスペクタをオン
2. MacのSafari → 設定 → 詳細 → Webデベロッパ用の機能を有効にする
3. LightningケーブルでiPhoneとMacを接続
4. MacのSafari → 開発メニュー → iPhoneの名前 → アプリのURL

---

## チェックリスト（アプリ更新時）

- [ ] index.htmlを更新したらsw.jsのCACHE_NAMEのバージョンを上げる
- [ ] デバッグ用のvconsoleを削除したか確認
- [ ] GitHubにアップロード後、スマホのキャッシュを消してからホーム画面に再追加
