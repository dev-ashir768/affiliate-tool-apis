# Foundation API — Final Whole-Branch Review

**Branch:** `feat/foundation-api`
**Base:** `6a256eafc89eff269535c1ae18ee8ea3dd5057e9`
**Head:** `b9d2115ae2ee7f9243061b33d720f90171846408`
**Scope:** 60 files changed, ~4.4k insertions (all new files; no pre-existing code modified)
**Spec:** `docs/superpowers/specs/2026-09-15-foundation-api-design.md`
**Plan:** `docs/superpowers/plans/2026-09-15-foundation-api.md`
**Reviewed:** 2026-09-16

---

## Verdict

**Not ready to merge as-is.** Two Critical defects must be fixed first. Both are small, contained changes.

Overall the slice is well built: it covers every endpoint in the spec, the module boundaries match the plan exactly, the error envelope is consistent, and several genuinely subtle issues (bot-reservation races, Stripe idempotency rollback, shop stuck in `VERIFYING` on enqueue failure) were already caught and fixed in follow-up commits on the branch. The problems below are concentrated in two areas: **the Redis degradation paths** (which silently disable security controls rather than failing loudly) and **production code that branches on test environment**, which left the primary verify happy-path uncovered.

### Verification performed

| Check | Result |
|-------|--------|
| `npx tsc -p tsconfig.json --noEmit` | **FAIL** — 2 errors in `src/lib/redis.ts` |
| `npx vitest run tests/lib tests/middleware tests/health.test.ts` | PASS — 7 tests, 4 files |
| DB/Redis-dependent suites | Not run — they mutate whatever `DATABASE_URL` resolves to (see I-11) |
| `.env` committed? | No — `.gitignore:4` covers it. `package-lock.json` is committed. |

---

## Critical

### C-1 — `npm run build` fails; there is no working production start path

`npx tsc -p tsconfig.json` exits 1:

```
src/lib/redis.ts(4,26): error TS2351: This expression is not constructable.
  Type 'typeof import(".../ioredis/built/index")' has no construct signatures.
src/lib/redis.ts(8,17): error TS7006: Parameter 'times' implicitly has an 'any' type.
```

`src/lib/redis.ts:1` uses `import Redis from "ioredis"`. Installed ioredis is 6.0.0, a CJS package (`main: ./built/index.js`, no `exports` map, no `type` field) whose `built/index.d.ts` re-exports via ESM syntax. Under `module: NodeNext` from an ESM package, the default import resolves to the module namespace rather than the class, so it isn't constructable. The second error is a cascade — `retryStrategy` loses contextual typing once the constructor call is untyped.

This was triaged as "pre-existing," but it is not pre-existing to this branch: `src/lib/redis.ts` is introduced by `812c540` inside this diff. `npm run dev` and `npm run worker` work because `tsx` strips types without checking them, which is exactly why it went unnoticed — but `npm run build` and therefore `npm start` (`node dist/server.js`) cannot succeed. The branch has no deployable artifact.

ioredis 6 exports the class as a named export (`export { default as Redis } from "./Redis"`), so the fix should be:

```ts
import { Redis } from "ioredis";
```

Please confirm `npm run build` exits 0 after the change rather than assuming the cascade error clears on its own.

### C-2 — An expired invite permanently bricks the invitee's email address

`createInvite` (`src/modules/orgs/orgs.service.ts:105-116`) creates a stub `User` row for an invitee who has not registered yet, with a random password hash and the sentinel name `"Invited"`.

Once the 7-day `INVITE_TTL_SEC` elapses, that email is unusable through every API path:

- `POST /auth/register` → the stub user exists → `CONFLICT "Email already registered"` (`src/modules/auth/auth.service.ts:55`).
- `POST /orgs/invites/:token/accept` → `acceptInvite` filters on `inviteExpiresAt` and throws `FORBIDDEN "Invite expired"`.
- Re-inviting → membership is still `status: "INVITED"`, so `createInvite` throws `CONFLICT "User already invited"` (`orgs.service.ts:132-137`).

There is no password-reset endpoint and no invite-revoke or invite-resend endpoint in this slice, so recovery requires direct database surgery. Any invite that isn't accepted within a week — a routine occurrence — permanently locks a real person out of the product.

