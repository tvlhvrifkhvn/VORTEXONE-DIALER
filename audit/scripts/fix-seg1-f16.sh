#!/usr/bin/env bash
# F-16 repro: the DNC bypass via phone edit + single-line dial, then the full
# post-fix matrix. Everything goes through the API except the one explicitly
# labelled "direct SQL" setup (a dnc_list entry whose lead has dnc_flag=false).
# Usage: AUDIT_PASSWORD=<seed password> bash audit/scripts/fix-seg1-f16.sh <label>
set -u
. "$(dirname "$0")/../lib/env.sh"
export DB=${DB:-vortex_seg1}
LABEL="${1:-run}"; R=$RANDOM   # random suffix keeps phone numbers unique per run
login >/dev/null
st() { grep -oE '\[HTTP [0-9]+\]' <<<"$1"; }
body() { sed 's/ \[HTTP.*//' <<<"$1"; }
mk() { body "$(api POST /api/leads "{\"name\":\"$1\",\"phone\":\"$2\",\"state\":\"TX\"}")" | jget lead.id; }
n4() { printf '%04d' $(( (R + $1) % 10000 )); }

A_PHONE="(214) 555-$(n4 1)"; A_E164="+1214555$(n4 1)"
A=$(mk "Seg1 DNC Source $R" "$A_PHONE")
C=$(body "$(api POST /api/calls "{\"leadId\":$A}")" | jget call.id)
echo "[$LABEL] lead A=$A $A_PHONE dialed (call $C), disposition dnc: $(st "$(api POST /api/dispositions "{\"callId\":$C,\"disposition\":\"dnc\"}")")"
echo "[$LABEL]   dnc_list has $A_E164: $(sql "select count(*) from dnc_list where phone='$A_E164'")"
# free the number from lead A so the unique constraint can't hide the bypass
echo "[$LABEL]   PUT A phone -> (214) 555-$(n4 2) (moves A off the number): $(st "$(api PUT /api/leads/$A "{\"phone\":\"(214) 555-$(n4 2)\"}")")"

B=$(mk "Seg1 Target $R" "(214) 555-$(n4 3)")
echo "[$LABEL] lead B=$B"
for fmt in "(214) 555-$(n4 1)" "214-555-$(n4 1)" "+1 214 555 $(n4 1)"; do
  r=$(api PUT /api/leads/$B "{\"phone\":\"$fmt\"}")
  echo "[$LABEL]   PUT B phone=\"$fmt\" -> $(st "$r") $(body "$r" | jget error) stored=$(sql "select phone from leads where id=$B")"
done
r=$(api POST /api/calls "{\"leadId\":$B}")
echo "[$LABEL]   POST /api/calls {leadId:B} -> $(st "$r") $(body "$r" | jget error) | dialed number: $(sql "select phone from leads where id=$B")"

echo "[$LABEL] invalid phone: PUT B phone=\"abc\" -> $(st "$(api PUT /api/leads/$B '{"phone":"abc"}')") $(body "$(api PUT /api/leads/$B '{"phone":"abc"}')" | jget error)"
OTHER=$(mk "Seg1 Other $R" "(214) 555-$(n4 4)")
r=$(api PUT /api/leads/$B "{\"phone\":\"214.555.$(n4 4)\"}"); echo "[$LABEL] number held by lead $OTHER: PUT B -> $(st "$r") $(body "$r" | jget error)"
r=$(api PUT /api/leads/$B "{\"phone\":\"214 555 $(n4 5)\"}"); echo "[$LABEL] clean new number \"214 555 $(n4 5)\": PUT B -> $(st "$r") stored=$(sql "select phone from leads where id=$B")"

D_E164="+1214555$(n4 6)"
D=$(mk "Seg1 ListOnly $R" "(214) 555-$(n4 6)")
sql "insert into dnc_list (phone, source) values ('$D_E164','manual') on conflict do nothing" >/dev/null
echo "[$LABEL] lead D=$D: number put on dnc_list by DIRECT SQL, dnc_flag=$(sql "select dnc_flag from leads where id=$D")"
r=$(api POST /api/calls "{\"leadId\":$D}"); echo "[$LABEL]   by-id dial D -> $(st "$r") $(body "$r" | jget error)"
sql "update leads set status='callback_scheduled', next_action_at=now() - interval '1 day' where id=$D" >/dev/null
echo "[$LABEL]   D made the top queue candidate by DIRECT SQL (callback due a day ago)"
r=$(api POST /api/calls '{}'); echo "[$LABEL]   POST /api/calls {} -> $(st "$r") served lead=$(body "$r" | jget lead.id) (D=$D)"
echo "[$LABEL]   D afterwards: $(sql "select 'status='||status||' dnc_flag='||dnc_flag||' locked_by='||coalesce(locked_by::text,'null') from leads where id=$D")"
echo "[$LABEL] manual dial pad to the DNC'd number $A_PHONE -> $(st "$(api POST /api/calls/manual/start "{\"toNumber\":\"$A_PHONE\"}")") $(body "$(api POST /api/calls/manual/start "{\"toNumber\":\"$A_PHONE\"}")" | jget error)"
