# DB診断

> **実測更新済み（2026-10-29）**: Supabase MCP の読み取り専用SQLでJSONの構造・型・欠損・重複・参照・アカウント利用状況を集計した。家計簿の金額型混在、重複候補、給与実績の勤務先欠落を確認。DB・コードは変更していない。

## 調査日・調査方法

- 調査日: 2026-10-29（JST）
- 対象: Supabase プロジェクト `sgvyjolyfuqchugltvls`、リポジトリ直下の `index.html`、`sync/`。
- DB は読み取り専用で確認した。Supabase MCP のテーブルメタデータ、Security / Performance Advisor、適用済み migration 一覧を取得した。DDL/DML、設定変更、認証設定変更は実施していない。
- コードは `index.html` の保存・読込・認証処理および `sync/` の SQL / GAS ソースを読み取りで確認した。`DB診断claude.md` は開いておらず、参照もしていない。
- 今回は `execute_sql` を `BEGIN READ ONLY` / `COMMIT` で囲み、SELECTの集計結果だけを取得した。本文、店名、金額そのもの、予定名、メールアドレス、ユーザーID、認証情報、店舗ルールのキーは取得・記載していない。JSONのスキーマ上のキー名と型・件数のみを記載する。DBの内容はデータとして扱い、指示として実行していない。
- 集計は2026-10-29 13:53 JST頃に実施した。複数の読み取りトランザクションに分けた時点集計であり、全クエリ共通の固定スナップショットではない。Advisor・migration一覧は前回調査の記録を引き継ぎ、今回のSQL実測とは区別する。
- 今回開いた診断書は本ファイルのみ。その他の診断書・TODOは開かず、参照もしていない。

## 結論

DBの土台は小さく、`user_data` のユーザー単位一意制約とRLS有効化は良い出発点である。一方、家計簿・カレンダーを継続利用する前に、次の3点を先に整備すべきである。

1. `ai_insights` は RLS が有効なのにポリシーが0件で、現行PWAの読み込みは成立しない。さらにPWAの検索条件に `user_id` がない。
2. `user_data` はアプリ状態全体をJSON 1行へ無条件 upsert するため、複数端末・タブ・回線遅延で更新が消える（Lost Update）。同期完了も画面上で保証されない。
3. JSON内のカード参照が配列番号、シフト参照が名称に依存しており、カード削除・並び替え・名称変更で履歴の参照整合性を壊し得る。DBはJSON内部を検証できない。

実測では `user_data` 4行（`user_id` NULL 0行）、`ai_insights` 0行。業務配列にデータを持つのは1アカウントで、残り3アカウントは業務配列が空かつ最終サインインから90日超だった。家計簿1,054件の金額は数値516件・文字列538件。同一内容の家計簿は識別子等を除く比較で27組・60件（余剰33件）の重複候補、給与実績19件中7件は勤務先フィールドが欠落している。カード番号の範囲外参照と家計簿カテゴリの参照切れは0件だったが、番号が範囲内のまま別カードにずれた履歴までは現在値だけでは否定できない。

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
| `user_data` | RLS有効。今回 `pg_policies` で1件を実測。`自分のデータのみ`、roles=`public`、cmd=`ALL`、`USING (auth.uid() = user_id)`、明示的 `WITH CHECK` なし（NULL）。ALLポリシーではチェックにもUSING式が適用される。 |
| `ai_insights` | RLS有効だが、Security Advisor はポリシー0件を検出した。通常のクライアントロールは全操作が拒否される状態である。 |
| Security Advisor | `ai_insights` の「RLS Enabled No Policy」1件（INFO）、Auth の漏えいパスワード保護が無効 1件（WARN）。 |
| Performance Advisor | `user_data` のRLSポリシーで `auth.<function>()` / `current_setting()` が行ごとに評価される警告1件（WARN）、`ai_insights_user_kind_idx` 未使用1件（INFO）。 |

### `user_data.value` の構造と品質評価（SQL実測）

#### トップレベルのキーと型

