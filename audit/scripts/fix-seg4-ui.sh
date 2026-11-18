#!/usr/bin/env bash
# Driver for fix-seg4-ui.js: fresh clone of vortex_seg3_tpl, backend from the
# given checkout (mock outcome forced to answered, labelled stub), frontend
# under `vite dev`. Leads are prepared through the API, except the phoneless
# lead (DIRECT SQL: what csvImport inserts for a row without a phone).
# Usage: bash audit/scripts/fix-seg4-ui.sh <label> <checkout dir>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROOT="$AUDIT_ROOT"
export DB=vortex_seg4_ui
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"; sleep 1
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SCRATCH/seg4-ui-be-$LABEL.txt" 2>&1 < /dev/null & )
( cd "$CO/frontend" && exec setsid npx vite --port 5173 --strictPort > "$SCRATCH/seg4-ui-fe-$LABEL.txt" 2>&1 < /dev/null & )
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
login rep2@example.com 'Rep2Pass!' tokU1 >/dev/null
pick() { sql "select id from leads where status='new' and not missing_phone and state in ('CA','NY','TX') order by id offset $1 limit 1"; }
disp() { local c; c=$(api POST /api/calls "{\"leadId\":$1}" tokU1 | sed -E 's/ \[HTTP [0-9]+\]$//' | jget call.id); sleep 0.5; api POST /api/dispositions "{\"callId\":$c,\"disposition\":\"$2\"}" tokU1 >/dev/null; }
CALL_L=$(pick 3); DNC_L=$(pick 9); NCN_L=$(pick 15); PLAIN_L=$(pick 21)
disp $DNC_L dnc; disp $NCN_L no_contact_number
PL=$(sql "insert into leads (name, phone, state, status, missing_phone) values ('Seg4 UI Phoneless', NULL, 'TX', 'new', true) returning id" | head -1)
echo "[$LABEL] leads: call=$CALL_L dnc=$DNC_L ($(sql "select status from leads where id=$DNC_L")) phoneless=$PL ncn=$NCN_L ($(sql "select status from leads where id=$NCN_L")) plain=$PLAIN_L"
NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg4-ui.js" http://localhost:5173 "$CALL_L" "$DNC_L" "$PL" "$NCN_L" "$PLAIN_L" 2>&1 | sed "s/^/[$LABEL] /"
echo "[$LABEL] backend log error/warn lines: $(grep -ciE 'error|warn' "$SCRATCH/seg4-ui-be-$LABEL.txt")"
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f "vite --port 5173"
