#!/usr/bin/env bash
# End-to-end smoke run on the mock adapters (Segment 10): import a small file,
# dial through it with every disposition, schedule a callback, send a text,
# receive an inbound STOP, export the PDF, then check that everything agrees
# (DB, report API, PDF, DNC list, opt-out list, invariants).
# Fresh clone of vortex_seg3_tpl with its 5,019 leads parked (DIRECT SQL), so
# only the imported leads are in the queue. Mock forced to answered (stub).
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg10-e2e.sh <label> <checkout>
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; ROOT="$AUDIT_ROOT"
export DB=vortex_seg10_e2e
p() { echo "[$LABEL] $*"; }
OUT="$SCRATCH/seg10-e2e-$LABEL"; mkdir -p "$OUT"
SECRET=e2e-test-secret-not-real
stop_backend
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
sql "update leads set deleted_at = now()" >/dev/null   # DIRECT SQL: park the template's leads
sql "insert into settings (key, value) values ('calling_hours_enforced', 'false') on conflict (key) do update set value = 'false'" >/dev/null
echo answered > "$SCRATCH/force-outcome"
SLOG="$ROOT/audit/logs/server-seg10-e2e-$LABEL.txt"
( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off SMS_WEBHOOK_SECRET=$SECRET NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 80); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
code() { api "$1" "$2" "${3:-}" tokS > "$SCRATCH/e2e-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/e2e-last" | grep -oE '[0-9]+'; }
body() { sed -E 's/ \[HTTP.*//' "$SCRATCH/e2e-last"; }

printf 'Name,Phone,State,Address,Brokerage\n' > "$OUT/e2e.csv"
i=0; for n in Contacted Voicemail NoAnswer BadNumber NoPerson Dnc Callback Texted; do i=$((i+1)); echo "E2E $n,212-555-77$((10+i)),NY,$i Main St Albany NY,E2E Realty" >> "$OUT/e2e.csv"; done
r=$(node "$ROOT/audit/scripts/seg9-import.js" "$SCRATCH/tokS" "$OUT/e2e.csv")
p "1. import 8 leads -> imported $(grep -oE '"imported":[0-9]+' <<<"$r")"

p "2. dial each and log every disposition"
CB=$(date -u -d '+2 days' +%Y-%m-%dT%H:00:00Z)
for d in contacted voicemail no_answer no_contact_number no_contact_person dnc callback_scheduled; do
  c=$(code POST /api/calls '{}'); C=$(body | grep -oE '"call":\{"id":[0-9]+' | grep -oE '[0-9]+$'); L=$(body | grep -oE '"lead":\{"id":[0-9]+' | grep -oE '[0-9]+$')
  sleep 4   # rings, then answered (forced)
  extra=''; [ $d = callback_scheduled ] && extra=",\"scheduledAt\":\"$CB\""
  c2=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"$d\",\"note\":\"e2e $d\"$extra}")
  p "   lead $L ($(sql "select name from leads where id=$L")) call $C -> $c, disposition $d -> $c2; lead now $(sql "select status from leads where id=$L")"
  sleep 1
done
T=$(sql "select id from leads where name='E2E Texted'")
c=$(code POST /api/sms/send "{\"leadId\":$T,\"rawBody\":\"Hi {{first_name}}, quick question about {{brokerage}}\"}"); p "3. text to E2E Texted -> $c $(body | grep -oE '"body":"[^"]*"')"
r=$(curl -s -w ' [HTTP %{http_code}]' -X POST "$API/api/sms/inbound" -H 'content-type: application/json' -H "x-webhook-secret: $SECRET" -d '{"from":"+12125557718","to":"+15550001111","body":"STOP","providerMessageId":"e2e-1"}')
p "4. inbound STOP from E2E Texted -> $(grep -oE 'HTTP [0-9]+' <<<"$r"); lead sms_opt_out $(sql "select sms_opt_out from leads where id=$T"), DNC $(sql "select dnc_flag from leads where id=$T"); number on the opt-out list: $(sql "select count(*) from sms_suppressions where phone='+12125557718'")"
c=$(code POST /api/sms/send "{\"leadId\":$T,\"rawBody\":\"One more\"}"); p "   a text after STOP -> $c"
curl -s -o "$OUT/e2e.pdf" -w '' "$API/api/exports/daily-pdf" -H "authorization: Bearer $(cat $SCRATCH/tokS)"
PDF=$(node "$ROOT/audit/scripts/pdf-numbers.js" "$OUT/e2e.pdf")
c=$(code GET /api/reports/today)
p "5. today: report API $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`dials ${j.dials} contacts ${j.contacts}`)})'); PDF $(node -e 'const j=JSON.parse(process.argv[1]);console.log(`dials ${j.headline.dials} contacts ${j.headline.contacts} vm ${j.headline.voicemails} na ${j.headline.noAnswers} dnc ${j.headline.dnc}, table rows ${j.rows}`)' "$PDF"); DB $(sql "select 'dials '||count(*)||' contacts '||count(*) filter (where disposition='contacted')||' vm '||count(*) filter (where disposition='voicemail')||' na '||count(*) filter (where disposition='no_answer')||' dnc '||count(*) filter (where disposition='dnc') from call_history where telephony_state is distinct from 'failed' and started_at > now() - interval '1 hour'")"
p "6. lead statuses: $(sql "select string_agg(replace(name,'E2E ','')||'='||status||case when next_action_at is not null then '(next '||to_char(next_action_at,'MM-DD')||')' else '' end, ', ' order by id) from leads where name like 'E2E %'")"
p "   DNC list has the DNC lead's number: $(sql "select count(*) from dnc_list where phone=(select phone from leads where name='E2E Dnc')"); open callbacks: $(sql "select count(*) from callbacks where not done and lead_id=(select id from leads where name='E2E Callback')")"
p "   open calls: $(sql "select count(*) from call_history where ended_at is null and disposition is null"); leads in_progress: $(sql "select count(*) from leads where status='in_progress'")"
p "7. invariants: $(psql -q -h localhost -U vortex -d $DB -At -f "$ROOT/audit/scripts/invariants.sql" 2>&1 | grep -A1 -E 'violations|should be' | grep -vE '^--|^$' | tr '\n' ' ' | cut -c1-200)"
p "   server log: $(grep -ciE 'error|warn' "$SLOG"; true) error/warn lines"
rm -f "$SCRATCH/force-outcome"
stop_backend
