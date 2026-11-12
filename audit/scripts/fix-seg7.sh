#!/usr/bin/env bash
# Segment 7 (F-34, F-45, F-46, F-49, failed dials): reports, the PDF and the
# reporting day, over the real API, on base and HEAD.
# Fresh clone of vortex_seg3_tpl migrated by <checkout>. Calls are inserted by
# DIRECT SQL at fixed instants (test shortcut, labelled): each one at a wall
# time in a named zone, e.g. 2026-11-10 23:59:30 Asia/Karachi. "DB" numbers are
# counted straight from call_history with independent SQL (a dial = a row whose
# telephony_state is not 'failed').
#   periods    5 periods (empty past day, past day with a known mix, today, a
#              1,500-call day, a range across midnight): dashboard API
#              (/reports/today), PDF headline, PDF table and DB, side by side
#   boundary   calls 30 s either side of midnight (Asia/Karachi)
#   tz         reporting_timezone = America/Chicago moves the day
#   daystart   day_start_time = 06:00 moves the day
#   failed     3 dials refused by the phone provider (TELEPHONY_PROVIDER=bogus)
#              + 1 dial-pad: before vs after in the counters and the PDF
#   validate   bad dates and ranges -> HTTP codes
#   goal       controlled clock: the dashboard counter across midnight and
#              across 05:00 Karachi (= midnight UTC), with day start 00:00
#   fonts      accented names, emoji, <script>: PDF text + page image
#   perf       100,000 calls over 90 days: report timings
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg7.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-periods boundary tz daystart failed validate goal fonts ui perf}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg7_api
p() { echo "[$LABEL] $*"; }
OUT="$SCRATCH/seg7-$LABEL"; mkdir -p "$OUT"

fresh_db() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "delete from call_history" >/dev/null   # DIRECT SQL: start from no calls
  SEED_UID=$(sql "select id from users where email='vortexoneagency@gmail.com'")
}
srv() {   # srv [env...]
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg7-$LABEL-$PART.txt"
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off NODE_OPTIONS="--require $ROOT/audit/stubs/fake-now.js" "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 120); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -s "$API/health" >/dev/null 2>&1 || { p "ABORT: backend did not start"; tail -5 "$SLOG"; exit 1; }
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
  login rep2@example.com 'Rep2Pass!' tokA >/dev/null
}
# call <wall time> <zone> <disposition|-> [state] [note] [lead]  (DIRECT SQL)
call() {
  local disp="NULL"; [ "$3" != - ] && disp="'$3'"
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, ended_at, duration_seconds, disposition, note)
       values (${6:-1}, $SEED_UID, '+15550000000', true, '${4:-ended}', timestamp '$1' at time zone '$2', timestamp '$1' at time zone '$2' + interval '65 seconds', 65, $disp, \$\$${5:-}\$\$)" >/dev/null
}
# dbcount <start wall> <end wall> <zone> -> "dials contacts voicemails noAnswers dnc"
dbcount() {
  sql "select count(*)||' '||count(*) filter (where disposition='contacted')||' '||count(*) filter (where disposition='voicemail')||' '||count(*) filter (where disposition='no_answer')||' '||count(*) filter (where disposition='dnc')
       from call_history where telephony_state is distinct from 'failed' and started_at >= timestamp '$1' at time zone '$3' and started_at < timestamp '$2' at time zone '$3'" | tr '|' ' '
}
apinums() { api GET "/api/reports/today$1" '' tokS | sed -E 's/ \[HTTP.*//' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.error?"error: "+j.error:`${j.dials} ${j.contacts} cr=${j.connectRate}%`+(j.period?` [${j.period.label}, ${j.period.timezone}]`:" [no period info]"))}catch{console.log("unparseable: "+s.slice(0,80))}})'; }
pdfnums() {   # pdfnums <query> <name>
  local f="$OUT/$2.pdf"
  local code; code=$(curl -s -o "$f" -w '%{http_code}' "$API/api/exports/daily-pdf$1" -H "authorization: Bearer $(cat $SCRATCH/tokS)")
  [ "$code" = 200 ] || { echo "HTTP $code"; return; }
  node "$ROOT/audit/scripts/pdf-numbers.js" "$f" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const h=j.headline||{};const st=j.status;console.log(`headline ${h.dials} ${h.contacts} ${h.voicemails} ${h.noAnswers} ${h.dnc} cr=${h.connectRate} | table rows ${j.rows} (contacted ${st.Contacted||0}, vm ${st.Voicemail||0}, na ${st["No Answer"]||0}, dnc ${st.DNC||0})${j.empty?" | says: No calls recorded":""} | header: ${j.header[1]||""}`)})'
}

