#!/usr/bin/env bash
# Segment 6 (F-18, F-19, F-20, F-26): calling hours over the real API, with a
# controlled clock (audit/stubs/fake-now.js shifts the Node clock to FAKE_NOW;
# Postgres now() is real, so due times are set relative to the real clock).
# Each part uses a fresh clone of vortex_seg3_tpl, migrated with the checkout's
# own migrations. The template's 5,019 leads are soft-deleted and the test
# leads below inserted by DIRECT SQL (test shortcut) BEFORE the server starts.
# Mock forced to no_answer (stub).
#   paths       11-13 07:30 Chicago / 08:30 New York: every outbound path vs
#               leads that are closed (by-id, queue callbacks + retries,
#               Redial, multi-line queue and selected, dial pad), unknown state
#   elpaso      11-13 07:30 El Paso / 08:30 Dallas: El Paso by-id, queue, dial pad
#   starvation  11-14 21:30 New York / 20:30 Dallas: 70 New York callbacks at
#               the front of the queue, Dallas/Denver leads behind them;
#               single-line, multi-line, the counts, a Knoxville lead by-id
#   toggle      flips Settings → Enforce calling hours and measures how long
#               until dialing follows (off → a closed lead dials; on → refused)
#   default     the setting missing from the DB
#   perf        100,000 leads, queue-read timings
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg6.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-paths elpaso starvation toggle default perf}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg6_api
echo no_answer > "$SCRATCH/force-outcome"
p() { echo "[$LABEL] $*"; }
KEY=calling_hours_enforced

