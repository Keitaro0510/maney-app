# 設計書: 楽天カード明細自動取り込み + 残高グラフ二重計上バグ修正（Phase 0+1）

対象アプリ: [maney-app](https://github.com/Keitaro0510/maney-app)（バイト学生向け家計管理PWA）

## Context

高沖さんは自作のPWA家計管理アプリ `maney-app`（GitHub: `Keitaro0510/maney-app`）を持っており、既に4本の個人アプリ（筋トレアプリ・家計簿アプリ・家計簿LINEボット・旅行記録アプリ）を作った経験を踏まえ、これらの技術資産を活かして「もっと便利なもの」を作りたいという相談から始まった企画。

対話の中で、現状の家計簿は「カードかPayPayしか使わないのに、それすら記録するのが面倒」という課題が明確になった。調査の結果:
- **楽天カード**は「カード利用のお知らせ(本人ご利用分)」という確定版メールが、完全に構造化されたフォーマット（`■利用日` `■利用先` `■利用金額` 等）で毎回届いており、自動パースが確実に可能
- **PayPayカード**は個別利用明細メールが存在せず（月次請求額のみ）、自動化不可能と判明。ユーザーは「PayPayはほとんど使わないので手動入力のままでいい」と判断
- Nintendo決済通知メールも発見したが対象外とした

技術設計を検討する中で、当初想定していた「Supabase Auth経由でGoogleカレンダーの追加スコープを取る」方式は、`provider_token`が保持されずセッションリフレッシュで消える既知の不具合（supabase-js issue #806等）があり、技術的に無理があると判明。Gmail読み取りも含めて **Google Apps Script (GAS)** を中核に据える設計にした。GASは自分が所有・実行するスクリプトのため、Gmail等のOAuthスコープ審査やトークン失効の問題を回避できる、個人開発では唯一実質無料で運用できる経路。

対話の結果、**今回はカレンダーUI刷新・彼女の予定連携（Phase 2, 3）は含めず、楽天カード明細の自動取り込み（Phase 0+1）のみ**を実装範囲とすることが確定した（週末2回、約3.5日相当）。カレンダー刷新や彼女の予定連携は将来のフェーズとして設計だけ残す。

承認方式は「ワンタップ承認」（未確認インボックスに一旦置き、ユーザーが確認・カテゴリ修正してから家計簿に反映）を採用。理由は、半角カタカナの店名（`ﾛｰｿﾝ`等）由来のカテゴリ誤推定を人が直せるようにするためと、既存の`st.ledger`が配列インデックスで削除・編集を行う構造のため、外部データを直接合成すると事故る（案A「自動マージ」は設計段階で却下済み）。

さらに対話の終盤で、「給与振込やカード引き落としの実績値を入力するとホームの折れ線グラフがバグる」という既存の不具合が報告された。実際のコードを読んで原因を特定し、修正済み（下記「0. 既存バグ修正」参照）。今回の自動取り込み機能は最終的にカード引き落とし実績の入力頻度を上げるため、このバグを放置すると新機能の価値を損なうため合わせて対応した。

## 実装アプローチ

### 0. 既存バグ修正: 残高グラフの二重計上（対応済み）

> **ステータス**: [maney-app commit 6ec597f](https://github.com/Keitaro0510/maney-app/commit/6ec597f) で修正済み

**原因（`index.html`の実コードを確認して特定）**:
- `estimateAcct()`（`index.html:974`）は、`st.baseDate`（基準日）から「今日」までの間に発生した給料日・固定収入日・固定費日・カード引き落とし日をすべて積算し、"現在の実際の残高"を計算する。ループ条件は`if(pd>today)break;`＝**今日を含む**日までが対象
- `buildBalanceSeries()`（`index.html:979-1013`）は、その`estimateAcct()`の結果を起点(`let bal=estimateAcct();`)にして、「今日」から90日先までの未来の収支を`for(let i=0;i<=90;i++)`で積み上げグラフ化する。ここで各日について`if(d>baseDate){...}`という条件でその日のdeltaを計算していた
- **バグの核心**: ループの`i=0`は「今日」そのものであり、`baseDate`が過去または今日（通常の設定）である限り`today > baseDate`が成立してしまう。そのため、もし「今日」がちょうど給料日・カード引き落とし日と重なった場合、その金額が①`estimateAcct()`側（`pd<=today`の範囲に含まれる）と②`buildBalanceSeries()`の`i=0`側（`d>baseDate`を満たす）の**両方で加算され、グラフの起点が実際より二重に動いていた**
- 実績値の有無に関わらず理論上は常に起きるバグだが、実績値がない場合は見積もり関数（`totalShiftIncForJob`等）による概算のため誤差として紛れやすく、確定した実績金額を入力すると具体的な金額のズレとして明確に可視化される、という体験と一致していた

**修正内容**: `buildBalanceSeries()`（`index.html:990`）の条件を`if(d>baseDate){`から`if(d>baseDate && d>today){`に変更。「今日」（`i=0`、`d===today`）は常にdelta計算からスキップされ、`estimateAcct()`側の計算と重複しなくなった。`baseDate`が未来に設定されている特殊ケースでも、`d>baseDate`の条件はそのまま効くため既存の意図した挙動は壊していない（最小修正）。

**検証方法**: 給料日またはカード締め日/引き落とし日が「今日」になるようにテストデータ（`st.jobs`のシフト・`st.cards`の`billDay`、または`st.baseDate`）を設定し、①実績値未入力の状態と②実績値を入力した状態それぞれで`renderBalanceChart()`のグラフの「今日」の値が`estimateAcct()`の返り値（ホーム画面の「現在の口座残高」表示）と一致し、翌日以降に不自然なジャンプが出ないことを確認する。あわせて`fixedIncs`/`fixedCosts`が今日と重なるケースも同様に確認する（同じバグパターンが4箇所すべてに存在するため）。

### 全体データフロー

```
Gmail（楽天カード確定版メール）
  → GAS（15分ごとの時間主導トリガー）がパース
  → Supabase card_tx テーブルに INSERT（重複防止つき）
  → Gmailにラベル maney/rakuten-imported を付与
  → PWA が起動時に card_tx (status='pending') を読み込み
  → 「未確認の明細」インボックスUIに表示
  → ユーザーがワンタップ承認 or カテゴリ修正して承認
  → st.ledger に通常の家計簿エントリとして push → await saveRemote()
  → card_tx.status を 'imported' に PATCH
```

**設計の核心**: 承認後は「ただの手入力エントリと区別がない」ようにする。これにより `monthLedger` / `cycle()`（カード請求額計算）/ `renderCal` / `renderLedger` / `renderCharts` を一切変更せずに済む。

### 1. Supabase: 新テーブル `card_tx`

既存の `user_data`（1レコードjsonb、`st`全体をPWAのみが書く）はそのまま維持し、追記型データだけ新テーブルに分離する。理由: `saveRemote()`（`index.html:759`）は`st`全体を無条件upsertするため、GASが`user_data.value.ledger`に直接追記すると、PWA側の次回保存で確実にLost Updateが起きる（実装を確認して検証済み）。

DDLは [`sql/card_tx.sql`](../sql/card_tx.sql) を参照。

カテゴリ・カード紐付けは意図的にこのテーブルに持たせない。カテゴリはユーザーが育てる`st.merchantRules`（PWA側）に、カード紐付けは`st.rakutenCardIdx`（PWA側）に置く。GASは「メールを見つける・パースする・投げる」だけの役割に徹する。

### 2. GAS: 楽天カードメール取り込みジョブ

実装は [`gas/main.gs`](../gas/main.gs) を参照。

**検索**: `from:info@mail.rakuten-card.co.jp -label:maney/rakuten-imported newer_than:14d`

件名の「確定版/速報版」判定はGASの検索クエリではなくJS側で行う（日本語件名のGmail検索は括弧の全半角で意図せず外れることがあるため）:
```javascript
if (subject.indexOf('速報版') !== -1) continue;   // 店名なしの先行メールを除外
if (subject.indexOf('カード利用のお知らせ') === -1) continue;
if (body.indexOf('<カードご利用情報>') === -1) continue;
```

**パース方式**: 固定順の正規表現ではなく「空行区切りでブロック分割 → `■項目名: 値` を辞書化 → 利用日/利用先/利用金額が揃ったブロックだけ明細とみなす」方式にする。理由: 楽天がメールフォーマットの項目を増減・並べ替えても、必須3項目さえ残っていればパースが継続する。固定順正規表現だと項目が1つ増えただけで全件が静かに0件になるリスクがある。

**店名正規化**: `merchant.normalize('NFKC')` で半角カナ→全角カナ・全角英数→半角英数を一括変換した上で、`ﾐｽﾀ-ﾄﾞ-ﾅﾂ`のようなASCIIハイフンを長音符`ー`に補正する処理を加える（実際のメールで確認済みの表記ゆれ）。

**金額パース**: `12,150 円` → `parseInt(s.replace(/[,\s円]/g,''), 10)`

**重複防止（三層）**:
1. Gmailラベル `maney/rakuten-imported` で処理済みスレッドを検索から除外（主防御）
2. `dedupe_key = '<gmailMessageId>#<blockIndex>'` に`unique(user_id, dedupe_key)`制約を張り、SupabaseへのPOST時に `Prefer: resolution=ignore-duplicates` + `?on_conflict=user_id,dedupe_key` で冪等化
3. 処理順序を「①Supabaseに書き込み成功を確認 → ②Gmailにラベル付与」の順に固定する。逆順にすると「ラベルは付いたがDBには無い」という恒久的な取りこぼしが起きる

**失敗の可視化**: GASの実行が静かに失敗し続けても気づけないのが最大のリスクなので、`try/catch`で例外時に自分宛にメール通知を送る処理と、実行のたびに最終実行時刻をScript PropertiesまたはSupabaseに記録する処理を必ず入れる。PWA設定画面に「最終取り込み: N時間前」を表示し、24時間超で警告を出す。

**認証情報の扱い**: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `USER_ID` はGASのScript Propertiesにのみ保存し、コードやGitHubには一切書かない。service_role keyはRLSをバイパスするため、書き込み時は必ず`user_id`を明示的に指定する。

### 3. PWA: 未確認明細インボックスUI

家計簿タブ（`sec-ledger`）の上部に、`card_tx`の`status='pending'`件数を表示するカードを追加する。タップすると一覧が開き、各行に自動推定カテゴリのドロップダウンが付き、「すべて承認」または個別に「無視」を選べる。

**承認時の処理順序**（README記載のiOS PWA既知問題「awaitなしのsaveRemote()は途中で打ち切られる」への対策として厳守する）:
```
1. st.ledger.push({date: used_on, amount, name: merchant_norm, cat: 推定カテゴリ,
                    type:'expense', pay: st.cards[st.rakutenCardIdx].name,
                    cardIdx: st.rakutenCardIdx, memo:'', src:'rakuten', txId: card_tx.id})
2. await saveRemote()   ← 完了を待つ。既存のsave()（awaitなし版）は使わない
3. card_tx.status を 'imported' に PATCH、ledger_ref に txId を記録
```
この順序なら、途中で失敗しても`card_tx`は`pending`のまま残り、次回起動時にインボックスへ再表示される（自己修復）。二重承認防止は「`st.ledger`に同じ`txId`を持つエントリが既にあるものはインボックス一覧から除外する」フィルタで行う。

**カテゴリ自動推定**: 優先順位は「`st.merchantRules`（学習済み・完全一致） > 静的な正規表現ルール表 > 'その他'」。承認画面でユーザーがカテゴリを変更したら、その店名→カテゴリの対応を`st.merchantRules`に保存し、次回から自動適用する。

> **2026-08-11時点で判断を更新**: 当初は「LLMは使わない（API従量課金は実質0円という制約に反する）」としていたが、**無料のGoogle Gemini APIを見つけたため方針転換**。この3段階ルールに当たらない初見の店名だけをGeminiに分類させる形で組み込む。詳細は下記「拡張: AI機能」節を参照。

**楽天カードの紐付け**: 設定画面(`sec-set`)に「楽天カード自動取り込み」セクションを新設し、`st.cards`から対象カードを選ぶUIを追加、選択結果を`st.rakutenCardIdx`に保存する。承認時に`cardIdx: st.rakutenCardIdx`をセットすることで、既存の`cycle()`関数（`index.html:946`、締め日ベースのカード請求額集計）に自動的に乗る。この関数は`st.ledger`を`cardIdx`と日付範囲でフィルタして合計しているだけなので、新規コード不要で正しく動くことを確認済み。

## 稼働後に見つかった問題と対応

設計・実装完了後、実際にGASをデプロイして`backfill`を実行する過程で4件の障害を踏んだ。すべて解決済みで、現在は15分おきのトリガーが安定稼働している（`backfill`で過去分162件の取り込みに成功、以後`main`トリガーで新着を自動処理）。

### デプロイ時のトラブルシューティング（`gas/main.gs`側、上から順に発生・解決）

1. **401 "Forbidden use of secret API key in browser"**: Supabaseの新しいsecret API key（`sb_secret_...`）は、リクエストの`User-Agent`ヘッダーを見てブラウザからの利用を検知しブロックする仕様。GASの`UrlFetchApp`が送る既定User-Agentに`Mozilla`という文字列が含まれるため誤検知された。`UrlFetchApp`はUser-Agentを明示的に上書きできない既知の制限（Google未対応）があるため、この経路は使えない
2. **上記の対応: レガシーJWT形式のservice_role keyへの切り替え**: 既存プロジェクトでは明示的に無効化しない限りレガシーキー（Settings→API Keys→Legacy API Keys）が使え、ブラウザ判定の対象外。これに切り替えて解決
3. **404 PGRST125 "Invalid path specified in request URL"**: Script Propertiesの`SUPABASE_URL`に誤って`/rest/v1/`まで含めて設定してしまい、コード側の`${url}/rest/v1/card_tx`との結合で二重パスになっていた。`getConfig_()`内で末尾の`/rest/v1(/)`と余分なスラッシュを取り除く正規化処理を追加し、設定値がどちらの形式でも壊れないようにした
4. **401 "new row violates row-level security policy"**: RLSは`apikey`ヘッダーではなく`Authorization`ヘッダーの値で判定される。レガシーキーの`anon`（RLSに従う）と`service_role`（RLSバイパス）を取り違えていたのが原因。正しい`service_role`ラベルのキーに差し替えて解決
5. **"Service invoked too many times for one day: email"**: デバッグ中に大量の失敗（69→106→124件）が個別にメール送信され、GAS消費者アカウントの1日約100通のクォータを枯渇させた。`logFailure_()`/`flushFailureNotifications_()`を導入し、失敗は必ず`console.error`に出力しつつ実行1回につき1通（先頭5件の詳細+残り件数）に集約する設計に変更

### 運用インシデント: 承認連打による記録重複（`maney-app`側、[commit 3fadb49](https://github.com/Keitaro0510/maney-app/commit/3fadb49)）

「すべて承認」ボタンをSupabase保存待ちの間に連打すると、`cardTxInbox`がまだクリアされておらず同じ処理が多重実行され、同じ明細が`st.ledger`に複数回pushされる事故が実際に発生した。対応:
- `cardTxBusy`フラグで承認/無視/一括承認の処理中を排他制御し、処理中はインボックス一覧を「処理中です…」に差し替えてボタンごと触れなくする
- 承認済みエントリには必ず`txId`（元の`card_tx`行への参照）が付与される設計を活かし、同じ`txId`が複数出現したら2件目以降を重複として削除する復旧ツール（設定タブ「自動取り込みの重複を整理する」）を追加。手動入力エントリは`txId`を持たないため対象外で安全

### 追加改善: カテゴリ学習の拡張 + 手動入力との重複統合（`maney-app`側、[PR #1](https://github.com/Keitaro0510/maney-app/pull/1)）

実運用で2つの摩擦が見つかり対応した。

**カテゴリ学習が承認時にしか効かない問題**: `st.merchantRules`の学習は承認画面のドロップダウン選択時（`cardTxToLedgerEntry_`）にしか発生せず、承認後に家計簿一覧で記録を編集（`saveLdgEdit`）しても学習されなかった。さらに調査の過程で、`saveLdgEdit`が編集対象のエントリを丸ごと新しいオブジェクトで置き換えており、既存の`src`/`txId`フィールドが編集のたびに失われるバグを発見した（編集すると「自動取り込み由来」の印が消え、上記の重複整理ツールや自己修復フィルタの対象から外れてしまう）。`saveLdgEdit`を修正し、編集前エントリの`src`/`txId`を引き継ぎつつ、`src==='rakuten'`のエントリでカテゴリが変更されたら`st.merchantRules`を更新するようにした。

**手動入力と自動取り込みの二重計上**: 楽天カードの明細メールは即時には届かないため、ユーザーが「今後のお金のめど」を立てるために先に手動で支出を記録し、後から同じ支出の明細が自動取り込みされると二重に残ってしまう。明細到着が遅いこと自体は仕様として受け入れ、`findManualDuplicate_(r)`（日付・金額・支払いカードの3条件すべてが一致する`txId`なしのエントリを検索）を承認処理（`approveCardTx`/`approveAllCardTx`）に組み込み、見つかったら手動入力側を削除してから自動取り込みエントリに置き換えるようにした。マッチング条件を3条件の完全一致にしているのは、同日の別の同額支出を誤って統合しないための安全策。

**Git運用の変更**: この修正から、`main`への直接コミットではなく`feature/`ブランチを切ってPRを作成し、GitHub上でマージする運用に切り替えた。

## 検証方法

0. **残高グラフ二重計上バグの検証**: 給料日/カード引き落とし日が「今日」と重なるテストデータを用意し、修正前後で`renderBalanceChart()`のグラフ起点（今日の値）が`estimateAcct()`の値と一致し、実績値の入力有無に関わらず不自然なジャンプが出ないことを確認する（対応済み）
1. **GASパーサの単体検証**: 実際に届いた楽天カード確定版メール（複数件入りのもの含む）をGASのテスト実行にかけ、パース結果が「利用日・利用先・利用金額・支払月」を正しく抽出できているか手動突合する。特に半角カナの店名（`ﾛｰｿﾝ`→`ローソン`、`ﾐｽﾀ-ﾄﾞ-ﾅﾂ`→`ミスタードーナツ`）が正しく正規化されるか確認
2. **重複防止の検証**: 同じメールに対してGASのジョブを2回連続実行し、`card_tx`にレコードが重複しないことをSupabase側で確認
3. **承認フローの検証**: PWA上でインボックスから明細を承認し、`st.ledger`に正しいフィールド（`cardIdx`含む）で追加されることを確認。承認後、設定画面のカード詳細で請求額（`cycle()`の出力）に反映されているか確認
4. **Lost Update非発生の確認**: 承認処理中にPWAが`user_data`を書き込んでも、GAS側が`card_tx`しか触らないため競合しないことを設計上保証している（実装後、承認操作とシフト追加等の他の保存操作を連続して行い、データが消えないことを確認）
5. **失敗通知の検証**: GASのパース処理内で意図的に例外を発生させ、自分宛メール通知が届くことを確認

## Critical Files

- `https://github.com/Keitaro0510/maney-app/blob/main/index.html` — 実装の中心
  - `index.html:974` `estimateAcct()`（基準日〜今日の実績・見積もり積算。二重計上バグの片側）
  - `index.html:979-1013` `buildBalanceSeries()`（今日〜90日先の予測。二重計上バグ修正済み）
  - `index.html:673` `st`のグローバル状態定義（`ledger`配列に新規エントリをpush）
  - `index.html:759` `saveRemote()`（st全体をupsert。Lost Updateの原因になるため、GASはここを一切触らない設計にする）
  - `index.html:789` `loadRemote()`（起動時1回のみ、新旧比較で上書き判定）
  - `index.html:1353` `saveLedger()`（既存の家計簿保存関数。エントリのフィールド構造の参考実装）
  - `index.html:946` `cycle()`（カード請求額計算。`cardIdx`と日付範囲でのフィルタ処理。新規コード不要でそのまま乗ることを確認済み）
  - `index.html:1189` カード編集保存（`st.cards`の構造参考）
- `https://github.com/Keitaro0510/maney-app/blob/main/sw.js` — `index.html`を変更したら`CACHE_NAME`を必ずバンプする（現在`money-app-v27`）。Supabaseへのリクエストは既存の fetch ハンドラで自動的にキャッシュ回避されるため追加対応不要
- `https://github.com/Keitaro0510/maney-app/blob/main/index.html` の`findManualDuplicate_()`（承認処理付近）、`saveLdgEdit()` — 今回追加した重複統合・学習ロジック
- `https://github.com/Keitaro0510/maney-app/blob/main/README.md` — iOS PWA既知問題集。「重要な保存は`saveRemote().then()`または`await`で完了を待つ」の教訓を承認処理に必ず適用する
- `gas/main.gs`（本リポジトリ） — GASコード
- `sql/card_tx.sql`（本リポジトリ） — Supabaseマイグレーション

## 拡張: AI機能（カテゴリ自動判定・月次アドバイス） + 毎朝のLINEダイジェスト通知（2026-08-11、実装済み）

「maneyfowardのイメージで、記録せずに使ったものを認識してほしい」「アプリにAIを組み込みたい」という要望を受けて追加検討したもの。

> **ステータス**: 実装完了。[maney-app-sync PR #1](https://github.com/Keitaro0510/maney-app-sync/pull/1)（GAS/SQL側）と[maney-app PR #5](https://github.com/Keitaro0510/maney-app/pull/5)（PWA側）がいずれもmainにマージ済み。ただし`GEMINI_API_KEY`/`LINE_CHANNEL_ACCESS_TOKEN`等のスクリプトプロパティ設定と、`installMonthlyAdviceTrigger()`/`installDigestTrigger()`の初回手動実行はまだ行っていない（README.mdのセットアップ手順6・7を参照）。

### 前提となる2つの制約

1. **課金は避ける**。Claude Codeのサブスク・ChatGPT Plus/Codexのサブスクは、いずれも自作アプリから叩くAPI利用分を含まない（別契約の従量課金）。調査の結果、**Google Gemini API（`gemini-2.5-flash`）の無料枠は1日500リクエストまで無料でクレジットカード登録も不要**([出典](https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits))。本アプリの想定利用量（月に数十件の初見店名判定＋月1回のアドバイス生成、毎日1通のLINE通知）はこの枠に収まるため、**Geminiの無料枠を採用し実質0円で運用する**。
2. **APIキーをPWA（ブラウザ）に露出させない**。`index.html`はGitHub Pagesで公開されるため、キーを書けば即座に盗用される。既存の楽天カード取り込みと同じ設計思想を踏襲し、**AI呼び出し・LINE送信は全てGAS側で行い、PWAからは一切外部AIを呼ばない**。PWAは「GASが計算・生成した結果」をSupabase経由で読むだけ。

### 機能A: カテゴリ自動判定（Gemini）

楽天カード明細に初見の店名が来たとき、`st.merchantRules`（学習済み）にも静的正規表現ルール（`MERCHANT_RULES`）にもマッチしない場合だけGeminiに分類させる。一度分類された店は`merchantRules`に学習される（既存の学習ロジック、上記「追加改善」節を参照）ので、**AIはその店について一生に一度しか呼ばれない**——2回目以降は完全に既存の学習ロジックだけで処理される。

**Supabase**: `card_tx`に`ai_suggested_cat text`カラムを追加（nullable）。

**GAS新規ファイル `gas/categorize.gs`**: `main()`の`importRakutenMails_`成功後に呼ぶ`categorizeNewCardTx_(cfg)`。処理の流れ:
1. `status='pending' AND ai_suggested_cat IS NULL`の行を取得
2. `st.merchantRules`（`fetchUserData_()`で取得）に既に載っている店名は除外（AIを呼ぶ必要がない）
3. 残った初見の店名を**まとめて1回のリクエスト**でGeminiに投げる（店名ごとに個別リクエストしない＝無料枠のRPM/RPDを節約）。プロンプトで`st.catExp`（ユーザーのカテゴリ一覧）を渡し、`generationConfig.responseMimeType:'application/json'`でJSON配列を強制
4. 返ってきたカテゴリが`catExp`に実在するか検証してから採用（ハレーション対策。存在しないカテゴリを返された場合は無視）
5. `card_tx.ai_suggested_cat`をPATCH

**PWA側（`index.html`）**: 既存の`guessCategory()`（L1017）は変更しない。未確認明細リスト描画箇所（`renderCardTxInboxList()`、L1069）だけで使う新関数`resolveCardTxCategory_(r)`を追加し、優先順位を「① `st.merchantRules`（学習済み） → ② 静的正規表現ルール → ③ `r.ai_suggested_cat`（Gemini示唆、`catExp`に存在する場合のみ） → ④ デフォルトカテゴリ」の4段階にする。①②に当たる限りAIの結果は一切参照されない。

**未設定時のフェイルセーフ**: `GEMINI_API_KEY`が未設定なら`categorizeNewCardTx_`は即座に何もせず戻る（例外を投げない）。既存のカード取り込み処理（`main()`）を巻き添えで壊さない設計は、下記LINE通知の`getLineConfig_()`にも共通する方針。

### 機能B: 月次支出アドバイス（Gemini）

「今月は外食が先月比+40%です」のような気づきを月1回GASで生成し、ホーム画面に表示する。**数値計算（カテゴリ別合計・前月比）はGAS側で決定論的に行い、Geminiにはその数値を渡して自然文の助言だけを書かせる**（数値をAIに計算させない＝ハレーション防止、渡した数値以外を創作しないようプロンプトで明示的に指示する）。

「給料日まで残高が持つか」等の複雑な予測ロジック（`cycle()`/`upcomingFixed()`/`daysToP()`）はPWA側との二重実装リスクが高いため対象外とする——今回の自動取り込み機能の設計原則（本ドキュメント冒頭「設計の核心」参照）と同じ考え方で、GASはPWAの複雑な派生計算を移植しない。

**Supabase**: 新規テーブル`ai_insights`（`user_id`, `kind`, `period`, `message`, `created_at`）。既存の`card_tx`と同じ「GASがINSERTし、PWAはSELECTのみ」という書き手分離の原則を踏襲する（本ドキュメント「1. Supabase: 新テーブル `card_tx`」の設計理由と同じ——`user_data`への直接追記はLost Updateを起こすため、書き手を分離した独立テーブルにする）。

**GAS新規ファイル `gas/advice.gs`**: `monthlyAdvice()`を毎月1日朝8時にトリガー実行（`installMonthlyAdviceTrigger()`、既存`installTrigger()`と同じ多重登録防止パターン）。
1. `computeMonthlyStats_(st)`: 今月・先月の支出をカテゴリ別に集計し、増加額が¥3,000以上のカテゴリだけ上位3件抜き出す（ノイズ除去）。変化がなく予算設定もなければ生成しない
2. `writeAdviceWithGemini_(apiKey, stats)`: 計算済みの数値をプロンプトに埋め込み、2〜3文の助言を生成させる
3. `ai_insights`にINSERT

**PWA側**: `loadCardTxInbox()`と同じパターンで`loadAiInsight()`を追加し、ホーム画面（`#alerts-home`の直前）に💡カードとして表示。

### 機能C: 毎朝7時のLINEダイジェスト通知

その日の予定・シフト・お金のイベント・未承認の楽天カード明細件数をLINEへ毎朝push通知する。**LINE Notifyは2025年3月末で終了済み**のため、後継の**LINE Messaging API**を使う。無料プラン（コミュニケーションプラン）は月200通まで無料で、本機能の使用量は1日1通＝月31通のため十分収まる。

**事前準備（ユーザー側の手作業）**:
1. [LINE Developers](https://developers.line.biz/)でプロバイダー→Messaging APIチャネルを作成
2. Messaging APIタブでチャネルアクセストークン（長期）を発行
3. 同画面の「あなたのユーザーID」を控える
4. 発行されたLINE公式アカウントを自分のLINEで友だち追加（未追加だとpushが届かない）
5. GASのスクリプトプロパティに`LINE_CHANNEL_ACCESS_TOKEN`と`LINE_USER_ID`を追加

**GAS新規ファイル `gas/notify.gs`**: `dailyDigest()`を毎朝7時頃にトリガー実行（`installDigestTrigger()`。GASの時間主導トリガーは厳密な時刻指定ができず、実際の発火は7:00〜7:15頃にばらつく点は許容する）。LINE用の設定は`getConfig_()`に混ぜず専用の`getLineConfig_()`で読む（未設定時にカード取り込みまで巻き添えで落ちるのを防ぐため）。

本文はPWA側の`buildDay()`（`index.html`、日/週カレンダー表示のイベント収集ロジック）と似た内容を出したいが、あちらはHTML生成でDOM前提のため共有できない。**派生計算（`cycle()`によるカード請求額・`calcShiftInc()`による日給・残高）はGASに移植しない**（PWA側を直したときに通知だけ古い数字を出す事故を避けるため、機能Bと同じ方針）。移植するのは`st`にリテラルで入っている値の整形だけ:
- `getPlansForDay()`/`planTimeOnDay()`/`hm2min`（`index.html:1371-1385`）
- `jobPayDay()`/`jobCloseDayNum()`（`index.html:1240-1241`）
- 祝日は`CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com')`で取得（GASなのでAPIキー不要）

出力例:
```
【8/12(水)】

■ 予定
 10:00〜12:00 バイト面談
 終日 彼女と映画

■ シフト
 17:00〜22:00 カフェ (休憩60分)

■ お金
 ・楽天カード 引き落とし日
 ・家賃 -¥55,000

※ 未承認の楽天カード明細が3件あります
```
各セクションは中身が空なら見出しごと省略。全部空でも「今日は特に予定なしです」の1行は必ず送る（毎日1通、動いているかの目印として）。未承認明細は0件のときだけ末尾の行を出さない。

### 共通のGAS新規ファイル `gas/shared.gs`

機能A・B・Cすべてで使う`fetchUserData_(cfg)`（Supabaseの`user_data.value`を1回GETするヘルパー、既存`postToSupabase_`と同じ認証ヘッダー方式）と`getGeminiKey_()`をここにまとめる。

### 検証方法（このセクション全体）

1. `categorizeNewCardTx_`単体実行: 未分類のpending明細で`ai_suggested_cat`が正しく埋まり、`catExp`に無いカテゴリが混入しないこと
2. 学習済み店名だけの状態ではGeminiへのリクエストが飛ばないこと
3. PWA側で学習済みルール・静的ルール・AI示唆の3パターンそれぞれ正しいカテゴリが初期選択されること
4. `GEMINI_API_KEY`/`LINE_CHANNEL_ACCESS_TOKEN`未設定時、それぞれの機能が例外を投げずにスキップされ、既存のカード取り込み（`main()`）が従来通り成功すること（巻き添え故障がないこと）
5. `monthlyAdvice`: 変化が小さい月ではインサイトが生成されず、変化がある月では渡した数値がそのまま本文に反映される（AIが数値を捏造していない）こと
6. `dailyDigest`を手動実行しLINEに届くこと。予定なしの日は「今日は特に予定なしです」になること。時刻付き予定・終日予定・シフトが正しい順（終日が先、時刻順）で並ぶこと
7. 構文チェック（Node.jsの`new Function`によるscriptタグ検証）、関数名/id重複チェックを通す。`node tests/parse.test.js`が従来どおり通ること

### Critical Files（このセクション全体、実装時の参照用）

- `sql/ai_features.sql`（新規）— `card_tx.ai_suggested_cat`カラム追加、`ai_insights`テーブル新設
- `gas/shared.gs`（新規）— `fetchUserData_()`, `getGeminiKey_()`
- `gas/categorize.gs`（新規）— カテゴリ自動判定一式
- `gas/advice.gs`（新規）— 月次アドバイス一式、`installMonthlyAdviceTrigger()`
- `gas/notify.gs`（新規）— LINEダイジェスト一式、`getLineConfig_()`, `installDigestTrigger()`
- `gas/main.gs` — `main()`内で`categorizeNewCardTx_(cfg)`を呼ぶ1箇所だけ変更。他は無変更
- `maney-app/index.html` — `#ai-insight-card`のHTML追加（`#alerts-home`直前）、`resolveCardTxCategory_()`（L1069の`renderCardTxInboxList()`内で使用）、`loadAiInsight()`/`renderAiInsightCard()`、`loadData()`内に`loadAiInsight()`呼び出し追加。参照のみ（コピー元）: `getPlansForDay()`/`planTimeOnDay()`/`hm2min`（L1371-1385）、`jobPayDay()`/`jobCloseDayNum()`（L1240-1241）
- `maney-app/sw.js` — `CACHE_NAME`を`v29`→`v30`にバンプ（必須）
- Git運用: `Keitaro0510/maney-app-sync`と`Keitaro0510/maney-app`それぞれに`feature/ai-categorize-and-advice`ブランチを作成しPR経由でマージ（前回までの運用を継続）

## 今回のスコープ外（将来検討）

- カレンダーUIのドット化・ボトムシート化（Phase 2）
- 彼女のGoogleカレンダー予定の統合表示（Phase 3、彼女への確認が未了のため）
- 上記2点はいずれ着手する場合、GAS基盤（今回作るもの）とPWA表示先の両方を流用できる設計にしてある