for PART in $PARTS; do case $PART in
periods)
  fresh_db
  # past day with a known mix: 3 contacted, 2 voicemail, 4 no_answer, 1 dnc, 1 not logged, 2 refused (failed)
  for t in 09:00 10:00 11:00; do call "2026-11-10 $t:00" Asia/Karachi contacted; done
  for t in 12:00 13:00; do call "2026-11-10 $t:00" Asia/Karachi voicemail; done
  for t in 14:00 15:00 16:00 17:00; do call "2026-11-10 $t:00" Asia/Karachi no_answer; done
  call "2026-11-10 18:00:00" Asia/Karachi dnc; call "2026-11-10 19:00:00" Asia/Karachi -
  call "2026-11-10 20:00:00" Asia/Karachi - failed; call "2026-11-10 20:05:00" Asia/Karachi - failed
  # a 1,500-call day
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, ended_at, duration_seconds, disposition)
       select 1 + g % 400, $SEED_UID, '+15550000000', true, 'ended', (timestamp '2026-11-03 00:00' at time zone 'Asia/Karachi') + g * interval '50 seconds', null, g % 300,
              (array['contacted','voicemail','no_answer','dnc','callback_scheduled'])[1 + g % 5] from generate_series(0, 1499) g" >/dev/null
  # today (real clock, Karachi): 4 calls in the last 2 hours of today, plus 1 refused
  TODAY=$(TZ=Asia/Karachi date +%F); NOWK=$(TZ=Asia/Karachi date +%H:%M:%S)
  for d in contacted voicemail no_answer -; do sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, duration_seconds, disposition) values (2, $SEED_UID, '+1555', true, 'ended', greatest(now() - interval '1 minute', timestamp '$TODAY 00:00:05' at time zone 'Asia/Karachi'), 30, $( [ $d = - ] && echo NULL || echo "'$d'"))" >/dev/null; done
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, duration_seconds) values (2, $SEED_UID, '+1555', true, 'failed', now() - interval '1 minute', 0)" >/dev/null
  # range across midnight: Nov 7 22:00 -> Nov 8 04:00 Karachi
  call "2026-11-07 21:59:00" Asia/Karachi contacted; call "2026-11-07 23:00:00" Asia/Karachi contacted; call "2026-11-08 01:00:00" Asia/Karachi voicemail; call "2026-11-08 03:59:00" Asia/Karachi no_answer; call "2026-11-08 04:01:00" Asia/Karachi dnc
  srv
  p "== 5 periods: dashboard/report API (/reports/today) | PDF headline vs PDF table | DB count (dials contacts vm na dnc), Asia/Karachi"
  for spec in "empty past day|?date=2026-11-05|2026-11-05 00:00|2026-11-06 00:00" "past day, known mix|?date=2026-11-10|2026-11-10 00:00|2026-11-11 00:00" "today ($TODAY, Karachi)||$TODAY 00:00|$(TZ=Asia/Karachi date -d "$TODAY +1 day" +%F) 00:00" "1,500-call day|?date=2026-11-03|2026-11-03 00:00|2026-11-04 00:00" "range across midnight|?from=2026-11-07T22:00&to=2026-11-08T04:00|2026-11-07 22:00|2026-11-08 04:00"; do
    IFS='|' read -r name q s e <<<"$spec"
    p "  $name ($s -> $e)"
    p "    DB:        $(dbcount "$s" "$e" Asia/Karachi)"
    p "    API:       $(apinums "$q")"
    p "    PDF:       $(pdfnums "$q" "period-$(echo "$name" | tr -cd 'a-z0-9')")"
  done ;;
