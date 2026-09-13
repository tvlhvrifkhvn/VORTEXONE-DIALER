#!/usr/bin/env bash
# Runs once when the devcontainer/Codespace is created.
# Installs Postgres, creates the app role/db, installs deps, and wires up
# .env files (including Codespaces' forwarded-port URLs when applicable).
set -euo pipefail

echo "==> Installing PostgreSQL"
sudo apt-get update -y
sudo apt-get install -y postgresql
sudo service postgresql start

echo "==> Creating vortex role and vortex_dialer database"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='vortex'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE vortex WITH LOGIN PASSWORD 'vortex';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='vortex_dialer'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE vortex_dialer OWNER vortex;"

cd "$(dirname "$0")/.."

echo "==> Preparing backend/.env"
[ -f backend/.env ] || cp backend/.env.example backend/.env

echo "==> Preparing frontend/.env"
[ -f frontend/.env ] || cp frontend/.env.example frontend/.env

# In GitHub Codespaces, localhost URLs don't work from the browser — the
# frontend must call the backend's *forwarded* URL, and the backend must
# allow that forwarded frontend URL as its CORS origin.
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  FRONTEND_URL="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  BACKEND_URL="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  echo "==> Codespaces detected, wiring forwarded URLs"
  echo "    frontend: ${FRONTEND_URL}"
  echo "    backend:  ${BACKEND_URL}"
  sed -i "s#^VITE_API_URL=.*#VITE_API_URL=${BACKEND_URL}/api#" frontend/.env
  if grep -q '^CORS_ORIGIN=' backend/.env; then
    sed -i "s#^CORS_ORIGIN=.*#CORS_ORIGIN=${FRONTEND_URL}#" backend/.env
  else
    echo "CORS_ORIGIN=${FRONTEND_URL}" >> backend/.env
  fi
fi

echo "==> Installing backend dependencies"
(cd backend && npm install)

echo "==> Installing frontend dependencies"
(cd frontend && npm install)

echo "==> Running migrations"
(cd backend && npm run migrate)

echo "==> Seeding database"
(cd backend && npm run seed)

echo "==> Setup complete. Run 'npm run dev' in backend/ and frontend/ to start the app."
