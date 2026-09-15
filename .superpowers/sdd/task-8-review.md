# Task 8 Review: Shop verify queue + stub worker + Playwright scaffold

**Reviewer:** SDD review (read-only)  
**Base:** `3b6f600815069d005c4937ed58647213eafb700e`  
**Head:** `3d5c336bbe7702ff63a3df2e2383aff916f72703`  
**Verdict:** **Spec ✅** · **Quality: Important**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Install BullMQ | ✅ | `bullmq@^6.3.6` in `package.json` |
| Create `src/lib/queue.ts` | ✅ | `SHOP_VERIFY_QUEUE`, `bullConnection`, lazy queue |
| Create `src/modules/shops/verify.service.ts` | ✅ | `requestVerify` |
| Create `src/workers/shop-verify.processor.ts` | ✅ | `processShopVerify`, `startShopVerifyWorker` |
| Create `src/workers/shop-verify.playwright.scaffold.ts` | ✅ | Throws `AppError("NOT_IMPLEMENTED", …, 501)` |
| Create `src/worker.ts` | ✅ | Starts worker, logs startup |
| Modify `shops.routes.ts` — `POST /:id/verify` | ✅ | OWNER/ADMIN via `requireRole` |
| Create `tests/shops/verify-stub.test.ts` | ✅ | Stub ACTIVE, SHOP_NOT_READY, HTTP, Playwright |
| Queue name `shop-verify` | ✅ | |
| Job data `{ shopId, organizationId, mode, verificationJobId }` | ✅ | |
| Stub → shop `ACTIVE` + `verifiedAt`; bot `ASSIGNED` | ✅ | Uses `shop.botIdentityId` (see deviation) |
| Playwright scaffold `NOT_IMPLEMENTED` | ✅ | |
| `requestVerify` rejects unless `PENDING_INVITE` / `FAILED` | ✅ | `SHOP_NOT_READY` 409 |
| Mode from `SHOP_VERIFY_MODE` | ✅ | Defaults `stub` → `STUB` |
| Creates `ShopVerificationJob` QUEUED, enqueues, returns VERIFYING | ✅ | See enqueue-skip deviation in test |
| TDD / commit message / scope | ✅ | Report: 5 tests in file; full suite 27 tests |

### Documented deviations (acceptable)

| Deviation | Judgment |
|-----------|----------|
| Lazy `getShopVerifyQueue()` + proxy `shopVerifyQueue.add` instead of eager `new Queue` on import | Acceptable — avoids Redis connect when tests import processor |
| Bot update via `shop.botIdentityId` + conditional `update` instead of brief's `updateMany({ shop: { id } })` | Acceptable — equivalent for 1:1 shop↔bot; skips no-op when bot missing |
| `$transaction` callback instead of array form | Acceptable — same semantics |
| `maxRetriesPerRequest: null` on BullMQ connection | Acceptable — required for BullMQ + blocking commands |
| Enqueue skipped when `NODE_ENV=test` | Acceptable for Task 8 — see judgment below |

---

## Global constraints

| Constraint | Status | Notes |
|------------|--------|-------|
| Stub default | ✅ | `env.SHOP_VERIFY_MODE` defaults `"stub"`; `verifyModeFromEnv()` → `STUB` unless `"playwright"` |
| Playwright scaffold `NOT_IMPLEMENTED` | ✅ | 501 `AppError`; processor catch marks shop/job `FAILED` if mode is Playwright |
| BullMQ `shop-verify` queue | ✅ | Queue + Worker with concurrency 5, retry/backoff on add |
| State machine `PENDING_INVITE` → `VERIFYING` → `ACTIVE` / `FAILED` | ✅ | `requestVerify` gates entry; processor completes or fails; `FAILED` re-entry allowed |

---

## Enqueue-skip in test — judgment

**Verdict: Acceptable (Task 8 scope)**

| Factor | Assessment |
|--------|--------------|
| Brief TDD pattern | Explicitly calls processor directly in test — matches implementation |
| Production path | Enqueue runs when `NODE_ENV !== "test"` |
| Test reliability | Avoids Redis `ETIMEDOUT` in CI/local without Redis |
| Coverage gap | `requestVerify` / HTTP tests assert DB state only; no BullMQ integration in test env |
| Follow-up | Task 9 smoke (Redis + `npm run worker`) is the right place for end-to-end verify |