boundary)
  fresh_db
  call "2026-11-10 23:59:30" Asia/Karachi contacted '' '' 1; call "2026-11-11 00:00:30" Asia/Karachi voicemail '' '' 2
  srv
  p "== midnight in Asia/Karachi: a contacted call at 23:59:30 Nov 10, a voicemail at 00:00:30 Nov 11 (= 18:59:30 / 19:00:30 UTC Nov 10)"
  for d in 2026-11-10 2026-11-11; do p "  date=$d: API $(apinums "?date=$d") | PDF $(pdfnums "?date=$d" "boundary-$d")"; done ;;
tz)
  fresh_db
  call "2026-11-10 23:59:30" America/Chicago contacted; call "2026-11-11 00:00:30" America/Chicago voicemail
  sql "insert into settings (key, value) values ('reporting_timezone', 'America/Chicago') on conflict (key) do update set value = excluded.value" >/dev/null
  srv
  p "== reporting_timezone = America/Chicago; calls at 23:59:30 Nov 10 and 00:00:30 Nov 11 Chicago time (= 05:59:30 / 06:00:30 UTC Nov 11)"
  p "  setting via API: PUT reporting_timezone=America/Chicago -> $(api PUT /api/settings/reporting_timezone '{"value":"America/Chicago"}' tokS | grep -oE 'HTTP [0-9]+')"
  for d in 2026-11-10 2026-11-11; do p "  date=$d: API $(apinums "?date=$d") | PDF $(pdfnums "?date=$d" "tz-$d") | DB $(dbcount "$d 00:00" "$(date -d "$d +1 day" +%F) 00:00" America/Chicago)"; done ;;
daystart)
  fresh_db
  call "2026-11-10 05:59:30" Asia/Karachi contacted; call "2026-11-10 06:00:30" Asia/Karachi voicemail; call "2026-11-11 05:59:30" Asia/Karachi no_answer; call "2026-11-11 06:00:30" Asia/Karachi dnc
  srv
  p "== day_start_time = 06:00 (Karachi): calls at Nov 10 05:59:30 / 06:00:30 and Nov 11 05:59:30 / 06:00:30"
  p "  PUT day_start_time=06:00 -> $(api PUT /api/settings/day_start_time '{"value":"06:00"}' tokS | grep -oE 'HTTP [0-9]+')"
  p "  date=2026-11-10: API $(apinums "?date=2026-11-10") | PDF $(pdfnums "?date=2026-11-10" daystart) | DB (06:00 -> 06:00) $(dbcount "2026-11-10 06:00" "2026-11-11 06:00" Asia/Karachi)"
  api PUT /api/settings/day_start_time '{"value":"00:00"}' tokS >/dev/null
  p "  back to 00:00: date=2026-11-10: API $(apinums "?date=2026-11-10") | DB $(dbcount "2026-11-10 00:00" "2026-11-11 00:00" Asia/Karachi)" ;;
failed)
  fresh_db
  sql "update leads set status='in_queue' where id in (select id from leads where not missing_phone order by id limit 5)" >/dev/null
  srv
  BEFORE_API=$(apinums ""); BEFORE_PDF=$(pdfnums "" failed-before); BEFORE_ROWS=$(sql "select count(*)||' rows, '||count(*) filter (where telephony_state='failed')||' failed' from call_history")
  stop_backend; srv TELEPHONY_PROVIDER=bogus
  codes=''; for i in 1 2 3; do codes="$codes $(api POST /api/calls '{}' tokA | grep -oE 'HTTP [0-9]+')"; done
  codes="$codes / dial pad $(api POST /api/calls/manual/start '{"toNumber":"212-555-0188"}' tokA | grep -oE 'HTTP [0-9]+')"
  p "== 3 queue dials + 1 dial-pad dial with TELEPHONY_PROVIDER=bogus: $codes"
  p "  call_history: before $BEFORE_ROWS; after $(sql "select count(*)||' rows, '||count(*) filter (where telephony_state='failed')||' failed' from call_history")"
  p "  today, API: before $BEFORE_API | after $(apinums "")"
  p "  today, PDF: before $BEFORE_PDF"
  p "               after $(pdfnums "" failed-after)"
  p "  per-state report total dials: $(api GET /api/reports/per-state '' tokS | sed -E 's/ \[HTTP.*//' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).states.reduce((a,r)=>a+r.dials,0)))'); manual-calls list: $(api GET /api/reports/manual-today '' tokS | sed -E 's/ \[HTTP.*//' | jget calls | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))') row(s)"
  p "  lead attempts on the 5 leads: $(sql "select string_agg(attempts::text, ',') from (select attempts from leads where id in (select id from leads where not missing_phone order by id limit 5) order by id) s")" ;;
