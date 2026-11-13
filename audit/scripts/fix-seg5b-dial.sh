#!/usr/bin/env bash
# Segment 5 B.1 (F-30): a failed dial must leave no trace.
# Backend from <checkout> with TELEPHONY_PROVIDER=<provider> (twilio = the
# phase-2 stub, which throws; or a bogus name). Fresh clone of vortex_seg3_tpl.
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg5b-dial.sh <label> <checkout> <provider>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; PROV=$3; ROOT="$AUDIT_ROOT"
export DB=vortex_seg5b_dial
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null 2>&1 )
p() { echo "[$LABEL] $*"; }
stop_backend
SLOG="$ROOT/audit/logs/server-seg5b-dial-$LABEL.txt"
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" TELEPHONY_PROVIDER="$PROV" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -s "$API/health" >/dev/null || { echo "[$LABEL] ABORT: backend/DB not up: $(tail -3 "$SLOG")"; exit 1; }
login rep2@example.com 'Rep2Pass!' tokU1 >/dev/null
lead=$(sql "select id from leads where status='in_queue' and not missing_phone and state in ('TX','NY','FL','IL','CA') order by id limit 1")
snap() { sql "select status||' attempts='||attempts||' locked_by='||coalesce(locked_by::text,'-') from leads where id=$1"; }
p "TELEPHONY_PROVIDER=$PROV"
p "single-line: lead $lead before: $(snap $lead); call rows: $(sql "select count(*) from call_history where lead_id=$lead")"
r=$(api POST /api/calls "{\"leadId\":$lead}" tokU1)
p "  POST /api/calls {leadId:$lead} -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") $(grep -oE '"error":"[^"]*"' <<<"$r")"
p "  lead after: $(snap $lead); call rows: $(sql "select coalesce(string_agg(telephony_state||' ended='||(ended_at is not null), ', '),'none') from call_history where lead_id=$lead")"
sleep 1; r=$(api POST /api/calls "{\"leadId\":$lead}" tokU1)
p "  same lead again -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") (a burned lock would give 409); lead: $(snap $lead)"
nl=$(sql "select id from leads where status='new' and not missing_phone and state in ('TX','NY','FL','IL','CA') order by id limit 1")
r=$(api POST /api/calls '{}' tokU1)
p "  POST /api/calls {} (next in queue) -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") $(grep -oE '"error":"[^"]*"' <<<"$r"); in_progress leads now: $(sql "select count(*) from leads where status='in_progress'"); ringing rows: $(sql "select count(*) from call_history where telephony_state='ringing'")"
r=$(api POST /api/calls/manual/start '{"toNumber":"(312) 555-0142"}' tokU1)
p "manual dial pad -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") $(grep -oE '"error":"[^"]*"' <<<"$r"); manual rows: $(sql "select coalesce(string_agg(telephony_state||' ended='||(ended_at is not null), ', '),'none') from call_history where lead_id is null")"
att0=$(sql "select sum(attempts) from leads")
node "$ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokU1" 3 12 '[{"at":11,"do":"stop"}]' > "$SCRATCH/seg5b-dial-ml-$LABEL.txt" 2>&1
p "multi-line, 3 lines, 12 s: $(grep -E 'SUMMARY' "$SCRATCH/seg5b-dial-ml-$LABEL.txt" | cut -c1-200)"
p "  start: $(grep -m1 'multiline/start' "$SCRATCH/seg5b-dial-ml-$LABEL.txt" | sed -E 's/^ *[0-9.]+s POST [^ ]+ [^ ]+ //' | cut -c1-160)"
p "  line messages: $(grep -oE 'msg=.*' "$SCRATCH/seg5b-dial-ml-$LABEL.txt" | sort | uniq -c | head -3 | tr -s ' ' | tr '\n' ';')"
p "  after: call rows by state: $(sql "select coalesce(string_agg(telephony_state||'='||n, ', '),'none') from (select telephony_state, count(*) n from call_history where lead_id is not null group by 1) t"); leads in_progress: $(sql "select count(*) from leads where status='in_progress'"); attempts burned: $(( $(sql "select sum(attempts) from leads") - att0 ))"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines; first: $(grep -iE 'error' "$SLOG" | head -1 | cut -c1-120)"
stop_backend
