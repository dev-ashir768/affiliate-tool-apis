#!/usr/bin/env bash
# One-command production deploy for affiliate-tool-apis (run on the server, in this repo).
#   bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  echo "Missing .env — create it with the production secrets first." >&2
  exit 1
fi
if ! grep -q '^IMAP_PASS=..*' .env; then
  echo "Warning: IMAP_PASS is not set in .env — bot shop verify will fail." >&2
fi

step "Pulling latest main"
git pull --ff-only origin main

step "Installing dependencies"
npm ci

step "Building"
npm run build

step "Applying database migrations"
npx prisma migrate deploy

step "Ensuring Chromium for shop verify"
npx playwright install --with-deps chromium

step "Restarting API and worker"
if pm2 describe influxa-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

step "Status"
pm2 status
echo
echo "Deployed $(git log --oneline -1)"
