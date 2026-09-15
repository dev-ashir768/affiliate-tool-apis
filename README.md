# Affiliate Tool APIs (Foundation)

Express + Prisma API and BullMQ worker for the affiliate tool foundation.

## Prerequisites

- Node.js 20+
- PostgreSQL (local or remote)
- Redis reachable at `REDIS_URL` (remote VPS is fine — **no Docker required**)

> **Redis note:** Auth refresh mirrors, rate limits, and the shop-verify queue use Redis.
> Rate limiting **fails open** when Redis is unreachable so local API development still works.
> Production must keep Redis reachable for refresh enforcement, rate limits, and workers.

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL, REDIS_URL, JWT secrets, SESSION_VAULT_KEY, CORS_ORIGINS, Stripe keys
```

### Environment (see `.env.example`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis for refresh mirror, rate limits, BullMQ |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Min 32 chars each |
| `SESSION_VAULT_KEY` | 32-byte hex/string for session vault |
| `CORS_ORIGINS` | Comma-separated origins (portal default `http://localhost:3000`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `SHOP_VERIFY_MODE` | `stub` (default) or `playwright` |

### Database

```bash
npm install
npm run prisma:generate
npm run prisma:migrate    # prisma migrate deploy
npm run prisma:seed       # plans + sample bot identities
```

Free plan has `shopLimit: 0` — bump an org’s `shopLimit` (or complete Stripe billing) before connecting a shop.

## Run

```bash
# API (default http://localhost:4000)
npm run dev

# Worker (shop verify queue) — needs reachable Redis
npm run worker
```

Health check: `GET /health` → `{ "ok": true }`.

### Portal CORS

Set `CORS_ORIGINS` to the portal origin(s), e.g. `http://localhost:3000`.
Credentials (cookies) are enabled; the portal must call the API with `credentials: "include"`.

### Stripe webhooks (local)

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
```

Copy the CLI webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## Smoke script

With API (+ ideally worker) running:

```bash
npm run smoke
# or: npx tsx scripts/smoke-foundation.ts
```

Flow: register → bump org `shopLimit` to 1 (free plan starts at 0) → connect shop → request verify → poll until `ACTIVE`.

If Redis/worker is unavailable, the script falls back to calling `processShopVerify` directly and documents that path in the console output.

Optional gated HTTP smoke test:

```bash
SMOKE_HTTP=1 npm test -- tests/smoke/foundation.http.test.ts
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | API with watch |
| `npm run worker` | Shop-verify worker with watch |
| `npm run smoke` | Foundation end-to-end smoke |
| `npm test` | Vitest suite |
| `npm run prisma:migrate` | `prisma migrate deploy` |
| `npm run prisma:seed` | Seed plans/bots |
