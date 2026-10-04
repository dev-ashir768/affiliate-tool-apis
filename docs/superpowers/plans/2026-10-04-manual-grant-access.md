# Manual Grant Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SUPERADMIN grant/revoke complimentary paid plan access on an organization from backoffice without Stripe.

**Architecture:** DB-only grant upserts org plan limits + a `Subscription` with `stripeSubscriptionId = manual_<orgId>`. Entitlements treat expired manual period ends as no access. Stripe-backed subs block grant and overwrite manual on webhook. Portal org detail exposes Grant/Revoke via BFF.

**Tech Stack:** Express + Prisma + Vitest (apis); Next.js App Router BFF + React Query + shadcn (portal).

**Spec:** `docs/superpowers/specs/2026-10-04-manual-grant-access-design.md`

## Global Constraints

- SUPERADMIN only for grant/revoke routes
- Synthetic id prefix exactly `manual_`
- Never grant `free` plan
- Real Stripe sub (`stripeSubscriptionId` not starting with `manual_`) → HTTP 409 on grant/revoke
- Lifecycle events for grant/revoke use `silent: true` (email is a non-goal)
- No Prisma schema migration
- Dual repos: commit API changes in `affiliate-tool-apis`, portal in `affiliate-tool-portal`

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/entitlements.ts` | `isManualSubscriptionId`, period-end denial for manuals |
| `tests/lib/entitlements-grace.test.ts` | Unit tests for manual expiry |
| `src/modules/platform/platform-grant.service.ts` | `grantOrganizationAccess`, `revokeOrganizationAccess` |
| `src/modules/platform/platform.schemas.ts` | Zod bodies for grant/revoke |
| `src/modules/platform/platform.service.ts` | `billingSource` on org summary/detail |
| `src/modules/platform/platform.routes.ts` | Wire POST grant/revoke |
| `tests/platform/grant-access.test.ts` | Integration tests |
| Portal BFF routes under `app/api/platform/organizations/[id]/` | Proxy grant/revoke |
| `types/platform.ts`, `validations/platform.validations.ts`, `services/platform.ts`, `hooks/use-platform.ts` | Types + client + mutations |
| `components/backoffice/organizations/organization-detail.tsx` (+ grant dialog) | UI |

---

### Task 1: Manual entitlements helper

**Files:**
- Modify: `affiliate-tool-apis/src/lib/entitlements.ts`
- Modify: `affiliate-tool-apis/tests/lib/entitlements-grace.test.ts`

**Interfaces:**
- Produces: `isManualSubscriptionId(id: string): boolean`
- Produces: `subscriptionGrantsAccess(subscription: Pick<Subscription, "status" | "currentPeriodEnd" | "stripeSubscriptionId"> | null | undefined): boolean`

- [ ] **Step 1: Extend unit tests (fail first)**

Add to `tests/lib/entitlements-grace.test.ts`:

```ts
import {
  subscriptionGrantsAccess,
  isManualSubscriptionId,
} from "../../src/lib/entitlements.js";

it("detects manual subscription ids", () => {
  expect(isManualSubscriptionId("manual_org123")).toBe(true);
  expect(isManualSubscriptionId("sub_1ABC")).toBe(false);
});

it("denies expired manual ACTIVE grants", () => {
  expect(
    subscriptionGrantsAccess({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() - 60_000),
      stripeSubscriptionId: "manual_org1",
    }),
  ).toBe(false);
});

it("grants open-ended and future manual ACTIVE", () => {
  expect(
    subscriptionGrantsAccess({
      status: "ACTIVE",
      currentPeriodEnd: null,
      stripeSubscriptionId: "manual_org1",
    }),
  ).toBe(true);
  expect(
    subscriptionGrantsAccess({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 86400_000),
      stripeSubscriptionId: "manual_org1",
    }),
  ).toBe(true);
});

it("does not deny Stripe ACTIVE with past period end", () => {
  expect(
    subscriptionGrantsAccess({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() - 60_000),
      stripeSubscriptionId: "sub_real",
    }),
  ).toBe(true);
});
```

Update existing ACTIVE/TRIALING cases to pass `stripeSubscriptionId: "sub_test"` (or any non-manual).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd affiliate-tool-apis
npx vitest run tests/lib/entitlements-grace.test.ts
```

Expected: FAIL (`isManualSubscriptionId` missing / type mismatch).

- [ ] **Step 3: Implement**

In `src/lib/entitlements.ts`:

```ts
export function isManualSubscriptionId(id: string): boolean {
  return id.startsWith("manual_");
}

export function subscriptionGrantsAccess(
  subscription:
    | Pick<Subscription, "status" | "currentPeriodEnd" | "stripeSubscriptionId">
    | null
    | undefined,
): boolean {
  if (!subscription) return false;

  if (
    isManualSubscriptionId(subscription.stripeSubscriptionId) &&
    subscription.currentPeriodEnd != null &&
    Date.now() > subscription.currentPeriodEnd.getTime()
  ) {
    return false;
  }

  // existing ACTIVE / TRIALING / PAST_DUE logic unchanged
  ...
}
```

