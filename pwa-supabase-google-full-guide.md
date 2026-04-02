# PWAアプリをゼロから作ってスマホで使えるようにする手順

## そもそも何をやっているのか？

### 普通のアプリとPWAの違い

**普通のアプリ（App Store経由）**
- Appleに審査してもらう必要がある
- 年間12,000円のApple Developer登録が必要
- 審査に1〜2週間かかる

**PWA（このやり方）**
- お金ゼロ・審査なし・即日公開できる
- HTMLファイルをインターネット上に置くだけ
- スマホの「ホーム画面に追加」でアプリっぽく使える

### 仕組みのイメージ

```
【あなたのPC】          【GitHub】             【スマホ】
HTMLファイルを  →  インターネット上に  →  URLを開いて
作る・編集する      無料で公開される       ホーム画面に追加
```

GitHub（無料）= ファイルを置いておく場所 + URLを発行してくれるサービス

---

## 必要なもの

- PCとインターネット環境
- GitHubアカウント（無料）
- スマホ（iPhone / Android）

---

## PART 1: GitHubにファイルをアップロードしてURLを取得する

### ファイルの構成（最低限必要なもの）

```
アプリのフォルダ/
├── index.html      ← アプリ本体（これだけあれば動く）
├── manifest.json   ← アプリの名前・アイコンの設定
├── sw.js           ← オフラインでも動かすための設定
├── icon-192.png    ← アプリのアイコン（小）
└── icon-512.png    ← アプリのアイコン（大）
```

**各ファイルの役割**

| ファイル | 役割 |
|----------|------|
| `index.html` | アプリ本体。ここにすべての機能が書いてある |
| `manifest.json` | 「このWebサイトはアプリとして使える」とスマホに伝える設定ファイル |
| `sw.js` | Service Worker。アプリをキャッシュしてオフラインでも動くようにする |
| `icon-192.png` / `icon-512.png` | ホーム画面に表示されるアプリアイコン |

---

### STEP 1: GitHubアカウントを作る

