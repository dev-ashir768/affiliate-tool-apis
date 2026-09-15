# Task 9 Review: Rate limits, README, smoke script

**Reviewer:** SDD review (read-only)  
**Base:** `77eeedde9c6256c46ff1d62a2947158418515ec1`  
**Head:** `b9d2115ae2ee7f9243061b33d720f90171846408`  
**Verdict:** **Spec ✅** · **Quality: Approved**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Create `src/middleware/rate-limit.ts` | ✅ | Redis sliding window via Lua (`ZREMRANGEBYSCORE` + `ZCARD` + `ZADD` + `EXPIRE`) |
| Interface `rateLimit({ key, limit, windowSec })` → `RequestHandler` | ✅ | Signature matches brief exactly |
| Rate limit `/api/v1/auth/*` | ✅ | Router-level middleware: 20 req / 60s, key `auth:{ip}` |
| Rate limit `POST /shops/:id/verify` | ✅ | Route middleware: 10 req / 60s, key `shop-verify:{ip}` |
| Consumes Redis | ✅ | Uses shared `redis` client + `eval` |
| Create `README.md` | ✅ | Setup, env, Postgres, Redis, migrate, seed, dev, worker, Stripe CLI, portal CORS, smoke |
| Create `scripts/smoke-foundation.ts` | ✅ | register → shopLimit bump → connect → verify → poll ACTIVE |
| Optional `tests/smoke/foundation.http.test.ts` | ✅ | Gated on `SMOKE_HTTP=1` |
| Commit message from brief | ✅ | `docs: add Foundation README, rate limits, and smoke script` |

### Smoke flow vs brief

| Step | Status | Notes |
|------|--------|-------|
| 1. `POST /api/v1/auth/register` | ✅ | |
| 2. Upsert org `shopLimit=1` | ✅ | Direct Prisma update (brief allows manual upsert) |
| 3. `POST /api/v1/shops/connect` | ✅ | |
| 4. `POST /api/v1/shops/:id/verify` | ✅ | |
| 5. Poll `GET` until `ACTIVE` | ✅ | 15s timeout; `processShopVerify` fallback if worker/Redis path stalls |

### Enhancements beyond brief (acceptable)

| Item | Judgment |
|------|----------|
| Fail-open when Redis unreachable | Acceptable — documented in README; keeps local dev usable |
| `RATE_LIMITED` error code + 429 via existing `AppError` handler | Acceptable — required for correct HTTP semantics |
| `tests/middleware/rate-limit.test.ts` | Acceptable — fail-open, under-limit, over-limit |
| `npm run smoke` script alias | Acceptable |
| Smoke `processShopVerify` fallback | Acceptable — unblocks dev without worker; logs warn to run worker for prod-like smoke |

---

## Quality assessment

Implementation is focused, matches existing middleware/error patterns, and stays within Task 9 scope. Rate-limit wiring is minimal (auth router + verify route only). README is practical and covers all brief topics including free-plan `shopLimit: 0`.

### Strengths

- Correct sliding-window Lua script with unique members (`timestamp:random`) to avoid ZSET collisions.
- Redis recovery handled: `ensureRedis()` re-checks `redis.status === "ready"` before honoring cached `redisAvailable === false`.
- Command errors fail open; limit exceeded returns structured `AppError("RATE_LIMITED", …, 429)`.
- Unit tests mock Redis and cover the three critical paths without requiring live Redis.
- Smoke script is self-contained with clear console output, health pre-check, and cleanup (`prisma.$disconnect`, `redis.quit`).
- README explicitly calls out Redis dependency, fail-open behavior, and when to run the worker.

### Findings

| Severity | Item |
|----------|------|
| Minor | **Live `npm run smoke` not executed** in implementer session — script and unit tests exist; confirm manually with API + Postgres (+ worker) before relying on it in CI. |
| Minor | **Gated HTTP smoke test** (`tests/smoke/foundation.http.test.ts`) only asserts `/health` — does not exercise register→verify flow even when `SMOKE_HTTP=1`. |
| Minor | **IP-based keys** — behind reverse proxies, rate limits may key on proxy IP unless Express `trust proxy` is configured later. |
| Minor | **Fail-open in production** — intentional and documented; if Redis is down, auth/verify endpoints lose rate-limit protection until Redis recovers. Ops must keep Redis reachable (README states this). |
| Informational | **`tsc --noEmit` / ioredis** — pre-existing constructability errors in `src/lib/redis.ts`; **not introduced by this diff**. Does not block Task 9 deliverables but remains a repo-wide typecheck gap. |

No Critical or Important defects identified in the diff.

---

## Test verification

Report claims:

- `npm test` — 9 passed \| 1 skipped (10 files), 28 passed \| 1 skipped (29 tests)
- Targeted run — rate-limit + smoke + health: 4 passed \| 1 skipped

Review performed via static analysis of brief, report, and diff (read-only; tests not re-run).

---

## Summary

Task 9 delivers all specified artifacts: Redis sliding-window rate limiter with the brief’s interface, auth (20/60s) and shop-verify (10/60s) wiring, Foundation README, smoke script with shopLimit bump and ACTIVE polling, optional gated HTTP smoke test, and the requested commit. Extra unit tests and fail-open behavior are sensible foundation choices and well documented.

**Spec: ✅**  
**Quality: Approved**

**Follow-up (optional):** Run `npm run smoke` against a live stack; extend gated HTTP smoke to cover full flow; address pre-existing `tsc`/ioredis typing separately.