The same stub mechanism has a second, narrower problem: `acceptInvite` decides whether a user is a stub by comparing `membership.user.name === "Invited"` (`orgs.service.ts` accept path). A legitimate user who happens to have set their display name to `Invited` can have their password and name overwritten by whoever holds the invite token.

Both stem from encoding "this account is a placeholder" in a display-name string. Suggested fix, in rough order of preference:

1. Add an explicit marker — a `UserStatus.INVITED` value (the enum already exists) or a nullable `passwordHash` — and branch on that instead of the name.
2. Give expired/pending invites a recovery path: let `createInvite` overwrite an `INVITED` membership whose `inviteExpiresAt` has passed (re-issue a fresh token), and/or add `DELETE /orgs/current/invites/:id`.
3. Allow `register` to adopt an unclaimed stub account (set the password, flip status) instead of rejecting with 409.

Option 1 plus option 2 is the minimum that removes the dead end.

---

## Important

### I-1 — Refresh-token Redis mirror degrades silently and permanently after one blip

`src/modules/auth/refresh-store.ts:9` checks the cached failure flag *before* the live status check:

```ts
async function ensureRedis(): Promise<boolean> {
  if (redisAvailable === false) return false;
  if (redis.status === "ready") { ... }
```

Consequences, all for the remaining lifetime of the process:

- **It never recovers.** Once `redisAvailable` is `false`, the live `status === "ready"` check on line 10 is unreachable. Redis coming back does nothing; only a restart helps.
- **The documented "fail closed in production" only applies to the first failure.** The `throw new Error("Redis unavailable")` guards on lines 34/67/73 are all downstream of the line-9 early return, so every subsequent call silently returns `false` and falls through to the in-process `memory` map (`isRefreshMirrored`, line 104).
- **Multi-instance correctness breaks.** After a blip, instance B's memory map has no record of tokens issued by instance A, so `isRefreshMirrored` returns `false` and valid refreshes get 401'd — users are logged out at random depending on which instance they land on.
- **The map grows without bound.** `mirrorRefresh` does `memory.set(...)` unconditionally on every issued token (line 87), and entries are only evicted when `memoryAlive` happens to read an expired one. In production, where the map is normally never read, every session accumulates for the full 7-day TTL and is never swept.

Note the security blast radius is limited: `rotateRefresh` still checks `revokedAt`/`expiresAt` against Postgres (`auth.service.ts:126-129`), so revocation remains authoritative. The mirror is an extra gate, not the only one. The availability and memory problems are the real issues.

Suggested: move the `status === "ready"` check above the cached flag (as `rate-limit.ts` already does), re-probe on a cooldown instead of latching, log at `error` on every transition into degraded mode, and either sweep `memory` on an interval or drop the map entirely outside tests.

### I-2 — Rate limiting is silently disabled after the first Redis failure, and is IP-blind behind a proxy

Three compounding problems in `src/middleware/rate-limit.ts`:

1. **No recovery.** `ensureRedis` does check live status first (line ~21, better than I-1), but with `lazyConnect: true` a rejected `connect()` leaves ioredis in `end` state with no auto-retry, and the catch sets `redisAvailable = false`. In practice, one failed connect disables rate limiting until restart.
2. **No signal.** The fail-open branches (`next()` at line ~1510 and the catch at ~1546) log nothing. Brute-force protection on `/auth/*` can be off in production and nothing surfaces it. At minimum log at `error`; better, gate fail-open on `env.NODE_ENV !== "production"` so the documented dev convenience doesn't silently become a production posture.
3. **`trust proxy` is never set.** `clientKey` reads `req.ip`, which without `app.set("trust proxy", ...)` is the socket peer. Behind nginx or any VPS reverse proxy that is the proxy's address, so *all* clients collapse into a single bucket — the 20-req/60s auth limit becomes a global cap, and one client can lock everyone out. This needs to be configured in `createApp()` alongside the CORS setup.

Separately, the 20/60s bucket wraps the entire `authRoutes` router (`auth.routes.ts:1668`), which includes `GET /auth/me` and `POST /auth/refresh`. A portal session with a few tabs polling `/me` plus token refreshes can trip 429 on its own. Consider excluding `/me` or giving reads their own higher limit.

### I-3 — `Subscription.currentPeriodEnd` will always be null against the pinned Stripe API version