1. [github.com](https://github.com) を開く
2. 「Sign up」をクリック
3. メールアドレス・パスワード・ユーザー名を入力して登録

---

### STEP 2: リポジトリ（ファイル置き場）を作る

リポジトリ = GitHubの中の「フォルダ」のようなもの

1. GitHubにログインして右上の「＋」→「New repository」をクリック
2. 以下を入力：
   - **Repository name**: `money-app`（何でもOK）
   - **Public** を選択（無料で公開するため）
3. 「Create repository」をクリック

---

### STEP 3: ファイルをアップロードする

1. 作ったリポジトリのページを開く
2. 「Add file」→「Upload files」をクリック
3. 5つのファイル（index.html, manifest.json, sw.js, icon-192.png, icon-512.png）をドラッグ＆ドロップ
4. 下の「Commit changes」をクリック

---

### STEP 4: GitHub Pagesを有効にする（URLを発行する）

1. リポジトリのページ上部「Settings」タブをクリック
2. 左メニュー「Pages」をクリック
3. **Branch** を「None」から「main」に変更して「Save」をクリック
4. 1〜2分待つと以下のURLが発行される：
   ```
   https://ユーザー名.github.io/money-app/
   ```

このURLをスマホで開けばアプリが使える。

---

### STEP 5: スマホのホーム画面にアプリを追加する

**iPhoneの場合（Safari）**
1. SafariでアプリのURLを開く
2. 下の共有ボタン（□↑）をタップ
3. 「ホーム画面に追加」→「追加」

**Androidの場合（Chrome）**
1. ChromeでアプリのURLを開く
2. メニュー（⋮）→「アプリをインストール」または「ホーム画面に追加」

これでホーム画面にアイコンが追加され、普通のアプリのように使える。

---

### ファイルを更新したいとき

1. PCでファイルを修正する
2. GitHubのリポジトリで対象ファイルをクリック
3. 鉛筆アイコン（Edit）をクリックして内容を貼り替える、または「Add file」→「Upload files」で上書きアップロード
4. 「Commit changes」をクリック

> ⚠️ **重要**: `index.html` を更新したら `sw.js` の `CACHE_NAME` のバージョンも必ず上げること
> （例: `money-app-v1` → `money-app-v2`）
> これをやらないとスマホが古いキャッシュを使い続けて変更が反映されない

---

## PART 2: Supabaseでデータをクラウド保存できるようにする

### なぜSupabaseが必要なのか？

**Supabaseなし（localStorageのみ）**
- データはスマホの中だけに保存される
- 機種変更するとデータが消える
- 複数の端末でデータが共有できない

**Supabaseあり（クラウド保存）**
- データはインターネット上のデータベースに保存される
- 機種変更してもデータが引き継げる
- スマホでもPCでも同じデータが見られる

Supabase = 無料で使えるオンラインデータベースサービス

---

### STEP 1: Supabaseアカウントとプロジェクトを作る

1. [supabase.com](https://supabase.com) を開く
2. 「Start your project」→ GitHubアカウントでログイン
3. 「New project」をクリック
4. プロジェクト名・パスワード・リージョン（Japanを選ぶ）を入力して「Create new project」
5. 1〜2分待って作成完了

---

### STEP 2: APIキーを取得する

APIキー = アプリがSupabaseにアクセスするためのパスワードのようなもの

1. 左メニュー **Settings → API** を開く
2. 以下の2つをメモしておく：
   - **Project URL**（例: `https://xxxx.supabase.co`）
   - **anon public key**（`sb_publishable_` から始まる文字列）

> **anon public key（公開キー）** = フロントエンドに書いてOK。流出しても大きな問題にはならない
> **service_role key（秘密キー）** = 絶対にコードに書かない。これが漏れると全データが見られる

---

### STEP 3: データベースのテーブルを作る

テーブル = Excelの表のようなもの。ここにアプリのデータを保存する。

1. Supabaseの左メニュー **SQL Editor** を開く
2. 以下のコードを貼り付けて「Run」をクリック：

```sql
-- テーブル作成（ユーザーごとにデータを保存する箱）
create table user_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- RLS（行レベルセキュリティ）を有効化
-- 「自分のデータしか見られない」というルールを設定する
alter table user_data enable row level security;

-- ポリシー設定：ログインしているユーザーが自分のデータだけ操作できる
create policy "自分のデータのみ" on user_data
  for all using (auth.uid() = user_id);

-- user_idにユニーク制約（1ユーザー = 1レコードのルール）
alter table user_data add constraint user_data_user_id_unique unique (user_id);
```

---

### STEP 4: index.htmlにSupabaseの設定を追加する

`<head>` 内にSupabase SDKを追加：

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

JavaScriptの中でSupabaseクライアントを初期化：

```javascript
const SUPA_URL = 'https://xxxx.supabase.co'; // STEP2でメモしたProject URL
const SUPA_KEY = 'sb_publishable_xxxx';       // STEP2でメモしたanon public key

const supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: {
    persistSession: true,       // セッションを保持する
    storageKey: 'money-app-auth',
    storage: window.localStorage,
    autoRefreshToken: true,     // セッションを自動更新する
    detectSessionInUrl: true    // URLからセッション情報を取得する
  }
});
```

---

### STEP 5: 保存・読み込みの処理を書く

```javascript
// ローカルに保存（オフライン時のキャッシュ）
function saveLocal(){
  localStorage.setItem('mavFinal2', JSON.stringify(st));
}

// Supabaseに保存
async function saveRemote(){
  const { data: { session } } = await supa.auth.getSession();
  if(!session) return; // 未ログインなら何もしない
  currentUser = session.user;
  await supa.from('user_data').upsert({
    user_id: currentUser.id,
    value: st,
    updated_at: new Date().toISOString()
  }, {onConflict: 'user_id'});
  // upsert = 同じuser_idのレコードがあれば更新、なければ追加
}

// 保存ボタンの処理
// ポイント: saveRemote().then() で保存完了を待ってからalertを出す
// iOSのPWAでは saveRemote() を await なしで呼ぶと途中で打ち切られることがある
function saveSetting(){
  // ...stにデータを反映する処理...
  saveLocal();
  saveRemote().then(()=>{
    alert('設定を保存しました！');
  });
}

// Supabaseからデータを読み込む
async function loadRemote(){
  if(!currentUser) return;
  const {data, error} = await supa
    .from('user_data')
    .select('value')
    .eq('user_id', currentUser.id)
    .single();
  if(!error && data){
    st = {...st, ...data.value};
    // 画面を再描画...
  }
}
```

---

## PART 3: Googleログイン機能を追加する

### なぜGoogleログインが必要なのか？

Supabaseに保存するとき「誰のデータか」を区別するためにログインが必要。
Googleログインを使えばパスワード不要で、Googleアカウントだけでサインインできる。

---

### STEP 1: SupabaseのコールバックURLをメモする

1. Supabase → **Authentication → Providers → Google** を開く
2. ページ上部の **Callback URL** をコピーしておく
   ```
   https://xxxx.supabase.co/auth/v1/callback
   ```

このURLは「Googleがログイン後にSupabaseに認証結果を送る宛先」。

---

### STEP 2: Google Cloud ConsoleでOAuth設定をする

OAuth = 「このアプリはGoogleログインを使っていいですよ」という許可証を取る作業

1. [console.cloud.google.com](https://console.cloud.google.com) を開く
2. 上部「プロジェクトを選択」→「新しいプロジェクト」→ 名前を入力して「作成」
3. 左メニュー **Google Auth Platform** → **「開始」** をクリック
4. アプリ名・サポートメール（自分のGmail）を入力して進める
5. 左メニュー **クライアント** → **「クライアントを作成」**
6. アプリケーションの種類: **「ウェブアプリケーション」**
7. **「承認済みのリダイレクトURI」** に STEP1 のCallback URLを貼り付ける
8. 「作成」→ **Client ID** と **Client Secret** が表示される → メモしておく

**本番環境に公開する（重要）**
左メニュー **ブランディング** → **「アプリを公開」** をクリック
→ テストモードのままだとリクエスト数に制限がある

---

### STEP 3: SupabaseにGoogle認証を設定する

1. Supabase → **Authentication → Providers → Google** を開く
2. **「Enable Sign in with Google」** をオンにする
3. STEP2でメモした **Client ID** と **Client Secret** を貼り付ける
4. 「Save」をクリック

---

### STEP 4: SupabaseのリダイレクトURLを設定する

ログイン後にアプリに戻ってくるための設定。これをしないとログイン後に `localhost` になってエラーになる。

1. Supabase → **Authentication → URL Configuration** を開く
2. **Site URL** にGitHub PagesのURLを入力：
   ```
   https://ユーザー名.github.io/money-app/
   ```
3. **Redirect URLs** に同じURLを追加
4. 「Save」をクリック

---

### STEP 5: index.htmlにログイン機能を追加する

**HTMLにログイン画面を追加**

```html
<!-- ログイン画面（未ログイン時に表示） -->
<div id="login-screen">
  <button onclick="loginWithGoogle()">Googleでログイン</button>
</div>

<!-- ユーザーメニュー（ログイン後に表示） -->
<div id="user-menu" style="display:none">
  <span id="user-email"></span>
  <button onclick="logout()">ログアウト</button>
</div>
```

**JavaScriptにログイン処理を追加**

```javascript
let currentUser = null;

// Googleでログイン
async function loginWithGoogle(){
  await supa.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.href } // ログイン後に元のページに戻る
  });
}

// ログアウト
async function logout(){
  await supa.auth.signOut();
  localStorage.removeItem('mavFinal2');
  location.reload();
}

// アプリ起動時の処理
async function loadData(){
  // まずローカルから読んで即表示
  const s = localStorage.getItem('mavFinal2');
  if(s) st = {...st, ...JSON.parse(s)};

  // ログイン状態を確認
  const { data: { session } } = await supa.auth.getSession();

  if(session){
    // ログイン済み → アプリ画面を表示
    currentUser = session.user;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('user-menu').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser.email;
    await loadRemote(); // Supabaseから最新データを取得
  } else {
    // 未ログイン → ログイン画面を表示
    document.getElementById('login-screen').style.display = 'flex';
  }

  // ログイン状態の変化を監視
  // （Googleログイン後にリダイレクトで戻ってきたときに発火する）
  supa.auth.onAuthStateChange(async (event, session) => {
    if(event === 'SIGNED_IN' && session){
      currentUser = session.user;
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('user-menu').style.display = 'block';
      await loadRemote();
    } else if(event === 'SIGNED_OUT'){
      currentUser = null;
      document.getElementById('login-screen').style.display = 'flex';
    }
  });
}

// アプリ起動
loadData();
```

---

## PART 4: よくあるトラブルと対処法

| 症状 | 原因 | 対処法 |
|------|------|--------|
| スマホに変更が反映されない | Service Workerのキャッシュ | sw.jsのCACHE_NAMEのバージョンを上げる → ホーム画面のアイコンを削除 → 再追加 |
| ログイン後に「localhostに接続できない」 | SupabaseのSite URLが未設定 | Authentication → URL ConfigurationにGitHub PagesのURLを設定 |
| 「Unsupported provider」エラー | SupabaseのGoogle認証が無効 | Authentication → Providers → Google をオン |
| 最初の数回は保存できるが途中から効かない | iOSのPWAで非同期処理が打ち切られる | `saveRemote().then()` で保存完了を待つように修正 |
| 保存は200OKなのにデータが変わらない | Service Workerがキャッシュしたレスポンスを返している | sw.jsでsupabase.coをキャッシュ対象から除外する |

---

## まとめ：全体の流れ

```
1. index.html（アプリ本体）を作る
        ↓
2. GitHubにファイルをアップロード
        ↓
3. GitHub PagesでURLを発行
        ↓
4. スマホでURLを開いてホーム画面に追加
   → これだけでPWAアプリとして使える！
        ↓
5. Supabaseでデータベースを作る
        ↓
6. Google Cloud ConsoleでOAuth設定
        ↓
7. SupabaseにGoogle認証を設定
        ↓
8. index.htmlにログイン・保存処理を追加
        ↓
9. GitHubに再アップロード
   → クラウド保存・Googleログイン対応完了！
```
