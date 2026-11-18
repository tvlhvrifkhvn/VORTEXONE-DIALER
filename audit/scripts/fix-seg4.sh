#!/usr/bin/env bash
# Segment 4 repros: F-21 (undo matrix), F-17 (name cascade), F-35 (callback
# time), F-36 (note on another lead's call), F-23 (no_contact_number
# recovery), F-55 (missing_phone recovery), DNC phone-edit block.
# Each run uses a fresh clone of vortex_seg3_tpl. Mock outcome forced to
# answered (audit/stubs/force-outcome.js, labelled stub). Test setup that is
# not reachable through the API (synthetic leads, a dnc_list entry, attempts
# near max) is done by DIRECT SQL and labelled.
#
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg4.sh <label> [parts]
#   parts: any of undo cascade callback note ncn missing dncedit (default: all)
# Acting user: U1 = rep2 (rep).
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL="${1:-run}"; shift || true
PARTS="${*:-undo cascade callback note ncn missing dncedit}"
export DB=vortex_seg4_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
stop_backend
SLOG="$AUDIT_ROOT/audit/logs/server-seg4-$LABEL.txt"
( cd "$AUDIT_ROOT/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $AUDIT_ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 40); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -s "$API/health" >/dev/null || { echo "[$LABEL] ABORT: backend/DB not up: $(tail -3 "$SLOG")"; exit 1; }
login rep2@example.com 'Rep2Pass!' tokU1 >/dev/null
T=tokU1
p() { echo "[$LABEL] $*"; }
echo answered > "$SCRATCH/force-outcome"
code() { api "$1" "$2" "${3:-}" "${4:-$T}" > "$SCRATCH/last"; sed -E 's/ \[HTTP [0-9]+\]$//' "$SCRATCH/last" > "$SCRATCH/last-body"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/last" | grep -oE '[0-9]+'; }
err() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.error||"")}catch{console.log("")}' "$SCRATCH/last-body"; }
NEXT=0
lead() { NEXT=$((NEXT+1)); L=$(sql "select id from leads where status='new' and not missing_phone and deleted_at is null and state in ('CA','NY','TX','FL','IL','WA') order by id offset $((NEXT*5)) limit 1"); }
dial() { DC=$(code POST /api/calls "{\"leadId\":$1${2:+,\"sessionId\":$2}}"); CALL=$(jget call.id < "$SCRATCH/last-body" 2>/dev/null); }
snap() { sql "select status||' att='||attempts||' next='||coalesce(to_char(next_action_at,'MM-DD HH24:MI'),'-')||' notes='||notes_count||' cold='||coalesce(cold_reason,'-')||' dnc='||dnc_flag||' locked_by='||coalesce(locked_by::text,'-') from leads where id=$1"; }
extras() { local ph; ph=$(sql "select phone from leads where id=$1"); echo "callbacks=$(sql "select count(*) from callbacks where lead_id=$1 and not done") dnc_list=$(sql "select count(*) from dnc_list where phone='$ph'") session=$(sql "select 'c'||total_contacts||'/v'||total_voicemails||'/n'||total_no_answers||'/cb'||total_callbacks||'/d'||total_dnc from dialing_sessions where id=$2")"; }

for part in $PARTS; do case $part in
undo)
  p "== F-21 undo matrix: disposition, then undo within 10 s; lead, callbacks, dnc_list and session stats must be back as before =="
  SID=$(code POST /api/sessions/start '{"mode":"power"}' >/dev/null; jget sessionId < "$SCRATCH/last-body")
  FUTURE=$(date -u -d '+2 days' +%Y-%m-%dT%H:%M:%SZ)
  for d in contacted voicemail no_answer callback_scheduled no_contact_number no_contact_person dnc cold; do
    lead; disp=$d; [ $d = cold ] && { disp=no_answer; sql "update leads set attempts = max_attempts - 1 where id=$L" >/dev/null; }  # DIRECT SQL: one attempt left
    dial $L $SID; C=$CALL; sleep 0.5
    B="$(snap $L) | $(extras $L $SID)"
    extra=""; [ $disp = callback_scheduled ] && extra=",\"scheduledAt\":\"$FUTURE\""
    c1=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"$disp\",\"note\":\"matrix $d\"$extra}")
    M="$(snap $L) | $(extras $L $SID)"
    c2=$(code POST /api/dispositions/$C/undo); e2=$(err)
    A="$(snap $L) | $(extras $L $SID)"
    ok=FAIL; [ "$c2" = 200 ] && [ "$A" = "$B" ] && ok=PASS
    p "  $ok $d: disposition $c1, undo $c2 ${e2:+($e2)}"
    p "       before: $B"; p "       dispo : $M"; p "       undone: $A"
    code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"contacted\"}" >/dev/null
  done ;;
