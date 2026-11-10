#!/bin/sh
# Install gitmuster from a GitHub release without cloning the repository and without npm.
# Resolves a published release tag, downloads its attached source archive, unpacks it under
# ~/.local/share/gitmuster, and writes a wrapper into ~/.local/bin.
# Only Node.js 18+ and git are required afterwards.
#
# 'latest' means the most recent stable release. While gitmuster is in beta the stable
# channel is empty, so the newest pre-release is used instead and the reason is printed.
#
# Usage: sh install.sh [--version vX.Y.Z] [--prefix DIR] [--uninstall]
set -eu

REPO="kanduit-lab/gitmuster"
VERSION="latest"
PREFIX="${HOME}/.local"
UNINSTALL="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --uninstall) UNINSTALL="yes"; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

BIN_DIR="${PREFIX}/bin"
SHARE_DIR="${PREFIX}/share/gitmuster"
LAUNCHER="${BIN_DIR}/gitmuster"

if [ "$UNINSTALL" = "yes" ]; then
  rm -f "$LAUNCHER"
  rm -rf "$SHARE_DIR"
  echo "gitmuster removed from ${PREFIX}."
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "node not found. Install Node.js 18 or newer from https://nodejs.org." >&2; exit 1; }
major="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$major" -lt 18 ]; then
  echo "Node.js 18 or newer is required; this machine has $(node --version)." >&2
  exit 1
fi
command -v git >/dev/null 2>&1 || { echo "git not found. Install Git first." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl not found. Install curl first." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar not found. Install tar first." >&2; exit 1; }

# Release metadata is read from the redirect a download follows, so no API token or rate
# limit is involved: /releases/latest/download/<asset> redirects to the tagged asset.
resolve_tag() {
  target="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest/download/gitmuster.tar.gz" 2>/dev/null || true)"
  case "$target" in
    */download/*) printf '%s' "$target" | sed 's|.*/download/||; s|/.*||' ;;
    *) printf '' ;;
  esac
}

if [ "$VERSION" = "latest" ]; then
  TAG="$(resolve_tag)"
  if [ -z "$TAG" ]; then
    # The stable channel is empty while gitmuster is in beta. Fall back to the newest
    # pre-release so 'latest' still installs something, and say so.
    TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=10" 2>/dev/null \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
    if [ -z "$TAG" ]; then
      echo "No published release found for ${REPO}." >&2
      exit 1
    fi
    echo "No stable release yet; using the newest pre-release ${TAG}." >&2
  fi
else
  TAG="$VERSION"
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/gitmuster.tar.gz"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT INT TERM

echo "Downloading gitmuster ${TAG}"
curl -fsSL "$URL" -o "${STAGE}/gitmuster.tar.gz" || {
  echo "Release asset download failed for ${TAG}." >&2
  echo "Confirm the tag exists and carries gitmuster.tar.gz: https://github.com/${REPO}/releases" >&2
  exit 1
}
tar -xzf "${STAGE}/gitmuster.tar.gz" -C "$STAGE"
SOURCE_DIR="$(find "$STAGE" -maxdepth 1 -type d -name 'gitmuster-*' | head -n 1)"
if [ -z "$SOURCE_DIR" ]; then
  echo "Downloaded archive did not contain the gitmuster sources." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
rm -rf "$SHARE_DIR"
mv "$SOURCE_DIR" "$SHARE_DIR"

# The release archive is already trimmed to runtime files; this keeps the installed tree
# inspectable even if an older release carried extra material.
for entry in "$SHARE_DIR"/* "$SHARE_DIR"/.[!.]*; do
  [ -e "$entry" ] || continue
  case "$(basename "$entry")" in
    cli.mjs|picker.mjs|repositories.mjs|package.json|README.md|README.ko.md|LICENSE) ;;
    *) rm -rf "$entry" ;;
  esac
done

printf '%s\n' "$TAG" > "${SHARE_DIR}/.gitmuster-version"

cat > "$LAUNCHER" <<EOF
#!/bin/sh
exec node "${SHARE_DIR}/cli.mjs" "\$@"
EOF
chmod +x "$LAUNCHER"

echo "Installed ${TAG}: ${LAUNCHER}"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) echo "Run 'gitmuster help' in any folder that holds repositories." ;;
  *) echo "Add ${BIN_DIR} to PATH, then run 'gitmuster help':"
     echo "  export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac
