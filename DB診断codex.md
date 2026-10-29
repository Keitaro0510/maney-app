# DB診断

> **未完了（2026-10-29 時点）**: `user_data` の JSON の中身の集計が「未確認」のまま。Codex を承認なしの設定で起動したため、集計用の SQL が実行できなかった。やり直しの手順は [`DB診断_TODO.md`](DB診断_TODO.md) を参照。

## 調査日・調査方法

- 調査日: 2026-10-29（JST）
- 対象: Supabase プロジェクト `sgvyjolyfuqchugltvls`、リポジトリ直下の `index.html`、`sync/`。
- DB は読み取り専用で確認した。Supabase MCP のテーブルメタデータ、Security / Performance Advisor、適用済み migration 一覧を取得した。DDL/DML、設定変更、認証設定変更は実施していない。
- コードは `index.html` の保存・読込・認証処理および `sync/` の SQL / GAS ソースを読み取りで確認した。`DB診断claude.md` は開いておらず、参照もしていない。
- 個人データ保護のため、レコード本文、店名、金額、予定名、メールアドレス、キー等は取得・記載していない。
- `user_data.value` の実データを集計するための読み取り SQL は、MCP 側で承認が必要だが、この環境の承認ポリシーが `never` のため実行前に拒否された。このため、JSON 内の実件数・実型分布・実際の重複・実際の参照切れは**未確認**である。表の行数とコードから確定できる事項は区別して記載する。

## 結論

DBの土台は小さく、`user_data` のユーザー単位一意制約とRLS有効化は良い出発点である。一方、家計簿・カレンダーを継続利用する前に、次の3点を先に整備すべきである。

1. `ai_insights` は RLS が有効なのにポリシーが0件で、現行PWAの読み込みは成立しない。さらにPWAの検索条件に `user_id` がない。
2. `user_data` はアプリ状態全体をJSON 1行へ無条件 upsert するため、複数端末・タブ・回線遅延で更新が消える（Lost Update）。同期完了も画面上で保証されない。
3. JSON内のカード参照が配列番号、シフト参照が名称に依存しており、カード削除・並び替え・名称変更で履歴の参照整合性を壊し得る。DBはJSON内部を検証できない。

実データの詳細品質は未測定だが、テーブル行数は `user_data` が4行、`ai_insights` が0行だった。JSON内部について「問題なし」とは判断できないため、スキーマ移行前に安全な集計を再実行することが必要である。

## 現状の構成

### Supabase（public スキーマ）

| テーブル | 行数 | 定義・制約 | RLS / 利用者 |
|---|---:|---|---|
| `user_data` | 4 | `id uuid` PK（自動生成）、`user_id uuid`（nullable、unique、`auth.users(id)` FK）、`value jsonb`、`updated_at timestamptz`（既定値 `now()`） | RLS有効。PWAが読書きし、GASもサービスロールで読む。 |
| `ai_insights` | 0 | `id uuid` PK、`user_id uuid`（`auth.users(id)` FK）、`kind text`（既定値あり）、`period text`（nullable）、`message text`、`created_at timestamptz`（既定値 `now()`） | RLS有効。GASがINSERTし、PWAがSELECTする設計。 |

- `list_migrations` が返した適用済み migration は1件（`drop_card_tx`）だった。これはリモートの適用履歴として返った一覧であり、過去DDL全体の再現性を保証するものではない。
- リポジトリの `sync/sql/ai_features.sql` は `ai_insights_user_kind_idx (user_id, kind, created_at desc)` を定義しており、Performance Advisor も同名インデックスを認識している。
- `user_data.user_id` の unique 制約により、**非NULLの同一ユーザーID**を複数行にすることは防げる。一方、`user_id` はnullableなので、DB単体ではユーザーに紐づかない行を複数許容する。

### RLS ポリシーと Advisor

| 対象 | 確認結果 |
|---|---|
| `user_data` | RLS有効。Performance Advisor はポリシー名 `自分のデータのみ` を検出した。ただし承認拒否のため、対象コマンド（SELECT/INSERT/UPDATE/DELETE）と `USING` / `WITH CHECK` 式の完全列挙は未確認。 |
| `ai_insights` | RLS有効だが、Security Advisor はポリシー0件を検出した。通常のクライアントロールは全操作が拒否される状態である。 |
| Security Advisor | `ai_insights` の「RLS Enabled No Policy」1件（INFO）、Auth の漏えいパスワード保護が無効 1件（WARN）。 |
| Performance Advisor | `user_data` のRLSポリシーで `auth.<function>()` / `current_setting()` が行ごとに評価される警告1件（WARN）、`ai_insights_user_kind_idx` 未使用1件（INFO）。 |

