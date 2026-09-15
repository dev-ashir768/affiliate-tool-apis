# Affiliate Tool APIs — Foundation Design

Date: 2026-09-15  
Status: Approved for implementation planning  
Scope: Auth, organizations/memberships, Stripe billing, shop connection (hybrid verify)  
Stack: Node.js, Express, TypeScript, PostgreSQL, Prisma, Redis, BullMQ  
Source blueprint: TikTok Shop Business Model & Customer Journey (SaaS operational blueprint)

## Goal

Stand up `affiliate-tool-apis` as the backend for Tiksly’s Foundation slice: register/login with JWT access + refresh, multi-user orgs with seat limits, Stripe Checkout subscriptions that sync plan quotas, and zero-password TikTok Shop connection via bot staff-role delegation with a stub verify path and Playwright worker scaffold.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| First slice | Foundation (auth + orgs + shop connection) |
| Auth | JWT access + refresh tokens |
| Shop verify | Hybrid — stub default + Playwright scaffold behind flag |
| Billing | Stripe Checkout + webhooks |
| Org roles | `OWNER` \| `ADMIN` \| `MEMBER` (VA seats = plan seat limit) |
| Architecture | Modular Express monolith + separate worker process entrypoint |
| Language | TypeScript |

Out of scope for Foundation: creator discovery, outreach campaigns, influencer CRM pipeline, unified inbox, full backoffice crawler/proxy product surfaces (schema hooks only where needed for bots/shops).

## Architecture

```
affiliate-tool-apis/
  src/
    app.ts
    server.ts                 # HTTP process
    worker.ts                 # BullMQ process
    config/
    lib/                      # prisma, redis, queue, crypto, errors, logger
    middleware/               # auth, orgContext, validate, errorHandler, rateLimit
    modules/
      auth/
      orgs/
      billing/
      shops/
      bots/
    workers/
      shop-verify.processor.ts
      shop-verify.playwright.scaffold.ts
  prisma/
    schema.prisma
    seed.ts                   # Plan catalog + optional bot pool
```

**Runtime**

- **API process** — Express HTTP; enqueues jobs; never runs Playwright in-request.
- **Worker process** — same repo, `npm run worker`; consumes BullMQ queues.
- **PostgreSQL** — system of record via Prisma.
- **Redis** — refresh-token fast path / denylist + BullMQ broker.

**Tenancy**

- Authenticated requests resolve `userId` from access JWT.
- Active `organizationId` is carried as a JWT claim (set at login / org switch later).
- Middleware loads `Membership` and rejects if missing or not `ACTIVE`.
- All shop/billing/member mutations are scoped to that organization.

## Data model

### Enums

- `MembershipRole`: `OWNER`, `ADMIN`, `MEMBER`
- `MembershipStatus`: `INVITED`, `ACTIVE`, `DISABLED`
- `SubscriptionStatus`: `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `INCOMPLETE`
- `BotStatus`: `AVAILABLE`, `RESERVED`, `ASSIGNED`, `DISABLED`
- `ShopRegion`: `US`, `UK`
- `ShopStatus`: `PENDING_INVITE`, `VERIFYING`, `ACTIVE`, `FAILED`, `DISCONNECTED`
- `ShopVerifyMode`: `STUB`, `PLAYWRIGHT`

### Models

| Model | Key fields | Notes |
|-------|------------|-------|
| `User` | email (unique), passwordHash, name, status | Email normalized lowercase |
| `Organization` | name, slug, planId, stripeCustomerId, seatLimit, shopLimit, dailyInviteQuota | Quotas mirrored from Plan on subscription sync |
| `Membership` | userId, organizationId, role, status | Unique (userId, organizationId) |
| `Plan` | code, name, monthlyPriceCents, seatLimit, shopLimit, dailyInviteQuota, stripePriceId | Seed Starter / Growth / Agency |
| `Subscription` | organizationId, stripeSubscriptionId, status, currentPeriodEnd | One active-ish sub per org |
| `RefreshToken` | userId, tokenHash, expiresAt, revokedAt, replacedById? | Rotation chain; Redis TTL mirror |
| `BotIdentity` | email (unique), proxyBinding?, status, reservedForOrgId?, reservedAt? | Pre-seeded pool preferred |
| `Shop` | organizationId, region, botIdentityId, externalShopId?, displayName?, status, statusReason?, sessionVaultCiphertext?, verifiedAt? | Bot email exposed to UI for Seller Center invite |
| `ShopVerificationJob` | shopId, bullJobId?, mode, status, attempts, lastError? | Audit of verify runs |
| `StripeEvent` | eventId (unique), type, processedAt | Webhook idempotency |

### Business rules

1. Register creates `User` + `Organization` + `Membership(OWNER, ACTIVE)`. Org starts on a free/default plan row only if seeded; paid quotas apply after Stripe webhook (or test seed).
2. Creating a membership invite checks `seatLimit` vs active+invited count. Invite tokens are single-use, stored hashed, expire after a fixed TTL (e.g. 7 days).
3. `POST /shops/connect` checks `shopLimit`, reserves an `AVAILABLE` bot → `RESERVED`, creates shop `PENDING_INVITE`.
4. Verify transitions: `PENDING_INVITE` → `VERIFYING` → `ACTIVE` or `FAILED`.
5. On `ACTIVE`, bot → `ASSIGNED`; on disconnect/fail release policy: `FAILED` may return bot to `AVAILABLE` after cooldown (v1: immediate on `DISCONNECTED` / admin reset).
6. Stripe webhooks update `Subscription` and copy Plan limits onto `Organization`.
7. No merchant TikTok passwords stored. Session vault (when Playwright path used) is AES-256-GCM with `SESSION_VAULT_KEY`.

## API surface

Base path: `/api/v1` (recommended). JSON request/response. Zod validation on inputs.

### Auth

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| POST | `/auth/register` | public | Create user/org/owner; return tokens |
| POST | `/auth/login` | public | Access + refresh |
| POST | `/auth/refresh` | refresh cookie/body | Rotate refresh; new access |
| POST | `/auth/logout` | refresh or access | Revoke refresh |
| GET | `/auth/me` | access | User + memberships + current org summary |

### Organizations / members

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/orgs/current` | member | Org + plan + subscription summary |
| PATCH | `/orgs/current` | OWNER/ADMIN | Update name |
| GET | `/orgs/current/members` | member | List members/invites |
| POST | `/orgs/current/invites` | OWNER/ADMIN | Email invite; seat check |
| POST | `/orgs/invites/:token/accept` | access (invited user) | Activate membership |

