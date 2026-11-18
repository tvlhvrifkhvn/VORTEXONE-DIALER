#!/usr/bin/env bash
# Segment 5 B.6 carry-overs from Segment 4.
#   callback     lead-page "Schedule callback" (POST /api/leads/:id/callback): time
#                validation like the disposition path, and a DNC lead
#   redial-race  Redial right as the lock expires: the Redial request and the
#                stale-lock sweep fired at the same moment, N times. Looks for a
#                lead left unlocked (in_queue) while the rep's new call is open.
# Fresh clone of vortex_seg3_tpl; mock forced to answered (stub); lock times
# backdated by DIRECT SQL (test shortcut).
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg5b-b6.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-callback redial-race}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg5b_b6
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
p() { echo "[$LABEL] $*"; }
stop_backend
SLOG="$ROOT/audit/logs/server-seg5b-b6-$LABEL.txt"
echo answered > "$SCRATCH/force-outcome"
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off STALE_LOCK_SWEEP=off NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
login rep2@example.com 'Rep2Pass!' tokU1 >/dev/null
login rep3@example.com 'Rep3Pass!' tokU2 >/dev/null   # fires the sweeps (own rate-limit budget)
code() { api "$1" "$2" "${3:-}" "${4:-tokU1}" > "$SCRATCH/b6-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/b6-last" | grep -oE '[0-9]+'; }
err() { grep -oE '"error":"[^"]*"' "$SCRATCH/b6-last" | head -1; }
NEXT=0
lead() { NEXT=$((NEXT+1)); L=$(sql "select id from leads where status in ('new','in_queue') and not missing_phone and state in ('CA','NY','TX','FL','IL') order by id offset $((NEXT*3)) limit 1"); }

for part in $PARTS; do case $part in
callback)
  p "== lead-page Schedule callback (POST /api/leads/:id/callback) =="
  for v in "next tuesday" "2020-01-01" "$(date -u -d '-30 seconds' +%Y-%m-%dT%H:%M:%SZ)" "$(date -u -d '+2 days' +%Y-%m-%dT%H:%M:%SZ)"; do
    lead; c=$(code POST /api/leads/$L/callback "{\"scheduledAt\":\"$v\"}")
    p "  \"$v\" -> $c $(err) | lead $(sql "select status||' next='||coalesce(to_char(next_action_at,'YYYY-MM-DD HH24:MI'),'-') from leads where id=$L"), open callbacks $(sql "select count(*) from callbacks where lead_id=$L and not done")"
  done
  lead; sql "update leads set status='dnc', dnc_flag=true where id=$L" >/dev/null   # DIRECT SQL: a DNC lead
  c=$(code POST /api/leads/$L/callback "{\"scheduledAt\":\"$(date -u -d '+2 days' +%Y-%m-%dT%H:%M:%SZ)\"}")
  p "  DNC lead $L, future time -> $c $(err) | lead $(sql "select status||' dnc_flag='||dnc_flag from leads where id=$L")" ;;
redial-race)
  N=${RACE_TRIES:-40}
  p "== Redial vs the stale-lock sweep, $N tries (lock backdated 31 s: expired, not yet swept; timer sweep off, sweeps fired by GET /api/leads) =="
  bad=0; ok=0; released=0; codes=''
  for i in $(seq 1 $N); do
    lead
    C=$(api POST /api/calls "{\"leadId\":$L}" tokU1 | sed -E 's/ \[HTTP.*//' | jget call.id 2>/dev/null)
    [ -z "$C" ] && continue
    code POST /api/calls/$C/hangup >/dev/null
    sql "update leads set locked_at = now() - interval '31 seconds' where id=$L" >/dev/null
    # fire Redial and three sweeps together
    ( api POST /api/calls "{\"leadId\":$L,\"redial\":true}" tokU1 > "$SCRATCH/b6-redial" ) &
    for k in 1 2 3; do ( api GET "/api/leads?limit=1" "" tokU2 > /dev/null ) & done
    wait
    rc=$(grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/b6-redial" | grep -oE '[0-9]+')
    codes="$codes $rc"
    st=$(sql "select status||'|'||coalesce(locked_by::text,'-') from leads where id=$L")
    open=$(sql "select count(*) from call_history where lead_id=$L and ended_at is null and disposition is null")
    if [ "$rc" = 201 ] && [ "${st%%|*}" != in_progress ]; then bad=$((bad+1)); p "  try $i lead $L: Redial 201 but lead is $st with $open open call(s)  <-- lock lost"; fi
    [ "$rc" = 201 ] && [ "${st%%|*}" = in_progress ] && ok=$((ok+1))
    [ "$rc" != 201 ] && released=$((released+1))
    for x in $(sql "select id from call_history where lead_id=$L and disposition is null"); do code POST /api/dispositions "{\"callId\":$x,\"disposition\":\"contacted\"}" >/dev/null; done
    sleep 3.5   # stay under the per-user API limit
  done
  p "  Redial status codes: $(tr ' ' '\n' <<<"$codes" | grep . | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  p "  result: Redial 201 with the lead still locked to the rep: $ok; Redial not 201: $released; Redial 201 but the lead was left unlocked: $bad" ;;
esac; done
rm -f "$SCRATCH/force-outcome"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines"
stop_backend