### `user_data.value` の構造と品質評価

実値は未取得だが、`index.html:777` の初期状態と各保存関数から、JSONは次の単一ドキュメント構造である。

- スカラー: 口座残高・基準日・締め日・予算・扶養上限など。
- 配列: `jobs`、`shifts`、`ledger`、`cards`、`wds`、`actualInputs`、`plans`、`fixedIncs`、`fixedCosts`、収支カテゴリ配列。
- 代表的な要素: `ledger` は日付・金額・カテゴリ・種別・支払方法等（`index.html:1706`）、`shifts` は勤務先名・日付・時刻等（`:1569`）、予定は日時範囲・予算・完了状態等（`:2017-2041`）、カードは名称・締め日・引落日（`:1506-1515`）。
- 型は既にソース上で統一されていない。たとえば家計簿入力の `ledger.amount` はフォーム値をそのまま保存するため文字列になり得る（`:1706`）一方、固定費の `amount` は `parseInt` 後の数値（`:1893`）。集計側は多くで `parseInt` をしている。JSONB列にもJSON Schema・CHECK制約はない。
- `fixDefaults()`（`:975-984`）は一部の配列欠落と予定の時刻フィールドだけを補完する。主要配列や各要素の必須項目、日付書式、数値型、重複ID、参照先の存在は検証しない。

したがって、実測できなかった項目は以下のとおりである。

| 品質観点 | 結果 |
|---|---|
| `value` の有効JSON・トップレベル型 | 未確認 |
| 配列別件数、必須フィールド欠落、実際の型分布 | 未確認 |
| JSON内部の重複（予定ID、同一明細、同一シフト等） | 未確認 |
| JSON内部参照の整合性（カード・勤務先・カテゴリ） | 未確認 |
| テーブル行数 | `user_data` 4、`ai_insights` 0（確認済み） |

### 保存・同期フロー

1. PWAは起動時にローカルストレージ `mavFinal2` を先に読み、画面描画後にログイン済みなら `user_data` を1行SELECTする（`index.html:931-965`）。
2. リモートの `updated_at` がローカルの `_updatedAt` より新しい場合だけ、トップレベルを浅くマージしてローカルへ反映する（`:899-925`）。
3. 操作ごとの `save()` はローカルへ即時保存し、`saveRemote()` をawaitせず起動する（`:862-893`）。リモート保存は状態オブジェクト全体を `user_id` 一意キーで upsert する（`:869-888`）。
4. `sync/gas/shared.gs` はサービスロールで、設定された1ユーザーの `user_data.value` 全体をREST GETする。`advice.gs` は集計後に `ai_insights` へINSERTし、`notify.gs` は当日の予定等をLINEへ送る。

## 問題点（優先度別、根拠付き）

### P0: 利用継続前に解消

1. **`ai_insights` のRLSポリシーが0件で、現行PWAでは助言を取得できない**
   - 根拠: Security Advisor の `rls_enabled_no_policy` が `public.ai_insights` を1件検出。テーブルはRLS有効、ポリシーなし。
   - 根拠: PWAは匿名/ログインセッションで `.from('ai_insights').select(...)` を実行する（`index.html:992-998`）。ポリシーなしのRLSではSELECTが拒否され、エラーはcatchでログ出力のみとなり、画面は助言なしになる。
   - 影響: 現在0行であっても、GASが書き込んだ後にPWAで表示できない。機能障害であり、ポリシーを安易に緩めると金融・予定情報を含む助言の横断閲覧につながる。

2. **`user_data` の全量上書きにより、複数端末・タブで更新が失われる**
   - 根拠: `saveRemote()` は `value: st` として状態全体を `upsert(..., {onConflict: 'user_id'})` している（`index.html:869-884`）。行バージョン、`updated_at` を条件にしたUPDATE、差分更新、サーバー側競合検出がない。
   - 根拠: 読み込み時の時刻比較は起動時1回だけで（`:899-925`）、保存前にリモートの最新状態を再取得しない。
   - 影響: 端末Aと端末Bが同時に異なる予定・収支を追加すると、後に完了した全量保存がもう片方の変更を消せる。家計簿の履歴欠損に直結する。

