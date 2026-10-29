# アーカイブ

今は使っていないが、経緯を残すために置いているもの。アプリ（`index.html`）からは読まない。

| 場所 | 中身 | しまった理由 |
|---|---|---|
| [`sync/`](sync/) | 月次アドバイス（Gemini）と LINE 通知の GAS、`ai_insights` テーブルの SQL、楽天カードの取り込みの設計書。元は別リポジトリ `maney-app-sync` | 月次アドバイス・LINE 通知は使わないと決めた（[docs/db/PLAN.md](../docs/db/PLAN.md) の「決まったこと」2）。楽天カードの取り込みは 2026-10-24 に削除済み。アプリの AI アドバイスの表示と、DB の `ai_insights` テーブルは 2026-10-29 に消した |
| [`db-audit/`](db-audit/) | DB の診断（Claude 2026-10-24、Codex 2026-10-29） | 診断をもとに方針（[docs/db/PLAN.md](../docs/db/PLAN.md)）を決め、#8〜#11 で対応し終えた。書かれている構造（JSON 1行の `user_data`）は、今はもう使っていない |

DB の中の古いデータ（切り替える前の JSON の複製と履歴）は、`private.archive_user_data` にまとめている（[docs/db/RESTORE.md](../docs/db/RESTORE.md)）。
