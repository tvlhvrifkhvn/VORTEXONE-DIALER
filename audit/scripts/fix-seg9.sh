#!/usr/bin/env bash
# Segment 9 (F-47, F-48, F-40, F-07, SMS suppression list, unmatched read):
# over the real API, on base and HEAD. Fresh clone of vortex_seg3_tpl migrated
# by <checkout>. Users: seed owner (supervisor, tokS), rep2 (rep, tokA).
# The Groq key used is a FAKE test value; this script never prints it.
#   settings   who can read / write settings; unknown and over-long keys;
#              the app still reads its settings (calling hours, reporting
#              timezone, the AI features via a local fake Groq server)
#   prefs      per-user settings over the API, a server restart; default max
#              attempts on new leads (create + import) vs old leads
#   uploads    real PNG / JPEG / GIF vs HTML, EXE, SVG, a fake .png; headers
#              when served; mediaUrl checks
#   cors       allowed / disallowed origin, preflights, no origin
#   suppress   STOP from an unknown number, then that number created and
#              imported as a lead; START; duplicate STOP; backfill
#   unmatched  marking a text from an unknown number as read
# Controlled clock (fake-now.js, Node only): 2026-11-13 13:30 UTC = 08:30 New York.
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg9.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-settings prefs ui uploads cors suppress unmatched}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg9_api
p() { echo "[$LABEL] $*"; }
OUT="$SCRATCH/seg9-$LABEL"; mkdir -p "$OUT"
SECRET=s9-test-secret-not-real
FAKEKEY="gsk_FAKE_TEST_KEY_0000000000000000WXYZ"

