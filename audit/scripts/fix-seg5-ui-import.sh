#!/usr/bin/env bash
# Driver for fix-seg5-ui-import.js: production build (vite build + preview), backend
# from <checkout> with AI off, fresh clone of vortex_seg3_tpl, a generated CSV.
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg5-ui-import.sh <label> <checkout> [rows]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROWS=${3:-300}; ROOT="$AUDIT_ROOT"; W="$SCRATCH/seg5-ui"; mkdir -p "$W"
export DB=vortex_seg5_ui
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null 2>&1 )
sql "select phone from leads where phone is not null and not dnc_flag and status in ('new','in_queue') order by id" > "$W/existing.txt"
sql "select phone from leads where phone is not null" > "$W/avoid.txt"
node "$ROOT/audit/scripts/gen-leads.js" --rows "$ROWS" --format csv --out "$W/ui-leads.csv" --existing "$W/existing.txt" --avoid "$W/avoid.txt" --seed 21 | sed "s/^/[$LABEL] gen: /" | cut -c1-200
psql -q -h localhost -U vortex -d "$DB" -f "$W/ui-leads.csv.setup.sql" >/dev/null
stop_backend; pkill -f "vite preview"; sleep 0.5
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" IMPORT_AI=off GROQ_BASE_URL=http://127.0.0.1:9 node src/index.js > "$W/be-$LABEL.txt" 2>&1 < /dev/null & )
( cd "$CO/frontend" && npx vite build > "$W/build-$LABEL.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$W/fe-$LABEL.txt" 2>&1 < /dev/null & )
for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg5-ui-import.js" http://localhost:5173 "$W/ui-leads.csv" "$W/shots-$LABEL" 2>&1 | sed "s/^/[$LABEL] /"
echo "[$LABEL] expected buckets: $(node -e "const e=require('$W/ui-leads.csv.expected.json');console.log(JSON.stringify({total:e.totalRows,imported:e.imported,noNumber:e.noNumber,merged:e.merged,alreadyInList:e.alreadyInList,dncBlocked:e.dncBlocked,invalid:e.invalid}))")"
echo "[$LABEL] backend log error/warn lines: $(grep -ciE 'error|warn' "$W/be-$LABEL.txt")"
stop_backend; pkill -f "vite preview"
