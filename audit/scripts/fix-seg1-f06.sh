#!/usr/bin/env bash
# F-06 repro: seed a database, then try to log in with (a) the password the
# seed printed and (b) the OLD committed default password.
# Usage: OLD_DEFAULT_PASSWORD='<old default>' bash audit/scripts/fix-seg1-f06.sh <db_name> [label]
#   Set SEED_USER_PASSWORD in the environment to test the env-var path.
# Passwords are never echoed: they are masked as first 4 chars + length.
set -u
. "$(dirname "$0")/../lib/env.sh"
DBN="$1"; LABEL="${2:-seed}"
URL="postgres://vortex:vortex@localhost:5432/$DBN"
mask() { local v="$1"; [ -z "$v" ] && { echo "(none)"; return; }; echo "${v:0:4}****(len ${#v})"; }

OUT=$(cd "$AUDIT_ROOT/backend" && DATABASE_URL="$URL" npm run --silent seed 2>&1)
# old format: "Seed complete. Login with <email> / <password>"; new format: "  password: <password>"
PW=$(echo "$OUT" | sed -n -E 's/^Seed complete\. Login with [^ ]+ \/ (.+)$/\1/p; s/^[[:space:]]*password:[[:space:]]+([^[:space:]]+)$/\1/p' | head -1)
[ -z "$PW" ] && [ -n "${SEED_USER_PASSWORD:-}" ] && PW="$SEED_USER_PASSWORD"
SAFE_OUT="$OUT"
for secret in "$PW" "${OLD_DEFAULT_PASSWORD:-}" "${SEED_USER_PASSWORD:-}"; do [ -n "$secret" ] && SAFE_OUT="${SAFE_OUT//"$secret"/$(mask "$secret")}"; done
echo "--- [$LABEL] seed output on $DBN (passwords masked):"; echo "$SAFE_OUT" | sed 's/^/    /'
echo "--- [$LABEL] users row: $(DB=$DBN sql "select email||' role='||role from users")"

export API=http://localhost:4100
( cd "$AUDIT_ROOT/backend" && exec setsid env PORT=4100 DATABASE_URL="$URL" node src/index.js > "$SCRATCH/f06-backend.txt" 2>&1 < /dev/null & )
for i in $(seq 1 40); do curl -s "$API/health" >/dev/null 2>&1 && break; sleep 0.25; done
try() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/login" -H 'content-type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({email:"vortexoneagency@gmail.com",password:process.argv[1]}))' "$1")"; }
echo "--- [$LABEL] login with the password the seed printed ($(mask "$PW")): HTTP $(try "$PW")"
[ -n "${OLD_DEFAULT_PASSWORD:-}" ] && echo "--- [$LABEL] login with the OLD committed default ($(mask "$OLD_DEFAULT_PASSWORD")): HTTP $(try "$OLD_DEFAULT_PASSWORD")"
pkill -f "PORT=4100" 2>/dev/null; pkill -f "node src/index.js" -P 1 2>/dev/null
for p in $(pgrep -f "node src/index.js"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q '^PORT=4100$' && kill $p; done
echo "$PW" > "$SCRATCH/f06-last-password"   # kept outside the repo for the reseed check
