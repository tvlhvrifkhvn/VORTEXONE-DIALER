#!/usr/bin/env bash
# Driver for fix-seg5b-poll.js: production build (vite build + preview), backend
# from <checkout> with the mock forced to answered (stub), fresh clone of vortex_seg3_tpl.
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg5b-poll.sh <label> <checkout> [scenarios]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; WHICH=${3:-ABC}; ROOT="$AUDIT_ROOT"
export DB=vortex_seg5b_poll
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite preview"; sleep 0.5
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SCRATCH/seg5b-poll-be-$LABEL.txt" 2>&1 < /dev/null & )
( cd "$CO/frontend" && npx vite build > "$SCRATCH/seg5b-poll-build-$LABEL.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$SCRATCH/seg5b-poll-fe-$LABEL.txt" 2>&1 < /dev/null & )
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
L=$(sql "select string_agg(id::text, ' ') from (select id from leads where status='new' and not missing_phone and state in ('CA','NY','TX','FL','IL') order by id limit 3) t")
NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg5b-poll.js" http://localhost:5173 $L "$WHICH" 2>&1 | sed "s/^/[$LABEL] /"
echo "[$LABEL] backend log error/warn lines: $(grep -ciE 'error|warn' "$SCRATCH/seg5b-poll-be-$LABEL.txt")"
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite preview"