Call sites already pass full `Subscription` objects from Prisma — no further changes required once the Pick includes `stripeSubscriptionId`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/lib/entitlements-grace.test.ts
```

- [ ] **Step 5: Commit (apis)**

```bash
git add src/lib/entitlements.ts tests/lib/entitlements-grace.test.ts
git commit -m "feat: deny expired manual subscription grants in entitlements."
```

---

### Task 2: Grant / revoke service + routes + billingSource

**Files:**
- Create: `affiliate-tool-apis/src/modules/platform/platform-grant.service.ts`
- Modify: `affiliate-tool-apis/src/modules/platform/platform.schemas.ts`
- Modify: `affiliate-tool-apis/src/modules/platform/platform.service.ts` (`toOrgSummary` / `getOrganization`)
- Modify: `affiliate-tool-apis/src/modules/platform/platform.routes.ts`
- Create: `affiliate-tool-apis/tests/platform/grant-access.test.ts`

**Interfaces:**
- Consumes: `isManualSubscriptionId`, `subscriptionGrantsAccess`, `recordBillingLifecycleEvent`, `writeAuditLog`, `getOrganization`
- Produces:
  - `manualSubscriptionId(organizationId: string): string` → `` `manual_${organizationId}` ``
  - `grantOrganizationAccess(organizationId, input, actorUserId): Promise<OrgDetail>`
  - `revokeOrganizationAccess(organizationId, input, actorUserId): Promise<OrgDetail>`
  - Org summary/detail field `billingSource: "manual" | "stripe" | "none"`

- [ ] **Step 1: Write failing integration test**

Create `tests/platform/grant-access.test.ts` patterned on `tests/shops/connect.test.ts`:

- `beforeAll`: create free-plan org (no subscription) + SUPERADMIN user with `platformMembership` + `signAccessToken({ sub, orgId: null, orgRole: null, platformRole: "SUPERADMIN", hasProductAccess: false })`
- Also create OPS staff token for 403 case
- Ensure plans `starter` (or first non-free) exist via `prisma.plan.findFirst({ where: { code: { not: "free" }, active: true } })`

Cases:

1. `POST /api/v1/platform/organizations/:id/grant-access` with `{ planCode: starter.code }` → 200, `billingSource === "manual"`, `hasProductAccess === true`, `plan.code === starter.code`, `stripeSubscriptionId === "manual_"+orgId`
2. Re-grant with different paid plan + future `currentPeriodEnd` → 200, updated plan
3. Create Stripe sub on a second org (`stripeSubscriptionId: "sub_real_..."`) → grant → 409
4. Revoke on manual org → 200, free plan, `billingSource === "none"`, `hasProductAccess === false`
5. Revoke again / revoke Stripe org → 409
6. OPS token grant → 403
7. Unit-style: after grant with past `currentPeriodEnd` rejected by validation (400); after grant with future end, force-update period end to past in DB and `GET` org → `hasProductAccess === false`

Cleanup in `afterAll`: delete lifecycle events, audit logs, subscription, memberships, org, platform memberships, users.

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/platform/grant-access.test.ts
```

Expected: 404 on grant route.

- [ ] **Step 3: Schemas**

In `platform.schemas.ts`:

```ts
export const grantAccessSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  currentPeriodEnd: z.string().datetime().optional().nullable(),
  note: z.string().trim().max(500).optional(),
});

export const revokeAccessSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
```

- [ ] **Step 4: Service implementation**

Create `platform-grant.service.ts`:

