#!/usr/bin/env bash
# F-51 driver: runs fix-seg2-ui-strictmode.js against `vite dev` (StrictMode) or
# a production build, with a backend from the given checkout, on a fresh clone
# of vortex_seg2_tpl, mock outcome forced to answered (labelled stub).
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg2-f51.sh <label> <checkout dir> <dev|prod> [two]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; MODE=$3; TWO=${4:-}
ROOT="$AUDIT_ROOT"
export DB=vortex_seg2_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg2_tpl" >/dev/null 2>&1
echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"; pkill -f "vite preview"; sleep 1
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SCRATCH/f51-be-$LABEL.txt" 2>&1 < /dev/null & )
if [ "$MODE" = dev ]; then
  ( cd "$CO/frontend" && exec setsid npx vite --port 5173 --strictPort > "$SCRATCH/f51-fe-$LABEL.txt" 2>&1 < /dev/null & )
else
  ( cd "$CO/frontend" && npx vite build > "$SCRATCH/f51-build-$LABEL.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$SCRATCH/f51-fe-$LABEL.txt" 2>&1 < /dev/null & )
fi
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
curl -s "$API/health" >/dev/null || { echo "[$LABEL] backend failed: $(tail -3 "$SCRATCH/f51-be-$LABEL.txt")"; exit 1; }
A=$(sql "select id from leads where status='new' and not missing_phone and name like 'Bulk Agent 70%' order by id limit 1")
B=$(sql "select id from leads where status='new' and not missing_phone and name like 'Bulk Agent 71%' order by id limit 1")
A0=$(sql "select attempts from leads where id=$A"); B0=$(sql "select attempts from leads where id=$B")
if [ -n "$TWO" ]; then
  NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg2-ui-strictmode.js" http://localhost:5173 "$A" "$B" | sed "s/^/[$LABEL] /"
  for X in $A $B; do echo "[$LABEL] DB lead $X: calls=$(sql "select count(*) from call_history where lead_id=$X") ($(sql "select string_agg(id||':'||telephony_state, ', ') from call_history where lead_id=$X")) attempts=$(sql "select attempts from leads where id=$X") status=$(sql "select status from leads where id=$X")"; done
else
  NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg2-ui-strictmode.js" http://localhost:5173 "$A" | sed "s/^/[$LABEL] /"
  echo "[$LABEL] DB lead $A: calls=$(sql "select count(*) from call_history where lead_id=$A") ($(sql "select string_agg(id||':'||telephony_state, ', ') from call_history where lead_id=$A")) attempts $A0 -> $(sql "select attempts from leads where id=$A")"
fi
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"; pkill -f "vite preview"