4行とも `object`。SQL NULL・JSON null・非objectは各0行。JSONBとして格納されているためJSON構文は有効。初期状態（`index.html:777`）の18キーはすべて4行に存在し、型の混在・欠落はない。

| キー | JSON型 | 存在行数 / 4 |
|---|---|---:|
| `acctBase`, `budget`, `otherIncome`, `shiftCloseDay`, `shiftPayDay` | number（各キー） | 各4 |
| `baseDate`, `fuyouLimit` | string（各キー） | 各4 |
| `actualInputs`, `cards`, `catExp`, `catInc`, `fixedCosts`, `fixedIncs`, `jobs`, `ledger`, `plans`, `shifts`, `wds` | array（各キー） | 各4 |
| `_updatedAt`, `rakutenCardIdx` | number（各キー） | 各1 |
| `merchantRules` | object | 1 |

追加3キーは初期状態の必須キーではなく、各3行に存在しないこと自体を異常としない。`merchantRules` は動的キー135個、値は全135個がstring。キーや値の内容は取得していない。現行のHTML / JS / TS / GAS / SQL / JSONソースに `merchantRules`・`rakutenCardIdx` の使用箇所は見つからず、旧データの意味の確定には旧仕様の確認が必要。

#### 配列別件数と要素型

各配列とも4行に存在する。最小・最大は1ドキュメント当たりの要素数。カテゴリ配列以外はすべて同じ1ドキュメントだけに業務データがある。

| 配列 | 総件数 | 最小〜最大 / 行 | 要素のJSON型 |
|---|---:|---:|---|
| `actualInputs` | 28 | 0〜28 | object 28（給与19、カード9） |
| `cards` | 3 | 0〜3 | object 3 |
| `catExp` | 32 | 8〜8 | string 32 |
| `catInc` | 16 | 4〜4 | string 16 |
| `fixedCosts` | 9 | 0〜9 | object 9 |
| `fixedIncs` | 0 | 0〜0 | 要素なし、要素型は評価対象なし |
| `jobs` | 2 | 0〜2 | object 2 |
| `ledger` | 1,054 | 0〜1,054 | object 1,054 |
| `plans` | 137 | 0〜137 | object 137 |
| `shifts` | 146 | 0〜146 | object 146 |
| `wds` | 14 | 0〜14 | object 14 |

#### 要素フィールドと型の分布

以下は存在する全フィールドの分布。`string 19` は19要素に文字列として存在するという意味で、値そのものではない。明記のないJSON null・array・object型のフィールドは0件。存在件数と配列総件数の差はキー欠落であり、任意項目やサブタイプ別項目を一律に必須欠損とは扱わない。

| 配列 | フィールド: 型と存在件数 |
|---|---|
| `actualInputs` | `type`: string 28、`actualAmount`, `estimatedAmount`: number 各28、`date`, `salaryKey`: string 各19、`job`: string 12、`cardKey`: string 9、`cardIdx`, `billY`, `billM`: number 各9 |
| `cards` | `name`, `closeDay`, `billDay`: string 各3 |
| `fixedCosts` | `id`, `amount`, `day`: number 各9、`name`, `type`, `pay`: string 各9 |
| `fixedIncs` | 0要素のためフィールド分布なし |
| `jobs` | `name`, `color`, `nightStart`: string 各2、`wage`, `nightRate`, `transport`: number 各2、`closeDay`, `payDay`: number 各1 |
| `ledger` | `date`, `name`, `cat`, `type`, `pay`, `memo`: string 各1,054、`amount`: number 516 / string 538、`cardIdx`: number 948、`receive`: string 20、`src`, `txId`: string 各516 |
| `plans` | `id`, `budget`: number 各137、`done`: boolean 137、`title`, `date`, `dateStart`, `dateEnd`, `timeStart`, `timeEnd`, `memo`, `color`: string 各137、`planCardIdx`: number 73 |
| `shifts` | `job`, `date`, `start`, `end`: string 各146、`wage`: number 146、`rest`: number 72 |
| `wds` | `date`: string 14、`amount`: number 14 |
| `catExp`, `catInc` | 文字列要素のため要素内フィールドなし |

