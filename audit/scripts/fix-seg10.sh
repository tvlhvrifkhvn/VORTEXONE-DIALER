#!/usr/bin/env bash
# Segment 10 cleanup items over the real API, on base and HEAD. Fresh clone of
# vortex_seg3_tpl migrated by <checkout>; test rows by DIRECT SQL (labelled).
#   seed      F-06: a fresh seed, then a login with the old committed default
#   validate  F-53: bad page / limit / dates, LIKE wildcards, bodies, a 500's text
#   names     F-54: a 10,000-character name on create / edit / import; dashboard layout
#   busy      F-05: busy lines with the mock (sends 'busy') and with a stub that
#             never sends it (audit/stubs/no-busy.js): same end state?
#   coach     F-42 / F-43 / F-44 with the local Groq stub (never the real Groq)
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg10.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-seed validate names busy coach}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg10_api
p() { echo "[$LABEL] $*"; }
OUT="$SCRATCH/seg10-$LABEL"; mkdir -p "$OUT"

fresh_db() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "insert into settings (key, value) values ('calling_hours_enforced', 'false') on conflict (key) do update set value = 'false'" >/dev/null
}
srv() {
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg10-$LABEL-$PART.txt"
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=${GROQ_URL:-http://127.0.0.1:9} IMPORT_AI=off NODE_OPTIONS="--require $ROOT/audit/stubs/force-outcome.js ${EXTRA_REQUIRE:-}" "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 80); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -s "$API/health" >/dev/null 2>&1 || { p "ABORT: backend did not start"; tail -5 "$SLOG"; exit 1; }
  [ -n "${NOLOGIN:-}" ] && return 0
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
  login rep2@example.com 'Rep2Pass!' tokA >/dev/null
}
code() { api "$1" "$2" "${3:-}" "${4:-tokS}" > "$SCRATCH/s10-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/s10-last" | grep -oE '[0-9]+'; }
body() { sed -E 's/ \[HTTP.*//' "$SCRATCH/s10-last"; }
err() { grep -oE '"error":"[^"]*"' "$SCRATCH/s10-last" | head -1 | cut -c1-140; }
raw() { curl -s -w ' [HTTP %{http_code}]' -X "$1" "$API$2" -H "authorization: Bearer $(cat $SCRATCH/tokS)" ${3:+-H "content-type: $3"} ${4:+--data-binary "$4"}; }

for PART in $PARTS; do case $PART in
seed)
  PART=seed
  OLD=$(git -C "$ROOT" show 475ee4c^:backend/src/db/seeds/run.js | sed -n -E "s/^const SEED_PASSWORD = process.env.SEED_USER_PASSWORD \|\| '([^']+)';/\1/p")
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS vortex_seg10_f06" -c "CREATE DATABASE vortex_seg10_f06 OWNER vortex TEMPLATE vortex_empty" >/dev/null 2>&1
  p "== F-06: fresh seed (SEED_USER_PASSWORD unset), then logins"
  ( cd "$CO/backend" && OLD_DEFAULT_PASSWORD="$OLD" bash "$ROOT/audit/scripts/fix-seg1-f06.sh" vortex_seg10_f06 "$LABEL" 2>&1 ) | grep -E "password|login|HTTP" | sed "s/^/[$LABEL]   /"
  pkill -f "PORT=4100" 2>/dev/null; SLOG=/dev/null ;;
