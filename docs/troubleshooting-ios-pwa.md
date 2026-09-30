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

---

## 主な機能追加の記録

### 楽天カード明細の自動取り込み（2026-08-10〜）
GAS（Google Apps Script）が楽天カードの利用通知メールを解析し、Supabaseの`card_tx`テーブル経由でアプリに取り込む。設計・実装の詳細は別リポジトリ [Keitaro0510/maney-app-sync](https://github.com/Keitaro0510/maney-app-sync) を参照。

### 予定への時刻入力 + カレンダー日/週/月表示切り替え（2026-08-10、[PR #3](https://github.com/Keitaro0510/maney-app/pull/3)）
予定(`st.plans`)に`timeStart`/`timeEnd`（`'HH:MM'`または`''`）を追加し、カレンダーを日表示・週表示・月表示（デフォルト）で切り替えられるようにした。日/週表示はGoogleカレンダー風のタイムライングリッドではなく、時刻順のリスト表示（既存の`dayClick()`を`buildDay(ds,opts)`という収集関数に切り出し、日表示は1回・週表示は7回呼んで共有）。

**実装上の注意点（同じパターンを踏む場合の参考に）**:
- `savePlan()`はオブジェクトを**丸ごと再構築**して保存する実装だったため、新フィールド（`timeStart`/`timeEnd`）をオブジェクトリテラルに追加し忘れると、既存の予定を編集した瞬間にその値が消える。データを丸ごと作り直す保存関数に新フィールドを足すときは、生成箇所を全部洗い出してから着手すること
- `allDay`のような真偽値フラグは持たせず、既存の`dateEnd!==date`という期間判定の流儀に合わせて`!timeStart`で終日判定を導出する設計にした。フラグと実データが矛盾しうる状態（`allDay:true`なのに`timeStart`が入っている等）を構造的に排除できる
- `renderCal()`は祝日取得のため`async`。ビューを日/週/月の3種に増やす際、素早い切り替えや連打で古い描画が後から上書きしてしまうレース条件が起きるため、`calRenderSeq`という単調増加のシーケンス番号でガードした

### 家計簿の月送りナビゲーション・グラフ月/年切り替え、カテゴリ学習拡張、手動入力との重複統合（2026-08-10）
記録一覧・グラフが当月固定だったのを月送り可能にし、グラフに月/年表示切り替えを追加。また、楽天カード自動取り込みの運用改善として、カテゴリ学習を承認後の編集でも効くようにし、明細到着が遅く先に手動入力してしまった記録は承認時に自動統合するようにした（詳細は上記`maney-app-sync`リポジトリの設計書を参照）。
