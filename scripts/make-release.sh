#!/usr/bin/env bash
set -euo pipefail

# Packs a release: one zip with what the server needs to build and run
# Cryptovich — and nothing else. No node_modules, no .next, no git history, no
# tests or docs, no local notes, and never
# a .env, an override or anything of the server's own.
#
#   ./scripts/make-release.sh           → releases/cryptovich-<version>.zip
#
# On the server, in the Cryptovich folder:
#
#   unzip -o ~/cryptovich-<version>.zip && ./scripts/upgrade.sh
#
# The zip has no folder of its own: it unpacks over the existing copy, and
# .env, uploads, branding and the like are left as they are. It carries
# .release-files, the list of every file in it; upgrade.sh compares that
# with the previous release's list and removes what the new version no
# longer has, so a deleted or moved source file does not linger there.
#
# The workspace packages' dist/ is built fresh and shipped with the
# sources: the images build the apps, but read @platform/shared,
# @platform/integrations and @platform/db from their prebuilt dist/.
#
# Signing, for updating from the site (About -> Update): with a release key
# the zip gets a signature beside it (cryptovich-<version>.zip.sig), and a
# server installs only a release whose signature matches the public key
# its own version carries (deploy/release-key.pub). Once:
#
#   ./scripts/make-release.sh --new-key
#
# makes the pair: the private key stays on this machine
# (~/.config/cryptovich/release-key.pem, or RELEASE_KEY), the public one
# goes into the project and ships with every release. Then publish both
# files of a release on GitHub (palmdm/Cryptovich, tag v<version>).

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

command -v zip >/dev/null || { echo "zip is not installed (sudo apt install zip)." >&2; exit 1; }
command -v git >/dev/null || { echo "git is needed to list the project's files." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is needed to build the shared packages." >&2; exit 1; }

KEY="${RELEASE_KEY:-$HOME/.config/cryptovich/release-key.pem}"
if [ "${1:-}" = "--new-key" ]; then
  command -v openssl >/dev/null || { echo "openssl is needed to make a key." >&2; exit 1; }
  if [ -f "$KEY" ]; then
    echo "A key is already there: $KEY (not replaced)."
  else
    mkdir -p "$(dirname "$KEY")"
    (umask 077 && openssl genpkey -algorithm ed25519 -out "$KEY")
    echo "Private key: $KEY - keep it, and keep it to yourself."
  fi
  openssl pkey -in "$KEY" -pubout -out deploy/release-key.pub
  echo "Public key: deploy/release-key.pub - it ships with the next release; from the one after, servers can update themselves."
  exit 0
fi

VERSION="$(head -n 1 CHANGELOG.md | sed 's/^VERSION=//')"
OUT="$ROOT/releases/cryptovich-$VERSION.zip"
bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

bold "Cryptovich $VERSION: building the shared packages"
pnpm --filter @platform/db generate >/dev/null
# From scratch, so nothing compiled from a deleted source rides along.
rm -rf packages/shared/dist packages/integrations/dist packages/db/dist
pnpm --filter @platform/shared --filter @platform/integrations --filter @platform/db build >/dev/null
echo "packages/shared, packages/integrations, packages/db: built"

bold "Choosing the files"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Every file git knows or would add (so .gitignore's exclusions hold:
# node_modules, .next, .env, uploads…), plus the fresh dist/.
{
  git ls-files --cached --others --exclude-standard
  find packages/shared/dist packages/integrations/dist packages/db/dist -type f
} | LC_ALL=C sort -u | while IFS= read -r f; do
  # Deleted here but still in git's index.
  [ -e "$f" ] || [ -L "$f" ] || continue
  case "$f" in
    # Local notes, the repository's own machinery, documentation.
    .claude/* | .remember/* | CLAUDE.md | .github/* | docs/* | releases/*) continue ;;
    # Tests: the server builds and runs, it does not test.
    apps/*/test/* | packages/*/test/* | *.test.ts | *.test.tsx | *.test.js | *.test.d.ts) continue ;;
    # The server's own: never overwritten by a release.
    docker-compose.override.yml | branding/*.png | branding/*.svg | branding/*.ico | apps/api/data/* | apps/status/data/*) continue ;;
    deploy/maintenance/on | deploy/maintenance/window | .release-files*) continue ;;
    .env.example) ;;
    .env | .env.* | */.env.*) continue ;;
  esac
  # A .env that is a real file stays home; packages/db/.env is only a link
  # to the folder's own .env, and is shipped as that link.
  case "$f" in */.env) [ -L "$f" ] || continue ;; esac
  printf '%s\n' "$f"
done >"$tmp/.release-files"

count="$(wc -l <"$tmp/.release-files" | tr -d ' ')"
echo "$count files"

bold "Packing $OUT"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
# -y keeps the link as a link; file modes (executable scripts) are kept.
zip -q -X -y "$OUT" -@ <"$tmp/.release-files"
(cd "$tmp" && zip -q -X "$OUT" .release-files)
echo "$(du -h "$OUT" | cut -f1)  $OUT"

SIGNED=0
if [ -f "$KEY" ] && command -v openssl >/dev/null; then
  openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$OUT" -out "$OUT.sig"
  if [ -f deploy/release-key.pub ] && ! openssl pkeyutl -verify -pubin -inkey deploy/release-key.pub -rawin -in "$OUT" -sigfile "$OUT.sig" >/dev/null 2>&1; then
    echo "Warning: the signature does not match deploy/release-key.pub - servers will refuse this release. Run --new-key?" >&2
  fi
  echo "Signed: $OUT.sig"
  SIGNED=1
fi

cat <<EOF

On the server (in the Cryptovich folder, e.g. ~/proj2):

  unzip -o ~/cryptovich-$VERSION.zip && ./scripts/upgrade.sh

Copy it there first, for instance:

  scp $OUT user@server:~/
EOF
if [ "$SIGNED" = 1 ]; then
  echo
  echo "To let servers update themselves from the site, publish a GitHub release"
  echo "of palmdm/Cryptovich tagged v$VERSION with both files:"
  echo "  $OUT"
  echo "  $OUT.sig"
else
  echo
  echo "Not signed (no key at $KEY): servers will not install it from the site. ./scripts/make-release.sh --new-key makes one."
fi
