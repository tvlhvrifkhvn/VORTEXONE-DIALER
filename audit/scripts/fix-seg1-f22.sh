#!/usr/bin/env bash
# F-22 repro: a soft-deleted lead must not be dialable by id or served by the queue.
# Usage: AUDIT_PASSWORD=<seed password> bash audit/scripts/fix-seg1-f22.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
export DB=${DB:-vortex_seg1}
LABEL="${1:-run}"; R=$RANDOM
login >/dev/null
ph() { printf '+1972555%04d' $(( (R + $1) % 10000 )); }
X=$(api POST /api/leads "{\"name\":\"Seg1 Deleted $R\",\"phone\":\"$(ph 1)\",\"state\":\"TX\"}" | sed 's/ \[HTTP.*//' | jget lead.id)
echo "[$LABEL] lead X=$X created; DELETE /api/leads/$X -> $(api DELETE /api/leads/$X | grep -oE '\[HTTP [0-9]+\]')  deleted_at set=$(sql "select deleted_at is not null from leads where id=$X")"
r=$(api POST /api/calls "{\"leadId\":$X}"); echo "[$LABEL]   dial deleted lead by id -> $(grep -oE '\[HTTP [0-9]+\]' <<<"$r") $(sed 's/ \[HTTP.*//' <<<"$r" | jget error)"
sql "update leads set status='callback_scheduled', next_action_at=now()-interval '2 days', locked_by=null, locked_at=null where id=$X" >/dev/null
echo "[$LABEL]   deleted lead made the top queue candidate by DIRECT SQL; POST /api/calls {} served lead=$(api POST /api/calls '{}' | sed 's/ \[HTTP.*//' | jget lead.id) (X=$X)"
Y=$(api POST /api/leads "{\"name\":\"Seg1 Live $R\",\"phone\":\"$(ph 2)\",\"state\":\"TX\"}" | sed 's/ \[HTTP.*//' | jget lead.id)
echo "[$LABEL] control: non-deleted lead Y=$Y dial by id -> $(api POST /api/calls "{\"leadId\":$Y}" | grep -oE '\[HTTP [0-9]+\]')"