`webhook.service.ts` reads `object.current_period_end` from the subscription object. The installed SDK is `stripe@22.6.2`, pinned to API version `2026-08-26.dahlia` (`node_modules/stripe/cjs/apiVersion.js`). Stripe moved `current_period_start`/`current_period_end` off the Subscription object and onto subscription items in `2025-03-31.basil`, well before this pin — so the top-level field won't be present and `currentPeriodEnd` will be written as `null` on every real event.

The unit test passes because its fixture puts `current_period_end` at the top level of the fake object, mirroring the implementation rather than Stripe's actual payload. Read it from `items.data[0].current_period_end` (with a top-level fallback for older versions), and update the fixture to match a real `dahlia` payload.

### I-4 — Stripe event claim and side effects are not atomic

`handleStripeEvent` (`webhook.service.ts:223-247`) inserts the `StripeEvent` claim row in one transaction, applies side effects in another, and deletes the claim on failure. Two gaps:

- **Crash between claim and apply loses the event permanently.** The claim is committed; Stripe retries; the retry hits the `P2002` branch and returns early as "already processed." The subscription sync never happens and nothing reports it.
- **Concurrent duplicate delivery can drop an event.** Delivery A claims and starts applying; delivery B sees `P2002` and returns 200; A then fails and deletes the claim. Both deliveries have been acknowledged and no work was done.

The spec called for the claim and side effects to be in the same transaction ("recorded in `StripeEvent` before side effects commit (or in same transaction after claim)"). Either do that, or give `StripeEvent` a status column so the early-return branch can distinguish `claimed` from `completed` and re-apply the former.

Related: when the org can't be resolved, `applyFromSubscription` throws `NOT_FOUND` (404) and the claim is rolled back, so Stripe retries that event indefinitely. Events for customers this system doesn't own should be acknowledged with 200 and logged.

### I-5 — The verify worker can resurrect a disconnected shop

`processShopVerify` (`src/workers/shop-verify.processor.ts:14-28`) sets `status: "VERIFYING"` and later `"ACTIVE"` using only `shopId` from the job payload, with no check of the shop's current state.

A user who requests verify and then immediately `DELETE`s the shop leaves a queued job that will flip the `DISCONNECTED` row back to `ACTIVE` — with `botIdentityId` already null, so it becomes an active shop with no bot identity. BullMQ's 3 retries widen the window.

Load the shop first and bail (acknowledge the job without error) unless its status is `PENDING_INVITE`, `VERIFYING`, or `FAILED`.

### I-6 — `login` ignores `User.status`

`auth.service.ts:99-102` verifies the password and moves straight to the membership lookup. A user with `status: DISABLED` authenticates normally and gets a full session. The `UserStatus` enum and column exist in the schema specifically for this.

Currently latent — no endpoint sets `DISABLED` in this slice — but the control is one line and shipping the column without the check invites someone to set it manually and assume it works.

### I-7 — Seat and shop limits are check-then-act outside a transaction

- `createInvite`: `countSeats()` then `membership.create()` (`orgs.service.ts:100-161`).
- `connectShop`: `countActiveShops()` then `reserveBot()` + `shop.create()` (`shops.service.ts`).

Two concurrent requests can both pass the count and both create, exceeding a paid plan's limit. The bot reservation itself is correctly guarded with an optimistic `updateMany` — the same rigor should apply to the quota checks. Either do the count and the insert in one `$transaction` with an appropriate isolation level, or add a DB-level guard.

### I-8 — Re-running the seed nulls out configured Stripe price IDs

`prisma/seed.ts` upserts with `update: plan`, where each plan's `stripePriceId` is `process.env.STRIPE_PRICE_* ?? null`. Running `npm run prisma:seed` on an environment where those env vars aren't exported wipes the configured price IDs, after which `createCheckoutSession` fails with `"Plan is not available for checkout"` for every plan.

Given the README lists `npm run prisma:seed` as a routine setup step, this is easy to trip. Omit `stripePriceId` from the `update` clause (only set it on `create`), or skip the field when the env var is absent.

Related: the seed also inserts five `bot-s{n}@example.com` bot identities that `reserveBot` will hand out in whatever environment it runs against.

### I-9 — Missing uniqueness and indexes on columns the code queries by

