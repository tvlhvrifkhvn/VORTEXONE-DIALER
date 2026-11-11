#!/usr/bin/env bash
# F-14 repro (Segment 2). Each run starts from an identical fresh DB cloned from
# the template vortex_seg2_tpl (seeded user + rep2 + 5,019 dialable leads), so
# runs are comparable and the "open call" SQL is not polluted by earlier runs.
# Every parallel request records its real HTTP status (curl -w, one file each).
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg2-f14.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL="${1:-run}"
export DB=vortex_seg2_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg2_tpl" >/dev/null
stop_backend
LOG="$AUDIT_ROOT/audit/logs/server-seg2-f14-$LABEL.txt"
( cd "$AUDIT_ROOT/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/index.js > "$LOG" 2>&1 < /dev/null & )
for i in $(seq 1 40); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
login >/dev/null; login rep2@example.com 'Rep2Pass!' token2 >/dev/null
T1=$(cat "$SCRATCH/token"); T2=$(cat "$SCRATCH/token2")
OUT="$SCRATCH/f14-$LABEL"; rm -rf "$OUT"; mkdir -p "$OUT"

# fire N parallel POST /api/calls with a body; each writes "<status> <body>" to its own file
burst() {  # burst <name> <n> <token> <json>
  local name=$1 n=$2 tok=$3 body=$4
  for i in $(seq 1 "$n"); do
    ( curl -s -o "$OUT/$name-$i.body" -w '%{http_code}' -X POST "$API/api/calls" \
        -H "authorization: Bearer $tok" -H 'content-type: application/json' -d "$body" > "$OUT/$name-$i.code" ) &
  done
  wait
}
codes() { for f in "$OUT"/$1-*.code; do cat "$f"; echo; done | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}'; }
leads() { for f in "$OUT"/$1-*.body; do node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.lead?j.lead.id:"-")}catch{console.log("-")}' "$f"; done; }

echo "[$LABEL] (d) sequential order: first 10 leads served by 10 sequential POST /api/calls {} on fresh data"
sql "update leads set status='callback_scheduled', next_action_at=now()-interval '1 hour' where id = (select id from leads where name='Bulk Agent 777')" >/dev/null
ORDER=""; for i in $(seq 1 10); do ORDER="$ORDER $(api POST /api/calls '{}' | sed 's/ \[HTTP.*//' | jget lead.name | sed 's/Bulk Agent /BA/;s/ /_/g')"; done
echo "[$LABEL]   order:$ORDER   (Bulk Agent 777 was made a due callback, so it must be first)"
C=$(sql "select id from call_history order by id desc limit 1")
echo "[$LABEL]   dial→disposition→dial: dispose call $C no_answer -> $(api POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_answer\"}" | grep -oE '\[HTTP [0-9]+\]'); next dial -> $(api POST /api/calls '{}' | grep -oE '\[HTTP [0-9]+\]')"
# close every call (d) opened through the real disposition API (no_answer = +4h), so
# the global "more than one open call" check in (a) only sees calls from (a) itself
for c in $(sql "select id from call_history where disposition is null order by id"); do api POST /api/dispositions "{\"callId\":$c,\"disposition\":\"no_answer\"}" >/dev/null; done
echo "[$LABEL]   calls from (d) left open after dispositioning them: $(sql "select count(*) from call_history where disposition is null")"
M0=$(sql "select coalesce(max(id),0) from call_history")

echo "[$LABEL] (a) 20 parallel POST /api/calls {} — one user"
burst a 20 "$T1" '{}'
echo "[$LABEL]   statuses: $(codes a)"
echo "[$LABEL]   calls created: $(sql "select count(*) from call_history where id > $M0")   distinct leads: $(sql "select count(distinct lead_id) from call_history where id > $M0")   responses' distinct lead ids: $(leads a | grep -v '^-$' | sort -u | wc -l)"
echo "[$LABEL]   leads with >1 open call (ended_at IS NULL): $(sql "select coalesce(string_agg(lead_id||' x'||n, ', '),'none') from (select lead_id, count(*) n from call_history where ended_at is null and lead_id is not null group by 1 having count(*) > 1) t")"
echo "[$LABEL]   attempts > max_attempts (I7): $(sql "select count(*) from leads where attempts > max_attempts")"
M1=$(sql "select max(id) from call_history")

X=$(sql "select id from leads where status='new' and not missing_phone and name like 'Bulk Agent 4%' order by id limit 1")
A0=$(sql "select attempts from leads where id=$X")
echo "[$LABEL] (b) 10 parallel POST /api/calls {leadId:$X} — one user, one lead (attempts before=$A0)"
burst b 10 "$T1" "{\"leadId\":$X}"
echo "[$LABEL]   statuses: $(codes b)  calls on lead $X: $(sql "select count(*) from call_history where lead_id=$X and id > $M1")  attempts after=$(sql "select attempts from leads where id=$X") (delta $(( $(sql "select attempts from leads where id=$X") - A0 )))"
echo "[$LABEL]   409 messages: $(cat "$OUT"/b-*.body | grep -oE '"error":"[^"]*"' | sort | uniq -c | tr '\n' ' ')"
M2=$(sql "select max(id) from call_history")

echo "[$LABEL] (c) two users, 10 parallel next-lead requests each, at the same time"
( burst c1 10 "$T1" '{}' ) & ( burst c2 10 "$T2" '{}' ) & wait
echo "[$LABEL]   user1 statuses: $(codes c1)  user2 statuses: $(codes c2)"
echo "[$LABEL]   leads served to BOTH users: $(sql "select coalesce(string_agg(lead_id::text, ', '),'none') from (select lead_id from call_history where id > $M2 group by 1 having count(distinct user_id) > 1) t")   calls: $(sql "select count(*) from call_history where id > $M2") on $(sql "select count(distinct lead_id) from call_history where id > $M2") leads"

echo "[$LABEL] (e) invariants after the run"
echo "[$LABEL]   I7 attempts > max_attempts: $(sql "select count(*) from leads where attempts > max_attempts")   I2 in_progress leads without an open call: $(sql "select count(*) from leads l where status='in_progress' and not exists (select 1 from call_history c where c.lead_id=l.id and c.disposition is null)")   leads with >1 open call: $(sql "select count(*) from (select lead_id from call_history where ended_at is null and lead_id is not null group by 1 having count(*)>1) t")"
echo "[$LABEL]   server log: 500-class errors=$(grep -ciE 'error' "$LOG")  (lines: $(grep -iE 'error' "$LOG" | sort | uniq -c | head -3 | tr '\n' ';'))"
stop_backend
