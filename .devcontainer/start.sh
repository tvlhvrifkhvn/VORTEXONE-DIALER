#!/usr/bin/env bash
# Runs every time the devcontainer/Codespace starts or resumes.
# postCreateCommand (setup.sh) only runs once, so Postgres needs to be
# started again on every subsequent start.
set -euo pipefail

sudo service postgresql start
echo "==> Postgres is running. Start the app with:"
echo "    cd backend && npm run dev"
echo "    cd frontend && npm run dev"
