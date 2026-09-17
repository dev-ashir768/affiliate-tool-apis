# Tiksly Operator Runbook

## Local stack

```bash
# APIs
cd affiliate-tool-apis
cp .env.example .env   # fill secrets
npm install
npm run db:migrate:prod
npm run db:seed
npm run dev:all        # API + workers (shop-verify + crawler)

# Portal
cd affiliate-tool-portal
cp .env.example .env   # API URL + secrets
npm install
npm run dev
```

## Superadmin bootstrap

Set in APIs `.env` before seed:

- `PLATFORM_SUPERADMIN_EMAIL`
- `PLATFORM_SUPERADMIN_PASSWORD` (or `PLATFORM_SUPERADMIN_PASSWORD_HASH`)

Then `npm run db:seed`. Login at portal `/login` → routes to backoffice.

## Stripe (test)

1. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plan price IDs in `.env` + seed
2. `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe`
3. Portal Billing → Checkout / Customer Portal (BFF only; no Stripe secrets in browser)

## Shop verify modes

| Mode | Env |
|------|-----|
| Demo stub | `SHOP_VERIFY_MODE=stub` (default) |
| Playwright dry-run | `SHOP_VERIFY_MODE=playwright` + `PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true` |
| Fixture Chromium | dry-run `false`, `SHOP_VERIFY_TARGET=fixture`, `npx playwright install chromium` |
| Live Seller Center | `SHOP_VERIFY_TARGET=live` + `SHOP_VERIFY_LIVE_URL_US/UK` + accept selector |
| Bot inbox gate | `BOT_INBOX_PROVIDER=imap` + IMAP_* (optional `console` for log-only) |

Never commit vault keys, IMAP passwords, or Stripe secrets.

## Email

- `EMAIL_PROVIDER=console` (dev logs) or `smtp` with SMTP_* 
- Templates: password reset, org invite, staff welcome

## Growth product (Phase 9 slice 1)

- Creators CRM: `/creators` → `GET/POST /api/v1/creators`
- Lists: `/api/v1/creators/lists`
- Campaigns: `/campaigns` → `/api/v1/creators/campaigns`
- No TikTok crawl/API yet — manual handles only

## Health

- `GET http://localhost:4000/health` → `{ ok: true }`
- Crawler dry-run: backoffice `/backoffice/crawler` → Run dry check (needs Redis + worker)

## Migrations

```bash
npm run db:migrate:prod   # deploy
npm run db:migrate:dev    # create during development
npm run db:status
```

## Production checklist

- [ ] Postgres + Redis reachable; backups scheduled
- [ ] `TRUST_PROXY=true` behind load balancer
- [ ] Strong JWT + `SESSION_VAULT_KEY` (≥32 chars)
- [ ] Stripe live keys only on prod; webhook endpoint verified
- [ ] SMTP configured; test invite + reset emails
- [ ] `SHOP_VERIFY_MODE=stub` or dry-run until live URLs validated
- [ ] Optional `SENTRY_DSN` when error tracking wired
- [ ] Rate limits: auth + shop verify + creators write (Redis)