金額関連の追加検査では、トップレベルの `acctBase`, `budget`, `otherIncome` はnumber各4、`fuyouLimit` はstring 4。`jobs.wage` / `transport` はnumber各2、`shifts.wage` はnumber 146、`actualInputs.actualAmount` / `estimatedAmount` はnumber各28、`fixedCosts.amount` はnumber 9、`plans.budget` はnumber 137、`wds.amount` はnumber 14。`ledger.amount` だけが同一フィールド内でnumber 516・string 538と混在する。これらの金額関連フィールドは全件、文字列表現が `^-?[0-9]+$` に一致し、小数・空文字・非数値表現は0件。範囲や業務上の正当性をこの検査だけで保証するものではない。

#### 日付・時刻と必須項目

- `baseDate` 4、`ledger.date` 1,054、`shifts.date` 146、`wds.date` 14、給与実績の `actualInputs.date` 19、`plans.date` / `dateStart` / `dateEnd` 各137は全件 `YYYY-MM-DD`。年・月・月末日まで検証し、不正な暦日・その他形式・空文字は各0件。カード実績9件は年月方式でdateを持たない仕様。
- 予定の開始日＞終了日、および互換用 `date` と `dateStart` の不一致は各0件。
- シフトの `start` / `end` 各146、勤務先の `nightStart` 2は全件有効な `HH:mm`。予定の `timeStart` は有効な `HH:mm` 3・空文字134、`timeEnd` は空文字137。空文字は終日・終了時刻省略を表す仕様であり欠損エラーにしない。非空の不正時刻は0件。
- 必須キーは現行保存処理と読込処理を基準に検査した。家計簿は `date,amount,name,cat,type,pay`、シフトは `job,date,start,end,wage`、勤務先は `name,wage`、カードは `name,closeDay,billDay`、引出しは `date,amount`、固定収入は `name,amount,day`、固定費は `id,name,amount,day,type,pay`、予定は `id,title,date,dateStart,dateEnd,budget,done,timeStart,timeEnd`、実績共通は `type,actualAmount,estimatedAmount`。実績はさらに給与で `job,salaryKey,date`、カードで `cardIdx,cardKey,billY,billM` を検査した。
- 上記43の配列・サブタイプ・フィールド組合せで、キー欠落は**給与実績の `job` 7 / 19件のみ**。必須項目のJSON nullは0件。予定の時刻を除いた必須文字列の空文字は0件。固定収入は0要素のため実レコードの必須検証は対象なし。
- `shifts.rest` は74件で欠落、`jobs.closeDay` / `payDay` は各1件で欠落しているが、現行コードに既定値処理があり、主要必須欠損とは区別する。移行時には既定値の意味を確認して補完する。

#### ID・同一内容の重複

比較単位は**同じ `user_data` 行の同じ配列内**。別ユーザーのカテゴリや設定が同じでも重複に数えない。「余剰」は各組の件数から1を引いた合計で、自動削除してよい件数ではない。

| 検査 | 重複組数 | 対象レコード数 | 余剰件数 |
|---|---:|---:|---:|
| `plans.id` 137件、`fixedCosts.id` 9件、`ledger.txId` 存在分516件 | 各0 | 各0 | 各0 |
| `ledger` 要素のJSONB完全一致（全フィールド・型を比較） | 11 | 22 | 11 |
| `ledger` から `id`, `txId`, `src` を除外して一致 | 27 | 60 | 33 |
| 上記に加えて `amount` をnumericへ変換して比較 | 27 | 60 | 33 |
| その他の非空配列（カテゴリを含む）の完全一致、および識別子等除外後一致 | 各0 | 各0 | 各0 |

`actualInputs` の給与 `salaryKey`（19件）・カード `cardKey`（9件）も、同じ行内で重複余剰0件。`ledger` のうち `txId` がない538件はID重複検査の対象外。`jobs`, `cards`, `shifts`, `wds` に不変IDは存在せず、ID重複0という保証はできない。予定・明細などの内容一致は正当な複数回の記録でも起こり得るため、上記は重複候補として扱い、削除を断定しない。

