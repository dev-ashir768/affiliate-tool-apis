# Manual Grant Access (Superadmin) — Design

Date: 2026-10-04  
Status: Approved (chat)  
Repos: `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

Merchants can register and sit on `/onboarding` without paying. Superadmins can view the org in backoffice but cannot activate a package. Access today only comes from Stripe checkout + webhooks.

## Goal

Let **SUPERADMIN** grant (and revoke) complimentary paid access from backoffice org detail, without charging Stripe, with optional end date. Real Stripe subscriptions always win over manual grants.

## Non-goals

- Creating real Stripe subscriptions or coupons from the app
- OPS / FINANCE grant permissions
- Automatic email to the merchant on grant/revoke
- Cron job to flip expired manuals to free (entitlements deny access when period ended; revoke UI remains available)
- Impersonation or forcing the merchant JWT refresh from the server

## Decisions

| Topic | Choice |
|-------|--------|
| Model | DB-only complimentary grant |
| Who | `SUPERADMIN` only |
| Stripe conflict | Grant only when no real Stripe sub; Stripe webhook overwrites manual |
| Duration | Optional `currentPeriodEnd`; omit/null = open-ended until revoke |
| Synthetic id | `stripeSubscriptionId = manual_<organizationId>` |

## Approach

Upsert org plan + limits and a `Subscription` row marked with `manual_<orgId>`. Reuse `subscriptionGrantsAccess` for product access. Portal org detail exposes Grant / Revoke.

## API

Auth: `authenticate` + `requirePlatform("SUPERADMIN")`.

### `POST /api/v1/platform/organizations/:id/grant-access`

Body:

```json
{
  "planCode": "starter",
  "currentPeriodEnd": "2026-11-04T00:00:00.000Z",
  "note": "Pilot / comp"
}
```

Rules:

- `planCode` required; must resolve to an active non-`free` plan
- `currentPeriodEnd` optional; if set must be in the future
- `note` optional, max 500 chars; stored in audit metadata
- If org missing → 404
- If existing subscription `stripeSubscriptionId` does **not** start with `manual_` → **409** (`CONFLICT`)
- Else in a transaction:
  1. Update org `planId`, `seatLimit`, `shopLimit`, `botLimit`, `dailyInviteQuota` from plan
  2. Upsert subscription: `status: ACTIVE`, `stripeSubscriptionId: manual_<orgId>`, `currentPeriodEnd` as provided (or null)
  3. Write `BillingLifecycleEvent` (`SUBSCRIBED` if first paid-ish transition, else `UPGRADED` / `DOWNGRADED` by monthly price vs previous)
  4. `writeAuditLog` action `organization.grant_access` with actor, orgId, planCode, period end, note

Response: same shape as `GET /organizations/:id` (includes `hasProductAccess: true` when grant is live).

### `POST /api/v1/platform/organizations/:id/revoke-access`

Body:

```json
{ "note": "Pilot ended" }
```

Rules:

- If no subscription or id does not start with `manual_` → **409**
- Else: set org to `free` plan + free limits; delete subscription row (or set `CANCELED` then delete — prefer delete so org matches “no sub” onboarding state); lifecycle `CANCELED`; audit `organization.revoke_access`

Response: org detail with `hasProductAccess: false`.

## Entitlements

Update `subscriptionGrantsAccess` so that when `stripeSubscriptionId` starts with `manual_` and `currentPeriodEnd` is set and in the past, access is **false** even if status is `ACTIVE`.

Stripe-backed rows keep current behavior (`ACTIVE` / `TRIALING` grant; `PAST_DUE` grace unchanged). Do not apply period-end denial to non-manual subscriptions.

Helper: `isManualSubscriptionId(id: string): boolean` → `id.startsWith("manual_")`.

## Stripe webhook interaction

Existing apply-subscription path already replaces plan + subscription from Stripe events. When a merchant later pays:

- Webhook upserts real `stripeSubscriptionId` and paid plan
- Manual id is overwritten; no special branch required beyond ensuring unique constraint allows update/replace of the single org subscription row

Grant remains blocked while a non-manual subscription exists.

## Portal UI

File: `components/backoffice/organizations/organization-detail.tsx` (+ small dialog/actions as needed).

- Show billing source badge: **Manual** | **Stripe** | **None**
- **Grant access** button when source is None or Manual (re-grant / change plan allowed for manual)
- Dialog: plan select (non-free public/active plans from existing plans API), optional end date, optional note, confirm
- **Revoke access** when source is Manual
- Hide grant/revoke for Stripe; show copy that management is in Stripe
- SUPERADMIN-only UI is already gated by backoffice nav / platform role; still rely on API 403

BFF routes:

- `POST /api/platform/organizations/[id]/grant-access`
- `POST /api/platform/organizations/[id]/revoke-access`

## Merchant session after grant

JWT `hasProductAccess` updates on login / token refresh. After grant, merchant may need one logout/login (or natural refresh) to leave `/onboarding`. Document in UI toast for superadmin: “Merchant may need to sign in again to pick up access.”

## Tests (API)

- Grant on free/no-sub org → plan + manual sub + access true
- Grant with future `currentPeriodEnd` → access true; past end → access false via entitlements helper
- Grant when Stripe sub present → 409
- Re-grant on existing manual → updates plan/period
- Revoke manual → free + no access
- Revoke when Stripe / none → 409
- Non-superadmin → 403

## Implementation notes

- Keep logic in `platform.service.ts` (or small `platform-grant.service.ts` if file is already large)
- Reuse plan limit copy pattern from `webhook.service.ts` / billing apply helpers where practical
- No Prisma schema migration required (`stripeSubscriptionId` stays required string; synthetic values are valid)
- Portal types: extend org detail with optional `billingSource: "manual" | "stripe" | "none"` computed server-side for cleaner UI