fresh_db() {
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "update leads set deleted_at = now()" >/dev/null   # DIRECT SQL: park the template's leads
}
# ins <name> <phone> <state> <address> <status> [due-offset e.g. '-1 hour'] [attempts] -> id
ins() {
  local due="NULL"; [ -n "${6:-}" ] && due="now() + interval '$6'"
  sql "insert into leads (name, phone, state, address, status, next_action_at, attempts) values ('$1', '$2', '$3', \$\$$4\$\$, '$5', $due, ${7:-0}) returning id"
}
srv() {   # srv <FAKE_NOW> [env...]
  local fake=$1; shift
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg6-$LABEL-$PART.txt"
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_BASE_URL=http://127.0.0.1:9 IMPORT_AI=off STALE_LOCK_SWEEP=off FAKE_NOW="$fake" NODE_OPTIONS="--require $ROOT/audit/stubs/fake-now.js --require $ROOT/audit/stubs/force-outcome.js" "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 240); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -s "$API/health" >/dev/null 2>&1 || { p "ABORT: backend did not start"; tail -5 "$SLOG"; exit 1; }
  login rep2@example.com 'Rep2Pass!' tokA >/dev/null
  login rep3@example.com 'Rep3Pass!' tokB >/dev/null
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
}
code() { api "$1" "$2" "${3:-}" "${4:-tokA}" > "$SCRATCH/s6-last"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/s6-last" | grep -oE '[0-9]+'; }
err() { grep -oE '"error":"[^"]*"' "$SCRATCH/s6-last" | head -1; }
callid() { sed -E 's/ \[HTTP.*//' "$SCRATCH/s6-last" | jget call.id 2>/dev/null; }
leadof() { local v; v=$(sed -E 's/ \[HTTP.*//' "$SCRATCH/s6-last" | jget lead.id 2>/dev/null); [ "$v" = undefined ] || echo "$v"; }
finish() { [ -n "${1:-}" ] && [ "$1" != undefined ] && { code POST /api/calls/$1/hangup '' "${2:-tokA}" >/dev/null; code POST /api/dispositions "{\"callId\":$1,\"disposition\":\"contacted\"}" "${2:-tokA}" >/dev/null; }; }
desc() { sql "select '#'||id||' '||name||' ('||coalesce(nullif(trim(state),''),'no state')||' '||phone||')' from leads where id=$1"; }
leftover() {
  p "  no lead lost: test leads by status: $(sql "select string_agg(status||'='||n, ', ') from (select status, count(*) n from leads where deleted_at is null group by 1 order by 1) s")"
  p "  in_progress with no open call: $(sql "select count(*) from leads l where status='in_progress' and not exists (select 1 from call_history c where c.lead_id=l.id and c.ended_at is null and c.disposition is null)"); open calls: $(sql "select count(*) from call_history where ended_at is null and disposition is null")"
  p "  invariants: $(psql -q -h localhost -U vortex -d $DB -At -f "$ROOT/audit/scripts/invariants.sql" 2>&1 | tr '\n' ' ' | cut -c1-400)"
}

for PART in $PARTS; do case $PART in
paths)
  fresh_db
  NY=$(ins 'NY open' +12125550111 NY 'New York, NY' new)
  IL=$(ins 'IL closed' +13125550111 IL 'Chicago, IL' new)
  PENS=$(ins 'Pensacola' +18505550111 FL '1 Palafox Pl, Pensacola, FL' new)
  GARY=$(ins 'Gary' +12195550111 IN 'Gary, IN' new)
  BG=$(ins 'Bowling Green' +12705550111 KY 'Bowling Green, KY' new)
  UNK=$(ins 'No state' +12125550112 '' '' new)
  RED=$(ins 'Redial IL' +13125550112 IL 'Chicago, IL' new)
  CB=$(ins 'Callback IL' +13125550113 IL 'Chicago, IL' callback_scheduled '-2 hours')
  RT=$(ins 'Retry IL' +13125550114 IL 'Chicago, IL' no_answer '-3 hours' 1)
  CBP=$(ins 'Callback Pensacola' +18505550112 FL 'Pensacola, FL' callback_scheduled '-1 hour')
  CBP2=$(ins 'Callback Pensacola 2' +18505550114 FL 'Pensacola, FL' callback_scheduled '-50 minutes')
  ML1=$(ins 'ML Chicago' +13125550115 IL 'Chicago, IL' new); ML2=$(ins 'ML Pensacola' +18505550113 FL 'Pensacola, FL' new)
  sql "insert into settings (key, value) values ('$KEY', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  srv 2026-11-13T13:30:00Z
  p "== paths: controlled clock 2026-11-13 13:30 UTC = 08:30 New York, 07:30 Chicago (CT closed); enforcement ON"
  p "-- by lead id (POST /api/calls {leadId})"
  for L in $NY $IL $PENS $GARY $BG $UNK; do c=$(code POST /api/calls "{\"leadId\":$L}"); p "  $(desc $L) -> $c $(err)"; finish "$(callid)"; done
  p "-- Redial of a closed-zone lead still locked to the rep (lock set by DIRECT SQL: a call started at 20:59, Redial after 21:00)"
  sql "update leads set status='in_progress', locked_by=(select id from users where email='rep2@example.com'), locked_at=now() where id=$RED" >/dev/null
  c=$(code POST /api/calls "{\"leadId\":$RED,\"redial\":true}"); p "  $(desc $RED) redial -> $c $(err)"; finish "$(callid)"
  p "-- multi-line, selected leads [$ML1 Chicago, $ML2 Pensacola], 6 s"
  T0=$(sql "select now()")
  LEAD_IDS="$ML1,$ML2" node "$ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokB" 3 6 '[{"at":5,"do":"stop"}]' > "$SCRATCH/s6-ml2.txt" 2>&1
  p "  calls placed: $(sql "select count(*) from call_history where started_at >= '$T0'") — to: $(sql "select coalesce(string_agg(distinct l.name, ', '),'none') from call_history c join leads l on l.id=c.lead_id where c.started_at >= '$T0'")"
  p "-- queue (Start Dialing, POST /api/calls {}) once: due Chicago callback + due Chicago retry + 2 due Pensacola callbacks"
  c=$(code POST /api/calls '{}'); L=$(leadof); p "  next lead -> $c $(err) ${L:+$(desc $L)}"; finish "$(callid)"
  p "-- multi-line, queue mode, 3 lines, 6 s"
  T0=$(sql "select now()")
  node "$ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokB" 3 6 '[{"at":5,"do":"stop"}]' > "$SCRATCH/s6-ml.txt" 2>&1
  p "  calls placed: $(sql "select count(*) from call_history where started_at >= '$T0'") — to: $(sql "select coalesce(string_agg(distinct l.name, ', '),'none') from call_history c join leads l on l.id=c.lead_id where c.started_at >= '$T0'")"
  p "-- dial pad (POST /api/calls/manual/start)"
  for n in 212-555-0177 312-555-0177 850-555-0177 416-555-0177; do
    c=$(code POST /api/calls/manual/start "{\"toNumber\":\"$n\"}"); p "  $n -> $c $(err)"
    C=$(callid); [ -n "$C" ] && [ "$C" != undefined ] && code POST /api/calls/$C/hangup >/dev/null
  done
  sleep 1; leftover ;;
