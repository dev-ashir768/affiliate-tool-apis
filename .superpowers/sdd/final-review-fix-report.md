# Foundation API — Final Review Fix Report

**Branch:** `feat/foundation-api`  
**Date:** 2026-09-16  
**Source review:** `.superpowers/sdd/final-review.md`

---

## Status

Critical and highest-priority Important findings from the final Foundation review are fixed and verified.

## Commits

| SHA | Summary |
|-----|---------|
| `dbf2c92` | fix: use named Redis import so TypeScript build succeeds (C-1) |
| `f14da4f` | fix: unblock expired invite stubs and reject DISABLED logins (C-2, I-6) |
| `208a1ab` | fix: recover Redis degradation, trust proxy, verify guards, Stripe period end (I-1, I-2 partial, I-3, I-5) |

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` / `npm run build` | **PASS** (exit 0) |
| `npm test` | **PASS** — 10 files passed, 1 skipped; **33 tests passed**, 1 skipped |

---

## Fixed

### C-1 — ioredis / build
- `src/lib/redis.ts` now uses `import { Redis } from "ioredis"` with an explicit `times: number` on `retryStrategy`.

### C-2 — Expired invite dead-end
- Stub identity is **membership `INVITED` + `inviteTokenHash`**, not `name === "Invited"`.
- `createInvite` **re-issues** (new token + extended expiry) when an existing invite is expired.
- `register` cleans up **expired invite stubs** and allows the email to register.
- `acceptInvite` only sets password/name for stub users (no ACTIVE memberships elsewhere).

### I-1 / I-2 (latch + trust proxy)
- Refresh mirror and rate limiter use a **5s reprobe cooldown** instead of a permanent `redisAvailable = false` latch; degradation is logged.
- `TRUST_PROXY=true|1` enables `app.set("trust proxy", 1)` (documented in `.env.example`).

### I-5 — Verify worker
- Skips non-activatable shops (`DISCONNECTED`, etc.).
- Refuses to activate without `botIdentityId`; re-checks before stub activate.

### I-6 — DISABLED login
- `login` returns `FORBIDDEN` when `user.status === "DISABLED"`.

### I-3 — Stripe `currentPeriodEnd`
- Reads `items.data[0].current_period_end` first (dahlia / post-basil), with top-level fallback; webhook fixture updated.

---

## Skipped this pass (as requested)

| Item | Notes |
|------|--------|
| Duplicate commit messages | Cosmetic only |
| **I-4** Full Stripe transactional claim redesign | Still claim-then-apply with rollback on failure; concurrent crash/P2002 gap remains — track before production |
| **I-8** Seed nulling `stripePriceId` | Document only: re-running `prisma:seed` without `STRIPE_PRICE_*` env vars can wipe price IDs; omit field from `update` in a follow-up |
| I-7, I-9–I-13, Minor list | Not in this pass |

---

## Follow-ups before production

1. Stripe event claim/status so retries re-apply incomplete work (I-4).
2. Seed `stripePriceId` update safety (I-8).
3. Dedicated test DB / `.env.test` (I-11).
4. BullMQ connection parity with full `REDIS_URL` (I-12).
