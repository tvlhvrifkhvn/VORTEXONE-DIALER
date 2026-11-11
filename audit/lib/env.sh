# Shared helpers for the audit scripts. Source it: `. audit/lib/env.sh`
# Nothing here prints secrets: the JWT is kept in a scratch file, never echoed.
AUDIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export AUDIT_ROOT
export API="${API:-http://localhost:4000}"
export SCRATCH="${SCRATCH:-/var/tmp/audit-scratch}"
mkdir -p "$SCRATCH"
export PGPASSWORD=vortex

# sql "<query>"  -> unaligned output against the audit DB
sql() { psql -h localhost -U vortex -d "${DB:-vortex_dialer}" -AtF'|' -c "$1"; }
# sqlt "<query>" -> aligned table output (for pasting into the report)
sqlt() { psql -h localhost -U vortex -d "${DB:-vortex_dialer}" -c "$1"; }

# login [email] [password] -> stores token in $SCRATCH/token[-suffix]
login() {
  local email="${1:-vortexoneagency@gmail.com}" pw="${2:-ChangeMe123!}" out="${3:-token}"
  curl -s -X POST "$API/api/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pw\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.token){console.error("login failed:",s);process.exit(1)}process.stdout.write(j.token)})' > "$SCRATCH/$out"
}

# api METHOD PATH [json] [tokenfile]  -> prints body then " [HTTP nnn]"
api() {
  local m="$1" p="$2" d="$3" tf="${4:-token}" tok=""
  [ -f "$SCRATCH/$tf" ] && tok="$(cat "$SCRATCH/$tf")"
  if [ -n "$d" ]; then
    curl -s -w ' [HTTP %{http_code}]\n' -X "$m" "$API$p" -H "authorization: Bearer $tok" -H 'content-type: application/json' -d "$d"
  else
    curl -s -w ' [HTTP %{http_code}]\n' -X "$m" "$API$p" -H "authorization: Bearer $tok"
  fi
}

# jq-lite: echo '{"a":{"b":1}}' | jget a.b
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{s=s.replace(/ \[HTTP \d+\]\s*$/,"");let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v==null?v:v[k];console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }

# start_backend <logname> [extra env assignments...] — starts backend on $PORT (default 4000)
start_backend() {
  local name="$1"; shift
  ( cd "$AUDIT_ROOT/backend" && exec setsid env "$@" node src/index.js > "$AUDIT_ROOT/audit/logs/server-$name.txt" 2>&1 < /dev/null & )
  for i in $(seq 1 40); do curl -s "${API}/health" >/dev/null 2>&1 && return 0; sleep 0.25; done
  echo "backend did not come up; log:"; tail -5 "$AUDIT_ROOT/audit/logs/server-$name.txt"; return 1
}
stop_backend() { pkill -f "node src/index.js" 2>/dev/null; sleep 0.5; }