cascade)
  p "== F-17 three leads named the same in TX, FL, AZ (AZ has a scheduled callback); no_contact_person on the TX one =="
  NM="Sam Same $RANDOM"; R=$((RANDOM % 9000 + 1000))
  # DIRECT SQL: synthetic leads sharing a name (imports create such collisions)
  X=$(sql "insert into leads (name, phone, state, status) values ('$NM','+1713555$R','TX','new') returning id" | head -1)
  Y=$(sql "insert into leads (name, phone, state, status) values ('$NM','+1305555$R','FL','in_queue') returning id" | head -1)
  Z=$(sql "insert into leads (name, phone, state, status, next_action_at) values ('$NM','+1602555$R','AZ','callback_scheduled', now() + interval '1 day') returning id" | head -1)
  sql "insert into callbacks (lead_id, scheduled_at) values ($Z, now() + interval '1 day')" >/dev/null
  dial $X; C=$CALL; sleep 0.5
  c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_contact_person\"}"); casc=$(jget cascadedLeadIds < "$SCRATCH/last-body")
  p "  no_contact_person on TX lead $X -> $c, cascadedLeadIds=$casc"
  p "  TX $X: $(snap $X)"; p "  FL $Y: $(snap $Y)"; p "  AZ $Z: $(snap $Z), open callbacks=$(sql "select count(*) from callbacks where lead_id=$Z and not done")"
  [ -n "${NO_UNDO:-}" ] && { p "  (NO_UNDO set: cascade left in place for the read-only report)"; continue; }
  c=$(code POST /api/dispositions/$C/undo); p "  undo -> $c"
  p "  after undo: TX $(sql "select status from leads where id=$X") | FL $(sql "select status||'/'||coalesce(cold_reason,'-') from leads where id=$Y") | AZ $(sql "select status||'/'||coalesce(cold_reason,'-') from leads where id=$Z")"
  code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"contacted\"}" >/dev/null ;;
callback)
  p "== F-35 callback time on the disposition path =="
  for v in "next tuesday" "2020-01-01" "$(date -u -d '-30 seconds' +%Y-%m-%dT%H:%M:%SZ)" "$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)"; do
    lead; dial $L; C=$CALL; sleep 0.3
    c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"callback_scheduled\",\"scheduledAt\":\"$v\"}")
    p "  scheduledAt \"$v\" -> $c $(err) | lead $(sql "select status||' next='||coalesce(to_char(next_action_at,'YYYY-MM-DD HH24:MI'),'-') from leads where id=$L")"
    [ "$c" != 200 ] && code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"contacted\"}" >/dev/null
  done
  p "  lead-page route for comparison: POST /api/leads/:id/callback \"next tuesday\" -> $(lead; code POST /api/leads/$L/callback '{"scheduledAt":"next tuesday"}') $(err)" ;;
note)
  p "== F-36 note linked to a call of another lead =="
  lead; A=$L; dial $A; CA=$CALL; lead; B=$L; dial $B; CB=$CALL
  c=$(code POST /api/leads/$A/notes "{\"callId\":$CB,\"body\":\"wrong call\"}"); p "  note on lead $A with lead $B's call $CB -> $c $(err) | stored rows: $(sql "select count(*) from lead_notes where lead_id=$A and call_id=$CB")"
  c=$(code POST /api/leads/$A/notes "{\"callId\":$CA,\"body\":\"own call\"}"); p "  note on lead $A with its own call $CA -> $c"
  c=$(code POST /api/leads/$A/notes "{\"body\":\"no call\"}"); p "  note on lead $A without a call -> $c"
  c=$(code POST /api/leads/$A/notes "{\"callId\":99999999,\"body\":\"ghost\"}"); p "  note with a call id that doesn't exist -> $c $(err)"
  for X in $CA $CB; do code POST /api/dispositions "{\"callId\":$X,\"disposition\":\"contacted\"}" >/dev/null; done ;;