fresh_db() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "insert into settings (key, value) values ('calling_hours_enforced', 'true') on conflict (key) do update set value = 'true'" >/dev/null
}
srv() {
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg9-$LABEL-$PART.txt"
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=${GROQ_URL:-http://127.0.0.1:9} IMPORT_AI=off SMS_WEBHOOK_SECRET=$SECRET FAKE_NOW=2026-11-13T13:30:00Z NODE_OPTIONS="--require $ROOT/audit/stubs/fake-now.js" "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 80); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -s "$API/health" >/dev/null 2>&1 || { p "ABORT: backend did not start"; tail -5 "$SLOG"; exit 1; }
  [ -n "${NOLOGIN:-}" ] && return 0   # the browser test logs in 4 times itself (limit: 5 logins a minute)
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
  login rep2@example.com 'Rep2Pass!' tokA >/dev/null
}
code() { api "$1" "$2" "${3:-}" "${4:-tokS}" > "$SCRATCH/s9-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/s9-last" | grep -oE '[0-9]+'; }
body() { sed -E 's/ \[HTTP.*//' "$SCRATCH/s9-last"; }
err() { grep -oE '"error":"[^"]*"' "$SCRATCH/s9-last" | head -1; }
inbound() { curl -s -w ' [HTTP %{http_code}]' -X POST "$API/api/sms/inbound" -H 'content-type: application/json' -H "x-webhook-secret: $SECRET" -d "{\"from\":\"$1\",\"to\":\"+15550001111\",\"body\":\"$2\"${3:+,\"providerMessageId\":\"$3\"}}"; }
csv() { printf 'Name,Phone,State,Address,Brokerage\n%s\n' "$@" > "$OUT/import.csv"; node "$ROOT/audit/scripts/seg9-import.js" "$SCRATCH/tokS" "$OUT/import.csv"; }

for PART in $PARTS; do case $PART in
settings)
  fresh_db
  # a local fake Groq server: records whether a request carried the stored key (never prints it)
  rm -f "$OUT/groq-seen"
  node -e 'const http=require("http");const k=process.argv[1],f=process.argv[2];http.createServer((q,r)=>{require("fs").appendFileSync(f,(q.headers.authorization==="Bearer "+k?"stored-key":"other-key")+"\n");r.writeHead(500,{"content-type":"application/json"});r.end("{}")}).listen(9911)' "$FAKEKEY" "$OUT/groq-seen" & GROQPID=$!
  GROQ_URL=http://127.0.0.1:9911 srv
  p "== settings API: owner = supervisor (tokS), rep2 = rep (tokA); groq-key set by the owner to a FAKE test key"
  c=$(code PUT /api/settings/groq-key "{\"value\":\"$FAKEKEY\"}" tokS); p "  owner PUT groq-key -> $c"
  for who in tokA tokS; do c=$(code GET /api/settings/groq-key '' $who); p "  $( [ $who = tokA ] && echo rep || echo owner) GET groq-key -> $c; full key in the response: $(body | grep -q "$FAKEKEY" && echo YES || echo no); response: $(body | sed "s/$FAKEKEY/<the full key>/")"; done
  c=$(code PUT /api/settings/calling_hours_enforced '{"value":"false"}' tokA); p "  rep PUT calling_hours_enforced=false -> $c $(err); stored now: $(sql "select value from settings where key='calling_hours_enforced'")"
  c=$(code PUT /api/settings/groq-key '{"value":"gsk_rep_overwrite"}' tokA); p "  rep PUT groq-key -> $c $(err); stored key still the owner's: $(sql "select (value = '$FAKEKEY') from settings where key='groq-key'")"
  c=$(code PUT /api/settings/reporting_timezone '{"value":"America/Chicago"}' tokS); p "  owner PUT reporting_timezone=America/Chicago -> $c"
  c=$(code GET /api/reports/today '' tokA); p "  report period timezone now: $(body | grep -oE '"timezone":"[^"]*"')"
  c=$(code PUT /api/settings/calling_hours_enforced '{"value":"false"}' tokS); p "  owner PUT calling_hours_enforced=false -> $c; GET as rep -> $(code GET /api/settings/calling_hours_enforced '' tokA) $(body)"
  code PUT /api/settings/calling_hours_enforced '{"value":"true"}' tokS >/dev/null
  c=$(code PUT /api/settings/anything-at-all '{"value":"x"}' tokS); p "  owner PUT unknown key anything-at-all -> $c $(err)"
  c=$(code GET /api/settings/anything-at-all '' tokS); p "  owner GET unknown key -> $c $(err)"
  K=$(printf 'k%.0s' $(seq 1 101)); c=$(code PUT /api/settings/$K '{"value":"x"}' tokS); p "  owner PUT a 101-char key -> $c $(err)"
  V=$(printf 'v%.0s' $(seq 1 3000)); c=$(code PUT /api/settings/calling_hours_enforced "{\"value\":\"$V\"}" tokS); p "  owner PUT calling_hours_enforced = 3,000 chars -> $c $(err)"
  c=$(code PUT /api/settings/groq-key "{\"value\":\"$V\"}" tokS); p "  owner PUT groq-key = 3,000 chars -> $c $(err)"
  c=$(code POST /api/ai/expand-note '{"note":"called, left vm"}' tokA); sleep 0.5
  p "  AI feature (expand note) still reads the stored key: requests to the fake Groq server: $(sort "$OUT/groq-seen" 2>/dev/null | uniq -c | tr -s ' ' | tr '\n' ';')"
  p "  settings rows now: $(sql "select string_agg(key, ', ' order by key) from settings")"
  p "  server log: 'CORS'/'value too long' lines: $(grep -ciE 'too long|cors' "$SLOG"; true)"
  kill $GROQPID 2>/dev/null ;;
prefs)
  fresh_db; srv
  p "== per-user settings (API) and default max attempts"
  for k in daily_goal default_lines pitch_script; do
    v=$([ $k = daily_goal ] && echo 150 || ([ $k = default_lines ] && echo 2 || echo "Hi, this is Rep Two from Vortexone"))
    c=$(code PUT /api/settings/me/$k "{\"value\":\"$v\"}" tokA); p "  rep PUT /settings/me/$k=\"$v\" -> $c $(err)"
  done
  c=$(code GET /api/settings/me '' tokA); p "  rep GET /settings/me -> $c $(body | cut -c1-200)"
  c=$(code GET /api/settings/me '' tokS); p "  owner GET /settings/me -> $c $(body | cut -c1-200)"
  c=$(code PUT /api/settings/me/not_a_pref '{"value":"1"}' tokA); p "  rep PUT /settings/me/not_a_pref -> $c $(err)"
  srv
  c=$(code GET /api/settings/me '' tokA); p "  after a server restart, rep GET /settings/me -> $c $(body | cut -c1-200)"
  c=$(code PUT /api/settings/default_max_attempts '{"value":"8"}' tokA); p "  rep PUT default_max_attempts=8 -> $c $(err)"
  c=$(code PUT /api/settings/default_max_attempts '{"value":"0"}' tokS); p "  owner PUT default_max_attempts=0 -> $c $(err)"
  c=$(code PUT /api/settings/default_max_attempts '{"value":"8"}' tokS); p "  owner PUT default_max_attempts=8 -> $c $(err)"
  OLD=$(sql "select string_agg(distinct max_attempts::text, ',') from leads"); OLDN=$(sql "select count(*) from leads")
  c=$(code POST /api/leads '{"name":"New Manual Lead","phone":"212-555-8801","state":"NY"}' tokS); NEWID=$(body | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
  p "  lead created via POST /api/leads -> $c, its max_attempts: $(sql "select max_attempts from leads where id=${NEWID:-0}")"
  r=$(csv "Imp One,212-555-8802,NY,1 A St Albany NY,X Realty" "Imp Two,212-555-8803,NY,2 B St Albany NY,Y Realty")
  p "  import of 2 leads -> imported $(grep -oE '"imported(Total)?":[0-9]+' <<<"$r" | head -1); their max_attempts: $(sql "select string_agg(max_attempts::text, ',') from leads where phone in ('+12125558802','+12125558803')")"
  p "  the $OLDN leads that existed before: max_attempts values $(sql "select string_agg(distinct max_attempts::text, ',') from leads where id <= (select max(id) from leads) - 3") (were $OLD)" ;;
ui)
  fresh_db
  sql "insert into settings (key, value) values ('groq-key', '$FAKEKEY') on conflict (key) do update set value = excluded.value" >/dev/null   # DIRECT SQL: the fake key
  NOLOGIN=1 srv
  pkill -f "vite preview"; ( cd "$CO/frontend" && npx vite build > "$OUT/ui-build.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$OUT/ui-fe.txt" 2>&1 < /dev/null & )
  for i in $(seq 1 120); do curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
  p "== browser (production build)"
  NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg9-ui.js" http://localhost:5173 2>&1 | sed "s/$FAKEKEY/<the full key>/g; s/^/[$LABEL]   /"
  pkill -f "vite preview" ;;
