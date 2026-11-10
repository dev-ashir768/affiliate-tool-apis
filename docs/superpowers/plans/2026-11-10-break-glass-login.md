# Break-Glass Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ACTIVE SUPERADMIN open a merchant account from `/login` using the target email + the SUPERADMIN’s own password and TOTP, with audit and an exitable banner — without a shared master secret.

**Architecture:** Extend `mfa_pending` JWT with optional `breakGlass` + `targetUserId` (`sub` = actor). On login, after a failed target-password check, try SUPERADMIN password match and issue a break-glass challenge. On `/2fa/verify`, validate actor TOTP then mint a merchant session (shared helper with Impersonate). Portal sets `impersonation_meta` without staff stash; Exit clears session → `/login`.

**Tech Stack:** Express + Jose JWT + Prisma + Vitest (apis); Next.js BFF cookies + existing ImpersonationBanner (portal)

**Spec:** `docs/superpowers/specs/2026-11-10-break-glass-login-design.md`

## Global Constraints

- Dual repos: commit API work in `affiliate-tool-apis`, portal work in `affiliate-tool-portal`
- No shared master password / master OTP env var
- Actor = ACTIVE `platformMembership.role === "SUPERADMIN"` whose password matches
- Never break-glass into platform staff; never skip actor TOTP; ignore `rememberDevice` on break-glass
- Target org = first ACTIVE membership by `createdAt` asc
- Audit action on success only: `auth.break_glass`
- Before SUPERADMIN password is proven → always `401 Invalid credentials`
- YAGNI — no org picker, no IP allowlist, no feature flag in v1

## File map

| File | Responsibility |
|------|----------------|
| `affiliate-tool-apis/src/lib/tokens.ts` | Optional break-glass claims on `mfa_pending` |
| `affiliate-tool-apis/tests/lib/mfa-pending-token.test.ts` | Token round-trip / reject access verifier |
| `affiliate-tool-apis/src/modules/platform/mint-merchant-session.ts` | Shared target session mint + eligibility checks |
| `affiliate-tool-apis/src/modules/platform/platform-impersonate.service.ts` | Call shared mint helper |
| `affiliate-tool-apis/src/modules/auth/auth.service.ts` | Break-glass branch inside `login` |
| `affiliate-tool-apis/src/middleware/authenticate-mfa-pending.ts` | Attach `mfaBreakGlass` / `mfaTargetUserId` |
| `affiliate-tool-apis/src/modules/auth/two-factor.service.ts` | Break-glass verify; block setup when break-glass |
| `affiliate-tool-apis/src/modules/auth/auth.routes.ts` | Pass `breakGlass` on challenge + verify response |
| `affiliate-tool-apis/tests/auth/break-glass.service.test.ts` | Service-level break-glass cases |
| `affiliate-tool-apis/tests/auth/break-glass.http.test.ts` | HTTP login + verify + setup blocked |
| `affiliate-tool-portal/lib/auth/session.ts` | Meta `mode`; `isImpersonating` + break-glass exit helpers |
| `affiliate-tool-portal/app/api/auth/2fa/verify/route.ts` | Set meta when `breakGlass` |
| `affiliate-tool-portal/app/api/auth/exit-impersonation/route.ts` | No staff stash → clear session → `/login` |
| `affiliate-tool-portal/components/layout/impersonation-banner.tsx` | Break-glass copy + Exit label |
| `affiliate-tool-portal/app/(dashboard)/layout.tsx` | Pass `mode` into banner |

---

### Task 1: MFA pending token claims

**Files:**
- Modify: `affiliate-tool-apis/src/lib/tokens.ts`
- Modify: `affiliate-tool-apis/tests/lib/mfa-pending-token.test.ts`

**Interfaces:**
- Produces:
  - `export type MfaPendingClaims = { sub: string; breakGlass?: true; targetUserId?: string }`
  - `signMfaPendingToken(userId: string, opts?: { breakGlass: true; targetUserId: string }): Promise<string>`
  - `verifyMfaPendingToken(token: string): Promise<MfaPendingClaims>`