#### カード・勤務先・カテゴリの参照

参照先は必ず同じ `user_data` 行の配列で比較した。

| 参照検査 | 検査件数 | 不整合件数 |
|---|---:|---:|
| `ledger.cardIdx` → `cards` の非負整数・配列範囲 | 948 | 0 |
| `plans.planCardIdx` → `cards` の非負整数・配列範囲 | 73 | 0 |
| カード実績 `cardIdx` → `cards` の非負整数・配列範囲 | 9 | 0 |
| `fixedCosts.pay` の `card-{index}` → `cards` | 9 | 0 |
| トップレベル `rakutenCardIdx` → `cards` の配列範囲 | 1 | 0 |
| 家計簿の `pay` と参照カードの `name` の一致 | 948 | 0 |
| 既存カード名を支払方法に持つ支出なのに `cardIdx` がない | 該当条件で全家計簿検査 | 0 |
| カード実績 `cardKey` と `cardIdx,billY,billM` からの生成キーの一致 | 9 | 0 |
| `shifts.job` → `jobs.name` | 146 | 0 |
| 給与実績 `job` → `jobs.name` | 19 | 7（すべてjob欠落） |
| 給与実績 `salaryKey` と `job`＋支給年月の一致 | 19 | 7（同上） |
| 家計簿 `cat` → 種別に対応する `catExp` / `catInc` | 1,054 | 0（未知の種別も0） |

給与実績の残り12件は勤務先参照・給与キーとも一致。`job` 欠落7件については、`salaryKey` が現在の勤務先名＋区切り文字で始まるものも0件であり、現在の勤務先への機械的な紐付けはできない。現在の給与検索は `job` の一致も必須（`index.html:1042`等）なので、この7件は現行検索で取得されない。

`merchantRules` の値135件は、現行の収入・支出カテゴリいずれにも一致しなかった。ただし現行ソースに利用箇所がなく、値がカテゴリなのか別の識別子なのか確定できないため、カテゴリ参照切れ135件とは断定しない。旧仕様を確認してから移行対象を決める。

範囲内のカード番号が削除・並び替えにより過去と異なるカードを指しているかは、現在値の範囲検査では検出できない。勤務先名・カード名・カテゴリの意味の変更も、現在データのみで履歴全体の整合性を保証できない。

#### NULLユーザーと未利用アカウント

| 指標・定義 | 件数 |
|---|---:|
| `user_data` 行 / `user_id IS NULL` 行 | 4 / 0 |
| Authアカウント総数 / 一度もサインインしていないアカウント | 4 / 0 |
| `user_data` がない / 両publicテーブルに紐付く行がないアカウント | 0 / 0 |
| 最終サインインが集計時点から90日超、またはサインインなし | 3 |
| カテゴリ以外の9業務配列がすべて空のアカウント | 3 |
| 上記「90日超または未サインイン」と「業務配列が空」の両方に該当 | 3 |

未利用候補は上記3件と定義する。ただし最終サインイン日時は最終アプリ操作日時ではなく、既存セッションでの利用を把握できない。ローカルだけのデータや保持目的もDBからは分からないため、不要アカウントと断定せず、削除判断には利用者の確認が必要。

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
   - 根拠: `delCard(i)` は`st.cards.splice(i,1)` し、削除した番号に一致する固定費の参照だけを銀行払いへ変更する（現行 `index.html:1524`）。後続番号の固定費も繰り上げない。家計簿・予定・実績の番号は更新しない。
   - 影響: 削除位置より後のカードに結び付いた過去・将来データが別カードとして集計され、請求額・残高予測を誤る。DBのFKで防げないJSON内部参照である。

2. **`ai_insights` のPWA検索にユーザー条件がなく、DBにも期間単位の一意制約がない**
   - 根拠: `loadAiInsight()` は `kind='monthly_advice'` のみで最新1件を取得しており、`.eq('user_id', currentUser.id)` がない（`index.html:995`）。正しいRLSに全面依存している。
   - 根拠: テーブル定義と `sync/sql/ai_features.sql` に `(user_id, kind, period)` のunique制約はない。GASの再実行・再試行で同一期間の複数行を作成できる。現在は0行のため、現時点の実重複は0件。
   - 影響: 将来RLSの不備があれば他ユーザーの助言を表示し得る。重複時は最新だけが表示され、どれが正なのかDB上で判別できない。

