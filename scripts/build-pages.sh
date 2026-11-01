#!/usr/bin/env bash
# GitHub Pages に出すファイルを集め、sw.js の CACHE_NAME を中身の指紋にする（D15）。
# 公開の手順（.github/workflows/deploy.yml）と、PR のテスト（.github/workflows/test.yml）が使う。
#
#   bash scripts/build-pages.sh          # _site に集める。最後に版の名前（money-app-1a2b3c4d5e6f など）を出す
#   bash scripts/build-pages.sh 出す先    # 集める場所を変える
#
# 公開するのはアプリに要るファイルだけ（文書・DB・テストは出さない）。
# ファイルを足したら、下の「集める」と sw.js の ASSETS に足す（js/ の中は全部集める）
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"
PLACEHOLDER="'money-app-dev'"

rm -rf "$OUT"
mkdir -p "$OUT"

# ---------- 集める ----------
cp index.html sw.js manifest.json icon-192.png icon-512.png "$OUT/"
cp -r js "$OUT/js"

# ---------- 確かめる ----------
# sw.js の ASSETS にある手元のファイル（'./〜'）が、全部そろっているか
for f in $(grep -oE "'\./[^']*'" sw.js | tr -d "'"); do
  [ "$f" = "./" ] && continue
  if [ ! -f "$OUT/${f#./}" ]; then
    echo "sw.js の ASSETS にある $f が、公開するファイルにありません" >&2
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
sed -i "s/$PLACEHOLDER/'$version'/" "$OUT/sw.js"
grep -q "'$version'" "$OUT/sw.js"

echo "$version"