3. **リモート保存がfire-and-forgetで、失敗・順序逆転・離脱を利用者に伝えない**
   - 根拠: `save()` は `saveRemote()` をawaitしない（`index.html:891-894`）。各操作は直後に画面を閉じたり描画を進める。`saveRemote()` は失敗を `console.warn` にのみ出す（`:869-888`）。
   - 影響: 通信断、認証切れ、PWAの中断時にローカルだけ更新されても利用者は気付けない。連続保存でリクエストの完了順が入力順と異なる場合も、古いスナップショットが後から残る可能性がある。

### P1: DB整理と同時に解消

1. **カード参照が配列番号で、カード削除後に履歴の参照先がずれる**
   - 根拠: 家計簿 `ledger.cardIdx`（`index.html:1706`）、予定 `planCardIdx`（`:2037-2039`）、実績 `actualInputs.cardIdx` / `cardKey`（`:1044-1046`）、固定費 `pay: 'card-{index}'`（`:1891-1895`）がカード配列番号を保存している。
   - 根拠: `delCard(i)` は固定費の参照だけを銀行払いに変更してから `st.cards.splice(i,1)` する（`:1516`）。家計簿・予定・実績の番号は更新しない。
   - 影響: 削除位置より後のカードに結び付いた過去・将来データが別カードとして集計され、請求額・残高予測を誤る。DBのFKで防げないJSON内部参照である。

2. **`ai_insights` のPWA検索にユーザー条件がなく、DBにも期間単位の一意制約がない**
   - 根拠: `loadAiInsight()` は `kind='monthly_advice'` のみで最新1件を取得しており、`.eq('user_id', currentUser.id)` がない（`index.html:995`）。正しいRLSに全面依存している。
   - 根拠: テーブル定義と `sync/sql/ai_features.sql` に `(user_id, kind, period)` のunique制約はない。GASの再実行・再試行で同一期間の複数行を作成できる。現在は0行のため、現時点の実重複は0件。
   - 影響: 将来RLSの不備があれば他ユーザーの助言を表示し得る。重複時は最新だけが表示され、どれが正なのかDB上で判別できない。

3. **JSONBを正規化も検証もしておらず、重要な型・参照・重複をDBで保証できない**
   - 根拠: `user_data.value` は単一の `jsonb` 列で、メタデータ上にJSON Schema/要素別制約はない。アプリの保存経路にも包括的バリデーションはない。
   - 根拠: 金額が文字列・数値で混在し得ることは保存コードから確認できる（`:1706`, `:1893`）。シフトは勤務先名、カードは配列番号で参照するため、FKを張れない。
   - 影響: 将来の機能追加・GAS・分析処理で互換性が崩れやすく、破損値の発見が遅れる。今回、実データ集計が権限制約で未実施であるため、移行前に必ず定量確認が必要である。

4. **`user_data.user_id` がnullableで、アプリのデータモデルとDB制約が一致しない**
   - 根拠: テーブルメタデータは `user_id` に `nullable` と `unique` を表示する。PWAは常にログイン済みの `currentUser.id` を保存する（`index.html:870-883`）。
   - 影響: アプリ経路外（管理作業・将来の連携）からユーザー非紐付け行を作れてしまう。unique制約もNULL行同士は重複防止しない。

### P2: セキュリティ・運用・性能の改善

1. **GASはサービスロールで状態全体を取得し、外部AIとLINEへ個人情報を送る設計である**
   - 根拠: `sync/gas/shared.gs` の `fetchUserData_()` はサービスロールで `user_data.value` 全体を取得する。`advice.gs` はカテゴリ別集計値を外部AI APIへ送り、`notify.gs` は予定・シフト・金銭イベントをLINE APIへ送る。
   - 影響: サービスロールキー、GASプロジェクト権限、外部サービスの保持・ログ方針が実質的なデータ境界になる。`sync/README.md` は月次アドバイス・LINE通知を未稼働と記載しているため、実際に有効化する前に送信項目・保持期間・鍵のローテーション方針を確定すべきである。