validate)
  fresh_db; srv
  p "== validation (HTTP code + message)"
  for q in "date=not-a-date" "date=2026-02-30" "date=2026-13-01" "from=2026-11-10T10:00" "from=2026-11-10T10:00&to=2026-11-10T09:00" "from=2025-01-01T00:00&to=2026-11-10T00:00" "from=garbage&to=2026-11-10T00:00" "date=2026-11-10&from=2026-11-10T00:00&to=2026-11-11T00:00" "date=2026-11-10"; do
    a=$(api GET "/api/reports/today?$q" '' tokS); pc=$(curl -s -o "$OUT/v.pdf" -w '%{http_code}' "$API/api/exports/daily-pdf?$q" -H "authorization: Bearer $(cat $SCRATCH/tokS)")
    p "  ?$q -> today $(grep -oE 'HTTP [0-9]+' <<<"$a") $(grep -oE '"error":"[^"]*"' <<<"$a") | PDF HTTP $pc"
  done
  for v in "Mars/Olympus" "" "25:00" "6am"; do p "  PUT reporting_timezone=\"$v\" -> $(api PUT /api/settings/reporting_timezone "{\"value\":\"$v\"}" tokS | grep -oE 'HTTP [0-9]+'); PUT day_start_time=\"$v\" -> $(api PUT /api/settings/day_start_time "{\"value\":\"$v\"}" tokS | grep -oE 'HTTP [0-9]+')"; done
  p "  settings now: $(sql "select string_agg(key||'='||coalesce(value,'null'), ', ' order by key) from settings where key in ('reporting_timezone','day_start_time')")" ;;
goal)
  fresh_db
  call "2026-11-10 22:00:00" Asia/Karachi contacted; call "2026-11-10 23:00:00" Asia/Karachi voicemail; call "2026-11-11 02:00:00" Asia/Karachi no_answer
  p "== daily goal counter (/reports/today, what the dashboard polls), controlled clock (Node only), day start 00:00 Karachi"
  p "   calls: Nov 10 22:00 and 23:00, Nov 11 02:00 Karachi"
  for at in "2026-11-10T18:59:00Z|23:59:00 Nov 10 Karachi" "2026-11-10T19:00:30Z|00:00:30 Nov 11 Karachi (midnight passed)" "2026-11-10T23:59:00Z|04:59:00 Nov 11 Karachi (= 23:59 UTC)" "2026-11-11T00:00:30Z|05:00:30 Nov 11 Karachi (= 00:00:30 UTC)"; do
    IFS='|' read -r iso what <<<"$at"
    srv FAKE_NOW="$iso"
    p "  at $what: dials $(apinums "")"
  done ;;
fonts)
  fresh_db
  sql "update leads set name='José Hernández-Muñoz', brokerage='Ünïcödé ñ façade Realty <script>alert(1)</script>' where id=1; update leads set name='Zoë Ångström 😀', brokerage='Café Olé Homes' where id=2" >/dev/null
  call "2026-11-10 10:00:00" Asia/Karachi contacted "" "Señora Muñoz: call back after 3pm 👍 — café 🏠☎️ <b>not bold</b>" 1
  call "2026-11-10 11:00:00" Asia/Karachi voicemail "" "Left VM for Zoë 😀👨‍👩‍👧 — Ünïcödé ñ façade" 2
  srv
  pdfnums "?date=2026-11-10" fonts >/dev/null
  p "== fonts: PDF text (pdftotext) for the two rows"
  pdftotext -layout "$OUT/fonts.pdf" - | grep -E "José|Hernández|Muñoz|Zoë|Ünïcödé|script|Señora|Café|café|bold|Left VM|façade" | sed "s/^/[$LABEL]   /"
  p "  fonts embedded: $(pdffonts "$OUT/fonts.pdf" 2>/dev/null | awk 'NR>2{print $1}' | sed 's/^[A-Z]*+//' | sort -u | tr '\n' ' ')"
  pdftoppm -r 110 -png -f 1 -l 1 "$OUT/fonts.pdf" "$OUT/fonts-page"
  p "  page image: $OUT/fonts-page-1.png" ;;
