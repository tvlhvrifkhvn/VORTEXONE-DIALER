#!/usr/bin/env bash
# Segment 3 repros: F-15 (sweep releases live calls), F-25 (ended_at not set
# by the network `ended` event), F-24 (sweep only runs on queue reads),
# F-32 (any user can disposition / undo / hang up another rep's call).
# Each run uses a fresh clone of vortex_seg3_tpl (seg2 data + rep3, a second
# rep). Mock outcomes are forced by audit/stubs/force-outcome.js (labelled
# stub). Backdating locked_at / started_at in SQL is a test shortcut only.
#
# Usage: AUDIT_PASSWORD=<seed pw> bash audit/scripts/fix-seg3.sh <label> [parts]
#   parts: any of live hungup nocall ceiling undo f25 f24 f32 late multi (default: all)
# Users: U1 = rep2 (rep), U2 = rep3 (rep), SUP = seed user (supervisor).
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL="${1:-run}"; shift || true
PARTS="${*:-live hungup nocall ceiling undo f25 f24 f32 late multi}"
export DB=vortex_seg3_run
psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
stop_backend
SLOG="$AUDIT_ROOT/audit/logs/server-seg3-$LABEL.txt"
( cd "$AUDIT_ROOT/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" NODE_OPTIONS="--require $AUDIT_ROOT/audit/stubs/force-outcome.js" ${SEG3_ENV:-} node src/index.js > "$SLOG" 2>&1 < /dev/null & )
for i in $(seq 1 40); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
login >/dev/null; login rep2@example.com 'Rep2Pass!' tokU1 >/dev/null; login rep3@example.com 'Rep3Pass!' tokU2 >/dev/null
U1=2; U2=3
p() { echo "[$LABEL] $*"; }
force() { echo "$1" > "$SCRATCH/force-outcome"; }
# code METHOD PATH JSON TOKENFILE -> "nnn" (body saved to $SCRATCH/last-body)
code() { api "$1" "$2" "${3:-}" "${4:-token}" > "$SCRATCH/last" ; sed -E 's/ \[HTTP [0-9]+\]$//' "$SCRATCH/last" > "$SCRATCH/last-body"; grep -oE '\[HTTP [0-9]+\]' "$SCRATCH/last" | grep -oE '[0-9]+'; }
body() { cat "$SCRATCH/last-body"; }
err() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.error||"")}catch{console.log("")}' "$SCRATCH/last-body"; }
NEXT=0
lead() { NEXT=$((NEXT+1)); L=$(sql "select id from leads where status='new' and not missing_phone and deleted_at is null and state in ('CA','NY','TX','FL','IL','WA') order by id offset $((NEXT*7)) limit 1"); }
dial() { DC=$(code POST /api/calls "{\"leadId\":$1}" "$2"); CALL=$(body | jget call.id 2>/dev/null); }
lstate() { sql "select status||' locked_by='||coalesce(locked_by::text,'-') from leads where id=$1"; }
sweep() { code GET "/api/leads?limit=1" "" token >/dev/null; }
closeall() { for c in $(sql "select id from call_history where disposition is null and ended_at is null and lead_id is not null"); do o=$(sql "select user_id from call_history where id=$c"); t=tokU1; [ "$o" = "$U2" ] && t=tokU2; [ "$o" = 1 ] && t=token; code POST /api/dispositions "{\"callId\":$c,\"disposition\":\"contacted\"}" $t >/dev/null; done; }

for part in $PARTS; do case $part in
live)
  p "== F-15 live call: U1 on an answered call, locked_at backdated 60 s =="
  force answered; lead; dial $L tokU1; c=$DC; C1=$CALL; sleep 4
  p "  U1 dial lead $L -> $c, call $C1 telephony_state=$(sql "select telephony_state from call_history where id=$C1")"
  sql "update leads set locked_at = now() - interval '60 seconds' where id=$L" >/dev/null
  sweep; p "  after lazy sweep (GET /api/leads): $(lstate $L)"
  sleep 12; p "  after 12 s more (timer, if any): $(lstate $L)"
  dial $L tokU2; c=$DC; p "  U2 dial the same lead -> $c $(err)"
  p "  open calls on lead $L: $(sql "select count(*) from call_history where lead_id=$L and ended_at is null and disposition is null")"
  closeall ;;