Per the schema conventions, fields that must be unique should be constrained, and frequently queried fields indexed:

- `Organization.stripeCustomerId` — `resolveOrganization` looks it up with `findFirst` (`webhook.service.ts:412`). Two orgs could share a customer id and the webhook would silently pick one. Should be `@unique`, and is unindexed.
- `Plan.stripePriceId` — same pattern in `applyPlanAndSubscription` (`findFirst`). Should be `@unique`.
- Unindexed FK columns (Postgres does not auto-index these): `RefreshToken.userId`, `Membership.organizationId` (the composite unique starts with `userId`, so `listMembers`/`countSeats` can't use it), `ShopVerificationJob.shopId`, `Shop.botIdentityId` is fine (unique).

### I-10 — Production code branches on the test environment, leaving the verify happy path uncovered

`src/modules/shops/verify.service.ts:17-20`:

```ts
function shouldEnqueue(): boolean {
  if (env.NODE_ENV !== "test") return true;
  return process.env.FORCE_SHOP_VERIFY_ENQUEUE === "1";
}
```

The HTTP test then asserts the bypass rather than the behavior: `tests/shops/verify-stub.test.ts` expects `POST /shops/:id/verify` to return `PENDING_INVITE` and the shop to stay `PENDING_INVITE`. So the actual production path — enqueue succeeds, `bullJobId` is persisted, shop transitions to `VERIFYING` — has no automated coverage anywhere. Only the failure path is exercised, via the `FORCE_SHOP_VERIFY_ENQUEUE` escape hatch.

`src/lib/queue.ts` has the same shape: `shopVerifyQueue` is a hand-rolled `{ add, close }` wrapper rather than a `Queue`, primarily so `vi.spyOn` can replace `add`.

Injecting the queue as a dependency (or mocking `bullmq` at the module level in tests) would let both paths be tested and remove the environment branch from shipped code.

### I-11 — Tests run destructively against the developer's real database

`tests/setup.ts:1` does `import "dotenv/config"` and only fills in `DATABASE_URL` with `??=`. Since `.env` is loaded first, `npm test` runs against whatever database the developer (or a CI job, or a deploy box) has configured — there is no separate test database, no schema isolation, and no truncation strategy.

The suites are also destructive against shared seed data:

- `tests/billing/webhook.service.test.ts` mutates the seeded `growth` plan's `stripePriceId` globally and restores it in `afterAll`.
- `tests/shops/connect.test.ts` sets every other `AVAILABLE` bot to `DISABLED` to force reuse, restoring in a `finally`.

Both leave the shared pool corrupted if the process is interrupted. `fileParallelism: false` in `vitest.config.ts` papers over the cross-file races but confirms the coupling. Recommend a dedicated `.env.test` (loaded with override), and per-test fixtures rather than mutating seed rows.

### I-12 — `bullConnection()` drops parts of `REDIS_URL` that the app client honors

`src/lib/queue.ts` rebuilds the connection from `new URL(env.REDIS_URL)` but only carries over `hostname`, `port`, and `password`. Dropped: the ACL **username** (Redis 6+), the **TLS scheme** (`rediss://`), and the **database index** (`/2`).

Meanwhile `src/lib/redis.ts` passes the full URL string to ioredis, which honors all three. So on a VPS Redis using an ACL user, TLS, or a non-zero db, the API's refresh mirror and rate limiter work while the queue and worker either fail to authenticate or silently operate on a different database. The failure surfaces as `requestVerify` marking shops `FAILED` with a driver error — confusing to debug.

Simplest fix: pass `env.REDIS_URL` to BullMQ's connection option directly, or construct via `new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })` and share it.

### I-13 — Session vault key handling is byte-unsafe and completely untested

`src/lib/crypto.ts:8` and `:20`: `Buffer.from(env.SESSION_VAULT_KEY.slice(0, 32))`.

`slice(0, 32)` counts UTF-16 code units, not bytes. `SESSION_VAULT_KEY` is validated as `z.string().min(32)` — also characters. A key containing any non-ASCII character produces a buffer longer than 32 bytes and `createCipheriv` throws `Invalid key length` at runtime. A 32-char hex key (as in `.env.example`) is also being used as 32 raw ASCII bytes, i.e. 128 bits of actual entropy in a 256-bit slot.

`encryptVault`/`decryptVault` are currently dead code — nothing calls them, since the stub path writes `sessionVaultCiphertext: null` — and there is no round-trip test, which is why this hasn't surfaced. Before the Playwright path lands: validate the key as a 32-byte value (hex or base64 decode, check `Buffer.byteLength`) and add a round-trip test.

---

## Minor

**Correctness / robustness**

- Concurrent `register` with the same email races between `findUnique` and `create`, surfacing Prisma `P2002` as a 500 instead of the intended 409 `CONFLICT`. Catch `P2002` and map it.
- `slugify` (`auth.service.ts:25`) appends `Math.random().toString(36).slice(2, 8)` against a `@unique` slug column — a collision becomes an unhandled 500. Non-Latin org names collapse to just the random suffix.
- `verifyAccessToken` (`src/lib/tokens.ts`) coerces with `String(payload.orgId)` and casts `payload.role` without validation; a token missing claims yields the literal string `"undefined"`. `requireOrg` fails closed on the DB lookup, so impact is low, but validating the claim shape would be cheap.
- `getMe` uses `findUniqueOrThrow`, so a deleted-but-still-tokened user gets a 500 rather than a 401.
- `countActiveShops` counts `FAILED` shops toward `shopLimit`. Defensible (they can be re-verified) but a user who fails twice on a 1-shop plan must `DELETE` to recover, which isn't documented.
- BullMQ retries the `PLAYWRIGHT` `NOT_IMPLEMENTED` error three times with exponential backoff. Terminal errors should skip retries (`UnrecoverableError`).
- No graceful shutdown: neither `src/server.ts` nor `src/worker.ts` handles `SIGTERM`, closes the BullMQ worker, or disconnects Prisma. `startShopVerifyWorker` has a `failed` handler but no `error` handler.

**API surface / contract**

- No catch-all 404 handler — unknown routes fall past `errorHandler` to Express's default HTML response, breaking the `{ error: { code, message } }` envelope contract.
- `verify.service.ts:57` throws `new AppError("INTERNAL", ..., 503)` — code and status disagree, and the message interpolates the raw driver error, echoing Redis host/port details to the client.
- A missing `STRIPE_WEBHOOK_SECRET` returns 500 to Stripe, which then retries. A misconfiguration should be loud in logs but shouldn't invite a retry storm.
- The invite token travels in the URL path (`POST /orgs/invites/:token/accept`), so it lands in access logs, proxy logs, and browser history. Prefer the request body.
- `register`/`login` return `refreshToken` in the JSON body *and* set the httpOnly cookie. The spec permits a body token for non-browser clients, but handing it to browsers as well undercuts the cookie's purpose.
- `GET /billing/plans` is unauthenticated and unrated-limited.
- `handleStripeEvent(event as any)` at the route boundary (`billing.routes.ts`) discards the only place real Stripe types could be checked.
- `portalBaseUrl()` derives Stripe success/cancel URLs from `CORS_ORIGINS.split(",")[0]`. Conflating the CORS allowlist with the portal's public URL will break redirects the moment a second origin is added in the wrong order. Add an explicit `PORTAL_BASE_URL`.

**Observability**

- The spec's observability requirement ("structured logs with `requestId`, `userId`, `organizationId`, `shopId` when present") is unmet — there is no request-logging middleware and no request id anywhere. `error-handler.ts` also uses `console.error(err)` directly instead of the `logger` it sits next to.
- The 429 response carries no `Retry-After` header.
- The rate limiter uses `EVAL` (full script body) on every request rather than `EVALSHA` with a fallback.

**Auth hardening**

- `RefreshToken.replacedById` exists in the schema but is never populated, and `rotateRefresh` has no reuse detection — presenting an already-rotated token returns 401 but doesn't revoke the descendant chain, which is the standard response to a suspected stolen token.

**Tooling / repo hygiene**

- `tsconfig.json` has `include: ["src"]`, so `tests/`, `scripts/smoke-foundation.ts`, `prisma/seed.ts`, and `vitest.config.ts` are never typechecked. Worth a second `tsconfig.test.json` and a `typecheck` script.
- No linter and no CI workflow on the branch — nothing would have caught C-1 automatically.
- zod v4 deprecations in use: `z.string().email()` (now `z.email()`), `ZodTypeAny` in `validate.ts`, and `err.flatten()` in the error handler.
- Migration directories are stamped `20250915…` while the commits are dated 2026-09-15. Harmless, but `20250915200000_shop_bot_identity_optional/migration.sql` is hand-written — run `prisma migrate status` / `migrate diff` against the schema to confirm there's no drift.
- Untracked tool directories in the working tree (`.agents/`, `.claude/`, `.cursor/`, `.devin/`, `.superpowers/`) should be added to `.gitignore` before someone commits them by accident.
- The stub verify writes `sessionVaultCiphertext: null` where the spec said "placeholder vault metadata" — trivial, but worth confirming the portal doesn't expect a value.

---

## Triage of the flagged notes

| Note | Verdict | Rationale |
|------|---------|-----------|
| Stub `User` on invite | **Must fix before merge** | See C-2. Expired invites permanently lock out an email with no API recovery path. |
| Free plan `shopLimit: 0` | **No action** | Intentional per the plan ("forces billing or test quota bump"). Documented in both the README and the smoke script. Whether free should include a trial shop is a product decision, not a merge blocker. |
| VPS Redis unreachable / fail-open | **Partially must fix** | The fail-open *policy* is a reasonable dev affordance and is documented. What must change is that both Redis gates latch permanently after one failure (I-1, I-2), degrade with zero logging, and — for rate limiting — carry that posture into production. Fix the latching and add logging; consider gating fail-open on non-production. |
| tsc / ioredis constructability | **Must fix before merge** | See C-1. Not pre-existing — `src/lib/redis.ts` is added by this branch, and it breaks `npm run build`/`npm start`. |
| Duplicate auth commits `a405986` / `f224536` | **Cosmetic** | Not actually duplicated work: `a405986` is the real auth implementation (12 files, 625 insertions); `f224536` is a 1-line `.env.example` change that reuses the same commit message. Squash-merge, or reword `f224536`. No code impact. |

---

## Spec and plan coverage

Every endpoint in the spec's API surface is implemented and mounted under `/api/v1`:

| Area | Spec endpoints | Status |
|------|---------------|--------|
| Auth | register, login, refresh, logout, me | All present |
| Orgs | current (GET/PATCH), members, invites, invite accept | All present |
| Billing | plans, checkout-session, portal-session, webhook | All present |
| Shops | list, detail, connect, verify, disconnect | All present |

Architecture matches the plan's file table one-for-one. Other spec requirements: Argon2id ✓, refresh tokens SHA-256 hashed at rest with rotation ✓, raw body on the webhook route only and mounted before `express.json()` ✓, CORS allowlist with credentials ✓, rate limits on `/auth/*` and `/shops/:id/verify` ✓, Playwright scaffold throwing `NOT_IMPLEMENTED` behind the same job contract ✓, error envelope ✓.

Deviations worth recording: observability requirements unmet (Minor), `replacedById` declared but unused (Minor), session vault unexercised and untested (I-13), and the "fresh clone can migrate, seed, run API + worker" success criterion is currently blocked by C-1 for the built artifact.

---

## Merge recommendation

**Conditional approval.** Block the merge on:

1. **C-1** — fix the ioredis import and confirm `npm run build` exits 0.
2. **C-2** — remove the invite dead end (explicit stub marker + a re-invite or adoption path).

Strongly recommended in the same PR, since each is a handful of lines and they all silently disable something that looks enabled:

3. **I-1** — check live Redis status before the cached flag; log degradation.
4. **I-2** — `app.set("trust proxy", ...)`, log fail-open, don't fail open in production.
5. **I-5** — guard the verify worker on current shop status.
6. **I-6** — check `User.status` in `login`.
7. **I-8** — stop the seed from nulling `stripePriceId`.

Everything else — I-3, I-4, I-7, I-9 through I-13, and the Minor list — should be filed as tracked follow-ups. **I-3, I-4, I-11, and I-12 should be closed before the first production deploy**, since they affect billing data correctness, webhook durability, database safety, and worker connectivity respectively.

The test suite could not be fully verified in this review: only the four DB-free files were run (7 tests, all passing). Please confirm a full `npm test` against a dedicated test database before merging.