- Consumes: existing Jose helpers in the same file

- [ ] **Step 1: Write the failing tests**

Extend `tests/lib/mfa-pending-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  signMfaPendingToken,
  verifyMfaPendingToken,
  verifyAccessToken,
} from "../../src/lib/tokens.js";

describe("mfa pending token", () => {
  it("verifies purpose-bound pending token", async () => {
    const token = await signMfaPendingToken("user_1");
    const pending = await verifyMfaPendingToken(token);
    expect(pending.sub).toBe("user_1");
    expect(pending.breakGlass).toBeUndefined();
    expect(pending.targetUserId).toBeUndefined();
  });

  it("round-trips break-glass claims", async () => {
    const token = await signMfaPendingToken("actor_1", {
      breakGlass: true,
      targetUserId: "target_9",
    });
    const pending = await verifyMfaPendingToken(token);
    expect(pending.sub).toBe("actor_1");
    expect(pending.breakGlass).toBe(true);
    expect(pending.targetUserId).toBe("target_9");
  });

  it("rejects breakGlass without targetUserId", async () => {
    await expect(
      signMfaPendingToken("actor_1", {
        breakGlass: true,
        targetUserId: "",
      } as { breakGlass: true; targetUserId: string }),
    ).rejects.toThrow(/targetUserId/);
  });

  it("is rejected by verifyAccessToken", async () => {
    const token = await signMfaPendingToken("user_1");
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (cwd `affiliate-tool-apis`):

```bash
npx vitest run tests/lib/mfa-pending-token.test.ts
```

Expected: FAIL — `breakGlass` / extra opts not supported yet (or assertion miss).

- [ ] **Step 3: Implement token helpers**

In `src/lib/tokens.ts`, replace the MFA pending pair with:

```ts
export type MfaPendingClaims = {
  sub: string;
  breakGlass?: true;
  targetUserId?: string;
};

export async function signMfaPendingToken(
  userId: string,
  opts?: { breakGlass: true; targetUserId: string },
): Promise<string> {
  if (opts?.breakGlass) {
    const targetUserId = opts.targetUserId?.trim();
    if (!targetUserId) {
      throw new Error("breakGlass mfa_pending requires targetUserId");
    }
  }
  return new SignJWT({
    purpose: "mfa_pending",
    ...(opts?.breakGlass
      ? { breakGlass: true, targetUserId: opts.targetUserId.trim() }
      : {}),
  })
    .setProtectedHeader({ alg: algorithm() })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.MFA_PENDING_TTL_SEC}s`)
    .sign(await getSigningKey());
}

export async function verifyMfaPendingToken(
  token: string,
): Promise<MfaPendingClaims> {
  const { payload } = await jwtVerify(token, await getVerifyKey(), {
    algorithms: [algorithm()],
  });
  if (payload.purpose !== "mfa_pending" || !payload.sub) {
    throw new Error("Invalid mfa pending token");
  }
  const breakGlass = payload.breakGlass === true;
  const targetUserId =
    typeof payload.targetUserId === "string" && payload.targetUserId
      ? payload.targetUserId
      : undefined;
  if (breakGlass && !targetUserId) {
    throw new Error("Invalid mfa pending token");
  }
  return {
    sub: String(payload.sub),
    ...(breakGlass ? { breakGlass: true as const, targetUserId } : {}),
  };
}
```

Keep all other exports in the file unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/mfa-pending-token.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit (apis repo)**

```bash
git add src/lib/tokens.ts tests/lib/mfa-pending-token.test.ts
git commit -m "feat(auth): extend mfa_pending JWT with break-glass claims"
```

---

### Task 2: Shared merchant session mint + Impersonate refactor

**Files:**
- Create: `affiliate-tool-apis/src/modules/platform/mint-merchant-session.ts`
- Modify: `affiliate-tool-apis/src/modules/platform/platform-impersonate.service.ts`

**Interfaces:**
- Produces:
  - `assertBreakGlassTarget(targetUserId: string): Promise<{ id: string; email: string; name: string }>`
  - `mintMerchantSessionForTarget(input: { actorUserId: string; targetUserId: string; organizationId: string; auditAction: "auth.impersonate" | "auth.break_glass" }): Promise<{ user; organizationId; redirectTo; accessToken; refreshToken }>`