3. **JSONBを正規化も検証もしておらず、重要な型・参照・重複をDBで保証できない**
   - 根拠: `user_data.value` は単一の `jsonb` 列で、メタデータ上にJSON Schema/要素別制約はない。アプリの保存経路にも包括的バリデーションはない。
   - 根拠: 金額が文字列・数値で混在し得ることは保存コードから確認できる（`:1706`, `:1893`）。シフトは勤務先名、カードは配列番号で参照するため、FKを張れない。
   - 影響: 将来の機能追加・GAS・分析処理で互換性が崩れやすく、破損値の発見が遅れる。実測でも家計簿金額は数値516件・文字列538件。給与実績は19件中7件に `job` がなく、現行の勤務先別実績検索に一致しない。家計簿は識別子等除外で27組・60件（余剰33件）の重複候補がある。型統一、旧データの扱い、重複候補の確認を移行計画に含める。

4. **`user_data.user_id` がnullableで、アプリのデータモデルとDB制約が一致しない**
   - 根拠: テーブルメタデータは `user_id` に `nullable` と `unique` を表示する。PWAは常にログイン済みの `currentUser.id` を保存する（`index.html:870-883`）。
   - 影響: アプリ経路外（管理作業・将来の連携）からユーザー非紐付け行を作れてしまう。unique制約もNULL行同士は重複防止しない。今回の実測ではNULL行は0件で、現時点の孤立行はない。

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

1. **今回の実測をベースラインにして、変更前のバックアップを計画する。** 定量診断は完了。実際の修正・移行を別途行う前にアクセス制限付きバックアップと復元確認を行う。給与実績7件は旧仕様と履歴から紐付けを確認し、解決できないものを推測で補完しない。家計簿の重複候補27組は正当な反復記録かを確認し、自動一括削除しない。金額の文字列538件は意味・範囲を検証して数値へ統一する方針を決める。旧 `merchantRules` は意味を確認し、未利用候補3アカウントも利用者確認なしに削除しない。今回はバックアップ取得・データ修正・削除を実施していない。
2. **RLSをテスト付きで確定する。** `ai_insights` に本人のSELECTポリシーを追加し、PWAクエリにも `user_id=currentUser.id` を明示する。`user_data` は今回取得したALLポリシーを基にレビューする。NULLユーザー行は現時点0件だが、`user_id` をNOT NULLにする直前にも再確認する。匿名・別ユーザー・サービスロールの3経路で許可/拒否テストを行う。
3. **同期の競合制御を先に直す。** 最低限、保存キューと完了表示・再試行を入れ、`updated_at` またはrevisionを条件にした比較更新にする。競合時は自動全量上書きでなく、再読込・マージまたは利用者への解決提示を行う。
4. **JSON内IDを安定IDへ置換する。** カード・勤務先・予定・明細にUUID等の不変IDを持たせ、参照は配列番号や表示名ではなくIDに統一する。削除は参照有無を確認し、アーカイブ/論理削除も検討する。
5. **段階的に正規化する。** 最初は `ledger`、`cards`、`plans`、`shifts` をユーザーID付きテーブルへ切り出し、型・CHECK・FK・一意制約をDBで担保する。設定など更新単位の大きい少量データだけをJSONに残すと移行コストと整合性のバランスがよい。
6. **GASを有効化する前に境界を固める。** 最小権限の実行者、鍵の保管・ローテーション、外部AI/LINEへ送るフィールドの最小化、Webhook署名検証、失敗通知の個人情報マスキングを決める。不要な旧GASトリガーが実行中でないことも管理画面で確認する。
7. **最後に性能・Auth設定を整える。** 実データ投入後にRLS式とインデックスの使用状況を再確認し、漏えいパスワード保護を有効化する。
