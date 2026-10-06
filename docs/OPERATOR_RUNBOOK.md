# Tiksly Operator Runbook

## Local stack

```bash
# APIs
cd affiliate-tool-apis
cp .env.example .env   # fill secrets
npm install
npm run db:migrate:prod
npm run db:seed
npm run dev:all        # API + workers (shop-verify, discovery, outreach, …)

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

## Growth product

- Creators CRM, lists, campaigns, outreach, affiliate invites
- Discovery + TikTok Shop OpenAPI (per-shop OAuth)
- Crawl/sync via Discovery backoffice (not a separate crawler page)

## Observability

- Optional `SENTRY_DSN` + `npm i @sentry/node` (optionalDependency)
- CI: `.github/workflows/ci.yml` runs typecheck (+ portal lint)

## Health

- `GET http://localhost:4000/health` → `{ ok: true }`

## Migrations

```bash
npm run db:migrate:deploy   # deploy
npm run db:migrate:dev      # create during development
npm run db:status
```

## Production checklist

- [ ] Postgres + Redis reachable; backups scheduled
- [ ] `TRUST_PROXY=true` behind load balancer
- [ ] Strong JWT + `SESSION_VAULT_KEY` (prefer 64 hex chars) + `PORTAL_BFF_SECRET`
- [ ] Stripe live keys only on prod; webhook endpoint verified
- [ ] SMTP configured; test invite + reset emails
- [ ] Shop verify: `SHOP_VERIFY_MODE=playwright`, dry-run off, `SHOP_VERIFY_TARGET=live`
- [ ] Optional `SENTRY_DSN` when error tracking wired
- [ ] Rate limits: auth fail-closed when Redis down

## Auth keys, BFF secret and client IP

- **Access JWTs (EdDSA):** set `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` on the API and
  only `JWT_PUBLIC_KEY` on the portal (generator command in `.env.example`).
  Verify with `npm run check:jwt`. Without the keypair the API falls back to HS256
  and the portal needs `JWT_ACCESS_SECRET`.
- **Rollout order:** deploy the API with the keypair first, then the portal with
  `JWT_PUBLIC_KEY`. Old HS256 access tokens are rejected and silently re-issued
  via the refresh cookie; nobody is logged out.
- **`PORTAL_BFF_SECRET`:** identical on both apps. Rotating it = update both and
  restart both together.
- **Client IP:** the portal forwards the browser IP to the API (`X-Client-IP`,
  trusted only with the BFF secret) for rate limiting. nginx in front of the
  portal must set it:

  ```nginx
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  ```
- **Graceful restarts:** API and worker drain on SIGTERM; PM2 `kill_timeout` is
  35s so in-flight jobs finish instead of being re-run as stalled.

## Tests

Tests never use `DATABASE_URL` from `.env`. Point `TEST_DATABASE_URL` /
`TEST_REDIS_URL` at disposable instances (defaults: local
`affiliate_tool_test` and Redis db 15), then `npx prisma migrate deploy`,
`npx prisma db seed`, `npm test`.
