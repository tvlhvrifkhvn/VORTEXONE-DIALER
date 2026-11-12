#!/usr/bin/env bash
# Segment 8 (F-37, F-38, F-39, F-41, F-31): SMS and email over the real API,
# mock SMS / email adapters only. Fresh clone of vortex_seg3_tpl migrated by
# <checkout>; test leads inserted by DIRECT SQL (test shortcut, labelled).
# Controlled clock (audit/stubs/fake-now.js, Node only): 2026-11-13 13:30 UTC
# = 08:30 New York (open), 05:30 Los Angeles (closed); calling hours ON.
# The webhook secret is a throwaway test value, not a real credential.
#   inbound    POST /api/sms/inbound: STOP / START variants, a sentence with
#              "stop", unknown number, duplicate delivery, secret checks, DNC
#              lead, inbox / unread / timeline
#   templates  supported fields, unknown tokens, odd spacing, empty field,
#              an old template with a bad token
#   hours      single and bulk inside / outside hours, unknown zone, toggle OFF
#   safety     bulk summary with every kind of skip; single send to opted-out / DNC
#   email      empty / blank / valid subject, the mock adapter's log line
#   providers  bogus and valid TELEPHONY / SMS / EMAIL_PROVIDER at startup
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg8.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-inbound templates hours safety email providers}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg8_api
p() { echo "[$LABEL] $*"; }
SECRET=s8-test-secret-not-real
FAKE=2026-11-13T13:30:00Z

fresh_db() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "insert into settings (key, value) values ('calling_hours_enforced', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  # DIRECT SQL: the test leads
  sql "insert into leads (name, phone, state, address, brokerage, email, status, missing_phone, sms_opt_out, dnc_flag) values
    ('Ana María López', '+12125557701', 'NY', '10 Main St, Albany, NY', 'Café Realty', 'ana@example.test', 'new', false, false, false),
    ('Bob Empty', '+12125557702', 'NY', '11 Main St, Albany, NY', null, 'bob@example.test', 'new', false, false, false),
    ('Cara West', '+12135557703', 'CA', 'Los Angeles, CA', 'West Homes', 'cara@example.test', 'new', false, false, false),
    ('Dan Nostate', '+12125557704', '', null, 'Nowhere Realty', null, 'new', false, false, false),
    ('Eve Optout', '+12125557705', 'NY', 'Albany, NY', 'Opt Realty', null, 'new', false, true, false),
    ('Fay Dnc', '+12125557706', 'NY', 'Albany, NY', 'Dnc Realty', null, 'dnc', false, false, true),
    ('Gus Nophone', null, 'NY', 'Albany, NY', 'Gus Realty', null, 'new', true, false, false),
    ('Hal Nocity', '+12125557707', 'NY', null, 'Hal Realty', null, 'new', false, false, false)" >/dev/null
  for n in ANA:+12125557701 BOB:+12125557702 CARA:+12135557703 DAN:+12125557704 EVE:+12125557705 FAY:+12125557706 HAL:+12125557707; do eval "${n%%:*}=$(sql "select id from leads where phone='${n#*:}'")"; done
  GUS=$(sql "select id from leads where name='Gus Nophone'")
}
srv() {   # srv [env...]
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg8-$LABEL-$PART.txt"
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off FAKE_NOW=$FAKE NODE_OPTIONS="--require $ROOT/audit/stubs/fake-now.js" "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 80); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -s "$API/health" >/dev/null 2>&1 || { p "ABORT: backend did not start"; tail -5 "$SLOG"; exit 1; }
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
}
code() { api "$1" "$2" "${3:-}" "${4:-tokS}" > "$SCRATCH/s8-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/s8-last" | grep -oE '[0-9]+'; }
body() { sed -E 's/ \[HTTP.*//' "$SCRATCH/s8-last"; }
err() { grep -oE '"error":"[^"]*"' "$SCRATCH/s8-last" | head -1; }
inbound() {   # inbound <from> <body> [providerMessageId] [secret]  -> "code json"
  local id=${3:-}; local sec=${4-$SECRET}
  local data; data=$(node -e 'const [f,b,i]=process.argv.slice(1);const o={from:f,to:"+15550001111",body:b};if(i)o.providerMessageId=i;console.log(JSON.stringify(o))' "$1" "$2" "$id")
  curl -s -w ' [HTTP %{http_code}]' -X POST "$API/api/sms/inbound" -H 'content-type: application/json' ${sec:+-H "x-webhook-secret: $sec"} -d "$data"
}
optout() { sql "select sms_opt_out||'/dnc='||dnc_flag from leads where id=$1"; }
confirms() { sql "select count(*) from sms_messages where direction='outbound' and body like 'Vortexone Agency: You%'"; }

