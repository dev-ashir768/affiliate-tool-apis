# Task 6 Report: Stripe billing (plans, checkout, portal, webhook)

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/foundation-api`  
**Base:** `c52d9e5077961bfa3159c0522ff7255007959453`  
**Commits:** `79e25fc` — `feat: add Stripe checkout, portal, and idempotent webhooks`

## Summary

Added Stripe billing: public plan catalog, OWNER/ADMIN checkout + customer portal sessions, and an idempotent webhook processor mounted with `express.raw` before `express.json`. Subscription events upsert `Subscription`, map plan quotas onto the org, and duplicate `StripeEvent` ids are ignored.

## Files Created/Modified

| File | Action |
|------|--------|
| `src/modules/billing/stripe.ts` | Created — Stripe client + portal base URL from `CORS_ORIGINS` |
| `src/modules/billing/billing.service.ts` | Created — `listPlans`, `createCheckoutSession`, `createPortalSession` |
| `src/modules/billing/billing.routes.ts` | Created — billing routes + `billingWebhookHandler` |
| `src/modules/billing/webhook.service.ts` | Created — `handleStripeEvent` / `applySubscriptionFromStripe` |
| `src/app.ts` | Modified — raw webhook before JSON; mount `/api/v1/billing` |
| `tests/billing/webhook.service.test.ts` | Created — duplicate event idempotency + plan sync assertions |
| `package.json` / `package-lock.json` | Modified — add `stripe` dependency |

## Test Results

| Command | Result |
|---------|--------|
| `npm test -- tests/billing/webhook.service.test.ts` | ✅ 1 file, 1 test passed |
| `npm test` (full suite) | ✅ 7 files, 15 tests passed |

## TDD notes

1. Installed `stripe`.
2. Wrote failing webhook idempotency test (module missing) → RED.
3. Implemented webhook + billing service/routes/app wiring → GREEN.
4. Extended same test to assert org plan quotas / subscription upsert after first apply.

## Self-Review

- [x] `GET /api/v1/billing/plans` public
- [x] `POST /checkout-session` + `POST /portal-session` use `authenticate` + `requireOrg` + `requireRole("OWNER","ADMIN")`
- [x] Checkout uses `metadata.organizationId` + `client_reference_id`
- [x] Webhook raw body mounted before `express.json`
- [x] Idempotent via unique `StripeEvent.eventId` (P2002 → early return)
- [x] Subscription sync copies `planId` / seat / shop / dailyInviteQuota from Plan by `stripePriceId`
- [x] Graceful without live Stripe in tests (synthetic `handleStripeEvent`)
- [x] Commit message matches brief; `.env` not committed

## Concerns for Follow-up

1. **Claim-then-apply ordering:** `StripeEvent` is inserted before side effects. If org/plan resolution fails after claim, Stripe retries are ignored (event already recorded). Matches brief order; consider delete-on-failure or transactional claim later.
2. **No dedicated `PORTAL_URL`:** success/cancel/return URLs use the first `CORS_ORIGINS` entry.
3. **`checkout.session.completed` with subscription id only** creates an `INCOMPLETE` placeholder; full plan sync expects `customer.subscription.*` (or an expanded subscription object).
4. **No HTTP tests** for checkout/portal (would need Stripe mocks); only webhook service coverage as brief required.
5. **Missing Stripe env** correctly throws `INTERNAL` on checkout/portal/webhook signature paths — fine for local/dev until keys are set.

## Commands for Reproduction

```bash
npm test -- tests/billing/webhook.service.test.ts
npm test
```

## Follow-up fix (review finding)

**Commit:** `69fff64` — `fix: roll back StripeEvent claim when webhook apply fails`

**Issue:** After `StripeEvent` was claimed, apply failures left the claim in place, so Stripe retries were ignored forever.

**Fix:** Wrap apply in try/catch; on failure `deleteMany` the claim for that `eventId`, then rethrow.

**Test:** `rolls back StripeEvent claim when apply fails so Stripe can retry` — unknown customer fails (claim removed) → same event id with valid customer succeeds.

**Command:** `npm test -- tests/billing` → ✅ 1 file, 2 tests passed.

**Concerns update:** Claim-then-apply concern #1 is addressed by delete-on-failure rollback.