uploads)
  fresh_db; srv
  p "== uploads (POST /api/sms/upload-media as rep)"
  F="$OUT/files"; mkdir -p "$F"
  node -e '
    const fs=require("fs"),d=process.argv[1];
    fs.writeFileSync(d+"/real.png",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==","base64"));
    fs.writeFileSync(d+"/real.gif",Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64"));
    fs.writeFileSync(d+"/page.html","<html><body><script>alert(1)</script></body></html>");
    fs.writeFileSync(d+"/tool.exe",Buffer.concat([Buffer.from("MZ"),Buffer.alloc(200)]));
    fs.writeFileSync(d+"/pic.svg","<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");
    fs.writeFileSync(d+"/fake.png","<html><script>alert(1)</script></html>");
    fs.writeFileSync(d+"/fake.jpg","GIF89a but actually text");' "$F"
  # a real JPEG: page 1 of a bundled PDF rendered by pdftoppm
  PDF=$(ls /var/tmp/audit-scratch/seg7-after/*.pdf | head -1); pdftoppm -jpeg -r 8 -f 1 -l 1 "$PDF" "$F/jp"; mv "$F"/jp*.jpg "$F/real.jpg"
  for f in real.png real.jpg real.gif page.html tool.exe pic.svg fake.png fake.jpg; do
    r=$(curl -s -w ' [HTTP %{http_code}]' -X POST "$API/api/sms/upload-media" -H "authorization: Bearer $(cat $SCRATCH/tokA)" -F "file=@$F/$f")
    u=$(grep -oE '"url":"[^"]*"' <<<"$r" | cut -d'"' -f4)
    if [ -n "$u" ]; then h=$(curl -s -D - -o /dev/null "$API$u"); served="served $(grep -i '^content-type' <<<"$h" | tr -d '\r' | cut -c15-) nosniff=$(grep -qi 'x-content-type-options: nosniff' <<<"$h" && echo yes || echo no) (no token needed: $(grep -oE 'HTTP/[0-9.]+ [0-9]+' <<<"$h"))"; else served=""; fi
    p "  $f ($(file -b --mime-type "$F/$f")) -> $(grep -oE 'HTTP [0-9]+' <<<"$r") $(grep -oE '"error":"[^"]*"' <<<"$r") ${u:+url ${u##*.} file} $served"
    [ "$f" = real.png ] && GOODURL=$u
  done
  echo '<html><script>alert(1)</script></html>' > "$CO/backend/uploads/1700000000000-abcdef123456.html"   # an HTML upload left over from before the fix
  h=$(curl -s -D - -o /dev/null "$API/uploads/1700000000000-abcdef123456.html"); p "  old uploaded HTML file still on disk -> GET $(grep -oE 'HTTP/[0-9.]+ [0-9]+' <<<"$h" | cut -d' ' -f2) $(grep -i '^content-type' <<<"$h" | tr -d '\r')"
  rm -f "$CO/backend/uploads/1700000000000-abcdef123456.html"
  ANA=$(sql "insert into leads (name, phone, state, address, brokerage, status) values ('Media Lead', '+12125558811', 'NY', 'Albany, NY', 'M Realty', 'new') returning id")
  for m in "$GOODURL" "https://evil.example.com/x.png" "/uploads/does-not-exist.png" "/uploads/../package.json"; do c=$(code POST /api/sms/send "{\"leadId\":$ANA,\"rawBody\":\"Photo\",\"mediaUrl\":\"$m\"}" tokA); p "  send with mediaUrl \"$m\" -> $c $(err)"; done ;;
cors)
  fresh_db; srv CORS_ORIGIN=http://localhost:5173 NODE_ENV=development
  p "== CORS (allowed origin http://localhost:5173)"
  for o in http://localhost:5173 https://evil.example.com ""; do
    h=$(curl -s -D - -o /dev/null "$API/api/leads?limit=1" -H "authorization: Bearer $(cat $SCRATCH/tokS)" ${o:+-H "Origin: $o"})
    pf=$(curl -s -D - -o /dev/null -X OPTIONS "$API/api/leads" ${o:+-H "Origin: $o"} -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization')
    p "  origin ${o:-<none>}: GET -> $(grep -oE 'HTTP/[0-9.]+ [0-9]+' <<<"$h" | cut -d' ' -f2), allow-origin: $(grep -i '^access-control-allow-origin' <<<"$h" | tr -d '\r' | cut -d' ' -f2- || echo -); preflight -> $(grep -oE 'HTTP/[0-9.]+ [0-9]+' <<<"$pf" | cut -d' ' -f2), allow-origin: $(grep -i '^access-control-allow-origin' <<<"$pf" | tr -d '\r' | cut -d' ' -f2- || echo -)"
  done
  sleep 0.5
  p "  server log: 'Not allowed by CORS' lines $(grep -c 'Not allowed by CORS' "$SLOG"; true), stack-trace lines $(grep -cE '^\s+at ' "$SLOG"; true)" ;;
suppress)
  # an opted-out lead that exists BEFORE this checkout's migrations run (backfill check)
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  sql "insert into leads (name, phone, state, status, sms_opt_out) values ('Old Optout', '+12125558820', 'NY', 'new', true)" >/dev/null
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "insert into settings (key, value) values ('calling_hours_enforced', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  srv
  p "== SMS opt-out by phone number"
  p "  backfill: old opted-out lead's phone in sms_suppressions: $(sql "select count(*) from sms_suppressions where phone='+12125558820'" 2>/dev/null || echo 'n/a (no table)')"
  r=$(inbound "212-555-8830" "STOP" "s9-a"); r2=$(inbound "212-555-8830" "STOP" "s9-b")
  p "  STOP twice from unknown (212) 555-8830 -> $(grep -oE 'HTTP [0-9]+' <<<"$r"), $(grep -oE 'HTTP [0-9]+' <<<"$r2"); suppression rows for it: $(sql "select count(*) from sms_suppressions where phone='+12125558830'" 2>/dev/null || echo n/a)"
  c=$(code POST /api/leads '{"name":"Later Lead","phone":"212-555-8830","state":"NY"}' tokS); L1=$(body | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
  p "  lead created later with that number -> $c; sms_opt_out: $(sql "select sms_opt_out from leads where id=${L1:-0}"); dnc_flag: $(sql "select dnc_flag from leads where id=${L1:-0}")"
  inbound "212-555-8831" "stop" >/dev/null
  r=$(csv "Imported Later,212-555-8831,NY,1 C St Albany NY,Z Realty" "Imported Normal,212-555-8832,NY,2 C St Albany NY,Z Realty")
  p "  import of 2 leads, one with a STOPped number -> summary $(grep -oE '"(imported|importedTotal|smsOptedOut)":[0-9]+' <<<"$r" | tr '\n' ' '); sms_opt_out: $(sql "select string_agg(name||'='||sms_opt_out||'/dnc='||dnc_flag, ', ' order by name) from leads where phone in ('+12125558831','+12125558832')")"
  L2=$(sql "select id from leads where phone='+12125558831'")
  c=$(code POST /api/sms/send "{\"leadId\":${L1:-0},\"rawBody\":\"Hello\"}" tokS); p "  single text to the suppressed lead -> $c $(err)"
  sql "update leads set sms_opt_out=false where id=${L1:-0}" >/dev/null   # DIRECT SQL: the lead flag off, the phone still suppressed
  c=$(code POST /api/sms/send "{\"leadId\":${L1:-0},\"rawBody\":\"Hello\"}" tokS); p "  same, with only the phone suppressed (lead flag cleared by DIRECT SQL) -> $c $(err)"
  c=$(code POST /api/sms/templates '{"name":"s","body":"Hello {{first_name}}"}' tokS); T=$(body | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
  c=$(code POST /api/sms/bulk-send "{\"leadIds\":[${L1:-0},${L2:-0}],\"templateId\":$T}" tokS); p "  bulk to both -> $c $(body)"
  inbound "212-555-8830" "START" >/dev/null
  p "  START from (212) 555-8830 -> suppression rows: $(sql "select count(*) from sms_suppressions where phone='+12125558830'" 2>/dev/null || echo n/a); lead sms_opt_out: $(sql "select sms_opt_out from leads where id=${L1:-0}")"
  c=$(code POST /api/sms/send "{\"leadId\":${L1:-0},\"rawBody\":\"Hello again\"}" tokS); p "  text after START -> $c $(err)"
  p "  calls not blocked: dial the imported STOPped lead -> $(code POST /api/calls "{\"leadId\":${L2:-0}}" tokS) $(err)" ;;
unmatched)
  fresh_db; srv
  p "== texts from unknown numbers: mark read"
  inbound "+13125550601" "Who is this?" >/dev/null; inbound "+13125550602" "Wrong number" >/dev/null
  M=$(sql "insert into leads (name, phone, state, status) values ('Known Sender', '+12125558840', 'NY', 'new') returning id"); inbound "212-555-8840" "Call me back" >/dev/null
  c=$(code GET '/api/sms/inbox?page=1&limit=20' '' tokS); p "  inbox before: $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`leads unread ${(j.leads||[]).map(l=>l.leadName+"="+l.unreadCount).join(",")}; unknown-number messages ${(j.unmatched||[]).length} (unread ${(j.unmatched||[]).filter(u=>u.isRead===false).length}); unmatchedUnread=${j.unmatchedUnread}`)})')"
  MID=$(sql "select id from sms_messages where lead_id is null and from_number='+13125550601'")
  c=$(code POST /api/sms/mark-read-unmatched/$MID '' tokS); p "  mark one unknown-number message read -> $c $(err)"
  KM=$(sql "select id from sms_messages where lead_id=$M and direction='inbound'")
  c=$(code POST /api/sms/mark-read-unmatched/$KM '' tokS); p "  the new route on a KNOWN lead's message -> $c $(err)"
  c=$(code POST /api/sms/mark-read/$M '' tokS); p "  mark the known lead read (unchanged route) -> $c"
  c=$(code GET '/api/sms/inbox?page=1&limit=20' '' tokS); p "  inbox after: $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`leads unread ${(j.leads||[]).map(l=>l.leadName+"="+l.unreadCount).join(",")||"none"}; unknown-number messages ${(j.unmatched||[]).length} (unread ${(j.unmatched||[]).filter(u=>u.isRead===false).length}); unmatchedUnread=${j.unmatchedUnread}`)})')"
  p "  DB: unread inbound with no lead: $(sql "select count(*) from sms_messages where lead_id is null and direction='inbound' and not is_read")" ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG" 2>/dev/null; true) error/warn lines"
done
stop_backend