```ts
export function manualSubscriptionId(organizationId: string) {
  return `manual_${organizationId}`;
}

export async function grantOrganizationAccess(
  organizationId: string,
  input: { planCode: string; currentPeriodEnd?: string | null; note?: string },
  actorUserId: string,
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { plan: true, subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  if (
    org.subscription &&
    !isManualSubscriptionId(org.subscription.stripeSubscriptionId)
  ) {
    throw new AppError(
      "CONFLICT",
      "Organization has a Stripe subscription; manage access in Stripe",
      409,
    );
  }

  const plan = await prisma.plan.findFirst({
    where: { code: input.planCode, active: true },
  });
  if (!plan || plan.code === "free") {
    throw new AppError("VALIDATION_ERROR", "Paid active plan required", 400);
  }

  let periodEnd: Date | null = null;
  if (input.currentPeriodEnd) {
    periodEnd = new Date(input.currentPeriodEnd);
    if (Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() <= Date.now()) {
      throw new AppError(
        "VALIDATION_ERROR",
        "currentPeriodEnd must be a future datetime",
        400,
      );
    }
  }

  const subId = manualSubscriptionId(organizationId);
  const prevPlan = org.plan.code;
  const prevCents = org.plan.monthlyPriceCents;
  const hadManual = Boolean(org.subscription);

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        planId: plan.id,
        seatLimit: plan.seatLimit,
        shopLimit: plan.shopLimit,
        botLimit: plan.botLimit,
        dailyInviteQuota: plan.dailyInviteQuota,
      },
    });
    await tx.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        stripeSubscriptionId: subId,
        status: "ACTIVE",
        currentPeriodEnd: periodEnd,
      },
      update: {
        stripeSubscriptionId: subId,
        status: "ACTIVE",
        currentPeriodEnd: periodEnd,
      },
    });
  });

  const lifecycleType = !hadManual
    ? "SUBSCRIBED"
    : plan.monthlyPriceCents >= prevCents
      ? "UPGRADED"
      : plan.code !== prevPlan
        ? "DOWNGRADED"
        : "UPGRADED";

  if (!hadManual || plan.code !== prevPlan) {
    await recordBillingLifecycleEvent({
      organizationId,
      type: !hadManual
        ? "SUBSCRIBED"
        : plan.monthlyPriceCents >= prevCents
          ? "UPGRADED"
          : "DOWNGRADED",
      fromPlanCode: prevPlan,
      toPlanCode: plan.code,
      actorUserId,
      periodEnd: periodEnd?.toISOString() ?? null,
      silent: true,
      meta: { source: "manual_grant", note: input.note ?? null },
    });
  }

  await writeAuditLog({
    actorUserId,
    organizationId,
    action: "organization.grant_access",
    entityType: "Organization",
    entityId: organizationId,
    meta: {
      planCode: plan.code,
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
      note: input.note ?? null,
    },
  });

  return getOrganization(organizationId);
}

export async function revokeOrganizationAccess(
  organizationId: string,
  input: { note?: string },
  actorUserId: string,
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { plan: true, subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);
  if (
    !org.subscription ||
    !isManualSubscriptionId(org.subscription.stripeSubscriptionId)
  ) {
    throw new AppError(
      "CONFLICT",
      "No manual grant to revoke",
      409,
    );
  }

  const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  const fromPlan = org.plan.code;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.delete({ where: { organizationId } });
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
  });

  await recordBillingLifecycleEvent({
    organizationId,
    type: "CANCELED",
    fromPlanCode: fromPlan,
    toPlanCode: "free",
    actorUserId,
    silent: true,
    meta: { source: "manual_revoke", note: input.note ?? null },
  });

  await writeAuditLog({
    actorUserId,
    organizationId,
    action: "organization.revoke_access",
    entityType: "Organization",
    entityId: organizationId,
    meta: { note: input.note ?? null, fromPlanCode: fromPlan },
  });

  return getOrganization(organizationId);
}
```

Fix lifecycle type logic to match the if-condition (avoid unused `lifecycleType` variable — use the inline ternary once).

- [ ] **Step 5: `billingSource` on summaries**

In `toOrgSummary`:

```ts
function billingSourceOf(
  subscription: { stripeSubscriptionId?: string } | null,
): "manual" | "stripe" | "none" {
  if (!subscription?.stripeSubscriptionId) return "none";
  return isManualSubscriptionId(subscription.stripeSubscriptionId)
    ? "manual"
    : "stripe";
}
```

Add `billingSource: billingSourceOf(org.subscription)` to the returned object. Keep `stripeSubscriptionId` on detail; UI will hide Stripe dashboard links when `billingSource !== "stripe"`.

- [ ] **Step 6: Routes**

In `platform.routes.ts`:

```ts
platformRoutes.post(
  "/organizations/:id/grant-access",
  requirePlatform("SUPERADMIN"),
  validateBody(grantAccessSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      res.json(
        await grantOrganizationAccess(String(req.params.id), req.body, req.auth.sub),
      );
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.post(
  "/organizations/:id/revoke-access",
  requirePlatform("SUPERADMIN"),
  validateBody(revokeAccessSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      res.json(
        await revokeOrganizationAccess(String(req.params.id), req.body, req.auth.sub),
      );
    } catch (err) {
      next(err);
    }
  },
);
```

Confirm `AppError` code `CONFLICT` is accepted by the error middleware (use existing code string pattern from codebase; if only certain codes exist, match `errors.ts`).

- [ ] **Step 7: Run tests — expect PASS**

```bash
npx vitest run tests/platform/grant-access.test.ts tests/lib/entitlements-grace.test.ts
```

- [ ] **Step 8: Commit (apis)**

