# Task 8 Report: Shop verify queue + stub worker + Playwright scaffold

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/foundation-api`  
**Base:** `3b6f600815069d005c4937ed58647213eafb700e`  
**Commits:** `3d5c336` — `feat: add shop-verify BullMQ worker with stub and Playwright scaffold`

## Summary

Added BullMQ `shop-verify` queue, stub processor (marks shop `ACTIVE`, bot `ASSIGNED`), Playwright scaffold (`NOT_IMPLEMENTED`), `requestVerify` + `POST /api/v1/shops/:id/verify`, and `src/worker.ts` entry. Unit tests call `processShopVerify` with a fake Job (no live Redis).

## Files Created/Modified

| File | Action |
|------|--------|
| `src/lib/queue.ts` | Created — lazy Queue, `bullConnection`, `SHOP_VERIFY_QUEUE` |
| `src/modules/shops/verify.service.ts` | Created — `requestVerify` |
| `src/workers/shop-verify.processor.ts` | Created — `processShopVerify`, `startShopVerifyWorker` |
| `src/workers/shop-verify.playwright.scaffold.ts` | Created — throws `NOT_IMPLEMENTED` |
| `src/worker.ts` | Created — worker entry |
| `src/modules/shops/shops.routes.ts` | Modified — `POST /:id/verify` (OWNER/ADMIN) |
| `tests/shops/verify-stub.test.ts` | Created — stub ACTIVE, SHOP_NOT_READY, HTTP, Playwright |
| `vitest.config.ts` | Modified — `fileParallelism: false` (shared bot pool) |
| `package.json` / `package-lock.json` | Modified — `bullmq` |

## Test Results

| Command | Result |
|---------|--------|
| `npm test -- tests/shops/verify-stub.test.ts` | ✅ 1 file, 5 tests passed |
| `npm test` (full suite) | ✅ 9 files, 27 tests passed |

## TDD notes

1. Wrote failing `tests/shops/verify-stub.test.ts` (modules missing) → RED.
2. Implemented queue + processor + verify service + route + worker → GREEN.
3. Fixed shop-limit / bot-pool contention; serialized Vitest file parallelism.

## Self-Review

- [x] BullMQ installed; queue name `shop-verify`
- [x] Job data `{ shopId, organizationId, mode, verificationJobId }`
- [x] Stub → shop `ACTIVE` + `verifiedAt`; bot `ASSIGNED` via `shop.botIdentityId`
- [x] Playwright scaffold throws `AppError("NOT_IMPLEMENTED", …, 501)`
- [x] `requestVerify` rejects unless `PENDING_INVITE` / `FAILED` (`SHOP_NOT_READY`)
- [x] Mode from `env.SHOP_VERIFY_MODE` (`stub` → `STUB`)
- [x] `POST /shops/:id/verify` mounted; creates `ShopVerificationJob`
- [x] Enqueue skipped in `NODE_ENV=test` (shop stays `PENDING_INVITE`); VERIFYING only after successful enqueue
- [x] `src/worker.ts` starts worker
- [x] Commit message matches brief; `.env` not committed

## Concerns for Follow-up

1. **Enqueue skipped in test:** `requestVerify` does not hit Redis when `NODE_ENV=test` (unless `FORCE_SHOP_VERIFY_ENQUEUE=1`). End-to-end verify requires Redis + `npm run worker` (Task 9 smoke). Shop stays `PENDING_INVITE` until `processShopVerify` / worker runs.
2. **Stub sleeps 200ms:** Matches brief; slows unit tests slightly.
3. **`fileParallelism: false`:** Required because seeded bot pool (5) races across shop test files; suite is slower (~136s).
4. **Playwright path:** Failure marks shop `FAILED` via processor catch — expected until real Playwright lands.

## Commands for Reproduction

```bash
npm test -- tests/shops/verify-stub.test.ts
npm test
```

## Follow-up fix (review finding)

**Commit:** `77eeedd` — `fix: do not leave shop VERIFYING when enqueue fails`

**Issue:** `requestVerify` set shop `VERIFYING` before BullMQ enqueue; on enqueue failure the API still returned success and the shop could not re-verify (`SHOP_NOT_READY`).

**Fix:**
1. Create `ShopVerificationJob` `QUEUED` first.
2. Enqueue (skipped in test unless `FORCE_SHOP_VERIFY_ENQUEUE=1`); only then set shop `VERIFYING`.
3. On enqueue failure: shop → `FAILED` + `statusReason`, job → `FAILED` + `lastError`, throw `AppError("INTERNAL", …, 503)`.
4. Test skip leaves shop `PENDING_INVITE` (processor sets `VERIFYING`).
5. Added unit test: mock `shopVerifyQueue.add` reject → shop not stuck `VERIFYING`; re-verify allowed.

**Test:** `npm test -- tests/shops` → ✅ 2 files, 12 tests passed.