- Consumes: `issueSession` from `../auth/auth.service.js`, `subscriptionGrantsAccess`, `writeAuditLog`, `prisma`, `AppError`

- [ ] **Step 1: Create `mint-merchant-session.ts`**

```ts
import type { MembershipRole } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { subscriptionGrantsAccess } from "../../lib/entitlements.js";
import { issueSession } from "../auth/auth.service.js";

export async function assertBreakGlassTarget(targetUserId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, status: true },
  });
  if (!target || target.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }

  const staffMembership = await prisma.platformMembership.findFirst({
    where: { userId: targetUserId, status: "ACTIVE" },
  });
  if (staffMembership) {
    throw new AppError(
      "FORBIDDEN",
      "Cannot impersonate platform staff accounts",
      403,
    );
  }

  return { id: target.id, email: target.email, name: target.name };
}

/** First ACTIVE org membership for break-glass (v1: no org picker). */
export async function firstActiveMembershipOrgId(userId: string): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!membership) {
    throw new AppError(
      "FORBIDDEN",
      "User is not an active member of any organization",
      403,
    );
  }
  return membership.organizationId;
}

/**
 * Staff support: mint a normal merchant session for a target user.
 * JWT `sub` is the target; actor is recorded in audit.
 */
export async function mintMerchantSessionForTarget(input: {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
  auditAction: "auth.impersonate" | "auth.break_glass";
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new AppError("VALIDATION_ERROR", "Cannot impersonate yourself", 400);
  }

  const target = await assertBreakGlassTarget(input.targetUserId);

  const membership = await prisma.membership.findFirst({
    where: {
      userId: input.targetUserId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
  });
  if (!membership) {
    throw new AppError(
      "FORBIDDEN",
      "User is not an active member of this organization",
      403,
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    include: { subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  const hasProductAccess = subscriptionGrantsAccess(org.subscription);
  const tokens = await issueSession({
    sub: target.id,
    orgId: org.id,
    orgRole: membership.role as MembershipRole,
    platformRole: null,
    hasProductAccess,
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    organizationId: org.id,
    action: input.auditAction,
    entityType: "User",
    entityId: target.id,
    meta: {
      targetUserId: target.id,
      targetEmail: target.email,
      organizationId: org.id,
    },
  });

  return {
    user: { id: target.id, email: target.email, name: target.name },
    organizationId: org.id,
    redirectTo: hasProductAccess ? "/home" : "/onboarding",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
```

- [ ] **Step 2: Refactor Impersonate to call the helper**

Replace `platform-impersonate.service.ts` body with:

```ts
import { mintMerchantSessionForTarget } from "./mint-merchant-session.js";

export async function impersonateOrganizationMember(input: {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
}) {
  return mintMerchantSessionForTarget({
    ...input,
    auditAction: "auth.impersonate",
  });
}
```

- [ ] **Step 3: Run existing impersonation / platform tests (smoke)**

```bash
npx vitest run tests/platform tests/auth/claims.test.ts
```

Expected: PASS (or skip only argon2-blocked cases). If a dedicated impersonate test file exists, include it.

- [ ] **Step 4: Commit (apis repo)**

```bash
git add src/modules/platform/mint-merchant-session.ts src/modules/platform/platform-impersonate.service.ts
git commit -m "refactor(platform): extract shared merchant session mint helper"
```

---

### Task 3: Login break-glass branch (service)

**Files:**
- Modify: `affiliate-tool-apis/src/modules/auth/auth.service.ts`
- Create: `affiliate-tool-apis/tests/auth/break-glass.service.test.ts`

**Interfaces:**
- Produces: `login(...)` may return  
  `{ status: "mfa_required"; breakGlass: true; mfaPendingToken; user: target }`  
  or actor `mfa_setup` when SA password matched but actor `totpEnabled === false`
