#!/usr/bin/env bash
# Segment 11 (F-01): the Groq key comes only from GROQ_API_KEY.
# The real Groq API is never called: GROQ_BASE_URL points at a closed local
# port, or at a local fake server that only records whether a request carried
# the key that was saved in Settings. The old key is never printed: it is read
# from git history into a variable and only counted.
#   nokey    GROQ_API_KEY empty: the server starts, the AI route answers, an
#            import still works (no-AI mapper)
#   stored   a key saved in Settings → Integrations is still used
#   search   the working tree, the audit logs and FIX_LOG.md for the old key
# Usage: AUDIT_PASSWORD=<pw> bash audit/scripts/fix-seg11.sh <label> <checkout> [parts]
set -u
. "$(dirname "$0")/../lib/env.sh"
LABEL=$1; CO=$2; shift 2; PARTS="${*:-nokey stored search}"; ROOT="$AUDIT_ROOT"
export DB=vortex_seg11_api
p() { echo "[$LABEL] $*"; }
OUT="$SCRATCH/seg11-$LABEL"; mkdir -p "$OUT"
fresh_db() {
  stop_backend
  psql -q -h /var/tmp/audit-pg -U postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER vortex TEMPLATE vortex_seg3_tpl" >/dev/null 2>&1
  ( cd "$CO/backend" && DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" node src/db/migrate.js >/dev/null )
  sql "delete from settings where key='groq-key'" >/dev/null
}
srv() {
  stop_backend
  SLOG="$ROOT/audit/logs/server-seg11-$LABEL-$PART.txt"
  # GROQ_API_KEY set to empty on purpose: dotenv never overrides it from .env.
  ( cd "$CO/backend" && exec setsid env DATABASE_URL="postgres://vortex:vortex@localhost:5432/$DB" GROQ_API_KEY= GROQ_BASE_URL=${GROQ_URL:-http://127.0.0.1:9} "$@" node src/index.js > "$SLOG" 2>&1 < /dev/null & )
  for i in $(seq 1 80); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
  STARTED=$(curl -s -o /dev/null -w '%{http_code}' "$API/health")
  login vortexoneagency@gmail.com "$AUDIT_PASSWORD" tokS >/dev/null
}
for PART in $PARTS; do case $PART in
nokey)
  fresh_db; srv
  p "== GROQ_API_KEY empty, no key saved in Settings"
  p "  server started: health $STARTED"
  r=$(api POST /api/ai/expand-note '{"note":"called, left vm, try friday"}' tokS); p "  POST /api/ai/expand-note -> $(grep -oE 'HTTP [0-9]+' <<<"$r") $(grep -oE '"(error|note)":"[^"]*"' <<<"$r" | cut -c1-160)"
  printf 'Name,Phone,State,Address,Brokerage\nKey Test One,212-555-6601,NY,1 A St Albany NY,K Realty\nKey Test Two,212-555-6602,TX,2 B St Dallas TX,K Realty\n' > "$OUT/k.csv"
  t0=$(date +%s); r=$(node "$ROOT/audit/scripts/seg9-import.js" "$SCRATCH/tokS" "$OUT/k.csv")
  p "  import of 2 leads (AI mapping on, no key) -> $(grep -oE '"(imported|invalid)":[0-9]+' <<<"$r" | tr '\n' ' ')in $(( $(date +%s) - t0 )) s"
  r=$(api GET "/api/leads/$(sql "select id from leads where phone='+12125556601'")/brief" '' tokS); p "  pre-call brief -> $(grep -oE 'HTTP [0-9]+' <<<"$r"), instant part present: $(grep -q '"instant"' <<<"$r" && echo yes || echo no)"
  p "  server log: $(grep -ciE 'error' "$SLOG"; true) error lines; startup notes: $(grep -iE 'groq|ai ' "$SLOG" | head -2 | tr '\n' ' ' | cut -c1-160)" ;;
stored)
  fresh_db
  rm -f "$OUT/seen"
  node -e 'const http=require("http");const k=process.argv[1],f=process.argv[2];http.createServer((q,r)=>{require("fs").appendFileSync(f,(q.headers.authorization==="Bearer "+k?"saved-key":"other-key")+"\n");r.writeHead(200,{"content-type":"application/json"});r.end(JSON.stringify({choices:[{message:{content:"Called; left a voicemail. Try again Friday."}}]}))}).listen(9912)' "gsk_FAKE_SETTINGS_KEY_00000000000000" "$OUT/seen" & FAKE=$!
  sleep 0.3; GROQ_URL=http://127.0.0.1:9912 srv
  p "== a key saved in Settings (FAKE test value) is still used"
  api PUT /api/settings/groq-key '{"value":"gsk_FAKE_SETTINGS_KEY_00000000000000"}' tokS >/dev/null
  r=$(api POST /api/ai/expand-note '{"note":"called, left vm, try friday"}' tokS); p "  expand-note -> $(grep -oE 'HTTP [0-9]+' <<<"$r") $(grep -oE '"note":"[^"]*"' <<<"$r")"
  p "  fake Groq server saw: $(sort "$OUT/seen" 2>/dev/null | uniq -c | tr -s ' ' | tr '\n' ';')"
  kill $FAKE 2>/dev/null ;;
search)
  SLOG=/dev/null
  OLD=$(git -C "$ROOT" log -p --all -S'gsk_' -- backend/src/config/index.js | grep -oE "gsk_[A-Za-z0-9]{20,}" | head -1)
  p "== search for the old key (value never printed; length ${#OLD})"
  p "  in this checkout's tracked files: $(git -C "$CO" grep -c -F "$OLD" -- . 2>/dev/null | wc -l) file(s)"
  p "  in audit/logs, audit/screenshots, FIX_LOG.md, AUDIT_REPORT.md (working tree): $(grep -rlF "$OLD" "$CO/audit" "$CO/FIX_LOG.md" "$CO/AUDIT_REPORT.md" 2>/dev/null | wc -l) file(s)"
  p "  in git history (all branches): $(git -C "$ROOT" log --all -S"$OLD" --oneline | wc -l) commit(s) touch it (history keeps it: the key must be revoked)" ;;
esac
p "  server log ($PART): $(grep -ciE 'error|warn' "$SLOG" 2>/dev/null; true) error/warn lines"
done
stop_backend
