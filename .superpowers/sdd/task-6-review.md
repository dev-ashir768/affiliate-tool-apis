# Task 6 Review: Stripe billing (plans, checkout, portal, webhook)

**Reviewer:** SDD review (read-only)  
**Base:** `c52d9e5077961bfa3159c0522ff7255007959453`  
**Head:** `79e25fcf498800793a3b58498d335b3409a430f6`  
**Verdict:** **Spec ✅** · **Quality: Important**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Install `stripe` | ✅ | `package.json` / lockfile |
| Create `src/modules/billing/stripe.ts` | ✅ | Lazy client + `portalBaseUrl()` |
| Create `src/modules/billing/billing.service.ts` | ✅ | `listPlans`, `createCheckoutSession`, `createPortalSession` |
| Create `src/modules/billing/billing.routes.ts` | ✅ | Plans, checkout, portal, webhook handler |
| Create `src/modules/billing/webhook.service.ts` | ✅ | `handleStripeEvent` + `applySubscriptionFromStripe` alias |
| Create `tests/billing/webhook.service.test.ts` | ✅ | Idempotency + plan/quota sync assertions |
| Modify `src/app.ts` (raw webhook before JSON) | ✅ | `express.raw` on `/api/v1/webhooks/stripe` before `express.json()` |
| `GET /api/v1/billing/plans` | ✅ | Public; no auth middleware |
| `POST /api/v1/billing/checkout-session` `{ planCode }` | ✅ | OWNER/ADMIN via `authenticate` + `requireOrg` + `requireRole` |
| `POST /api/v1/billing/portal-session` | ✅ | OWNER/ADMIN |
| `POST /api/v1/webhooks/stripe` | ✅ | Signature verification + `handleStripeEvent` |
| Idempotent via `StripeEvent.eventId` (P2002 → early return) | ✅ | Claim before apply |
| Webhook: insert `StripeEvent`, resolve org, upsert `Subscription`, copy Plan quotas | ✅ | `checkout.session.completed` + `customer.subscription.*` |
| Checkout session fields (mode, customer/email, line_items, URLs, metadata, client_reference_id) | ✅ | Matches brief snippet |
| TDD: duplicate event test | ✅ | Brief test shape + extended org/subscription assertions |
| Commit message / scope | ✅ | `feat: add Stripe checkout, portal, and idempotent webhooks`; no `.env` |

---

## Global constraints

| Constraint | Status | Notes |
|------------|--------|-------|
| Stripe Checkout + webhooks; idempotent via `StripeEvent` | ✅ | Unique `eventId`; duplicate returns without re-apply |
| Error envelope `{ error: { code, message, details? } }` | ✅ | Billing routes use `AppError` → `errorHandler` |
| OWNER/ADMIN for checkout/portal | ✅ | Both POST routes gated |
| Webhook raw body + signature verification | ✅ | `express.raw({ type: "application/json" })` + `constructEvent` |
| Stripe events recorded before side effects (or same transaction after claim) | ✅ | `StripeEvent.create` precedes org/subscription updates |

---

## Quality assessment

Implementation is well-structured, follows existing middleware/error patterns, and covers the brief’s TDD case with meaningful assertions (plan quotas, subscription upsert). Checkout and portal services validate plan/customer preconditions with appropriate error codes.

### Strengths

- Webhook mounted with raw parser **before** global JSON middleware — correct for Stripe signature verification.
- Idempotency is simple and correct for the happy path: one `StripeEvent` row per `event.id`, P2002 short-circuit.
- Checkout session uses `metadata.organizationId` and `client_reference_id`; org resolution tries both plus `stripeCustomerId`.
- `applyPlanAndSubscription` wraps org quota copy + subscription upsert in a transaction.
- `customer.subscription.*` prefix handles created/updated/deleted uniformly; status mapping covers common Stripe states.
- `checkout.session.completed` handles expanded subscription object or subscription-id-only placeholder (deferred to subscription events).
- Service-level test avoids live Stripe; cleanup restores seeded `stripePriceId`.

### Defects

| Severity | Item |
|----------|------|
| **Important** | **Claim-then-apply without rollback on failure.** `handleStripeEvent` inserts `StripeEvent` first; if `applyFromCheckoutSession` / `applyFromSubscription` throws afterward (org not found, validation error, DB error), the event remains claimed. Stripe retries receive a non-2xx (e.g. 404) but duplicate delivery is ignored — subscription/plan sync is permanently skipped for that event. Brief ordering allows claim-first, but this is a production billing reliability gap. Mitigation: delete claim on failure, or claim+apply in one transaction, or defer claim until after successful apply with unique constraint retry. |
| Minor | Invalid Stripe signature: `constructEvent` throws a non-`AppError` → generic 500 envelope (still valid shape, but opaque vs 401/400). |
| Minor | Portal/checkout URLs use first `CORS_ORIGINS` entry; no dedicated `PORTAL_URL` env (brief used `${portalUrl}` placeholder). |
| Minor | Unknown `stripePriceId` skips org plan/quota update silently while subscription row still upserts — org can remain on free limits with an active sub. |
| Minor | No HTTP/integration tests for checkout, portal, or webhook route (brief only required service test; acceptable in scope). |
| Minor | `event as any` in webhook handler; Stripe types could narrow `StripeLikeEvent`. |

---

## Test verification

Report claims:

- `npm test -- tests/billing/webhook.service.test.ts` — 1 test passed  
- `npm test` — 7 files, 15 tests passed  

Review performed via static analysis of diff + source (read-only; tests not re-run). Test aligns with brief Step 2 and extends with quota/subscription checks. No coverage for claim-failure/retry behavior or webhook HTTP/signature paths.

---

## Summary

Task 6 delivers all specified billing endpoints, Stripe Checkout/portal session creation, raw-body webhook verification, and idempotent event processing with plan quota sync. Global constraints and brief file/route checklist are satisfied.

One operational gap warrants follow-up before treating billing as production-ready:

1. **Failed apply after event claim** — Stripe retries cannot recover; billing state may drift (Important).

Documented deviations (CORS-derived portal URL, checkout placeholder `INCOMPLETE` until subscription events) are acceptable within scope.

**Spec: ✅**  
**Quality: Important**

**Recommended fix before production:** on apply failure after claim, remove the `StripeEvent` row (or use transactional claim+apply) so Stripe retries can succeed; add a test that simulates apply failure then successful retry.