validate)
  fresh_db
  sql "insert into leads (name, phone, state, status) values ('Agent 100% Realty', '+12125559001', 'NY', 'new'), ('Under_score Homes', '+12125559002', 'NY', 'new'), ('Plain Name', '+12125559003', 'NY', 'new')" >/dev/null
  srv
  p "== F-53: GET /api/leads parameters"
  for q in "page=abc" "page=0" "limit=-5" "limit=1.5" "limit=99999" "limit=200" "dateFrom=garbage" "dateTo=2026-13-45" "dateFrom=2026-11-01"; do
    c=$(code GET "/api/leads?$q"); p "  ?$q -> $c $(err) $( [ "$c" = 200 ] && echo "rows $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).leads.length))')")"
  done
  for s in "%25" "_" "100%25" "Under_"; do
    c=$(code GET "/api/leads?search=$s&limit=10000"); p "  search \"$(node -e 'console.log(decodeURIComponent(process.argv[1]))' "$s")\" -> $c, matches $(body | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.total+" ("+j.leads.slice(0,3).map(l=>l.name).join(", ")+(j.total>3?", …":"")+")")})')"
  done
  c=$(code GET "/api/leads/search?q=%25"); p "  navbar search \"%\" -> $c, matches $(body | grep -o '"name"' | wc -l)"
  p "== F-53: request bodies"
  p "  POST /api/leads no body -> $(raw POST /api/leads | grep -oE 'HTTP [0-9]+|"error":"[^"]*"' | tr '\n' ' ')"
  p "  POST /api/leads JSON array -> $(raw POST /api/leads application/json '[1,2]' | grep -oE 'HTTP [0-9]+|"error":"[^"]*"' | tr '\n' ' ')"
  p "  POST /api/leads JSON string -> $(raw POST /api/leads application/json '"x"' | grep -oE 'HTTP [0-9]+|"error":"[^"]*"' | tr '\n' ' ')"
  L=$(sql "select id from leads where name='Plain Name'")
  p "  PUT /api/leads/$L no body -> $(raw PUT /api/leads/$L | grep -oE 'HTTP [0-9]+|"error":"[^"]*"' | tr '\n' ' ')"
  p "== F-53: an unexpected server error (a database error)"
  p "  GET /api/leads/not-a-number -> $(raw GET /api/leads/not-a-number | grep -oE 'HTTP [0-9]+|"error":"[^"]*"' | tr '\n' ' ')"
  p "  server log has the detail: $(grep -c 'invalid input syntax' "$SLOG"; true) line(s)" ;;
names)
  fresh_db; srv
  N=$(printf 'N%.0s' $(seq 1 10000))
  p "== F-54: a 10,000-character name"
  c=$(code POST /api/leads "{\"name\":\"$N\",\"phone\":\"212-555-9101\",\"state\":\"NY\"}"); p "  create -> $c $(err)"
  L=$(sql "select id from leads order by id limit 1")
  c=$(code PUT /api/leads/$L "{\"name\":\"$N\"}"); p "  edit -> $c $(err)"
  printf 'Name,Phone,State,Address,Brokerage\n%s,212-555-9102,NY,1 Long St Albany NY,%s\nShort Name,212-555-9103,NY,2 Long St Albany NY,Ok Realty\n' "$N" "$(printf 'Brokerage %.0s' $(seq 1 60))" > "$OUT/long.csv"
  r=$(node "$ROOT/audit/scripts/seg9-import.js" "$SCRATCH/tokS" "$OUT/long.csv")
  p "  import (1 long name + 1 normal) -> imported $(grep -oE '"imported":[0-9]+' <<<"$r"), namesTrimmed: $(grep -oE '"namesTrimmed":[0-9]+' <<<"$r" || echo 'not reported'); stored name length: $(sql "select length(name) from leads where phone='+12125559102'")"
  pkill -f "vite preview"; ( cd "$CO/frontend" && npx vite build > "$OUT/build.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$OUT/fe.txt" 2>&1 < /dev/null & )
  for i in $(seq 1 120); do curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
  NODE_PATH=$(npm root -g) node -e '
    const { chromium } = require("playwright");
    (async () => {
      const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
      await p.goto(process.argv[1] + "/login"); await p.fill("input[type=email]", "vortexoneagency@gmail.com"); await p.fill("input[type=password]", process.env.AUDIT_PASSWORD);
      await p.click("button[type=submit]"); await p.waitForTimeout(2500);
      await p.fill("input[placeholder*=earch]", "NNNNNNNN").catch(() => {}); await p.waitForTimeout(1500);
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      console.log(`dashboard at 1280px wide: page width ${m.sw}px vs window ${m.cw}px -> sideways scroll: ${m.sw > m.cw ? "YES" : "no"}`);
      await p.screenshot({ path: process.argv[2], fullPage: false }); await b.close();
    })().catch((e) => { console.log("FAILED: " + e.message.split("\n")[0]); process.exit(1); });' http://localhost:5173 "$OUT/dashboard-long-name.png" 2>&1 | sed "s/^/[$LABEL]   /"
  p "  screenshot: $OUT/dashboard-long-name.png"
  pkill -f "vite preview" ;;
busy)
  for mode in mock no-busy; do
    fresh_db
    sql "update leads set status='cold' where id > 20" >/dev/null   # DIRECT SQL: only leads 1-20 in the queue
    echo busy > "$SCRATCH/force-outcome"
    if [ $mode = no-busy ]; then EXTRA_REQUIRE="--require $ROOT/audit/stubs/no-busy.js" srv; else srv; fi
    T0=$(sql "select now()")
    node "$ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokA" 3 9 '[{"at":8,"do":"stop"}]' > "$OUT/busy-$mode.txt" 2>&1
    c=$(code POST /api/calls '{}' tokS); C=$(body | grep -oE '"call":\{"id":[0-9]+' | grep -oE '[0-9]+$'); sleep 6
    p "== F-05 busy lines, adapter: $mode ($( [ $mode = mock ] && echo "sends 'busy' then 'ended'" || echo "never sends 'busy', only 'ended'"))"
    p "  multi-line 9 s: slot events $(grep -oE 'byStatus=[^ ]*' "$OUT/busy-$mode.txt")"
    p "  leads dialed: $(sql "select string_agg(st||'='||n, ', ') from (select l.status||' attempts '||l.attempts||(case when l.next_action_at > now() then ' requeued' else '' end) st, count(*) n from leads l where l.id in (select lead_id from call_history where started_at >= '$T0' and session_id is not null) group by 1) s")"
    p "  their calls: $(sql "select string_agg(st||'='||n, ', ') from (select coalesce(disposition,'-')||'/'||telephony_state||(case when ended_at is null then '/open' else '' end) st, count(*) n from call_history where started_at >= '$T0' and session_id is not null group by 1) s")"
    p "  single-line call: $(sql "select coalesce(disposition,'-')||'/'||telephony_state||(case when ended_at is null then '/open' else '/ended' end) from call_history where id=${C:-0}")"
    rm -f "$SCRATCH/force-outcome"
  done ;;
coach)
  fresh_db
  # office colleagues: lead A (the brief) + B and C at the same office; B interested first, then C too
  A=$(sql "insert into leads (name, phone, state, status, brokerage, address, office_key) values ('Brief Lead', '+12125559201', 'NY', 'new', 'Coach Realty', '1 Main St, Albany, NY', 'coach realty|albany|ny') returning id")
  B=$(sql "insert into leads (name, phone, state, status, brokerage, address, office_key) values ('Colleague B', '+12125559202', 'NY', 'contacted', 'Coach Realty', '1 Main St, Albany, NY', 'coach realty|albany|ny') returning id")
  CC=$(sql "insert into leads (name, phone, state, status, brokerage, address, office_key) values ('Colleague C', '+12125559203', 'NY', 'new', 'Coach Realty', '1 Main St, Albany, NY', 'coach realty|albany|ny') returning id")
  U=$(sql "select id from users where email='vortexoneagency@gmail.com'")
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, ended_at, disposition) values ($B, $U, '+1555', true, 'ended', now() - interval '2 days', now() - interval '2 days', 'contacted')" >/dev/null
  # objection data for the rebuttal coach (DIRECT SQL): type 1, 12 instances, 4 positive
  T=$(sql "select id from objection_types order by id limit 1")
  sql "with c as (insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, ended_at, disposition)
        select (select id from leads where id > 100 order by id limit 1 offset g), $U, '+1555', true, 'ended', now() - g * interval '1 hour', now() - g * interval '1 hour', case when g % 3 = 0 then 'contacted' else 'no_answer' end from generate_series(1, 12) g returning id, lead_id)
       insert into call_objections (call_id, lead_id, objection_type_id, rebuttal_used) select id, lead_id, $T, 'We help with follow-up so you can focus on showings.' from c" >/dev/null
  echo '{"rebuttal":["clean","clean","clean"],"brief":"ok"}' > "$SCRATCH/groq-stub-mode.json"
  pkill -f groq-stub-server 2>/dev/null; ( exec setsid node "$ROOT/audit/stubs/groq-stub-server.js" > "$OUT/stub.txt" 2>&1 < /dev/null & ); sleep 0.5
  GROQ_URL=http://127.0.0.1:4999 srv
  code PUT /api/settings/groq-key '{"value":"gsk_FAKE_STUB_KEY_000000000000"}' >/dev/null
  p "== F-42 pre-call brief opener (lead $A)"
  c=$(code GET "/api/leads/$A/brief?ai=0"); p "  1 interested colleague -> $(body | grep -oE '"opener":"[^"]*"')"
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, ended_at, disposition) values ($CC, $U, '+1555', true, 'ended', now() - interval '1 day', now() - interval '1 day', 'contacted')" >/dev/null
  sql "update leads set status='contacted' where id=$CC" >/dev/null
  c=$(code GET "/api/leads/$A/brief?ai=0"); p "  2 interested colleagues -> $(body | grep -oE '"opener":"[^"]*"')"
  p "== F-44 regenerate three times (stub returns 3 clean suggestions each time)"
  for i in 1 2 3; do c=$(code POST /api/objections/types/$T/suggestions/regenerate '{}'); p "  regenerate $i -> $c; list shows $(body | grep -o '"status":"pending"' | wc -l) pending"; done
  p "  DB: pending $(sql "select count(*) from rebuttal_suggestions where objection_type_id=$T and status='pending'"), expired $(sql "select count(*) from rebuttal_suggestions where objection_type_id=$T and status='expired'" 2>/dev/null)"
  c=$(code GET /api/objections/suggestions/pending); p "  reviewer queue: $(body | grep -o '"id":' | wc -l) pending"
  p "== F-43 approving a flagged suggestion (rows by DIRECT SQL)"
  BAD=$(sql "insert into rebuttal_suggestions (objection_type_id, suggestion, based_on_count, status, review_note) values ($T, 'Our innovative solution will optimize your day.', 12, 'pending', 'needs manual rewrite: used ''innovative'', ''optimize''') returning id")
  BAD2=$(sql "insert into rebuttal_suggestions (objection_type_id, suggestion, based_on_count, status, review_note) values ($T, 'We leverage seamless synergy to unlock your growth.', 12, 'pending', null) returning id")
  GOOD=$(sql "insert into rebuttal_suggestions (objection_type_id, suggestion, based_on_count, status) values ($T, 'Totally fair. Most agents we help felt the same until they saw a week of follow-ups done for them.', 12, 'pending') returning id")
  for s in "$BAD:flagged with a note" "$BAD2:banned phrases, no note" "$GOOD:clean"; do c=$(code PUT /api/objections/suggestions/${s%%:*} '{"status":"approved"}'); p "  approve ${s#*:} -> $c $(err)"; done
  c=$(code GET /api/objections/hints); p "  call-screen hint now: $(body | grep -oE '"text":"[^"]*"' | head -1)"
  pkill -f groq-stub-server ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG" 2>/dev/null; true) error/warn lines"
done
stop_backend