- Consumes: `signMfaPendingToken`, `assertBreakGlassTarget`, `firstActiveMembershipOrgId`, `verifyPassword`, `prisma`

- [ ] **Step 1: Write failing service tests**

Create `tests/auth/break-glass.service.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { authenticator } from "otplib";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { hashPassword } from "../../src/lib/password.js";
import { encryptVault } from "../../src/lib/crypto.js";
import { generateTotpSecret } from "../../src/lib/totp.js";
import { login } from "../../src/modules/auth/auth.service.js";
import { verifyMfaPendingToken } from "../../src/lib/tokens.js";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const saEmail = `sa_bg_${suffix}@test.com`;
const merchantEmail = `m_bg_${suffix}@test.com`;
const staffEmail = `staff_bg_${suffix}@test.com`;
const saPassword = "SuperAdminBg123!";
const merchantPassword = "MerchantBg123!";

describe("break-glass login (service)", () => {
  let saId = "";
  let merchantId = "";
  let saSecret = "";

  beforeAll(async () => {
    const free = await prisma.plan.findUnique({ where: { code: "free" } });
    if (!free) throw new Error("free plan missing — run seed");

    const saHash = await hashPassword(saPassword);
    saSecret = generateTotpSecret();
    const sa = await prisma.user.create({
      data: {
        email: saEmail,
        passwordHash: saHash,
        name: "SA BreakGlass",
        status: "ACTIVE",
        totpEnabled: true,
        totpSecretEncrypted: encryptVault(saSecret),
        totpVerifiedAt: new Date(),
      },
    });
    saId = sa.id;
    await prisma.platformMembership.create({
      data: { userId: sa.id, role: "SUPERADMIN", status: "ACTIVE" },
    });

    const mHash = await hashPassword(merchantPassword);
    const merchant = await prisma.user.create({
      data: {
        email: merchantEmail,
        passwordHash: mHash,
        name: "Merchant BG",
        status: "ACTIVE",
      },
    });
    merchantId = merchant.id;
    const org = await prisma.organization.create({
      data: {
        name: "BG Org",
        slug: `bg-org-${suffix}`,
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    await prisma.membership.create({
      data: {
        userId: merchant.id,
        organizationId: org.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const staffHash = await hashPassword("StaffBg123!");
    const staff = await prisma.user.create({
      data: {
        email: staffEmail,
        passwordHash: staffHash,
        name: "Staff BG",
        status: "ACTIVE",
      },
    });
    await prisma.platformMembership.create({
      data: { userId: staff.id, role: "OPS", status: "ACTIVE" },
    });
  }, 60000);

  afterAll(async () => {
    try {
      const emails = [saEmail, merchantEmail, staffEmail];
      const users = await prisma.user.findMany({ where: { email: { in: emails } } });
      const ids = users.map((u) => u.id);
      await prisma.platformMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.organization.deleteMany({ where: { slug: `bg-org-${suffix}` } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("target email + SUPERADMIN password returns mfa_required breakGlass", async () => {
    const result = await login({ email: merchantEmail, password: saPassword });
    expect(result.status).toBe("mfa_required");
    if (result.status !== "mfa_required") throw new Error("unreachable");
    expect(result.breakGlass).toBe(true);
    expect(result.user.id).toBe(merchantId);
    const claims = await verifyMfaPendingToken(result.mfaPendingToken);
    expect(claims.sub).toBe(saId);
    expect(claims.breakGlass).toBe(true);
    expect(claims.targetUserId).toBe(merchantId);
  }, 60000);

  it("target email + own password stays normal (no breakGlass)", async () => {
    const result = await login({ email: merchantEmail, password: merchantPassword });
    expect(result.status).toBe("mfa_setup");
    expect(result).not.toHaveProperty("breakGlass");
    const claims = await verifyMfaPendingToken(
      (result as { mfaPendingToken: string }).mfaPendingToken,
    );
    expect(claims.sub).toBe(merchantId);
    expect(claims.breakGlass).toBeUndefined();
  }, 60000);

  it("wrong password returns 401", async () => {
    await expect(
      login({ email: merchantEmail, password: "TotallyWrong999!" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", statusCode: 401 });
  }, 60000);

  it("staff target + SA password returns 403", async () => {
    await expect(
      login({ email: staffEmail, password: saPassword }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  }, 60000);

  // silence unused in this task — secret used in Task 4
  it("keeps SA secret available for later verify tests", () => {
    expect(authenticator.generate(saSecret)).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run tests/auth/break-glass.service.test.ts
```