for PART in $PARTS; do case $PART in
inbound)
  fresh_db; srv SMS_WEBHOOK_SECRET=$SECRET
  p "== inbound texts (POST /api/sms/inbound, secret header); lead ANA $ANA, phone (212) 555-7701"
  for v in "STOP" "stop" "Stop." " STOP " "StopAll" "UNSUBSCRIBE" "cancel" "End!" "quit" ; do
    r=$(inbound "212-555-7701" "$v"); a=$(optout $ANA)
    r2=$(inbound "+1 (212) 555-7701" "START"); b=$(optout $ANA)
    p "  \"$v\" -> $(grep -oE 'HTTP [0-9]+' <<<"$r") action $(grep -oE '"action":"?[a-z_]*' <<<"$r" | cut -d: -f2 | tr -d '"'); opt_out/dnc after: $a | then START -> $(grep -oE 'HTTP [0-9]+' <<<"$r2"), after: $b"
  done
  for v in "UNSTOP" "start" "Start." ; do inbound "2125557701" "STOP" >/dev/null; r=$(inbound "2125557701" "$v"); p "  STOP then \"$v\" -> $(grep -oE 'HTTP [0-9]+' <<<"$r"), opt_out/dnc after: $(optout $ANA)"; done
  r=$(inbound "2125557701" "Please stop calling me before 3pm"); p "  sentence with 'stop' -> $(grep -oE 'HTTP [0-9]+' <<<"$r") action $(grep -oE '"action":[a-z"_]*' <<<"$r"); opt_out after: $(optout $ANA)"
  c0=$(confirms); r=$(inbound "2125557701" "STOP" "prov-123"); c1=$(confirms); r2=$(inbound "2125557701" "STOP" "prov-123"); c2=$(confirms)
  p "  duplicate delivery (providerMessageId prov-123 twice): $(grep -oE 'HTTP [0-9]+' <<<"$r") then $(grep -oE 'HTTP [0-9]+' <<<"$r2") $(grep -oE '"duplicate":[a-z]*' <<<"$r2"); rows with that id: $(sql "select count(*) from sms_messages where provider_message_id='prov-123'"); confirmations sent: +$((c1-c0)) then +$((c2-c1))"
  inbound "2125557701" "START" >/dev/null
  r=$(inbound "+13125559999" "Who is this? STOP" ); r2=$(inbound "+13125559999" "stop")
  p "  unknown number (312) 555-9999: \"Who is this? STOP\" -> $(grep -oE 'HTTP [0-9]+' <<<"$r"); \"stop\" -> $(grep -oE 'HTTP [0-9]+' <<<"$r2") $(grep -oE '"confirmationSent":[a-z]*' <<<"$r2"); stored with no lead: $(sql "select count(*) from sms_messages where lead_id is null and direction='inbound' and from_number='+13125559999'")"
  p "  two leads, one phone: $(sql "select 'insert a 2nd lead with ANA''s phone -> ' || 'blocked by leads_phone_key (one lead per number)'" ) $(psql -q -h localhost -U vortex -d $DB -c "insert into leads (name, phone, state, status) values ('Dup', '+12125557701', 'NY', 'new')" 2>&1 | grep -oE 'duplicate key[^"]*' | head -1)"
  inbound "2125557706" "STOP" >/dev/null; a=$(optout $FAY); inbound "2125557706" "START" >/dev/null
  p "  DNC lead FAY: STOP -> opt_out/dnc $a; START -> $(optout $FAY); status $(sql "select status from leads where id=$FAY"); dnc_list rows unchanged: $(sql "select count(*) from dnc_list where phone='+12125557706'")"
  p "  secret: none -> $(inbound "2125557701" "STOP" "" "" | grep -oE 'HTTP [0-9]+'); wrong -> $(inbound "2125557701" "STOP" "" "wrong-secret" | grep -oE 'HTTP [0-9]+'); ANA opt_out still: $(optout $ANA)"
  srv
  p "  server started WITHOUT SMS_WEBHOOK_SECRET: correct-looking secret -> $(inbound "2125557701" "STOP" | grep -oE 'HTTP [0-9]+'); ANA opt_out still: $(optout $ANA)"
  inbound "2125557703" "Is this still available?" >/dev/null
  srv SMS_WEBHOOK_SECRET=$SECRET
  inbound "2125557702" "Yes, call me tomorrow" "prov-b1" >/dev/null
  p "  inbox: $(api GET '/api/sms/inbox?page=1&limit=20' '' tokS | sed -E 's/ \[HTTP.*//' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`leads with unread ${(j.leads||[]).map(l=>l.leadName+"="+l.unreadCount).join(", ")}; unmatched list: ${j.unmatched?j.unmatched.map(u=>u.fromNumber+" \""+u.body+"\"").join(", "):"(not returned)"}`)})')"
  p "  timeline ANA: $(api GET /api/leads/$ANA/timeline '' tokS | sed -E 's/ \[HTTP.*//' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).timeline;const c={};for(const e of t){const k=e.type+(e.direction?"/"+e.direction:"")+(e.action?"/"+e.action:"");c[k]=(c[k]||0)+1}console.log(JSON.stringify(c))})')"
  p "  totals: inbound rows $(sql "select count(*) from sms_messages where direction='inbound'"), confirmations $(confirms), opt events $(sql "select count(*) from sms_opt_events" 2>/dev/null || echo n/a)" ;;
templates)
  fresh_db; srv
  p "== templates (save-time check), leads ANA (all fields) / BOB (no brokerage) / HAL (no address = no city)"
  for t in "Hi {{first_name}} at {{brokerage}} in {{city}}, {{state}} ({{name}})" "Hi {{ Name }} / {{FIRST_NAME}} / {{  state }} / {first_name}" "Hi {{zip}}" "Hi {first name} {{name}" "Hi {{name}} from {{ Brokerage }} {unknown}"; do
    c=$(code POST /api/sms/templates "$(node -e 'console.log(JSON.stringify({name:"t",body:process.argv[1]}))' "$t")"); p "  save \"$t\" -> $c $(err)"
  done
  GOOD=$(sql "select id from sms_templates where body like 'Hi {{first_name}} at%' order by id desc limit 1")
  ODD=$(sql "select id from sms_templates where body like 'Hi {{ Name }}%' order by id desc limit 1")
  OLD=$(sql "insert into sms_templates (name, body) values ('old bad', 'Hey {{first_name}}, {{zip}} special') returning id")   # DIRECT SQL: an old template saved before the check
  for spec in "GOOD:$GOOD:$ANA" "ODD:$ODD:$ANA" "GOOD:$GOOD:$BOB" "GOOD:$GOOD:$HAL" "OLD:$OLD:$ANA"; do
    IFS=: read -r n tid lid <<<"$spec"
    c=$(code POST /api/sms/send "{\"leadId\":$lid,\"templateId\":$tid}"); p "  send $n to $(sql "select name from leads where id=$lid") -> $c $(err) $(body | grep -oE '"body":"[^"]*"')"
  done
  c=$(code POST /api/sms/send "{\"leadId\":$ANA,\"rawBody\":\"Hi {{name}}, {{nickname}}\"}"); p "  free text with {{nickname}} -> $c $(err) $(body | grep -oE '"body":"[^"]*"')"
  p "  template list flags: $(api GET /api/sms/templates '' tokS | sed -E 's/ \[HTTP.*//' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).templates.map(t=>`${t.name}${t.needs_fixing?" NEEDS FIXING ("+t.invalid_tokens.join(" ")+")":""}`).join("; ")))')"
  c=$(code POST /api/sms/bulk-send "{\"leadIds\":[$ANA,$BOB,$HAL],\"templateId\":$GOOD}"); p "  bulk GOOD to ANA, BOB, HAL -> $c $(body)"
  c=$(code POST /api/sms/bulk-send "{\"leadIds\":[$ANA],\"templateId\":$OLD}"); p "  bulk with the old bad template -> $c $(err)"
  p "  outbound bodies containing { or } : $(sql "select count(*) from sms_messages where direction='outbound' and body ~ '[{}]'"); containing ' at in ' or ' at ,': $(sql "select count(*) from sms_messages where direction='outbound' and (body like '% at in %' or body like '% at ,%')")" ;;
hours)
  fresh_db; srv SMS_WEBHOOK_SECRET=$SECRET
  p "== texts and calling hours (08:30 New York open, 05:30 Los Angeles closed, Dan has no state)"
  for l in $ANA $CARA $DAN; do c=$(code POST /api/sms/send "{\"leadId\":$l,\"rawBody\":\"Hello there\"}"); p "  single to $(sql "select name||' ('||coalesce(nullif(trim(state),''),'no state')||')' from leads where id=$l") -> $c $(err)"; done
  c=$(code POST /api/sms/templates '{"name":"plain","body":"Hello {{first_name}}"}'); T=$(body | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
  c=$(code POST /api/sms/bulk-send "{\"leadIds\":[$ANA,$CARA,$DAN],\"templateId\":$T}"); p "  bulk ANA, CARA, DAN -> $c $(body)"
  p "  CARA texts on record: $(sql "select count(*) from sms_messages where lead_id=$CARA and direction='outbound'")"
  r=$(inbound "2135557703" "STOP"); p "  STOP from CARA at 05:30 her time -> $(grep -oE 'HTTP [0-9]+' <<<"$r") $(grep -oE '"confirmationSent":[a-z]*' <<<"$r") (the confirmation is exempt); CARA opt_out: $(optout $CARA)"
  inbound "2135557703" "START" >/dev/null
  code PUT /api/settings/calling_hours_enforced '{"value":"false"}' >/dev/null
  c=$(code POST /api/sms/send "{\"leadId\":$CARA,\"rawBody\":\"Hello there\"}"); p "  calling hours OFF: single to CARA -> $c $(err)" ;;
safety)
  fresh_db; srv
  p "== safety: single sends to EVE (opted out) and FAY (DNC); bulk to every kind of lead"
  for l in $EVE $FAY $GUS; do c=$(code POST /api/sms/send "{\"leadId\":$l,\"rawBody\":\"Hello\"}"); p "  single to $(sql "select name from leads where id=$l") -> $c $(err)"; done
  c=$(code POST /api/sms/templates '{"name":"b","body":"Hello {{first_name}} at {{brokerage}}"}'); T=$(body | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
  c=$(code POST /api/sms/bulk-send "{\"leadIds\":[$ANA,$BOB,$CARA,$DAN,$EVE,$FAY,$GUS,99999999],\"templateId\":$T}")
  p "  bulk to ANA (ok), BOB (no brokerage), CARA (closed), DAN (no state), EVE (opted out), FAY (DNC), GUS (no phone), 99999999 (no such lead) -> $c"
  p "    summary: $(body)"
  p "    adds up: $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.total===undefined){console.log("no total in summary");return}const parts=["sent","opted_out","dnc","outside_hours","missing_field","invalid_number","not_found","failed"];const sum=parts.reduce((a,k)=>a+(j[k]||0),0);console.log(`${parts.map(k=>k+"="+(j[k]||0)).join(" + ")} = ${sum} of total ${j.total}`)})')"
  p "    outbound rows written: $(sql "select string_agg(l.name, ', ') from sms_messages m join leads l on l.id=m.lead_id where m.direction='outbound'")" ;;
email)
  fresh_db; srv
  p "== email subject (lead ANA)"
  for s in '""' '"   "' 'null' '"Quick question, {{first_name}}"'; do c=$(code POST /api/email/send "{\"leadId\":$ANA,\"subject\":$s,\"body\":\"Hi {{first_name}}\"}"); p "  subject $s -> $c $(err) $(body | grep -oE '"subject":"[^"]*"')"; done
  p "  email rows stored: $(sql "select count(*)||' ('||coalesce(string_agg(quote_literal(subject), ', '),'-')||')' from email_messages")"
  sleep 1
  p "  mock adapter log lines: $(grep -c '\[mockEmailAdapter\]' "$SLOG"; true) — $(grep '\[mockEmailAdapter\]' "$SLOG" | head -3 | tr '\n' ';')" ;;
providers)
  fresh_db
  p "== provider names at startup (env value -> what happens)"
  for spec in "TELEPHONY_PROVIDER=bogus" "SMS_PROVIDER=bogus" "EMAIL_PROVIDER=bogus" "TELEPHONY_PROVIDER=mock" "TELEPHONY_PROVIDER=twilio" "SMS_PROVIDER=mock" "EMAIL_PROVIDER=mock"; do
    stop_backend; L="$ROOT/audit/logs/server-seg8-$LABEL-providers.txt"
    ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off $spec node src/index.js > "$L" 2>&1 < /dev/null & )
    up=no; for i in $(seq 1 24); do curl -s "$API/health" >/dev/null 2>&1 && { up=yes; break; }; sleep 0.25; done
    alive=$(pgrep -f "node src/index.js" >/dev/null && echo running || echo exited)
    p "  $spec -> started: $up, process: $alive; log: $(grep -vE '^\s*$' "$L" | head -2 | tr '\n' ' ' | cut -c1-200)"
  done
  stop_backend
  SLOG=$L ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG" 2>/dev/null; true) error/warn lines"
done
rm -f "$SCRATCH/force-outcome"
stop_backend
