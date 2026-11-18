#!/usr/bin/env bash
# F-27 repro (Segment 2): multi-line refills must dial different leads.
# Fresh DB per run (clone of vortex_seg2_tpl). Mock outcome forced through
# audit/stubs/force-outcome.js (labelled stub).
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg2-f27.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL="${1:-run}"
export DB=vortex_seg2_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg2_tpl" >/dev/null 2>&1
stop_backend
LOG="$AUDIT_ROOT/audit/logs/server-seg2-f27-$LABEL.txt"
( cd "$AUDIT_ROOT/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $AUDIT_ROOT/audit/stubs/force-outcome.js" node src/index.js > "$LOG" 2>&1 < /dev/null & )
for i in $(seq 1 40); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
login >/dev/null; login rep2@example.com 'Rep2Pass!' token2 >/dev/null
SSE="$AUDIT_ROOT/audit/scripts/sse-session.js"
dupsql="select coalesce(string_agg(session_id||':lead '||lead_id||' x'||n, ', '),'none') from (select session_id, lead_id, date_trunc('second', started_at) s, count(*) n from call_history where session_id is not null and id > \$M group by 1,2,3 having count(*) > 1) t"

echo no_answer > "$SCRATCH/force-outcome"
M=$(sql "select coalesce(max(id),0) from call_history")
echo "[$LABEL] (a) one user, 3 lines, forced no_answer, 15 s"
node "$SSE" "$SCRATCH/token" 3 15 '[{"at":14,"do":"stop"}]' > "$SCRATCH/f27a-$LABEL.txt"
echo "[$LABEL]   $(grep SUMMARY "$SCRATCH/f27a-$LABEL.txt")"
echo "[$LABEL]   calls: $(sql "select count(*) from call_history where id > $M") on $(sql "select count(distinct lead_id) from call_history where id > $M") distinct leads"
echo "[$LABEL]   same lead dialed twice in the same second within one session: $(sql "${dupsql//\$M/$M}")"
echo "[$LABEL]   sample (first 6 calls): $(sql "select string_agg(id||':slot'||slot_number||':lead'||lead_id||'@'||to_char(started_at,'SS.MS'), '  ' order by id) from (select * from call_history where id > $M order by id limit 6) t")"

M=$(sql "select max(id) from call_history")
echo "[$LABEL] (b) two users, two sessions at once, 3 lines each, forced no_answer, 15 s"
( node "$SSE" "$SCRATCH/token" 3 15 '[{"at":14,"do":"stop"}]' > "$SCRATCH/f27b1-$LABEL.txt" ) &
( node "$SSE" "$SCRATCH/token2" 3 15 '[{"at":14,"do":"stop"}]' > "$SCRATCH/f27b2-$LABEL.txt" ) & wait
echo "[$LABEL]   calls: $(sql "select count(*) from call_history where id > $M") on $(sql "select count(distinct lead_id) from call_history where id > $M") leads; sessions: $(sql "select string_agg(distinct session_id::text, ',') from call_history where id > $M")"
echo "[$LABEL]   same lead in BOTH sessions with overlapping calls (started < 6 s apart): $(sql "select coalesce(string_agg(distinct a.lead_id::text, ', '),'none') from call_history a join call_history b on a.lead_id=b.lead_id and a.id<b.id and a.session_id<>b.session_id where a.id > $M and b.id > $M and abs(extract(epoch from b.started_at-a.started_at)) < 6")"
echo "[$LABEL]   same-second duplicates within a session: $(sql "${dupsql//\$M/$M}")"

echo answered > "$SCRATCH/force-outcome"
sql "update leads set status='in_queue', locked_by=null, locked_at=null where status='in_progress'" >/dev/null
echo "[$LABEL] (c) audit §5.2: 3 lines all answered -> held; dispose+release active -> promoted; stop"
node "$SSE" "$SCRATCH/token" 3 12 '[{"at":6,"do":"dispose","slot":"active","disposition":"contacted"},{"at":7,"do":"forceOutcome","value":"no_answer"},{"at":7.5,"do":"release","slot":"active"},{"at":11,"do":"stop"}]' > "$SCRATCH/f27c-$LABEL.txt"
grep -E "answered|held|promoted|POST /api/calls/multiline/release" "$SCRATCH/f27c-$LABEL.txt" | sed -E 's/ lead=[0-9]+ call=[0-9]+//' | sed "s/^/[$LABEL]   /"

echo no_answer > "$SCRATCH/force-outcome"
sql "update leads set status='in_queue', locked_by=null, locked_at=null where status='in_progress'" >/dev/null
echo "[$LABEL] (d) selected-leads session with 5 chosen ids: 1 soft-deleted (API DELETE), 1 DNC-listed (direct SQL), 3 normal"
IDS=$(sql "select string_agg(id::text, ',' order by id) from (select id from leads where status='new' and not missing_phone and name like 'Bulk Agent 3%' order by id limit 5) t")
DEL=$(cut -d, -f2 <<<"$IDS"); DNCL=$(cut -d, -f4 <<<"$IDS")
api DELETE "/api/leads/$DEL" >/dev/null
sql "insert into dnc_list (phone, source) select phone, 'manual' from leads where id=$DNCL on conflict do nothing" >/dev/null
echo "[$LABEL]   ids=[$IDS] deleted=$DEL dnc_listed=$DNCL"
M=$(sql "select max(id) from call_history")
cat > "$SCRATCH/f27d.js" <<EOF
const fs=require('fs');const t=fs.readFileSync('$SCRATCH/token','utf8').trim();const H={authorization:'Bearer '+t,'content-type':'application/json'};
(async()=>{const s=await (await fetch('$API/api/sessions/start',{method:'POST',headers:H,body:JSON.stringify({mode:'multiline'})})).json();
const r=await fetch('$API/api/calls/multiline/start',{method:'POST',headers:H,body:JSON.stringify({sessionId:s.sessionId,lineCount:3,leadIds:[$IDS]})});
console.log('multiline/start ->',r.status,(await r.text()).replace(/"leadName":"[^"]*",?/g,'').slice(0,220));
await new Promise(r=>setTimeout(r,9000));
const st=await fetch('$API/api/calls/multiline/stop',{method:'POST',headers:H,body:'{}'});console.log('multiline/stop ->',st.status,await st.text());})();
EOF
node "$SCRATCH/f27d.js" | sed "s/^/[$LABEL]   /"
echo "[$LABEL]   calls per chosen lead: $(sql "select string_agg(l.id||'='||(select count(*) from call_history c where c.lead_id=l.id and c.id > $M), ' ' order by l.id) from leads l where l.id in ($IDS)")"
echo "[$LABEL]   status of chosen leads: $(sql "select string_agg(id||':'||status||case when deleted_at is not null then '(deleted)' else '' end, ' ' order by id) from leads where id in ($IDS)")"
echo "[$LABEL]   leads left in_progress after stop: $(sql "select count(*) from leads where status='in_progress'")"
rm -f "$SCRATCH/force-outcome"
echo "[$LABEL] server log errors: $(grep -ciE 'error' "$LOG")  lines: $(grep -iE 'error|failed' "$LOG" | sed -E 's/[0-9]+/N/g' | sort | uniq -c | head -4 | tr '\n' ';')"
stop_backend
