#!/usr/bin/env bash
# One-command dev startup: Postgres, migrations, backend, frontend.
# Safe to re-run any time (a Codespace restart, a stale process, whatever) —
# it kills anything already on 4000/5173 first, so it never doubles up.
#
# Usage:
#   ./dev.sh          # start everything
#   ./dev.sh stop      # stop backend + frontend (leaves Postgres running)
#   ./dev.sh status     # just print what's up right now
#   ./dev.sh logs backend|frontend   # tail a log

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BACKEND_LOG=/tmp/vortex-backend.log
FRONTEND_LOG=/tmp/vortex-frontend.log
BACKEND_PID=/tmp/vortex-backend.pid
FRONTEND_PID=/tmp/vortex-frontend.pid

kill_port() {
  local port="$1"
  local pid
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

wait_for() {
  local url="$1" tries=0
  until curl -sf "$url" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 30 ]; then
      return 1
    fi
    sleep 1
  done
  return 0
}

cmd_status() {
  echo "--- Postgres ---"
  service postgresql status 2>&1 || echo "not running"
  echo "--- Backend (http://localhost:4000) ---"
  curl -sf http://localhost:4000/health && echo || echo "not responding"
  echo "--- Frontend (http://localhost:5173) ---"
  curl -sf http://localhost:5173 >/dev/null 2>&1 && echo "up" || echo "not responding"
}

cmd_stop() {
  kill_port 4000
  kill_port 5173
  rm -f "$BACKEND_PID" "$FRONTEND_PID"
  echo "Stopped backend and frontend."
}

cmd_logs() {
  case "${1:-}" in
    backend) tail -f "$BACKEND_LOG" ;;
    frontend) tail -f "$FRONTEND_LOG" ;;
    *) echo "Usage: ./dev.sh logs backend|frontend" ;;
  esac
}

cmd_start() {
  echo "==> Postgres"
  sudo service postgresql start >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1 || true
  if ! service postgresql status 2>&1 | grep -q online; then
    echo "    Postgres isn't installed/configured yet — running one-time setup..."
    bash .devcontainer/setup-postgres.sh
  fi
  echo "    $(service postgresql status 2>&1)"

  echo "==> Clearing anything already on 4000/5173"
  kill_port 4000
  kill_port 5173

  echo "==> Backend: migrate + start"
  (cd backend && npm run migrate) || { echo "!! Migration failed — see output above."; exit 1; }
  (cd backend && nohup npm run dev > "$BACKEND_LOG" 2>&1 & echo $! > "$BACKEND_PID")
  if wait_for http://localhost:4000/health; then
    echo "    Backend up: $(curl -s http://localhost:4000/health)"
  else
    echo "!! Backend didn't come up in 30s — last 30 log lines:"
    tail -30 "$BACKEND_LOG"
    exit 1
  fi

  echo "==> Frontend: start"
  (cd frontend && nohup npm run dev -- --host > "$FRONTEND_LOG" 2>&1 & echo $! > "$FRONTEND_PID")
  if wait_for http://localhost:5173; then
    echo "    Frontend up on http://localhost:5173"
  else
    echo "!! Frontend didn't come up in 30s — last 30 log lines:"
    tail -30 "$FRONTEND_LOG"
    exit 1
  fi

  echo ""
  echo "Everything is up."
  echo "Backend log:  ./dev.sh logs backend"
  echo "Frontend log: ./dev.sh logs frontend"
  if [ -n "${CODESPACE_NAME:-}" ]; then
    echo ""
    echo "Open: https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
    echo "(or click the 5173 row's link in the Ports tab — it always has the current hostname)"
  fi
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  logs) cmd_logs "${2:-}" ;;
  *) echo "Usage: ./dev.sh [start|stop|status|logs backend|frontend]" ;;
esac
