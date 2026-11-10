#!/bin/sh
# Publish a release: build the assets, write the notes to a temporary file, hand both to
# gh, then delete the notes. The release body lives on GitHub; nothing about it is kept
# in the repository, so it can never drift into a commit.
#
# Usage: sh scripts/release.sh vX.Y.Z "one-line title" < notes.md
#        sh scripts/release.sh vX.Y.Z "one-line title" --prerelease < notes.md
set -eu

TAG="${1:-}"
TITLE="${2:-}"
shift 2 || { echo "Usage: sh scripts/release.sh vX.Y.Z \"title\" [--prerelease] < notes.md" >&2; exit 1; }
FLAGS="$*"

if [ -z "$TAG" ] || [ -z "$TITLE" ]; then
  echo "Usage: sh scripts/release.sh vX.Y.Z \"title\" [--prerelease] < notes.md" >&2
  exit 1
fi

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
if [ "v${PACKAGE_VERSION}" != "$TAG" ]; then
  echo "package.json is v${PACKAGE_VERSION} but the tag is ${TAG}." >&2
  echo "Bump package.json first; the release would otherwise disagree with itself." >&2
  exit 1
fi

if [ -n "$(git status --porcelain=v1)" ]; then
  echo "Working tree is dirty. Commit before releasing." >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "Tag ${TAG} already exists. Tags are not reused; bump the version instead." >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
ORIGIN_HEAD="$(git rev-parse origin/master 2>/dev/null || echo '')"
if [ "$SHA" != "$ORIGIN_HEAD" ]; then
  echo "HEAD is not pushed to origin/master. Push before tagging." >&2
  exit 1
fi

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT INT TERM
cat > "$NOTES"

sh scripts/build-release.sh dist

git tag "$TAG"
git push origin "$TAG"

# shellcheck disable=SC2086
gh release create "$TAG" --title "$TITLE" --notes-file "$NOTES" $FLAGS \
  dist/gitmuster.tar.gz dist/install.ps1 dist/install.sh

echo "Published ${TAG}. Notes live on GitHub; no copy was written to the repository."
