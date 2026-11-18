#!/usr/bin/env bash
# F-52 repro: PUT /api/leads/:id must apply the same validation as POST /api/leads.
# Usage: AUDIT_PASSWORD=<seed password> bash audit/scripts/fix-seg1-f52.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
export DB=${DB:-vortex_seg1}
LABEL="${1:-run}"; R=$RANDOM
login >/dev/null
LONG=$(head -c 10000 /dev/zero | tr '\0' 'L')
show() { local r="$1"; local e; e=$(sed 's/ \[HTTP.*//' <<<"$r" | jget error 2>/dev/null); echo "$(grep -oE '\[HTTP [0-9]+\]' <<<"$r") ${e:0:90}"; }
ph() { printf '+1817555%04d' $(( (R + $1) % 10000 )); }
X=$(api POST /api/leads "{\"name\":\"Seg1 Edit $R\",\"phone\":\"$(ph 1)\",\"state\":\"TX\"}" | sed 's/ \[HTTP.*//' | jget lead.id)
echo "[$LABEL] lead X=$X"
echo "[$LABEL] PUT state \"ZZ\"            -> $(show "$(api PUT /api/leads/$X '{"state":"ZZ"}')")  stored state=$(sql "select state from leads where id=$X")"
sql "update leads set state='TX' where id=$X" >/dev/null   # reset if the bad value was stored
echo "[$LABEL] PUT name null             -> $(show "$(api PUT /api/leads/$X '{"name":null}')")"
echo "[$LABEL] PUT name 10,000 chars     -> $(show "$(api PUT /api/leads/$X "{\"name\":\"$LONG\"}")")  stored length=$(sql "select length(name) from leads where id=$X")"
sql "update leads set name='Seg1 Edit $R' where id=$X" >/dev/null
echo "[$LABEL] PUT name \"   \"             -> $(show "$(api PUT /api/leads/$X '{"name":"   "}')")  stored name=\"$(sql "select name from leads where id=$X")\""
sql "update leads set name='Seg1 Edit $R' where id=$X" >/dev/null
echo "[$LABEL] PUT name 200 chars (limit) -> $(show "$(api PUT /api/leads/$X "{\"name\":\"${LONG:0:200}\"}")")"
echo "[$LABEL] PUT name 201 chars        -> $(show "$(api PUT /api/leads/$X "{\"name\":\"${LONG:0:201}\"}")")"
echo "[$LABEL] POST state ZZ             -> $(show "$(api POST /api/leads "{\"name\":\"P\",\"phone\":\"$(ph 2)\",\"state\":\"ZZ\"}")")"
echo "[$LABEL] POST name null            -> $(show "$(api POST /api/leads "{\"name\":null,\"phone\":\"$(ph 2)\",\"state\":\"TX\"}")")"
echo "[$LABEL] POST name 10,000 chars    -> $(show "$(api POST /api/leads "{\"name\":\"$LONG\",\"phone\":\"$(ph 2)\",\"state\":\"TX\"}")")"
echo "[$LABEL] POST name \"   \"            -> $(show "$(api POST /api/leads "{\"name\":\"   \",\"phone\":\"$(ph 2)\",\"state\":\"TX\"}")")"
sql "delete from leads where phone='$(ph 2)'" >/dev/null   # in case a bad POST was accepted
echo "[$LABEL] valid edits:"
for f in "name|\"Seg1 Renamed $R\"" "phone|\"(817) 555-$(printf '%04d' $(( (R + 3) % 10000 )))\"" "email|\"seg1-$R@example.com\"" "address|\"1 Main St, Fort Worth\"" "brokerage|\"Seg1 Realty\"" "state|\"OK\""; do
  k=${f%%|*}; v=${f#*|}; echo "[$LABEL]   PUT $k=$v -> $(show "$(api PUT /api/leads/$X "{\"$k\":$v}")")  stored $k=$(sql "select $k from leads where id=$X")"
done
echo "[$LABEL] lowercase state: PUT {\"state\":\"ca\"} -> $(show "$(api PUT /api/leads/$X '{"state":"ca"}')") stored=$(sql "select state from leads where id=$X")   | POST state \"ca\" -> $(api POST /api/leads "{\"name\":\"Lower $R\",\"phone\":\"$(ph 4)\",\"state\":\"ca\"}" | sed 's/ \[HTTP.*//' | jget lead.state)"