ui)
  fresh_db
  TODAY=$(TZ=Asia/Karachi date +%F)
  for d in contacted contacted voicemail no_answer; do sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, duration_seconds, disposition) values (2, $SEED_UID, '+1555', true, 'ended', greatest(now() - interval '1 minute', timestamp '$TODAY 00:00:05' at time zone 'Asia/Karachi'), 30, '$d')" >/dev/null; done
  call "2026-11-07 23:00:00" Asia/Karachi contacted; call "2026-11-08 01:00:00" Asia/Karachi voicemail; call "2026-11-08 03:59:00" Asia/Karachi no_answer
  srv
  pkill -f "vite preview"; ( cd "$CO/frontend" && npx vite build > "$OUT/ui-build.txt" 2>&1 && exec setsid npx vite preview --port 5173 --strictPort > "$OUT/ui-fe.txt" 2>&1 < /dev/null & )
  for i in $(seq 1 120); do curl -s -o /dev/null localhost:5173/ 2>/dev/null && break; sleep 0.5; done
  p "== browser (production build): today has 4 calls (2 contacted); range Nov 7 22:00 -> Nov 8 04:00 has 3 (1 contacted)"
  p "  API today: $(apinums "") | API range: $(apinums "?from=2026-11-07T22:00&to=2026-11-08T04:00") | DB range: $(dbcount "2026-11-07 22:00" "2026-11-08 04:00" Asia/Karachi)"
  PDF_OUT="$OUT/ui-range.pdf" NODE_PATH=$(npm root -g) node "$ROOT/audit/scripts/fix-seg7-ui.js" http://localhost:5173 2026-11-07T22:00 2026-11-08T04:00 2>&1 | sed "s/^/[$LABEL]   /"
  [ -s "$OUT/ui-range.pdf" ] && p "  PDF downloaded from the Reports page: $(node "$ROOT/audit/scripts/pdf-numbers.js" "$OUT/ui-range.pdf" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(`headline dials ${j.headline.dials}, contacts ${j.headline.contacts}; table rows ${j.rows}; header: ${j.header[1]}`)})')"
  pkill -f "vite preview" ;;
perf)
  fresh_db
  sql "insert into call_history (lead_id, user_id, from_number, was_mock, telephony_state, started_at, duration_seconds, disposition)
       select 1 + g % 5000, $SEED_UID, '+15550000000', true, case when g % 50 = 0 then 'failed' else 'ended' end, now() - (g * interval '78 seconds'), g % 300,
              case when g % 50 = 0 then null else (array['contacted','voicemail','no_answer','dnc','callback_scheduled'])[1 + g % 5] end
       from generate_series(0, 99999) g" >/dev/null
  sql "analyze call_history" >/dev/null
  srv
  BIGDAY=$(TZ=Asia/Karachi date -d '-3 days' +%F)
  p "== perf: 100,000 calls over the last ~90 days (5,019 leads); median of 9 runs each"
  for ep in "/api/reports/today" "/api/reports/today?date=$BIGDAY" "/api/reports/per-state" "/api/reports/manual-today" "/api/exports/daily-pdf?date=$BIGDAY"; do
    ts=(); for i in $(seq 1 9); do ts+=($(curl -s -o /dev/null -w '%{time_total}' "$API$ep" -H "authorization: Bearer $(cat $SCRATCH/tokS)")); done
    p "  GET $ep: median $(printf '%s\n' "${ts[@]}" | sort -n | sed -n 5p)s, max $(printf '%s\n' "${ts[@]}" | sort -n | tail -1)s"
  done
  p "  calls on $BIGDAY (Karachi day): DB $(dbcount "$BIGDAY 00:00" "$(date -d "$BIGDAY +1 day" +%F) 00:00" Asia/Karachi); PDF $(pdfnums "?date=$BIGDAY" perf-bigday)" ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG" 2>/dev/null; true) error/warn lines"
done
stop_backend
