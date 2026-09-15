# Task 9 Report: Rate limits, README, smoke script

**Status:** DONE  
**Branch:** `feat/foundation-api`  
**Base:** `77eeedd` (after Task 8)  
**Commit:** `b9d2115` — `docs: add Foundation README, rate limits, and smoke script`

## What shipped

1. **`src/middleware/rate-limit.ts`** — Redis sliding-window limiter via Lua (`ZREMRANGEBYSCORE` + `ZADD` + `ZCARD`). Signature matches brief. **Fails open** when Redis is unreachable (connect timeout / command errors) so local API still works; sticky unavailable clears if `redis.status === "ready"` again.
2. **Route wiring**
   - `/api/v1/auth/*`: 20 req / 60s (`rateLimitKey("auth")`)
   - `POST /api/v1/shops/:id/verify`: 10 req / 60s (`rateLimitKey("shop-verify")`)
3. **`RATE_LIMITED`** added to `ErrorCode` (429 envelope via existing error handler).
4. **`README.md`** — `.env.example`, Postgres, remote Redis (no Docker), fail-open note, `prisma migrate deploy` + seed, `npm run dev` / `worker`, Stripe CLI forward, portal CORS, smoke usage. Notes free plan `shopLimit: 0`.
5. **`scripts/smoke-foundation.ts`** + `npm run smoke` — register → bump `shopLimit=1` → connect → verify → poll `ACTIVE`; **`processShopVerify` fallback** when enqueue/worker path fails, with console docs.
6. **`tests/smoke/foundation.http.test.ts`** — gated (`SMOKE_HTTP=1`).
7. **`tests/middleware/rate-limit.test.ts`** — fail-open, under-limit allow, over-limit 429.

## Tests

```
npm test
# Test Files  9 passed | 1 skipped (10)
# Tests  28 passed | 1 skipped (29)

npx vitest run tests/middleware/rate-limit.test.ts tests/smoke/foundation.http.test.ts tests/health.test.ts
# 4 passed | 1 skipped
```

Live `npm run smoke` against a running API was **not** executed in this session (no assumption that API/Postgres were up). Unit coverage covers rate-limit behavior; smoke is for manual/CI with stack running.

## Self-review

| Check | Result |
|-------|--------|
| Brief interface `rateLimit({ key, limit, windowSec })` | Met |
| Auth + verify rate limited | Met |
| Fail open when Redis down | Met |
| README topics from brief | Met |
| Smoke path + shopLimit bump + fallback | Met |
| Commit message from brief | Met |
| No unrelated refactors | Met |

## Concerns

- **Live smoke not run here** — script is ready; confirm with API (+ optional worker) locally.
- **`tsc --noEmit`** still fails on pre-existing `ioredis` constructability errors in `src/lib/redis.ts` (unrelated to this task).
- Rate-limit keys are IP-based; behind proxies, configure Express `trust proxy` if needed later.
