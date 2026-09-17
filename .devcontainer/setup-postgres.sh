#!/usr/bin/env bash
# Runs once per container build (postCreateCommand) — the `universal`
# devcontainer image doesn't ship Postgres at all, so it has to be installed
# here rather than just started. Idempotent: safe to re-run.
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y postgresql
fi

sudo service postgresql start

# `sudo -u postgres ...` prompts for a password on this image's sudoers
# config (NOPASSWD only covers becoming root, not arbitrary -u targets) —
# go through root, then `su` to postgres, which root can always do without
# a password.
run_as_postgres() {
  sudo su - postgres -c "$1"
}

# Match backend/.env.example's default DATABASE_URL
# (postgres://vortex:vortex@localhost:5432/vortex_dialer).
run_as_postgres "psql -v ON_ERROR_STOP=1 <<'SQL'
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vortex') THEN
    CREATE ROLE vortex WITH LOGIN PASSWORD 'vortex' SUPERUSER;
  END IF;
END
\$\$;
SQL"

run_as_postgres "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'vortex_dialer'\"" | grep -q 1 \
  || run_as_postgres "createdb -O vortex vortex_dialer"

echo "Postgres ready: role 'vortex' / database 'vortex_dialer'."
