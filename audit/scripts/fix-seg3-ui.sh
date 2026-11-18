#!/usr/bin/env bash
# Driver for fix-seg3-ui.js: fresh clone of vortex_seg3_tpl, backend from the
# given checkout with the mock outcome forced to answered (labelled stub),
# frontend under `vite dev` (StrictMode).
# Usage: bash audit/scripts/fix-seg3-ui.sh <label> <checkout dir>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROOT="$AUDIT_ROOT"
export DB=vortex_seg3_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"; sleep 1
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SCRATCH/seg3-ui-be-$LABEL.txt" 2>&1 < /dev/null & )
( cd "$CO/frontend" && exec setsid npx vite --port 5173 --strictPort > "$SCRATCH/seg3-ui-fe-$LABEL.txt" 2>&1 < /dev/null & )
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
A=$(sql "select id from leads where status='new' and not missing_phone and state in ('CA','NY','TX') order by id offset 3 limit 1")
B=$(sql "select id from leads where status='new' and not missing_phone and state in ('CA','NY','TX') order by id offset 9 limit 1")
NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg3-ui.js" http://localhost:5173 "$A" "$B" | sed "s/^/[$LABEL] /"
echo "[$LABEL] backend log error/warn lines: $(grep -ciE 'error|warn' "$SCRATCH/seg3-ui-be-$LABEL.txt")"
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"