elpaso)
  fresh_db
  EP=$(ins 'El Paso' +19155550111 TX '100 N Oregon St, El Paso, TX' new)
  EPC=$(ins 'El Paso callback' +19155550112 TX 'El Paso, TX' callback_scheduled '-1 hour')
  DAL=$(ins 'Dallas' +12145550111 TX 'Dallas, TX' new)
  sql "insert into settings (key, value) values ('$KEY', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  srv 2026-11-13T14:30:00Z
  p "== elpaso: controlled clock 2026-11-13 14:30 UTC = 07:30 El Paso (MT), 08:30 Dallas (CT)"
  for L in $EP $DAL; do c=$(code POST /api/calls "{\"leadId\":$L}"); p "  by id $(desc $L) -> $c $(err)"; finish "$(callid)"; done
  c=$(code POST /api/calls '{}'); L=$(leadof); p "  queue next (El Paso callback due) -> $c $(err) ${L:+$(desc $L)}"; finish "$(callid)"
  c=$(code POST /api/calls/manual/start '{"toNumber":"915-555-0177"}'); p "  dial pad 915-555-0177 -> $c $(err)"; C=$(callid); [ -n "$C" ] && [ "$C" != undefined ] && code POST /api/calls/$C/hangup >/dev/null
  sleep 1; leftover ;;
starvation)
  fresh_db
  sql "insert into leads (name, phone, state, address, status, next_action_at) select 'NY callback '||g, '+1646557'||lpad(g::text,4,'0'), 'NY', 'New York, NY', 'callback_scheduled', now() - interval '3 hours' + g * interval '1 second' from generate_series(1000, 1069) g" >/dev/null
  for i in 1 2 3 4 5; do ins "Dallas $i" +121455502$((10+i)) TX 'Dallas, TX' new >/dev/null; done
  for i in 1 2 3; do ins "Denver $i" +130355502$((10+i)) CO 'Denver, CO' new >/dev/null; done
  KNOX=$(ins 'Knoxville' +18655550111 TN 'Knoxville, TN' new)
  sql "insert into settings (key, value) values ('$KEY', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  srv 2026-11-14T02:30:00Z
  p "== starvation: controlled clock 2026-11-14 02:30 UTC = 21:30 New York (closed), 20:30 Dallas, 19:30 Denver; 70 New York callbacks at the front, 5 Dallas + 3 Denver + 1 Knoxville behind"
  p "  queue order, first 3: $(sql "select string_agg(state||' '||status, ', ') from (select * from leads where deleted_at is null and status in ('new','in_queue','voicemail','no_answer','callback_scheduled') order by case status when 'callback_scheduled' then 0 else 1 end, next_action_at asc nulls first, created_at asc limit 3) s")"
  c=$(code POST /api/calls "{\"leadId\":$KNOX}"); p "  by id $(desc $KNOX) (Knoxville is Eastern: 21:30) -> $c $(err)"; finish "$(callid)"
  p "-- single-line Start Dialing, 3 times"
  for i in 1 2 3; do c=$(code POST /api/calls '{}'); L=$(leadof); p "  next lead #$i -> $c $(err) ${L:+$(desc $L)}"; finish "$(callid)"; done
  p "-- counts (GET /api/leads/state-counts), totals over all states"
  api GET /api/leads/state-counts '' tokS | sed -E 's/ \[HTTP.*//' > "$SCRATCH/s6-counts.json"
  node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).counts;const sum=k=>c.reduce((a,r)=>a+Number(r[k]||0),0);const has=c.some(r=>"dialable_now" in r);const nx=c.map(r=>r.next_opens_at).filter(Boolean).sort()[0];console.log("  dialable="+sum("dialable")+(has?" dialable_now="+sum("dialable_now")+" waiting_for_hours="+sum("waiting_for_hours")+" unknown_zone="+sum("unknown_zone")+" next_opens_at="+nx:" (no dialable-now / waiting fields)"))' "$SCRATCH/s6-counts.json" | while read -r l; do p "$l"; done
  p "-- multi-line, queue mode, 3 lines, 8 s"
  T0=$(sql "select now()")
  node "$ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokB" 3 8 '[{"at":7,"do":"stop"}]' > "$SCRATCH/s6-ml3.txt" 2>&1
  p "  calls placed: $(sql "select count(*) from call_history where started_at >= '$T0'") — by state: $(sql "select coalesce(string_agg(st||'='||n, ', '),'none') from (select l.state st, count(*) n from call_history c join leads l on l.id=c.lead_id where c.started_at >= '$T0' group by 1) s"); session summary: $(grep -oE 'byStatus=[^ ]*' "$SCRATCH/s6-ml3.txt")"
  p "  New York callbacks still waiting (callback_scheduled, never dialed): $(sql "select count(*) from leads where state='NY' and status='callback_scheduled' and attempts=0 and deleted_at is null") of 70"
  sleep 1; leftover ;;
