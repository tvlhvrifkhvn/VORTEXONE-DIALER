#!/usr/bin/env bash
# Redial path after the Segment 2 change: re-dialing a lead already locked to
# this user works ONLY with {redial:true}; a plain repeat request is a 409.
# Usage: AUDIT_PASSWORD=<seed pw> DB=<db> bash audit/scripts/fix-seg2-redial.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL="${1:-run}"; export DB=${DB:-vortex_seg2_run}
login >/dev/null; login rep2@example.com 'Rep2Pass!' token2 >/dev/null
X=$(sql "select id from leads where status='new' and not missing_phone and name like 'Bulk Agent 6%' order by id limit 1")
st() { grep -oE '\[HTTP [0-9]+\]' <<<"$1"; }
echo "[$LABEL] lead $X: first dial -> $(st "$(api POST /api/calls "{\"leadId\":$X}")")  attempts=$(sql "select attempts from leads where id=$X")"
sleep 4
r=$(api POST /api/calls "{\"leadId\":$X}"); echo "[$LABEL]   same user, plain repeat {leadId}            -> $(st "$r") $(sed 's/ \[HTTP.*//' <<<"$r" | jget error)"
r=$(api POST /api/calls "{\"leadId\":$X,\"redial\":true}"); echo "[$LABEL]   same user, Redial button {leadId,redial:true} -> $(st "$r")  attempts=$(sql "select attempts from leads where id=$X")"
r=$(api POST /api/calls "{\"leadId\":$X,\"redial\":true}" token2); echo "[$LABEL]   OTHER user with redial:true                 -> $(st "$r") $(sed 's/ \[HTTP.*//' <<<"$r" | jget error)"
echo "[$LABEL]   calls on lead $X: $(sql "select count(*) from call_history where lead_id=$X")"
