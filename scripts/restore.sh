#!/usr/bin/env bash
set -euo pipefail

# Restores a backup created by scripts/backup.sh — the other half of the
# relocate/clone pair. Typical relocation flow:
#
#   1. On the OLD server:  ./scripts/backup.sh
#   2. Copy the resulting backups/backup-<timestamp>.tar.gz to the NEW
#      server (scp, rsync, whatever you have).
#   3. On the NEW server: clone the repo, `cp .env.example .env` and fill
#      it in, then `docker compose up -d postgres redis`.
#   4. On the NEW server:  ./scripts/restore.sh backups/backup-<timestamp>.tar.gz
#   5. `docker compose up -d` to bring api/worker/web online.
#
# The dump was taken with --clean --if-exists, so restoring drops and
# recreates every object it touches — safe to run against an empty
# database, destructive against one with data you want to keep.
#
# Usage: ./scripts/restore.sh path/to/backup-TIMESTAMP.tar.gz

cd "$(dirname "$0")/.."

ARCHIVE="${1:?Usage: $0 path/to/backup-TIMESTAMP.tar.gz}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Extracting $ARCHIVE..."
tar xzf "$ARCHIVE" -C "$WORK_DIR"

echo "==> Restoring Postgres database..."
docker compose exec -T postgres psql -U postgres -d platform < "$WORK_DIR/database.sql"

echo "==> Restoring uploaded files..."
docker compose run --rm --no-deps -v "$WORK_DIR:/backup" api \
  sh -c "rm -rf /data/uploads/* /data/uploads/.[!.]* 2>/dev/null; tar xzf /backup/uploads.tar.gz -C /data/uploads"

echo "==> Restore complete. Run 'docker compose up -d' to bring the full stack online."
