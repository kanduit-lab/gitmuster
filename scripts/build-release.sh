#!/bin/sh
# Build the release asset that the installers download.
# Usage: sh scripts/build-release.sh <output-directory>
set -eu

OUT="${1:-dist}"
VERSION="$(node -p "require('./package.json').version")"
NAME="gitmuster-v${VERSION}"

RUNTIME="cli.mjs picker.mjs repositories.mjs package.json README.md README.ko.md LICENSE"

for f in $RUNTIME; do
  [ -f "$f" ] || { echo "missing runtime file: $f" >&2; exit 1; }
done

mkdir -p "$OUT"
rm -f "${OUT}/gitmuster.tar.gz" "${OUT}/install.ps1" "${OUT}/install.sh"

# Staged through a directory rather than tar --transform, which BSD tar lacks.
# The archive root is gitmuster-<tag>/ so both installers find it with a single glob.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT INT TERM

mkdir -p "${STAGE}/${NAME}"
for f in $RUNTIME; do
  cp "$f" "${STAGE}/${NAME}/"
done

tar -czf "${OUT}/gitmuster.tar.gz" -C "$STAGE" "$NAME"

# The installers ship as release assets so 'latest/download/install.ps1' resolves to the
# same tag as the payload it installs, instead of to whatever main happens to be.
cp install.ps1 install.sh "$OUT/"

echo "Built ${OUT}/gitmuster.tar.gz (${NAME})"
echo "Built ${OUT}/install.ps1 ${OUT}/install.sh"
tar -tzf "${OUT}/gitmuster.tar.gz"
