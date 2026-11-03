#!/usr/bin/env bash
# GitHub Pages に出すファイルを Vite でビルドし、sw.js の先読み一覧と版を作る（D15・D4）。
# 公開の手順（.github/workflows/deploy.yml）と、PR のテスト（.github/workflows/test.yml）が使う。先に npm ci（または npm install）しておく。
#
#   MANEY_TARGET=prod bash scripts/build-pages.sh          # _site にビルドする。最後に版の名前（money-app-1a2b3c4d5e6f など）を出す
#   MANEY_TARGET=prod bash scripts/build-pages.sh 出す先    # ビルドする場所を変える
#
# 接続先（D19）: MANEY_TARGET が prod（本番）か local（ローカルの Supabase。npm run build:local）。指定しないと止める。
# prod のときは、ローカル用のログインの入口とローカルの接続先が、出力に入っていないことを確かめる。local の出力は公開しない。
#
# 公開するのはアプリに要るファイルだけ（文書・DB・テストは出さない）。
# src/ の .ts は Vite が指紋付きの assets/ に出す。
# Vite を通さないファイル（css/・sw.js・manifest・アイコン）は vite.config.mjs の STATIC_FILES でコピーする。
# 先読み一覧はビルド結果から作るので、静的ファイルを足すときは STATIC_FILES も確認する。
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"

case "${MANEY_TARGET:-}" in
  prod|local) ;;
  *) echo "接続先を MANEY_TARGET=prod か MANEY_TARGET=local で指定する（D19）" >&2; exit 1 ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT"

# ---------- ビルドする ----------
npx vite build --outDir "$OUT" --emptyOutDir --logLevel warn >&2

# ---------- 確かめる ----------
fail() { echo "$1" >&2; exit 1; }
# モジュールだけで起動する。旧 js/ の script が混ざると、別の起動処理が走る
grep -q '<script type="module"' "$OUT/index.html" || fail "index.html にアプリのモジュールがありません"
if grep -q '<script src="js/' "$OUT/index.html"; then fail "index.html に旧 js/ の script が残っています"; fi
# manifest とアイコンを、名前を変えずに指しているか（Vite に名前を変えられると、ホーム画面のアプリが壊れる）
if ! grep -q 'rel="manifest" href="manifest.json"' "$OUT/index.html"; then
  echo "index.html の manifest の場所が変わっています（vite-ignore を確かめる）" >&2
  exit 1
fi
# 見た目は Vite を通さず、名前を変えずに指す
for ref in 'rel="stylesheet" href="css/app.css"'; do
  if ! grep -q "$ref" "$OUT/index.html"; then
    echo "index.html に $ref がありません（vite-ignore を確かめる）" >&2
    exit 1
  fi
done
# 接続先（D19）。本番の出力に、ローカル用のログインとローカルの接続先が入っていないか。本番の接続先を指しているか
if [ "$MANEY_TARGET" = prod ]; then
  ! grep -rq "data-maney-local-login" "$OUT" || fail "本番の出力に、ローカル用のログインの入口が入っています（src/main.ts の条件を確かめる）"
  ! grep -rqE "127.0.0.1:54321|localhost:54321" "$OUT/assets" || fail "本番の出力に、ローカルの Supabase の接続先が入っています"
  grep -rq "sgvyjolyfuqchugltvls.supabase.co" "$OUT/assets" || fail "本番の出力が、本番の Supabase を指していません"
else
  grep -rq "data-maney-local-login" "$OUT/assets" || fail "ローカルの出力に、ローカル用のログインの入口がありません"
  echo "ローカルの Supabase につなぐビルドです。公開しないこと（D19）" >&2
fi
# ---------- ビルド結果から先読み一覧と版を作る ----------
node scripts/finalize-sw.mjs "$OUT"
