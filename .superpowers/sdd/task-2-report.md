# Task 2 Report: Grant / revoke service + routes + billingSource

**Status:** DONE  
**Branch:** `feat/manual-grant-access`  
**Base:** `6617d97`

## Summary

Implemented SUPERADMIN grant/revoke organization access: schemas, `platform-grant.service.ts`, routes, `billingSource` on org summaries, and integration tests.

## Files

- Create: `src/modules/platform/platform-grant.service.ts`
- Create: `tests/platform/grant-access.test.ts`
- Modify: `src/modules/platform/platform.schemas.ts`
- Modify: `src/modules/platform/platform.routes.ts`
- Modify: `src/modules/platform/platform.service.ts`

## Tests

- `npx vitest run tests/platform/grant-access.test.ts` → **8/8 passed** (2026-10-04 ~17:34 PKT)
- Note: remote Postgres `72.62.170.13:5432` is intermittently unreachable; earlier runs skipped/failed on connectivity. Green run achieved when DB was up.

## TDD Evidence

- RED: route missing / suite failed before implementation (prior subagent)
- GREEN: 8/8 passed on focused suite when DB reachable

## Self-review

- Manual id `manual_<orgId>`, Stripe 409, free plan rejected, silent lifecycle + audit per plan
- `billingSource`: manual | stripe | none
- No schema migration

## Final review fixes

**Status:** DONE (2026-10-04)

### Changes

1. **Critical — checkout vs manual subs** (`billing.service.ts`): Plan-change path skips `manual_*` Stripe subscription IDs via `isManualSubscriptionId`; manual-grant orgs use normal Checkout session creation.
2. **Important — grant on CANCELED Stripe sub** (`platform-grant.service.ts`): 409 only when a non-manual subscription exists and status is not `CANCELED`.
3. **Important — MRR / paid counts** (`platform.service.ts` `billingOverview`): Exclude manual comps from `payingOrgs`.
4. **Tests**: `tests/billing/checkout-manual-sub.test.ts` (mocked Stripe: `checkout.sessions.create` yes, `subscriptions.retrieve` no); extended `grant-access.test.ts` (CANCELED Stripe grant 200, ACTIVE 409, `planCode: free` 400).
5. **Portal** (separate repo): `grant-access-dialog.tsx` — datetime `toISOString()` inside try/catch for invalid date toast.

### Test commands & output

```text
cd affiliate-tool-apis
npx vitest run tests/platform/grant-access.test.ts tests/lib/entitlements-grace.test.ts tests/billing/checkout-manual-sub.test.ts

 Test Files  3 passed (3)
      Tests  18 passed (18)
   Duration  60.39s
```

```text
cd affiliate-tool-portal
npx tsc --noEmit
(exit 0)
```