**Minor nit:** HTTP test name `"HTTP POST /shops/:id/verify enqueues verify"` is misleading — enqueue is skipped under test. Rename or add integration test in Task 9.

Test-only orphaned `VERIFYING` rows from `requestVerify` tests are cleaned in `afterAll`; not a runtime defect.

---

## VERIFYING-stuck on enqueue failure — judgment

**Verdict: Important (production failure path)**

### What happens (non-test)

1. `requestVerify` creates `ShopVerificationJob` (`QUEUED`).
2. Shop updated to `VERIFYING` **before** BullMQ `add`.
3. If Redis/BullMQ `add` throws, error is logged; API still returns `{ status: "VERIFYING" }`.
4. Job row stays `QUEUED` with no `bullJobId`; nothing exists in Redis for the worker to consume.

### Why stuck

- `requestVerify` only accepts `PENDING_INVITE` or `FAILED` — a shop left in `VERIFYING` **cannot be retried via API**.
- Comment ("caller/worker can still process when Redis recovers") assumes a recovery path that **does not exist**: the worker consumes BullMQ jobs only, not orphaned DB rows.
- Ordering (VERIFYING before enqueue) maximizes the stuck window; rollback or enqueue-first would be safer.

### Severity

| Level | Rationale |
|-------|-----------|
| Not Critical | Happy path (Redis up) works; stub + worker scaffold is functional |
| Important | Transient Redis outage permanently blocks verify for that shop until manual DB/ops fix |
| Not Minor | Violates state-machine intent for recoverable infra failures |

### Recommended follow-up

- Enqueue **before** setting shop `VERIFYING`, or wrap in compensating rollback (`FAILED` / revert to `PENDING_INVITE`) on enqueue error.
- Optional: periodic re-enqueue of `ShopVerificationJob` where `status=QUEUED` and `bullJobId IS NULL`.
- Integration test with mocked queue failure asserting shop is not left unrecoverable.

---

## Quality assessment

Implementation is structured, follows existing error/middleware patterns, and extends sensibly beyond the brief (lazy queue, direct processor unit tests, role-gated route).

### Strengths

- Processor exported for direct unit test — aligns with brief TDD.
- Stub path uses transaction for shop + bot + job terminal states.
- Playwright failure correctly propagates to `FAILED` shop/job via catch.
- `requestVerify` org-scoped lookup; `NOT_FOUND` / `SHOP_NOT_READY` covered.
- BullMQ job options: 3 attempts, exponential backoff.
- Worker failure logging on `failed` event.
- Tests cover service, processor, scaffold, and HTTP; cleanup resets bots/shops.

### Defects

| Severity | Item |
|----------|------|
| **Important** | **Enqueue failure leaves shop permanently `VERIFYING`.** No API retry; no re-enqueue worker. |
| Minor | HTTP test title implies enqueue in test env where it is skipped. |
| Minor | `VERIFYING` set in both `requestVerify` and processor — redundant. |
| Minor | `fileParallelism: false` slows full suite (~136s) — justified by shared bot pool. |
| Minor | No test for `FAILED` → re-verify happy path (logic present, untested). |
| Minor | Stub 200ms sleep adds latency to unit tests (matches brief). |

---

## Test verification

Report claims:

- `npm test -- tests/shops/verify-stub.test.ts` — 5 tests passed  
- `npm test` — 9 files, 27 tests passed  

Review performed via static analysis of diff + source (read-only; tests not re-run). Brief TDD case (`stub verify marks shop ACTIVE`) present via direct `processShopVerify`. No enqueue-failure or recovery scenario.

---

## Summary

Task 8 delivers all specified files, BullMQ `shop-verify` queue, stub processor (`ACTIVE` + bot `ASSIGNED`), Playwright `NOT_IMPLEMENTED` scaffold, `requestVerify` + `POST /api/v1/shops/:id/verify`, and worker entry. Global constraints (stub default, state machine, queue name) are satisfied.

Two concerns were flagged in the report; judgment:

1. **Enqueue-skip in test** — Acceptable for Task 8; e2e belongs in Task 9 smoke.
2. **VERIFYING-stuck on enqueue failure** — Important production gap; shop cannot self-recover.

**Spec: ✅**  
**Quality: Important**

**Recommended fix:** On enqueue failure, revert shop to `PENDING_INVITE` or mark `FAILED` with reason; or enqueue before `VERIFYING`. Add re-enqueue for orphaned `QUEUED` jobs without `bullJobId`.
