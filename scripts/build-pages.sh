#!/usr/bin/env bash
# GitHub Pages に出すファイルを Vite でビルドし、sw.js の CACHE_NAME を中身の指紋にする（D15・D4）。
# 公開の手順（.github/workflows/deploy.yml）と、PR のテスト（.github/workflows/test.yml）が使う。先に npm ci（または npm install）しておく。
#
#   bash scripts/build-pages.sh          # _site にビルドする。最後に版の名前（money-app-1a2b3c4d5e6f など）を出す
#   bash scripts/build-pages.sh 出す先    # ビルドする場所を変える
#
# 公開するのはアプリに要るファイルだけ（文書・DB・テストは出さない）。
# src/ の .ts は Vite が assets/main.js にまとめる（D17）。
# Vite を通さないファイル（js/・css/・sw.js・manifest・アイコン）は vite.config.mjs の STATIC_FILES でコピーする。
# ファイルを足したら、そこと sw.js の ASSETS に足す（js/・css/ の中は全部コピーする）
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"
PLACEHOLDER="'money-app-dev'"

rm -rf "$OUT"
mkdir -p "$OUT"

# ---------- ビルドする ----------
npx vite build --outDir "$OUT" --emptyOutDir --logLevel warn >&2

# ---------- 確かめる ----------
fail() { echo "$1" >&2; exit 1; }
ASSETS=$(sed -n '/^const ASSETS = \[/,/^\];/p' sw.js | grep -oE "'\./[^']*'" | tr -d "'") # ASSETS の配列の中だけ
in_assets() { printf '%s\n' "$ASSETS" | grep -qxF "./$1"; }
# sw.js の ASSETS にある手元のファイル（'./〜'）が、全部そろっているか
for f in $ASSETS; do
  [ "$f" = "./" ] && continue
  [ -f "$OUT/${f#./}" ] || fail "sw.js の ASSETS にある $f が、公開するファイルにありません"
done
# Vite が作ったファイル（assets/）は、すべて ASSETS にあるか。JS は1つだけか（D17。ほかのファイルが出ると、通信できないときに開けない）
for f in $(cd "$OUT" && find assets -type f | LC_ALL=C sort); do
  in_assets "$f" || fail "Vite が作った $f が、sw.js の ASSETS にありません（出力を1つの JS にするか、手順6で一覧を作る）"
done
[ "$(find "$OUT/assets" -type f -name '*.js' | wc -l | tr -d ' ')" = 1 ] || fail "assets/ の JS が1つではありません（D17）"
# 出力の index.html が読む手元のファイル（<script src>・stylesheet・modulepreload）は、すべて ASSETS にあるか
for f in $(grep -oE '<script[^>]* src="[^"]+"|<link[^>]* rel="(stylesheet|modulepreload)"[^>]* href="[^"]+"' "$OUT/index.html" | grep -oE '(src|href)="[^"]+"' | cut -d'"' -f2 | sed 's|^\./||' | grep -v '^https\?://'); do
  in_assets "$f" || fail "index.html が読む $f が、sw.js の ASSETS にありません"
done
# モジュール（assets/main.js）が、js/ の <script> より先に並んでいるか。js/ はすべて defer か（D17。逆だと js/ が window.MoneyCalc などを見つけられない）
module_at=$(grep -n '<script type="module"' "$OUT/index.html" | head -1 | cut -d: -f1)
classic_at=$(grep -n '<script src="js/' "$OUT/index.html" | head -1 | cut -d: -f1)
[ -n "$module_at" ] && [ -n "$classic_at" ] && [ "$module_at" -lt "$classic_at" ] || fail "index.html で、モジュールが js/ の <script> より先に並んでいません"
if grep '<script src="js/' "$OUT/index.html" | grep -qv ' defer'; then fail "index.html の js/ の <script> に defer がないものがあります"; fi
# manifest とアイコンを、名前を変えずに指しているか（Vite に名前を変えられると、ホーム画面のアプリが壊れる）
if ! grep -q 'rel="manifest" href="manifest.json"' "$OUT/index.html"; then
  echo "index.html の manifest の場所が変わっています（vite-ignore を確かめる）" >&2
  exit 1
fi
# 見た目とアプリの本体を、名前を変えずに指しているか（Vite に名前を変えられると、sw.js の ASSETS と合わなくなる）
for ref in 'rel="stylesheet" href="css/app.css"' '<script src="js/app.js"'; do
  if ! grep -q "$ref" "$OUT/index.html"; then
    echo "index.html に $ref がありません（vite-ignore を確かめる）" >&2
    exit 1
  fi
done
# 置き換える場所が1つだけあるか（2つあると、公開した版でも「手元」と見なしてしまう）
if [ "$(grep -c "$PLACEHOLDER" "$OUT/sw.js")" != 1 ]; then
  echo "sw.js に $PLACEHOLDER が1つだけ、ではありません" >&2
  exit 1
fi

# ---------- 版を決める ----------
# 公開するファイルの名前と中身から指紋を作る（sw.js は置き換える前の中身）。アプリのファイルが変わったときだけ変わる
hash=$(cd "$OUT" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)
version="money-app-$hash"
# -i.bak は Linux（GitHub Actions）でも Mac でも同じに動く書き方
sed -i.bak "s/$PLACEHOLDER/'$version'/" "$OUT/sw.js" && rm -f "$OUT/sw.js.bak"
grep -q "'$version'" "$OUT/sw.js"

echo "$version"