ncn)
  p "== F-23 no_contact_number recovery by fixing the phone =="
  lead; dial $L; C=$CALL; sleep 0.3
  code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_contact_number\"}" >/dev/null
  p "  lead $L after no_contact_number: $(snap $L)"
  c=$(code PUT /api/leads/$L '{"phone":"abc"}'); p "  PUT phone \"abc\" -> $c $(err) | $(sql "select status from leads where id=$L")"
  R=$((RANDOM % 9000 + 1000)); sql "insert into dnc_list (phone, source) values ('+1214555$R','manual')" >/dev/null  # DIRECT SQL: a DNC-listed number
  c=$(code PUT /api/leads/$L "{\"phone\":\"(214) 555-$R\"}"); p "  PUT a DNC-listed phone -> $c $(err) | $(sql "select status from leads where id=$L")"
  R2=$(( (R + 17) % 9000 + 1000 ))
  c=$(code PUT /api/leads/$L "{\"phone\":\"(214) 555-$R2\"}"); p "  PUT a valid new phone -> $c | $(snap $L)"
  p "  timeline notes: $(sql "select coalesce(string_agg(body, ' / '),'none') from lead_notes where lead_id=$L")"
  dial $L; p "  dial by id -> $DC $(err)"; [ "$DC" = 201 ] && code POST /api/dispositions "{\"callId\":$CALL,\"disposition\":\"contacted\"}" >/dev/null ;;
missing)
  p "== F-55 phoneless lead (imported without a number) gets a number =="
  NM="Seg4 Phoneless $RANDOM"
  P=$(sql "insert into leads (name, phone, state, status, missing_phone) values ('$NM', NULL, 'TX', 'new', true) returning id" | head -1)  # DIRECT SQL: what csvImport inserts
  p "  lead $P: $(sql "select status||' phone='||coalesce(phone,'NULL')||' missing_phone='||missing_phone from leads where id=$P")"
  dial $P; p "  dial before -> $DC $(err)"
  c=$(code PUT /api/leads/$P "{\"name\":\"$NM x\",\"phone\":\"\",\"state\":\"TX\"}"); p "  PUT name with phone \"\" (what the edit form sends) -> $c $(err)"
  R=$((RANDOM % 9000 + 1000))
  c=$(code PUT /api/leads/$P "{\"phone\":\"(469) 555-$R\"}"); p "  PUT phone \"(469) 555-$R\" -> $c | $(sql "select status||' phone='||coalesce(phone,'NULL')||' missing_phone='||missing_phone from leads where id=$P")"
  p "  timeline notes: $(sql "select coalesce(string_agg(body, ' / '),'none') from lead_notes where lead_id=$P")"
  dial $P; p "  dial after -> $DC $(err)"; [ "$DC" = 201 ] && code POST /api/dispositions "{\"callId\":$CALL,\"disposition\":\"contacted\"}" >/dev/null ;;
dncedit)
  p "== DNC lead: phone edits blocked, other edits allowed =="
  lead; dial $L; C=$CALL; sleep 0.3
  code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"dnc\"}" >/dev/null
  PH=$(sql "select phone from leads where id=$L"); NM=$(sql "select name from leads where id=$L"); ST=$(sql "select state from leads where id=$L")
  p "  lead $L: $(snap $L) phone=$PH"
  R=$((RANDOM % 9000 + 1000))
  c=$(code PUT /api/leads/$L "{\"phone\":\"(817) 555-$R\"}"); p "  PUT a new phone -> $c $(err) | phone now $(sql "select phone from leads where id=$L")"
  c=$(code PUT /api/leads/$L "{\"name\":\"$NM (renamed)\"}"); p "  PUT name only -> $c $(err)"
  c=$(code PUT /api/leads/$L "{\"phone\":\"$PH\"}"); p "  PUT only its current phone -> $c $(err)"
  c=$(code PUT /api/leads/$L "{\"name\":\"$NM (form)\",\"phone\":\"$PH\",\"state\":\"$ST\",\"email\":\"\",\"address\":\"\",\"brokerage\":\"\"}"); p "  PUT whole edit form, phone unchanged -> $c $(err)"
  p "  lead after: $(snap $L) phone=$(sql "select phone from leads where id=$L")" ;;
esac; done
rm -f "$SCRATCH/force-outcome"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines"
stop_backend
