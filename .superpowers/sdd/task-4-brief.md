### Task 4: Auth service + routes (register/login/refresh/logout/me)

**Files:**
- Create: `src/modules/auth/auth.schemas.ts`
- Create: `src/modules/auth/auth.service.ts`
- Create: `src/modules/auth/auth.routes.ts`
- Create: `src/modules/auth/refresh-store.ts`
- Create: `src/middleware/validate.ts`
- Create: `src/middleware/authenticate.ts`
- Modify: `src/app.ts`
- Create: `tests/auth/auth.service.test.ts`
- Create: `tests/auth/auth.http.test.ts`

**Interfaces:**
- Consumes: prisma, password, tokens, redis, Plan `free`
- Produces:
  - `register({ email, password, name, organizationName })`
  - `login({ email, password })`
  - `rotateRefresh(rawRefresh)`
  - `revokeRefresh(rawRefresh)`
  - Routes under `/api/v1/auth/*`
  - Cookie name: `refresh_token`

- [ ] **Step 1: Write failing auth service test (register creates owner + free plan org)**

```ts
// tests/auth/auth.service.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { register, login } from "../../src/modules/auth/auth.service.js";

describe("auth.service", () => {
  const email = `owner_${Date.now()}@test.com`;

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.membership.deleteMany({ where: { user: { email } } });
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email } } } },
    });
    await prisma.user.deleteMany({ where: { email } });
  });

  it("registers user with OWNER membership on free plan", async () => {
    const result = await register({
      email,
      password: "Secret123!",
      name: "Ashir",
      organizationName: "Tiksly Test",
    });
    expect(result.user.email).toBe(email);
    expect(result.organization.slug).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const membership = await prisma.membership.findFirst({
      where: { user: { email } },
    });
    expect(membership?.role).toBe("OWNER");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("logs in with same credentials", async () => {
    const result = await login({ email, password: "Secret123!" });
    expect(result.accessToken).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run â€” expect FAIL**

```bash
npm test -- tests/auth/auth.service.test.ts
```

- [ ] **Step 3: Implement auth module**

```ts
// src/middleware/validate.ts
import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}
```

```ts
// src/modules/auth/auth.schemas.ts
import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  organizationName: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
```

```ts
// src/modules/auth/refresh-store.ts
import { redis } from "../../lib/redis.js";
import { env } from "../../config/env.js";

export async function mirrorRefresh(hash: string, ttlSec: number) {
  await redis.set(`refresh:${hash}`, "1", "EX", ttlSec);
}

export async function revokeRefreshMirror(hash: string) {
  await redis.del(`refresh:${hash}`);
}

export async function isRefreshMirrored(hash: string) {
  return (await redis.exists(`refresh:${hash}`)) === 1;
}

export function refreshTtl() {
  return env.REFRESH_TOKEN_TTL_SEC;
}
```

```ts
// src/modules/auth/auth.service.ts
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  signAccessToken,
  type AccessClaims,
} from "../../lib/tokens.js";
import { sha256 } from "../../lib/crypto.js";
import {
  mirrorRefresh,
  revokeRefreshMirror,
  isRefreshMirrored,
  refreshTtl,
} from "./refresh-store.js";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

async function issueSession(claims: AccessClaims) {
  const accessToken = await signAccessToken(claims);
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtl() * 1000);
  await prisma.refreshToken.create({
    data: { userId: claims.sub, tokenHash: hash, expiresAt },
  });
  await mirrorRefresh(hash, refreshTtl());
  return { accessToken, refreshToken: raw };
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}) {
  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("CONFLICT", "Email already registered", 409);

  const free = await prisma.plan.findUnique({ where: { code: "free" } });
  if (!free) throw new AppError("INTERNAL", "Free plan missing", 500);

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name: input.name },
    });
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: slugify(input.organizationName),
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    return { user, organization };
  });

  const session = await issueSession({
    sub: result.user.id,
    orgId: result.organization.id,
    role: "OWNER",
  });

  return {
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
    ...session,
  };
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AppError("FORBIDDEN", "No active organization", 403);

  const session = await issueSession({
    sub: user.id,
    orgId: membership.organizationId,
    role: membership.role,
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: membership.organizationId,
    ...session,
  };
}

export async function rotateRefresh(raw: string) {
  const hash = sha256(raw);
  if (!(await isRefreshMirrored(hash))) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: stored.userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AppError("FORBIDDEN", "No active organization", 403);

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  await revokeRefreshMirror(hash);

  return issueSession({
    sub: stored.userId,
    orgId: membership.organizationId,
    role: membership.role,
  });
}

export async function revokeRefresh(raw: string) {
  const hash = sha256(raw);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (stored && !stored.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
  }
  await revokeRefreshMirror(hash);
}

export async function getMe(userId: string, orgId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: { include: { plan: true, subscription: true } } },
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    currentOrganizationId: orgId,
    memberships: memberships.map((m) => ({
      role: m.role,
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        planCode: m.organization.plan.code,
        seatLimit: m.organization.seatLimit,
        shopLimit: m.organization.shopLimit,
        subscriptionStatus: m.organization.subscription?.status ?? null,
      },
    })),
  };
}
```

Wire routes with cookie `refresh_token` (httpOnly, sameSite=lax, secure in production), mount at `/api/v1/auth`, and `authenticate` middleware using `verifyAccessToken`.

- [ ] **Step 4: HTTP integration test register â†’ me â†’ refresh**

Use Supertest against `createApp()` with real DB (or skip if DB unavailable â€” document that integration tests require Postgres + Redis).

- [ ] **Step 5: Run tests PASS, then commit**

```bash
npm test -- tests/auth
git add src tests
git commit -m "feat: implement JWT auth register, login, refresh, logout, me"
```

---