Expected: FAIL — login still 401s when password ≠ target.

- [ ] **Step 3: Implement login branch**

In `auth.service.ts`, change `login` so the initial credential gate becomes:

```ts
export async function login(input: {
  email: string;
  password: string;
  trustedDeviceRaw?: string | null;
}) {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  const targetPasswordOk =
    Boolean(user) && (await verifyPassword(user!.passwordHash, input.password));

  if (user && targetPasswordOk) {
    if (user.status === "DISABLED") {
      throw new AppError("FORBIDDEN", "Account is disabled", 403);
    }
    // … existing challengeUser / totpEnabled / staff / trusted-device / mfa_required path unchanged …
  }

  // Break-glass: email is target; password belongs to an ACTIVE SUPERADMIN.
  if (user && user.status === "ACTIVE") {
    const superadmins = await prisma.platformMembership.findMany({
      where: { role: "SUPERADMIN", status: "ACTIVE" },
      select: { userId: true, user: { select: { id: true, email: true, name: true, passwordHash: true, status: true, totpEnabled: true } } },
    });
    for (const row of superadmins) {
      const actor = row.user;
      if (actor.status !== "ACTIVE") continue;
      if (!(await verifyPassword(actor.passwordHash, input.password))) continue;
      if (actor.id === user.id) {
        // Same person typed own email — fall through to generic 401 if we somehow skipped above
        break;
      }

      const { assertBreakGlassTarget, firstActiveMembershipOrgId } = await import(
        "../platform/mint-merchant-session.js"
      );
      // Throws 403 for staff targets / missing org after SA proven
      await assertBreakGlassTarget(user.id);
      await firstActiveMembershipOrgId(user.id);

      if (!actor.totpEnabled) {
        const mfaPendingToken = await signMfaPendingToken(actor.id);
        return {
          status: "mfa_setup" as const,
          mfaPendingToken,
          user: { id: actor.id, email: actor.email, name: actor.name },
        };
      }

      const mfaPendingToken = await signMfaPendingToken(actor.id, {
        breakGlass: true,
        targetUserId: user.id,
      });
      return {
        status: "mfa_required" as const,
        breakGlass: true as const,
        mfaPendingToken,
        user: { id: user.id, email: user.email, name: user.name },
      };
    }
  }

  throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
}
```

Prefer a static import of `assertBreakGlassTarget` / `firstActiveMembershipOrgId` at top of file instead of dynamic import (avoid circular import: if `mint-merchant-session` → `issueSession` from auth.service creates a cycle, keep mint helpers’ `issueSession` import and use **dynamic import only inside the break-glass branch** as shown, or move `issueSession` later — dynamic import in the branch is acceptable for v1).

Keep the original happy-path body inside `if (user && targetPasswordOk) { ... return ... }` exactly as today’s logic.

- [ ] **Step 4: Run service tests**

```bash
npx vitest run tests/auth/break-glass.service.test.ts tests/auth/auth.service.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit (apis repo)**

```bash
git add src/modules/auth/auth.service.ts tests/auth/break-glass.service.test.ts
git commit -m "feat(auth): detect SUPERADMIN break-glass on login"
```

---

### Task 4: MFA middleware + verify / setup guards + routes

**Files:**
- Modify: `affiliate-tool-apis/src/middleware/authenticate-mfa-pending.ts`
- Modify: `affiliate-tool-apis/src/modules/auth/two-factor.service.ts`
- Modify: `affiliate-tool-apis/src/modules/auth/auth.routes.ts`
- Create: `affiliate-tool-apis/tests/auth/break-glass.http.test.ts`

**Interfaces:**
- Produces: `req.mfaBreakGlass?: true`, `req.mfaTargetUserId?: string`
- `verifyTotpLogin` accepts optional `{ breakGlass?: true; targetUserId?: string }` and returns `{ breakGlass?: true, ...sessionAsTarget }`
- `startTotpSetup` / `confirmTotpSetup` throw FORBIDDEN when called under break-glass (enforce in routes via middleware flag)

- [ ] **Step 1: Extend MFA middleware**

```ts
declare global {
  namespace Express {
    interface Request {
      mfaUserId?: string;
      mfaBreakGlass?: true;
      mfaTargetUserId?: string;
    }
  }
}