2. **公開Webhook補助のリクエスト署名検証がない（有効化時のみ）**
   - 根拠: `sync/gas/get_line_userid.gs` の `doPost` は受信ボディをそのままJSON解析し、LINE署名を検証していない。
   - 影響: 公開デプロイ中は第三者から任意リクエストを受け、メール送信を誘発され得る。このファイルは一時利用目的なので、必要なときだけ公開し、取得後は停止・削除する運用にする。

3. **Authの漏えいパスワード保護が無効**
   - 根拠: Security Advisor が WARN 1件として検出。
   - 影響: 現在Google OAuth中心でも、将来パスワードログインを追加・有効化した際の防御が弱い。

4. **RLSポリシーの評価が行ごとに再実行される**
   - 根拠: Performance Advisor の `auth_rls_initplan` WARN。`user_data` のポリシー `自分のデータのみ` が `auth.<function>()` または `current_setting()` を行ごとに評価する。
   - 影響: 現在4行では軽微だが、ユーザー・行数増加時に不要なオーバーヘッドになる。ポリシー式を `(select auth.uid())` 形式へ見直す候補。

5. **`ai_insights_user_kind_idx` は未使用**
   - 根拠: Performance Advisor の INFO 1件。テーブル行数も0。
   - 影響: 今は実害は小さい。P0/P1を直し、実際のクエリ計画を確認してから維持・変更・削除を判断する。未使用だけを理由に先に削除しない。

## 良い点

- 2テーブルともRLS自体は有効で、`user_data` にはユーザーIDのunique制約と `auth.users` FKがある。
- PWAは公開可能キーを使い、サービスロールキーをブラウザコードに置かない。強い権限はGASのスクリプトプロパティに分離する方針である。
- `ai_insights` を `user_data` とは別テーブルに分け、GASが状態JSONを書き換えない設計は、AI機能が本体状態を壊す競合を避ける方向として正しい。
- `sync/README.md` は未稼働機能・旧取り込み処理・トリガー残存の注意を記録しており、運用上の既知事項を追跡できる。
- `fixDefaults()` により一部の旧JSONへの後方互換を持たせ、`updated_at` とローカルの `_updatedAt` による最低限の新旧判定を実装している。

## 改善の進め方

1. **まずバックアップと定量診断をする。** 管理権限で読み取り専用の集計を実行し、`user_data.value` のトップレベル型、配列別件数、金額型、欠損、日付形式、予定ID重複、カード/勤務先/カテゴリ参照切れ、NULL `user_id` 件数を個人データを出さずに集計する。結果を移行前ベースラインにする。
2. **RLSをテスト付きで確定する。** `ai_insights` に本人のSELECTポリシーを追加し、PWAクエリにも `user_id=currentUser.id` を明示する。`user_data` は全コマンドのポリシー式を取得・レビューし、`user_id` をNOT NULLにする前にNULL行がないことを確認する。匿名・別ユーザー・サービスロールの3経路で許可/拒否テストを行う。
3. **同期の競合制御を先に直す。** 最低限、保存キューと完了表示・再試行を入れ、`updated_at` またはrevisionを条件にした比較更新にする。競合時は自動全量上書きでなく、再読込・マージまたは利用者への解決提示を行う。
4. **JSON内IDを安定IDへ置換する。** カード・勤務先・予定・明細にUUID等の不変IDを持たせ、参照は配列番号や表示名ではなくIDに統一する。削除は参照有無を確認し、アーカイブ/論理削除も検討する。
5. **段階的に正規化する。** 最初は `ledger`、`cards`、`plans`、`shifts` をユーザーID付きテーブルへ切り出し、型・CHECK・FK・一意制約をDBで担保する。設定など更新単位の大きい少量データだけをJSONに残すと移行コストと整合性のバランスがよい。
6. **GASを有効化する前に境界を固める。** 最小権限の実行者、鍵の保管・ローテーション、外部AI/LINEへ送るフィールドの最小化、Webhook署名検証、失敗通知の個人情報マスキングを決める。不要な旧GASトリガーが実行中でないことも管理画面で確認する。
7. **最後に性能・Auth設定を整える。** 実データ投入後にRLS式とインデックスの使用状況を再確認し、漏えいパスワード保護を有効化する。
