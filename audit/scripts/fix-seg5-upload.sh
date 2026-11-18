#!/usr/bin/env bash
# Segment 5 A.6 (F-13): upload validation, size limit, job expiry.
# Fresh clone of vortex_seg3_tpl; backend from <checkout> with IMPORT_MAX_UPLOAD_MB=1
# (post-fix setting; base ignores it and keeps its 15 MB limit).
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg5-upload.sh <label> <checkout>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROOT="$AUDIT_ROOT"; W="$SCRATCH/seg5-up"; mkdir -p "$W"
export DB=vortex_seg5_up
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null 2>&1 )
p() { echo "[$LABEL] $*"; }
# jobs left behind before the server starts (DIRECT SQL)
sql "insert into import_jobs (user_id, filename, status, created_at) values (1,'old-pending.csv','pending', now() - interval '25 hours'), (1,'fresh-pending.csv','pending', now() - interval '1 hour'), (1,'cut-off.csv','processing', now() - interval '5 minutes')" >/dev/null
p "jobs before start: $(sql "select string_agg(filename||'='||status, ', ' order by id) from import_jobs")"
# files
cp "$ROOT/audit/fixtures/k_fake.pdf" "$W/fake.pdf"; cp "$ROOT/audit/fixtures/k_wrong_ext.txt" "$W/list.txt"
cp "$ROOT/audit/fixtures/a_clean.csv" "$W/renamed-csv.xlsx"; cp "$ROOT/audit/fixtures/i_multisheet.xlsx" "$W/renamed-xlsx.csv"
cp "$ROOT/audit/fixtures/a_clean.csv" "$W/ok.csv"; cp "$ROOT/audit/fixtures/i_multisheet.xlsx" "$W/ok.xlsx"
node -e "const fs=require('fs');let s='name,phone,state\n';for(let i=0;i<60000;i++)s+='Big Test '+i+',,TX\n';fs.writeFileSync('$W/big.csv',s);fs.writeFileSync('$W/huge.csv',s.repeat(15))"
TMPD="$(node -e "console.log(require('os').tmpdir())")/vortex-imports"; rm -rf "$TMPD"
stop_backend
SLOG="$ROOT/audit/logs/server-seg5-upload-$LABEL.txt"
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" IMPORT_AI=off GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_MAX_UPLOAD_MB=1 node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done; sleep 1
p "jobs after start:  $(sql "select string_agg(filename||'='||status, ', ' order by id) from import_jobs")"
p "cut-off job message: $(sql "select coalesce(error_message,'(none)') from import_jobs where filename='cut-off.csv'")"
login >/dev/null
for f in fake.pdf list.txt renamed-csv.xlsx renamed-xlsx.csv ok.csv ok.xlsx big.csv huge.csv; do
  r=$(curl -s -w ' [HTTP %{http_code}]' -H "authorization: Bearer $(cat "$SCRATCH/token")" -F "file=@$W/$f" "$API/api/imports/upload")
  p "upload $f ($(stat -c %s "$W/$f") bytes) -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") $(grep -oE '"error":"[^"]*"' <<<"$r" | head -1)"
done
p "temp upload files left behind: $(ls "$TMPD" 2>/dev/null | wc -l)"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines; startup lines: $(grep -iE 'cleanup|interrupted' "$SLOG" | tr '\n' ' ')"
stop_backend; sleep 0.5
p "shutdown line: $(grep -E 'received' "$SLOG")"