export const authenticateMfaPending: RequestHandler = async (req, _res, next) => {
  try {
    const token = mfaPendingTokenFrom(req);
    if (!token) throw new Error("Missing MFA pending token");
    const claims = await verifyMfaPendingToken(token);
    req.mfaUserId = claims.sub;
    if (claims.breakGlass && claims.targetUserId) {
      req.mfaBreakGlass = true;
      req.mfaTargetUserId = claims.targetUserId;
    }
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired MFA challenge", 401));
  }
};
```

- [ ] **Step 2: Block setup when break-glass; branch verify**

In `auth.routes.ts` setup handlers, after `authenticateMfaPending`:

```ts
if (req.mfaBreakGlass) {
  throw new AppError(
    "FORBIDDEN",
    "Break-glass challenge cannot enroll TOTP",
    403,
  );
}
```

In `two-factor.service.ts`, extend `verifyTotpLogin`:

```ts
export async function verifyTotpLogin(
  userId: string,
  code: string,
  opts: {
    rememberDevice?: boolean;
    isStaff?: boolean;
    userAgent?: string;
    breakGlass?: true;
    targetUserId?: string;
  },
) {
  // existing actor load + TOTP/backup verify against userId (actor) unchanged
  // … after code verified successfully:

  if (opts.breakGlass && opts.targetUserId) {
    const {
      mintMerchantSessionForTarget,
      firstActiveMembershipOrgId,
    } = await import("../platform/mint-merchant-session.js");
    const organizationId = await firstActiveMembershipOrgId(opts.targetUserId);
    const minted = await mintMerchantSessionForTarget({
      actorUserId: userId,
      targetUserId: opts.targetUserId,
      organizationId,
      auditAction: "auth.break_glass",
    });
    return {
      status: "authenticated" as const,
      breakGlass: true as const,
      trustedDeviceRaw: undefined,
      user: minted.user,
      organizationId: minted.organizationId,
      platformMembership: null,
      redirectTo: minted.redirectTo,
      accessToken: minted.accessToken,
      refreshToken: minted.refreshToken,
    };
  }

  // … existing resolveAccessClaims / issueSession / trusted device / auth.2fa.verified path
}
```

In verify route handler:

```ts
const result = await verifyTotpLogin(req.mfaUserId!, req.body.code, {
  rememberDevice: req.body.rememberDevice,
  userAgent: req.get("user-agent") ?? undefined,
  ...(req.mfaBreakGlass && req.mfaTargetUserId
    ? { breakGlass: true as const, targetUserId: req.mfaTargetUserId }
    : {}),
});
// … cookies …
res.json({
  status: result.status,
  user: result.user,
  organizationId: result.organizationId,
  platformMembership: result.platformMembership,
  redirectTo: result.redirectTo,
  ...(result.breakGlass ? { breakGlass: true } : {}),
  ...authTokenPayload(req, result),
});
```

Login route challenge path — pass flag through:

```ts
if (result.status !== "authenticated") {
  sendMfaChallenge(
    req,
    res,
    200,
    result,
    "breakGlass" in result && result.breakGlass ? { breakGlass: true } : {},
  );
  return;
}
```

- [ ] **Step 3: HTTP tests**

Create `tests/auth/break-glass.http.test.ts` mirroring `two-factor.http.test.ts` helpers (`bffHeaders`, `authenticator`):

1. Seed SA (TOTP on) + merchant (org membership) in `beforeAll` (or register merchant + create SA via prisma like service test).  
2. `POST /login` with merchant email + SA password + BFF headers → 200, `breakGlass: true`, `mfaPendingToken` present.  
3. `POST /2fa/setup/start` with that pending Bearer → 403.  
4. `POST /2fa/verify` with actor TOTP → 200, `accessToken` subject = merchant (decode JWT `sub`), body `breakGlass: true`.  
5. Assert audit row `auth.break_glass` exists for actor/target (query `AuditLog` if model name matches — check schema; if `writeAuditLog` uses a table named in prisma, assert `prisma.auditLog.findFirst({ where: { action: "auth.break_glass" } })`).

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/auth/break-glass.http.test.ts tests/auth/two-factor.http.test.ts tests/middleware/authenticate-mfa.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit (apis repo)**

```bash
git add src/middleware/authenticate-mfa-pending.ts src/modules/auth/two-factor.service.ts src/modules/auth/auth.routes.ts tests/auth/break-glass.http.test.ts
git commit -m "feat(auth): complete break-glass TOTP verify and block setup"
```

---

### Task 5: Portal break-glass session + banner + exit

**Files:**
- Modify: `affiliate-tool-portal/lib/auth/session.ts`
- Modify: `affiliate-tool-portal/app/api/auth/2fa/verify/route.ts`
- Modify: `affiliate-tool-portal/app/api/auth/exit-impersonation/route.ts`
- Modify: `affiliate-tool-portal/components/layout/impersonation-banner.tsx`
- Modify: `affiliate-tool-portal/app/(dashboard)/layout.tsx`

**Interfaces:**
- Produces:
  - `ImpersonationMeta = { email: string; name: string; mode?: "impersonate" | "break_glass" }`
  - `setBreakGlassImpersonationMeta(meta: ImpersonationMeta): Promise<void>` — sets meta cookie only (no staff stash)
  - `isImpersonating()` true when staff backup **or** meta cookie present
  - `clearBreakGlassSession(): Promise<void>` — clear session + meta
- Consumes: existing cookie helpers

- [ ] **Step 1: Session helpers**

Update types and helpers in `lib/auth/session.ts`:

```ts
export type ImpersonationMeta = {
  email: string;
  name: string;
  mode?: "impersonate" | "break_glass";
};

