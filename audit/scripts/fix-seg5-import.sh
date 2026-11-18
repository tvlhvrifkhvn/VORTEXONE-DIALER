#!/usr/bin/env bash
# Segment 5 import run at one size/format. Fresh clone of vortex_seg3_tpl
# (synthetic leads only, never real data), a generated file (gen-leads.js) plus
# a second one for the cancel test, the file's setup SQL (DNC numbers and
# legacy DNC leads, DIRECT SQL), then the backend from <checkout> with AI forced
# off, then fix-seg5-import.js.
#
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg5-import.sh <label> <checkout> <rows> <csv|xlsx> [seed]
#   AI off: IMPORT_AI=off (post-fix switch) and GROQ_BASE_URL=http://127.0.0.1:9 (a closed local
#   port, so even code without the switch can never reach the real Groq API).
#   STUB=1     base only: route AI to audit/stubs/groq-stub-server.js in pass-through mode instead
#              (labelled "stubbed"), so base's write path can be measured without minutes of retries.
#   MANUAL_MAPPING=1  process with a hand-picked mapping (what a user would fix in the preview).
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROWS=$3; FMT=$4; SEED=${5:-7}
ROOT="$AUDIT_ROOT"
export DB=vortex_seg5_imp
W="$SCRATCH/seg5"; mkdir -p "$W"
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
# schema of <checkout> (post-fix adds columns/tables)
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js > "$W/migrate-$LABEL.txt" 2>&1 ) || { echo "[$LABEL] migrate failed"; cat "$W/migrate-$LABEL.txt"; exit 1; }

sql "select phone from leads where phone is not null and not dnc_flag and status in ('new','in_queue') order by md5(id::text || '$SEED')" > "$W/existing.txt"
sql "select phone from leads where phone is not null" > "$W/avoid.txt"
F="$W/leads-$ROWS.$FMT"; FC="$W/cancel-$ROWS.$FMT"
node "$ROOT/audit/scripts/gen-leads.js" --rows "$ROWS" --format "$FMT" --out "$F" --existing "$W/existing.txt" --avoid "$W/avoid.txt" --seed "$SEED" | sed "s/^/[$LABEL] gen: /"
psql -q -h localhost -U vortex -d "$DB" -f "$F.setup.sql" >/dev/null
# cancel-test file: other rows (other seed), no existing/DNC kinds needed
sql "select phone from leads where phone is not null" > "$W/avoid2.txt"; cat "$W/avoid.txt" "$F.phones.txt" >> "$W/avoid2.txt"
node "$ROOT/audit/scripts/gen-leads.js" --rows "$ROWS" --format "$FMT" --out "$FC" --avoid "$W/avoid2.txt" --seed "$((SEED + 1000))" --mix existing=0,dnc_lead=0 > /dev/null
psql -q -h localhost -U vortex -d "$DB" -f "$FC.setup.sql" >/dev/null

echo answered > "$SCRATCH/force-outcome"
stop_backend; pkill -f groq-stub-server 2>/dev/null; sleep 0.5
AIENV="IMPORT_AI=off GROQ_BASE_URL=http://127.0.0.1:9"
if [ "${STUB:-}" = 1 ]; then
  echo '{"clean":"echo","map":"fail"}' > "$SCRATCH/groq-stub-mode.json"
  ( exec setsid node "$ROOT/audit/stubs/groq-stub-server.js" > "$W/stub-$LABEL.txt" 2>&1 < /dev/null & )
  AIENV="GROQ_BASE_URL=http://127.0.0.1:4999"; sleep 0.5
fi
SLOG="$ROOT/audit/logs/server-seg5-$LABEL.txt"
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" $AIENV NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
PID=$(pgrep -f "node src/index.js" | head -1)
DB=$DB BACKEND_PID=$PID node "$ROOT/audit/scripts/fix-seg5-import.js" "$LABEL" "$F" "$FC"
echo "[$LABEL] invariants (I1-I9):"; psql -h localhost -U vortex -d "$DB" -f "$ROOT/audit/scripts/invariants.sql" 2>&1 | sed '/^$/d' | sed "s/^/[$LABEL]   /"
echo "[$LABEL] server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines$(grep -iE 'error|warn' "$SLOG" | sort | uniq -c | sort -rn | head -3 | sed 's/^/ | /' | tr '\n' ' ')"
rm -f "$SCRATCH/force-outcome"
stop_backend; pkill -f groq-stub-server 2>/dev/null