hungup)
  p "== F-15 hung-up call: released 30 s after hangup =="
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  c=$(code POST /api/calls/$C/hangup "" tokU1); p "  U1 dial lead $L, hangup -> $c"
  sleep 25; sweep; p "  25 s after hangup: $(lstate $L)"
  sleep 7; sweep; p "  32 s after hangup: $(lstate $L)" ;;
nocall)
  p "== F-15 lead locked with no call row at all =="
  lead; sql "update leads set status='in_progress', locked_by=$U1, locked_at=now() - interval '25 seconds' where id=$L" >/dev/null
  sweep; p "  locked 25 s ago: $(lstate $L)"
  sleep 6; sweep; p "  locked 31 s ago: $(lstate $L)" ;;
ceiling)
  p "== F-15 safety ceiling: open call older than MAX_LIVE_CALL_MINUTES (default 240) =="
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  sql "update call_history set started_at = now() - interval '239 minutes' where id=$C; update leads set locked_at = now() - interval '60 seconds' where id=$L" >/dev/null
  sweep; p "  open call started 239 min ago: $(lstate $L), call ended_at null=$(sql "select ended_at is null from call_history where id=$C")"
  sql "update call_history set started_at = now() - interval '241 minutes' where id=$C" >/dev/null
  sweep; p "  open call started 241 min ago: $(lstate $L), call ended_at set=$(sql "select ended_at is not null from call_history where id=$C"), disposition=$(sql "select coalesce(disposition,'null') from call_history where id=$C")"
  closeall ;;
undo)
  p "== undo after a hangup: the lead must not stay locked by a reopened call =="
  force answered; lead; dial $L tokU1; C=$CALL; sleep 4
  code POST /api/calls/$C/hangup "" tokU1 >/dev/null; sleep 1
  code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_answer\"}" tokU1 >/dev/null
  c=$(code POST /api/dispositions/$C/undo "" tokU1); p "  U1 hangup, no_answer, undo -> $c | lead $(lstate $L) | call ended_at set=$(sql "select ended_at is not null from call_history where id=$C")"
  sql "update leads set locked_at = now() - interval '31 seconds' where id=$L" >/dev/null; sweep
  p "  31 s after undo with no new disposition: $(lstate $L)" ;;
f25)
  p "== F-25 network ended: ended_at / duration_seconds / locked_at =="
  force no_answer; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 5
  p "  no_answer call $C: $(sql "select 'state='||telephony_state||' ended_at_set='||(ended_at is not null)||' duration='||coalesce(duration_seconds::text,'null')||' locked_at_after_end='||coalesce((l.locked_at >= c.ended_at - interval '1 second')::text,'n/a') from call_history c join leads l on l.id=c.lead_id where c.id=$C")"
  force voicemail; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4.5
  code POST /api/calls/$C/hangup "" tokU1 >/dev/null; H=$(sql "select to_char(ended_at,'HH24:MI:SS.MS')||' d='||duration_seconds from call_history where id=$C"); sleep 4
  p "  voicemail call hung up at 4.5 s, network ended at ~7 s: hangup wrote [$H], row now [$(sql "select to_char(ended_at,'HH24:MI:SS.MS')||' d='||duration_seconds||' state='||telephony_state from call_history where id=$C")]"
  lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4.5
  code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"voicemail\"}" tokU1 >/dev/null; H=$(sql "select to_char(ended_at,'HH24:MI:SS.MS')||' d='||duration_seconds from call_history where id=$C"); sleep 4
  p "  voicemail call dispositioned at 4.5 s, network ended at ~7 s: disposition wrote [$H], row now [$(sql "select to_char(ended_at,'HH24:MI:SS.MS')||' d='||duration_seconds||' disp='||disposition from call_history where id=$C")]"
  p "  I5-style: calls this run with telephony_state=ended but ended_at null: $(sql "select count(*) from call_history where telephony_state='ended' and ended_at is null")"
  closeall ;;
f24)
  p "== F-24 no queue reads after hangup: when does the lead return to in_queue? =="
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  code POST /api/calls/$C/hangup "" tokU1 >/dev/null; T0=$(date +%s)
  r="still in_progress after 60 s"
  while [ $(( $(date +%s) - T0 )) -lt 60 ]; do s=$(sql "select status from leads where id=$L"); [ "$s" = in_queue ] && { r="in_queue after $(( $(date +%s) - T0 )) s"; break; }; sleep 1; done
  p "  (DB polled directly, no API reads) lead $L: $r" ;;