```bash
git add src/modules/platform tests/platform/grant-access.test.ts
git commit -m "feat: superadmin manual grant and revoke organization access."
```

---

### Task 3: Portal BFF + client

**Files:**
- Create: `affiliate-tool-portal/app/api/platform/organizations/[id]/grant-access/route.ts`
- Create: `affiliate-tool-portal/app/api/platform/organizations/[id]/revoke-access/route.ts`
- Modify: `affiliate-tool-portal/types/platform.ts`
- Modify: `affiliate-tool-portal/validations/platform.validations.ts`
- Modify: `affiliate-tool-portal/services/platform.ts`
- Modify: `affiliate-tool-portal/hooks/use-platform.ts`

**Interfaces:**
- Consumes: API from Task 2
- Produces: `grantPlatformOrganizationAccess(id, body)`, `revokePlatformOrganizationAccess(id, body)`, hooks `useGrantPlatformOrganizationAccess`, `useRevokePlatformOrganizationAccess`

- [ ] **Step 1: Types + Zod**

```ts
// types/platform.ts
export type BillingSource = "manual" | "stripe" | "none";
// on PlatformOrgSummary:
billingSource?: BillingSource;

// validations/platform.validations.ts
export const grantPlatformAccessSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  currentPeriodEnd: z.string().datetime().optional().nullable(),
  note: z.string().trim().max(500).optional(),
});
export const revokePlatformAccessSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
```

- [ ] **Step 2: BFF routes**

Mirror `app/api/platform/plans/[id]/route.ts` pattern: parse body, `authenticatedApiFetch` to `/api/v1/platform/organizations/${id}/grant-access` (POST) and `.../revoke-access`.

- [ ] **Step 3: Service + hooks**

```ts
// services/platform.ts
export async function grantPlatformOrganizationAccess(
  id: string,
  body: GrantPlatformAccessSchemaType,
) {
  const res = await fetch(
    `/api/platform/organizations/${encodeURIComponent(id)}/grant-access`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  // use same error parsing as other platform mutations in this file
}

// hooks: mutation invalidates ["platform", "organizations", id] and list key
```

Follow existing `createPlatformCreator` error-handling style in `services/platform.ts`.

- [ ] **Step 4: Commit (portal)**

```bash
cd affiliate-tool-portal
git add app/api/platform/organizations types/platform.ts validations/platform.validations.ts services/platform.ts hooks/use-platform.ts
git commit -m "feat: BFF and client for manual organization access grant."
```

---

### Task 4: Org detail Grant / Revoke UI

**Files:**
- Create: `affiliate-tool-portal/components/backoffice/organizations/grant-access-dialog.tsx`
- Modify: `affiliate-tool-portal/components/backoffice/organizations/organization-detail.tsx`

**Interfaces:**
- Consumes: hooks from Task 3, `usePlatformPlans` (existing)

- [ ] **Step 1: Grant dialog**

Client dialog with:

- Plan `<select>` from `usePlatformPlans()` filtered `code !== "free" && active`
- Optional datetime-local / date input for end (convert to ISO on submit; empty = null)
- Optional note textarea
- Submit → `useGrantPlatformOrganizationAccess`, toast success including: “Merchant may need to sign in again to pick up access.”
- On error toast `err.message`

- [ ] **Step 2: Wire organization-detail**

In billing card header area:

- Badge text: `Billing source: {org.billingSource ?? "none"}`
- If `billingSource !== "stripe"`: show **Grant access** button opening dialog
- If `billingSource === "manual"`: show **Revoke access** (confirm via `window.confirm` or AlertDialog) calling revoke mutation with optional empty note
- Stripe dashboard subscription link only when `billingSource === "stripe"` (do not link `manual_*` ids)
- Update CardDescription when manual: complimentary access managed by platform

- [ ] **Step 3: Manual UI check**

```bash
cd affiliate-tool-portal
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit (portal)**

```bash
git add components/backoffice/organizations
git commit -m "feat: grant and revoke manual access on organization detail."
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `isManualSubscriptionId` + expired manual deny | 1 |
| grant-access API + rules | 2 |
| revoke-access API + rules | 2 |
| Stripe 409 / Stripe webhook overwrite (existing upsert) | 2 (block); webhook unchanged |
| Audit + silent lifecycle | 2 |
| `billingSource` | 2 |
| Portal BFF | 3 |
| Org detail UI + toast re-login note | 4 |
| SUPERADMIN only | 2 routes + tests |
| Tests listed in spec | 1 + 2 |

## Self-review notes

- No schema migration; synthetic Stripe ids reuse unique column
- `subscriptionGrantsAccess` signature adds `stripeSubscriptionId`; Prisma includes it on all current call sites
- Lifecycle on same-plan re-grant with only period change: skip lifecycle if plan unchanged (audit still written) — matches service code above