export async function setBreakGlassImpersonationMeta(meta: ImpersonationMeta) {
  const jar = await cookies();
  jar.set(
    IMPERSONATION_META_COOKIE,
    JSON.stringify({ ...meta, mode: meta.mode ?? "break_glass" }),
    { ...refreshCookieOptions(), httpOnly: false },
  );
}

export async function isImpersonating(): Promise<boolean> {
  const jar = await cookies();
  if (jar.get(STAFF_BACKUP_REFRESH_COOKIE)?.value) return true;
  return Boolean(jar.get(IMPERSONATION_META_COOKIE)?.value);
}

export async function clearBreakGlassSession() {
  await clearSessionCookies();
  const jar = await cookies();
  jar.set(IMPERSONATION_META_COOKIE, "", {
    ...clearRefreshCookieOptions(),
    httpOnly: false,
    maxAge: 0,
  });
}
```

Keep `stashStaffSessionForImpersonation` setting `mode: "impersonate"` in the meta JSON.

- [ ] **Step 2: Verify BFF sets meta on breakGlass**

In `app/api/auth/2fa/verify/route.ts`, extend `VerifyResponse` with `breakGlass?: boolean`. After `completeSession` succeeds:

```ts
if (data.breakGlass) {
  const { setBreakGlassImpersonationMeta } = await import("@/lib/auth/session");
  await setBreakGlassImpersonationMeta({
    email: data.user.email,
    name: data.user.name,
    mode: "break_glass",
  });
}
```

(Prefer static import at top.)

- [ ] **Step 3: Exit route**

```ts
import { NextResponse } from "next/server";
import {
  clearBreakGlassSession,
  restoreStaffSessionFromImpersonation,
  getImpersonationMeta,
} from "@/lib/auth/session";

