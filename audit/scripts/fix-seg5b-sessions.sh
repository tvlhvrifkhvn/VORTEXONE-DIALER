#!/usr/bin/env bash
# Segment 5 B.3 (F-28) + B.4 (F-29): multi-line sessions when the browser goes
# away, on Stop, and across a server restart. Fresh clone of vortex_seg3_tpl;
# mock outcome forced (stub). Uses audit/scripts/sse-session.js.
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg5b-sessions.sh <label> <checkout> [parts]
#   parts: disconnect reconnect disconnect-live stop restart (default: all)
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-disconnect reconnect disconnect-live stop restart}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg5b_sess
SSE="$ROOT/audit/scripts/sse-session.js"
p() { echo "[$LABEL] $*"; }
SLOG="$ROOT/audit/logs/server-seg5b-sessions-$LABEL.txt"; : > "$SLOG"
start_be() {
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js >> "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 60); do curl -s "$API/health" >/dev/null 2>&1 && return 0; sleep 0.1; done
}
fresh() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  start_be
  login >/dev/null
}
since() { sql "select count(*) from call_history where started_at > to_timestamp($1)"; }
state() { sql "select 'open calls='||(select count(*) from call_history where ended_at is null and disposition is null)||' answered/held open='||(select count(*) from call_history where ended_at is null and disposition is null and telephony_state='answered')||' abandoned='||(select count(*) from call_history where was_abandoned)||' leads in_progress='||(select count(*) from leads where status='in_progress')||' open sessions='||(select count(*) from dialing_sessions where ended_at is null)"; }

for part in $PARTS; do case $part in
disconnect)
  fresh; echo no_answer > "$SCRATCH/force-outcome"
  p "== F-28 browser goes away: SSE closed at 4 s, never reopened; 30 s =="
  T0=$(date +%s.%N)
  node "$SSE" "$SCRATCH/token" 3 30 '[{"at":4,"do":"closeSSE"}]' > "$SCRATCH/seg5b-disc-$LABEL.txt" 2>&1
  p "  calls placed: 0-4 s: $(sql "select count(*) from call_history where started_at <= to_timestamp($T0 + 4)"); 4-15 s: $(sql "select count(*) from call_history where started_at > to_timestamp($T0 + 4) and started_at <= to_timestamp($T0 + 15)"); 15-30 s: $(sql "select count(*) from call_history where started_at > to_timestamp($T0 + 15)")"
  sleep 5; p "  5 s after the script ended: new calls $(since $(date -d '-5 sec' +%s)); $(state)"
  p "  server log: $(grep -E 'disconnect|stopped' "$SLOG" | tail -1)" ;;
reconnect)
  fresh; echo no_answer > "$SCRATCH/force-outcome"
  p "== F-28 reconnect within the grace period: SSE closed at 4 s, reopened at 9 s; 30 s =="
  T0=$(date +%s.%N)
  node "$SSE" "$SCRATCH/token" 3 30 '[{"at":4,"do":"closeSSE"},{"at":9,"do":"openSSE"},{"at":29,"do":"stop"}]' > "$SCRATCH/seg5b-reconn-$LABEL.txt" 2>&1
  p "  calls placed: 0-15 s: $(sql "select count(*) from call_history where started_at <= to_timestamp($T0 + 15)"); 15-29 s: $(sql "select count(*) from call_history where started_at > to_timestamp($T0 + 15) and started_at <= to_timestamp($T0 + 29)") (dialing kept going)" ;;
disconnect-live)
  fresh; echo answered > "$SCRATCH/force-outcome"
  p "== F-28/F-29 browser goes away with live calls: 3 lines answered (1 active + 2 held), SSE closed at 6 s; 25 s =="
  node "$SSE" "$SCRATCH/token" 3 25 '[{"at":6,"do":"closeSSE"}]' > "$SCRATCH/seg5b-disclive-$LABEL.txt" 2>&1
  p "  $(grep -oE 'slot [0-9] (answered|held)' "$SCRATCH/seg5b-disclive-$LABEL.txt" | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  p "  after: $(state)"
  p "  calls: $(sql "select string_agg(id||':'||telephony_state||' ended='||(ended_at is not null)||' abandoned='||was_abandoned, ', ' order by id) from call_history")" ;;
stop)
  fresh; echo answered > "$SCRATCH/force-outcome"
  p "== F-29 audit §5.2: 3 lines answered -> 1 active + 2 held; manual Stop at 6 s, then /api/sessions/end =="
  node "$SSE" "$SCRATCH/token" 3 9 '[{"at":6,"do":"stop"}]' > "$SCRATCH/seg5b-stop-$LABEL.txt" 2>&1
  SID=$(grep -oE 'SESSION_ID=[0-9]+' "$SCRATCH/seg5b-stop-$LABEL.txt" | cut -d= -f2)
  p "  stop -> $(grep -oE 'multiline/stop \{\} -> .*' "$SCRATCH/seg5b-stop-$LABEL.txt" | cut -c1-150)"
  p "  sessions/end -> $(api POST /api/sessions/end "{\"sessionId\":$SID}" | grep -oE '\[HTTP [0-9]+\]')"
  p "  calls: $(sql "select string_agg(id||':'||telephony_state||' ended='||(ended_at is not null)||' abandoned='||was_abandoned, ', ' order by id) from call_history")"
  ACTIVE=$(sql "select id from call_history where ended_at is null and disposition is null order by id limit 1")
  p "  after stop: $(state)"
  if [ -n "$ACTIVE" ]; then
    c=$(api POST /api/dispositions "{\"callId\":$ACTIVE,\"disposition\":\"contacted\"}" | grep -oE '\[HTTP [0-9]+\]')
    p "  rep finishes the active call $ACTIVE: disposition -> $c; then: $(state)"
  fi
  p "  I6 leads with >1 open call: $(sql "select count(*) from (select lead_id from call_history where ended_at is null and disposition is null and lead_id is not null group by 1 having count(*)>1) t")" ;;
restart)
  fresh; echo answered > "$SCRATCH/force-outcome"
  p "== F-29 audit §5.5: 3 lines answered, server killed (SIGKILL) at 6 s, restarted =="
  ( node "$SSE" "$SCRATCH/token" 3 7 '[]' > "$SCRATCH/seg5b-restart-$LABEL.txt" 2>&1 & )
  sleep 6.5
  pkill -9 -f "node src/index.js"; sleep 1
  p "  after the kill: $(state)"
  T=$(date +%s.%N); start_be
  sleep 2; p "  2 s after restart: $(state)"
  p "  server log: $(grep -E 'restart|Closed|recover' "$SLOG" | tail -2 | tr '\n' ' ')" ;;
esac; done
rm -f "$SCRATCH/force-outcome"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines"
stop_backend
