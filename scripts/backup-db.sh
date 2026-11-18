#!/usr/bin/env bash
# Backs up the Vortex Dialer database to a timestamped file. Run it before
# every real lead upload (and before scripts/normalize-existing-phones.js --apply).
#
#   ./scripts/backup-db.sh                # writes backups/vortex-YYYYmmdd-HHMMSS.dump
#   BACKUP_DIR=/somewhere ./scripts/backup-db.sh
#
# Restore (replaces the current contents of the database with the backup):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/vortex-YYYYmmdd-HHMMSS.dump
#
# DATABASE_URL is read from the environment, or from backend/.env. It is never
# printed (it contains the database password).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${DATABASE_URL:-}" ] && [ -f backend/.env ]; then
  DATABASE_URL="$(sed -n -E 's/^DATABASE_URL=(.*)$/\1/p' backend/.env | tail -1)"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (and backend/.env has none) — nothing to back up." >&2
  exit 1
fi
command -v pg_dump >/dev/null || { echo "pg_dump is not installed." >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/vortex-$(date +%Y%m%d-%H%M%S).dump"

# Custom format: compressed, and pg_restore can restore all or part of it.
pg_dump --format=custom --no-owner --file="$OUT" "$DATABASE_URL"

LEADS="$(psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM leads' 2>/dev/null || echo '?')"
echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1), $LEADS leads)"
echo "Restore with:   pg_restore --clean --if-exists --no-owner -d \"\$DATABASE_URL\" $OUT"