export async function POST() {
  const meta = await getImpersonationMeta();
  const restored = await restoreStaffSessionFromImpersonation();
  if (restored) {
    return NextResponse.json({ redirectTo: "/backoffice/organizations" });
  }
  // Break-glass (or stale meta): drop merchant session
  if (meta?.mode === "break_glass" || meta) {
    await clearBreakGlassSession();
    return NextResponse.json({ redirectTo: "/login" });
  }
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "No staff session to restore",
      },
    },
    { status: 401 },
  );
}
```

Note: `restoreStaffSessionFromImpersonation` already clears meta — call order matters. Prefer:

```ts
export async function POST() {
  const meta = await getImpersonationMeta();
  if (meta?.mode === "break_glass") {
    await clearBreakGlassSession();
    return NextResponse.json({ redirectTo: "/login" });
  }
  const restored = await restoreStaffSessionFromImpersonation();
  if (!restored) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "No staff session to restore" } },
      { status: 401 },
    );
  }
  return NextResponse.json({ redirectTo: "/backoffice/organizations" });
}
```

- [ ] **Step 4: Banner + layout**

`impersonation-banner.tsx`:

```tsx
export function ImpersonationBanner({
  email,
  name,
  mode = "impersonate",
}: {
  email: string;
  name: string;
  mode?: "impersonate" | "break_glass";
}) {
  // … exit fetch unchanged …
  const label =
    mode === "break_glass" ? "Break-glass as" : "Viewing as";
  const exitLabel =
    mode === "break_glass" ? "Exit session" : "Exit to backoffice";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <p>
        {label} <span className="font-medium">{name}</span> ({email}). Actions
        run as this user; start is audited.
      </p>
      <Button …>{pending ? "Exiting…" : exitLabel}</Button>
    </div>
  );
}
```

Dashboard layout: pass `mode={meta.mode ?? "impersonate"}`.

- [ ] **Step 5: Typecheck portal**

```bash
npx tsc --noEmit
```

Expected: PASS (or project’s usual `npm run typecheck`).

- [ ] **Step 6: Commit (portal repo)**

```bash
git add lib/auth/session.ts app/api/auth/2fa/verify/route.ts app/api/auth/exit-impersonation/route.ts components/layout/impersonation-banner.tsx app/(dashboard)/layout.tsx
git commit -m "feat(auth): portal break-glass banner and exit to login"
```

---

### Task 6: Manual smoke + plan checkbox wrap-up

**Files:** none new

- [ ] **Step 1: Ensure SUPERADMIN has TOTP enrolled**

Login as `PLATFORM_SUPERADMIN_EMAIL` with `PLATFORM_SUPERADMIN_PASSWORD`, complete `/2fa/setup` if needed.

- [ ] **Step 2: Break-glass smoke**

1. Logout.  
2. `/login` → merchant email + **SUPERADMIN password**.  
3. Enter **SUPERADMIN** authenticator code.  
4. Land in merchant area with amber banner “Break-glass as …”.  
5. Exit → `/login`.  
6. Confirm normal merchant password login still works.  
7. Confirm backoffice Impersonate + Exit to backoffice still works.

- [ ] **Step 3: Commit plan progress note only if needed**

No code commit required. Mark all plan checkboxes `[x]` when done.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Login form target email + SA password + SA TOTP | 3, 4, 5 |
| Extend `mfa_pending` claims | 1 |
| Reuse Impersonate session mint | 2, 4 |
| Block staff targets | 2, 3 |
| First ACTIVE org membership | 2, 4 |
| Actor without TOTP → setup for actor, no break-glass | 3 |
| Setup endpoints forbidden under break-glass | 4 |
| Trusted device ignored | 4 |
| Audit `auth.break_glass` | 2, 4 |
| Banner + Exit → `/login` without staff stash | 5 |
| No master env secret / no org picker | Global constraints |
| Tests for happy path, 401, staff 403, normal login | 3, 4 |

## Placeholder / consistency check

- Token opt shape `breakGlass: true; targetUserId: string` consistent across Tasks 1–4.  
- Audit action string exactly `auth.break_glass`.  
- Portal `mode: "break_glass"` gates exit path separately from Impersonate stash.