toggle)
  fresh_db
  sql "insert into leads (name, phone, state, address, status) select 'IL '||g, '+1312556'||lpad(g::text,4,'0'), 'IL', 'Chicago, IL', 'new' from generate_series(1, 400) g" >/dev/null
  sql "insert into settings (key, value) values ('$KEY', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  p "== toggle: 07:30 Chicago (closed). PUT the setting, then try a closed Chicago lead every 100 ms (server restarted per cycle: per-user rate limit)"
  ids=($(sql "select id from leads where deleted_at is null order by id"))
  k=0; pend=''
  for cycle in 1 2 3; do
    srv 2026-11-13T13:30:00Z
    # warm-up while ON: dial closed leads until refused (a call placed here = dialing allowed right after startup)
    early=0; for w in 1 2 3 4 5 6 7 8 9 10; do c=$(code POST /api/calls "{\"leadId\":${ids[$k]}}" '' tokS); [ "$c" = 201 ] && { early=$((early+1)); finish "$(callid)" tokS; k=$((k+1)); continue; }; [ "$c" = 422 ] && break; sleep 0.3; done
    p "  cycle $cycle: setting ON at startup: calls placed before the first refusal: $early"
    code PUT /api/settings/$KEY '{"value":"false"}' tokS >/dev/null; t0=$(date +%s%3N); n=0; got=''; other=''
    while [ $(( $(date +%s%3N) - t0 )) -lt 8000 ]; do c=$(code POST /api/calls "{\"leadId\":${ids[$k]}}" '' tokA); [ "$c" = 201 ] && { got=$(( $(date +%s%3N) - t0 )); break; }; [ "$c" = 422 ] && n=$((n+1)) || other="$other $c"; sleep 0.1; done
    p "  cycle $cycle: OFF -> first dial allowed after ${got:-never (>8000)} ms ($n refused first${other:+; other codes:$other})"; finish "$(callid)"; k=$((k+1))
    code PUT /api/settings/$KEY '{"value":"true"}' tokS >/dev/null; t0=$(date +%s%3N); got=''; placed=0; other=''
    while [ $(( $(date +%s%3N) - t0 )) -lt 8000 ]; do c=$(code POST /api/calls "{\"leadId\":${ids[$k]}}" '' tokB); [ "$c" = 422 ] && { got=$(( $(date +%s%3N) - t0 )); break; }; if [ "$c" = 201 ]; then placed=$((placed+1)); pend="$pend $(callid)"; k=$((k+1)); else other="$other $c"; fi; sleep 0.1; done
    for C in $pend; do finish "$C" tokS; done; pend=''
    p "  cycle $cycle: ON  -> first refusal after ${got:-never (>8000)} ms ($placed call(s) placed after the switch${other:+; other codes:$other})"; k=$((k+1))
  done
  sleep 1; leftover ;;