f32)
  p "== F-32 another rep acts on U1's call =="
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  PH=$(sql "select phone from leads where id=$L")
  p "  U1 dial lead $L -> $c (call $C)"
  c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"dnc\"}" tokU2); p "  U2 dnc on U1's call     -> $c $(err) | lead $(lstate $L), on dnc_list=$(sql "select count(*) from dnc_list where phone='$PH'")"
  c=$(code POST /api/calls/$C/hangup "" tokU2); p "  U2 hangup U1's call     -> $c $(err) | ended_at set=$(sql "select ended_at is not null from call_history where id=$C")"
  c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_answer\"}" tokU1); p "  U1 no_answer own call   -> $c $(err)"
  c=$(code POST /api/dispositions/$C/undo "" tokU2); p "  U2 undo U1's call       -> $c $(err)"
  c=$(code POST /api/dispositions/$C/undo "" tokU1); p "  U1 undo own call        -> $c $(err)"
  c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"contacted\"}" token); p "  SUP contacted U1's call -> $c $(err) | lead $(lstate $L)"
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  c=$(code POST /api/calls/$C/hangup "" token); p "  SUP hangup U1's call    -> $c $(err)"
  closeall
  c=$(code POST /api/calls/manual/start '{"toNumber":"(312) 555-0142"}' tokU1); M=$(body | jget call.id 2>/dev/null)
  c=$(code POST /api/calls/$M/hangup "" tokU2); p "  U2 hangup U1's manual call -> $c $(err)"
  c=$(code POST /api/calls/$M/hangup "" tokU1); p "  U1 hangup own manual call  -> $c $(err)" ;;
late)
  p "== F-32 late disposition after the lead moved to another rep =="
  force answered; lead; dial $L tokU1; c=$DC; C=$CALL; sleep 4
  code POST /api/calls/$C/hangup "" tokU1 >/dev/null
  sql "update leads set locked_at = now() - interval '31 seconds' where id=$L" >/dev/null; sweep
  p "  U1 dialed lead $L, hung up, grace expired: $(lstate $L)"
  dial $L tokU2; c=$DC; C2=$CALL; p "  U2 dial lead $L -> $c: $(lstate $L)"
  c=$(code POST /api/dispositions "{\"callId\":$C,\"disposition\":\"no_answer\"}" tokU1); p "  U1 late no_answer on old call -> $c $(err) | lead $(lstate $L)"
  c=$(code POST /api/calls/$C2/hangup "" tokU2); p "  U2 hangup own call -> $c"
  closeall ;;
multi)
  p "== multi-line regression: one user, 3 lines, forced no_answer, 15 s =="
  force no_answer; M=$(sql "select coalesce(max(id),0) from call_history")
  node "$AUDIT_ROOT/audit/scripts/sse-session.js" "$SCRATCH/tokU1" 3 15 '[{"at":14,"do":"stop"}]' > "$SCRATCH/seg3-multi-$LABEL.txt"
  p "  $(grep SUMMARY "$SCRATCH/seg3-multi-$LABEL.txt")"
  p "  calls: $(sql "select count(*) from call_history where id > $M") on $(sql "select count(distinct lead_id) from call_history where id > $M") leads; ended_at null: $(sql "select count(*) from call_history where id > $M and ended_at is null")"
  sleep 1; p "  I6 leads with >1 open call: $(sql "select count(*) from (select lead_id from call_history where ended_at is null and disposition is null and lead_id is not null group by 1 having count(*)>1) t")" ;;
esac; done
rm -f "$SCRATCH/force-outcome"
p "server log: $(grep -ciE 'error|warn' "$SLOG") error/warn lines"
T0=$(date +%s%N); stop_backend; for i in $(seq 1 20); do pgrep -f "node src/index.js" >/dev/null || break; sleep 0.25; done
p "shutdown (SIGTERM): process gone after $(( ($(date +%s%N) - T0) / 1000000 )) ms; log: $(grep -E 'received' "$SLOG" || echo '(no shutdown line)')"
