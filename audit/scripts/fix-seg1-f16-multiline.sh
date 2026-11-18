#!/usr/bin/env bash
# F-16 regression for multi-line: a lead whose number is on dnc_list (dnc_flag
# false, set up by DIRECT SQL) must never be dialed by a multi-line session —
# neither when it is the top queue candidate nor when it is in a selected list.
# Usage: AUDIT_PASSWORD=<seed password> bash audit/scripts/fix-seg1-f16-multiline.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
export DB=${DB:-vortex_seg1}
LABEL="${1:-run}"; R=$RANDOM
login >/dev/null
echo no_answer > "$SCRATCH/force-outcome"
mkdnc() {  # create lead via API, then put its number on dnc_list via direct SQL
  local ph="+1469555$(printf '%04d' $(( (R + $1) % 10000 )))"
  local id=$(api POST /api/leads "{\"name\":\"Seg1 ML $1 $R\",\"phone\":\"$ph\",\"state\":\"TX\"}" | sed 's/ \[HTTP.*//' | jget lead.id)
  sql "insert into dnc_list (phone, source) values ('$ph','manual') on conflict do nothing" >/dev/null
  echo "$id"
}
Q=$(mkdnc 1); sql "update leads set status='callback_scheduled', next_action_at=now()-interval '1 day' where id=$Q" >/dev/null
echo "[$LABEL] queue mode: lead $Q (dnc_list only) is the top candidate"
m=$(sql "select coalesce(max(id),0) from call_history")
node "$AUDIT_ROOT/audit/scripts/sse-session.js" "$SCRATCH/token" 2 5 '[{"at":4,"do":"stop"}]' > "$SCRATCH/ml1.txt"
echo "[$LABEL]   calls placed to lead $Q: $(sql "select count(*) from call_history where lead_id=$Q and id > $m")   lead $Q now: $(sql "select status||' dnc_flag='||dnc_flag from leads where id=$Q")   other calls placed: $(sql "select count(*) from call_history where id > $m and lead_id <> $Q")"
S=$(mkdnc 2); OK=$(api POST /api/leads "{\"name\":\"Seg1 ML ok $R\",\"phone\":\"+1469556$(printf '%04d' $((R % 10000)))\",\"state\":\"TX\"}" | sed 's/ \[HTTP.*//' | jget lead.id)
echo "[$LABEL] selected-leads mode: leadIds=[$S (dnc_list only), $OK (clean)]"
m=$(sql "select coalesce(max(id),0) from call_history")
cat > "$SCRATCH/ml2.js" <<EOF
const fs=require('fs');const t=fs.readFileSync('$SCRATCH/token','utf8').trim();
(async()=>{const H={authorization:'Bearer '+t,'content-type':'application/json'};
const r=await fetch('$API/api/calls/multiline/start',{method:'POST',headers:H,body:JSON.stringify({lineCount:2,leadIds:[$S,$OK]})});
console.log('multiline/start ->',r.status,(await r.text()).slice(0,200));
await new Promise(r=>setTimeout(r,4000));
await fetch('$API/api/calls/multiline/stop',{method:'POST',headers:H,body:'{}'});})();
EOF
node "$SCRATCH/ml2.js" | sed "s/^/[$LABEL]   /"
echo "[$LABEL]   calls placed to lead $S: $(sql "select count(*) from call_history where lead_id=$S and id > $m")   lead $S now: $(sql "select status||' dnc_flag='||dnc_flag from leads where id=$S")   calls to clean lead $OK: $(sql "select count(*) from call_history where lead_id=$OK and id > $m")"
rm -f "$SCRATCH/force-outcome"