default)
  fresh_db
  L=$(ins 'IL default' +13125550199 IL 'Chicago, IL' new)
  sql "delete from settings where key='$KEY'" >/dev/null
  srv 2026-11-13T13:30:00Z
  p "== default: no '$KEY' row in settings; 07:30 Chicago"
  c=$(code GET /api/settings/$KEY '' tokS); p "  GET setting -> $c $(sed -E 's/ \[HTTP.*//' "$SCRATCH/s6-last")"
  c=$(code POST /api/calls "{\"leadId\":$L}"); p "  dial a closed Chicago lead -> $c $(err)"; finish "$(callid)"
  sleep 1; leftover ;;
perf)
  fresh_db
  # 100,000 leads over real area codes/states; 5,000 New York callbacks due at the front.
  sql "insert into leads (name, phone, state, address, status, next_action_at)
       select 'Perf '||g, '+1'||(array['212','312','303','213','214','850','915','405','602','907'])[1 + g % 10]||lpad((1000000 + g)::text, 7, '0'),
              (array['NY','IL','CO','CA','TX','FL','TX','OK','AZ','AK'])[1 + g % 10], 'Somewhere',
              case when g <= 5000 then 'callback_scheduled' else 'new' end,
              case when g <= 5000 then now() - interval '5 hours' + g * interval '1 second' end
       from generate_series(1, 100000) g" >/dev/null
  sql "update leads set phone = '+1212'||substr(phone, 6) , state='NY' where name like 'Perf %' and status='callback_scheduled'" >/dev/null
  sql "insert into settings (key, value) values ('$KEY', 'true') on conflict (key) do update set value = 'true'" >/dev/null
  sql "analyze leads" >/dev/null
  t0=$(date +%s%3N); srv 2026-11-14T02:30:00Z; p "== perf: 100,000 leads (+5,000 NY callbacks at the front), 21:30 New York; server ready after $(( $(date +%s%3N) - t0 )) ms"
  if [ "$(sql "select count(*) from information_schema.columns where table_name='leads' and column_name='tz_zones'")" = 1 ]; then p "  zones stored: $(sql "select count(*) filter (where tz_zones is not null)||' of '||count(*) from leads")"; else p "  zones stored: n/a (no column)"; fi
  for ep in "/api/leads?pageSize=50" "/api/leads/state-counts"; do
    ts=(); for i in $(seq 1 15); do ts+=($(curl -s -o /dev/null -w '%{time_total}' "$API$ep" -H "authorization: Bearer $(cat $SCRATCH/tokS)")); done
    p "  GET $ep x15: median $(printf '%s\n' "${ts[@]}" | sort -n | sed -n 8p)s, max $(printf '%s\n' "${ts[@]}" | sort -n | tail -1)s"
  done
  ts=(); codes=''; for i in $(seq 1 10); do
    r=$(curl -s -o "$SCRATCH/s6-last" -w '%{http_code} %{time_total}' -X POST "$API/api/calls" -H "authorization: Bearer $(cat $SCRATCH/tokA)" -H 'content-type: application/json' -d '{}')
    codes="$codes ${r%% *}"; ts+=("${r##* }"); C=$(jget call.id < "$SCRATCH/s6-last" 2>/dev/null); finish "$C"
  done
  p "  POST /api/calls {} (next lead) x10: codes$(tr ' ' '\n' <<<"$codes" | grep . | sort | uniq -c | tr -s ' ' | tr '\n' ';'), median $(printf '%s\n' "${ts[@]}" | sort -n | sed -n 5p)s, max $(printf '%s\n' "${ts[@]}" | sort -n | tail -1)s"
  p "  dialed: $(sql "select coalesce(string_agg(st||'='||n, ', '),'none') from (select l.state st, count(*) n from call_history c join leads l on l.id=c.lead_id where l.name like 'Perf %' group by 1) s")"
  ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG") error/warn lines"
done
rm -f "$SCRATCH/force-outcome"
stop_backend