### Billing

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/billing/plans` | public or auth | Plan catalog |
| POST | `/billing/checkout-session` | OWNER/ADMIN | Stripe Checkout for `priceId` / plan code |
| POST | `/billing/portal-session` | OWNER/ADMIN | Stripe Customer Portal |
| POST | `/webhooks/stripe` | Stripe signature | Idempotent subscription sync |

### Shops / bots

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/shops` | member | List org shops |
| GET | `/shops/:id` | member | Detail including bot email + status |
| POST | `/shops/connect` | OWNER/ADMIN | Allocate bot; return invite instructions payload |
| POST | `/shops/:id/verify` | OWNER/ADMIN | Enqueue `shop-verify` job |
| DELETE | `/shops/:id` | OWNER/ADMIN | Disconnect; release bot |

### Conventions

- Access token: `Authorization: Bearer <jwt>`
- Refresh token: httpOnly secure cookie preferred for browser portal; body token allowed for non-browser clients
- Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
- Domain codes include: `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `PLAN_LIMIT`, `SHOP_NOT_READY`, `CONFLICT`, `NOT_FOUND`

## Flows

### Registration → paid plan

1. Client `POST /auth/register` (optional `planCode`).
2. If unpaid, client `POST /billing/checkout-session`.
3. Stripe redirects; webhook upserts `Subscription` and applies quotas.
4. Portal reads `/orgs/current` for limits/status.

### Shop connection (hybrid)

1. Client `POST /shops/connect` `{ region }` → bot email + shop id + status `PENDING_INVITE`.
2. Merchant invites bot in TikTok Seller Center with Affiliate/Creator Collaboration role.
3. Client `POST /shops/:id/verify`.
4. Worker runs:
   - **STUB** (default): delay → `ACTIVE`, placeholder vault metadata.
   - **PLAYWRIGHT** (flag): scaffold accepts same job payload; real inbox/accept/login later.
5. Client polls `GET /shops/:id` until `ACTIVE` or `FAILED`.

## Workers

- Queue name: `shop-verify`
- Job data: `{ shopId, organizationId, mode, verificationJobId }`
- Concurrency: low for Playwright (1–2); stub can be higher
- Retries: exponential backoff for transient errors; terminal failure marks shop `FAILED` and writes `statusReason`
- Config: `SHOP_VERIFY_MODE=stub|playwright` (job may override only if explicitly allowed in admin/dev)

## Security

- Password hashing: Argon2id
- JWT access: short-lived (e.g. 15m); refresh: longer (e.g. 7–30d) with rotation
- Refresh tokens stored hashed in Postgres; Redis key for TTL/revoke checks
- Stripe webhook signature verification required; raw body parser on webhook route only
- Rate limits on `/auth/*` and `/shops/:id/verify`
- Secrets via env: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_VAULT_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- CORS allowlist for portal origin(s)

## Error handling & observability

- Central Express error middleware maps domain errors → HTTP status
- Structured logs with `requestId`, `userId`, `organizationId`, `shopId` when present
- Stripe events recorded in `StripeEvent` before side effects commit (or in same transaction after claim)

## Testing bar (Foundation)

- Unit: refresh rotation/revoke, seat/shop limit guards, shop state machine transitions
- Integration: register → mock Stripe webhook → connect shop → stub verify → `ACTIVE`
- No live TikTok / Playwright E2E in CI for v1

## Portal integration notes

- Replace portal mock auth/users routes gradually with `/api/v1` base URL
- Navigation/data-table contracts remain portal-owned; Foundation APIs do not serve nav JSON in this slice
- Cookie domain / CORS must be configured for local `affiliate-tool-portal` → `affiliate-tool-apis`

## Non-goals / deferred

- Creator discovery filters and GMV indexes
- Campaign blast queues and invite jitter engine
- Influencer CRM columns and messaging inbox
- Multi-shop org switcher UX beyond single active org claim (can add `POST /orgs/switch` later)
- Granular RBAC beyond three roles
- Paddle billing

## Success criteria

- Fresh clone can migrate, seed plans/bots, run API + worker against Postgres/Redis
- Register/login/refresh works end-to-end
- Stripe test-mode checkout + webhook updates org quotas
- Shop connect + stub verify reaches `ACTIVE` without Playwright
- Playwright verify module exists as scaffold with identical job contract
