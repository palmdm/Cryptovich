#!/usr/bin/env bash
set -euo pipefail

# Backs up the Postgres database and every uploaded file (post
# attachments, avatars) into a single timestamped tarball under
# ./backups/ — the exact artifact scripts/restore.sh consumes to relocate
# or clone the whole server onto a new machine (spec: "quick
# relocation/cloning ... in case of any situations").
#
# Requires the stack to already be running: `docker compose up -d`.
#
# Usage: ./scripts/backup.sh [output-dir]

cd "$(dirname "$0")/.."

OUT_DIR="${1:-backups}"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$OUT_DIR"

echo "==> Dumping Postgres database..."
docker compose exec -T postgres pg_dump -U postgres --clean --if-exists platform > "$WORK_DIR/database.sql"

# Runs a one-off container against the same `api` service definition so
# it reuses the already-configured `uploads:/data/uploads` volume mount
# from docker-compose.yml, rather than guessing the volume's
# compose-generated name.
echo "==> Archiving uploaded files..."
docker compose run --rm --no-deps -v "$WORK_DIR:/backup" api \
  tar czf /backup/uploads.tar.gz -C /data/uploads .

ARCHIVE="$OUT_DIR/backup-$TIMESTAMP.tar.gz"
tar czf "$ARCHIVE" -C "$WORK_DIR" database.sql uploads.tar.gz

echo "==> Backup written to $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
