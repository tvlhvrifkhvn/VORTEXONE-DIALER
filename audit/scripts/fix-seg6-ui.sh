#!/usr/bin/env bash
# Segment 6 browser check driver: fresh clone of vortex_seg3_tpl migrated by
# <checkout>, NO calling-hours setting row (the default), backend under a
# controlled clock (FAKE_NOW 2026-11-14 02:30 UTC = 21:30 New York, 20:30
# Dallas, 18:30 Los Angeles), production build (vite build + preview).
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg6-ui.sh <label> <checkout>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROOT="$AUDIT_ROOT"
export DB=vortex_seg6_ui
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
sql "delete from settings where key = 'calling_hours_enforced'" >/dev/null
echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite preview"; sleep 0.5
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off FAKE_NOW=2026-11-14T02:30:00Z NODE_OPTIONS="--require $ROOT/audit/stubs/fake-now.js --require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SCRATCH/seg6-ui-be-$LABEL.txt" 2>&1 < /dev/null & )
( cd "$CO/frontend" && npx vite build > "$SCRATCH/seg6-ui-build-$LABEL.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$SCRATCH/seg6-ui-fe-$LABEL.txt" 2>&1 < /dev/null & )
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
CLOSED=$(sql "select id from leads where state = 'NY' and status = 'new' and not missing_phone and deleted_at is null order by id limit 1")
OPEN=$(sql "select id from leads where state = 'CA' and phone like '+1213%' and status = 'new' and not missing_phone and deleted_at is null order by id limit 1")
[ -z "$OPEN" ] && OPEN=$(sql "select id from leads where state = 'CA' and status = 'new' and not missing_phone and deleted_at is null order by id limit 1")
echo "[$LABEL] closed lead $CLOSED (NY, 21:30 there), open lead $OPEN (CA, 18:30 there)"
NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg6-ui.js" http://localhost:5173 "$CLOSED" "$OPEN" 2>&1 | sed "s/^/[$LABEL] /"
echo "[$LABEL] backend log error/warn lines: $(grep -ciE 'error|warn' "$SCRATCH/seg6-ui-be-$LABEL.txt")"
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite preview"
