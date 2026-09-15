# Foundation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `affiliate-tool-apis` Foundation: JWT auth, orgs/memberships, Stripe billing, and hybrid TikTok Shop connect (stub verify + Playwright scaffold).

**Architecture:** TypeScript Express modular monolith with Prisma/Postgres, Redis (refresh + BullMQ), separate `server` and `worker` entrypoints. Base path `/api/v1`.

**Tech Stack:** Node.js 20+, Express 4, TypeScript, Prisma, PostgreSQL, Redis, BullMQ, Zod, Argon2, Jose (JWT), Stripe, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-15-foundation-api-design.md`

## Global Constraints

- TypeScript strict; ESM (`"type": "module"`) with `tsx` for runtime.
- Base path `/api/v1` for app routes; Stripe webhook at `/api/v1/webhooks/stripe` with raw body.
- Error shape: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
- Passwords: Argon2id. Refresh tokens hashed (SHA-256) at rest; rotate on refresh.
- No merchant TikTok passwords. Session vault AES-256-GCM only for Playwright path.
- Default shop verify mode: `stub`. Playwright is scaffold-only (throws `NOT_IMPLEMENTED` if selected until later).
- Never commit `.env`. Use `.env.example` only.
- TDD: write failing test → run fail → implement → run pass → commit.
- Prefer Vitest unit tests for pure logic; Supertest integration for HTTP.

---

## File structure

| Path | Responsibility |
|------|----------------|
| `package.json` | Scripts: `dev`, `worker`, `build`, `test`, `prisma:*` |
| `tsconfig.json` | Strict TS config |
| `.env.example` | Documented env vars |
| `prisma/schema.prisma` | Foundation models |
| `prisma/seed.ts` | Plans + bot pool |
| `src/config/env.ts` | Zod-parsed env |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/redis.ts` | Redis client |
| `src/lib/queue.ts` | BullMQ connection + `shop-verify` queue |
| `src/lib/errors.ts` | `AppError` + codes |
| `src/lib/logger.ts` | Structured logger |
| `src/lib/crypto.ts` | Hash, vault encrypt/decrypt |
| `src/lib/password.ts` | Argon2 hash/verify |
| `src/lib/tokens.ts` | Access JWT + refresh opaque token helpers |
| `src/middleware/error-handler.ts` | Map errors → JSON |
| `src/middleware/validate.ts` | Zod body/query/params |
| `src/middleware/authenticate.ts` | Bearer access JWT |
| `src/middleware/require-org.ts` | Active membership |
| `src/middleware/require-role.ts` | OWNER/ADMIN gates |
| `src/middleware/rate-limit.ts` | Redis rate limit |
| `src/modules/auth/*` | Register/login/refresh/logout/me |
| `src/modules/orgs/*` | Current org + invites |
| `src/modules/billing/*` | Plans, checkout, portal, webhook |
| `src/modules/bots/*` | Bot reservation helpers |
| `src/modules/shops/*` | Connect/list/verify/disconnect |
| `src/workers/shop-verify.processor.ts` | Stub processor |
| `src/workers/shop-verify.playwright.scaffold.ts` | Scaffold |
| `src/app.ts` | Express app factory |
| `src/server.ts` | HTTP listen |
| `src/worker.ts` | Worker process |
| `tests/**` | Vitest unit + integration |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/config/env.ts`
- Create: `src/lib/errors.ts`
- Create: `src/lib/logger.ts`
- Create: `src/middleware/error-handler.ts`
- Create: `tests/health.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `createApp()` → Express; `GET /health` → `{ ok: true }`; `env` object from Zod

- [ ] **Step 1: Write failing health test**

```ts
// tests/health.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Init package and install deps**

```bash
cd affiliate-tool-apis
npm init -y
npm install express cors cookie-parser helmet zod dotenv
npm install -D typescript tsx vitest @types/node @types/express @types/cors @types/cookie-parser @types/supertest supertest
```

Set `"type": "module"` in `package.json` and scripts:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "worker": "tsx watch src/worker.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Add tsconfig + vitest config**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Implement env, errors, logger, error handler, app, server**

```ts
// src/config/env.ts
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  SESSION_VAULT_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(604800),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SHOP_VERIFY_MODE: z.enum(["stub", "playwright"]).default("stub"),
  INVITE_TTL_SEC: z.coerce.number().default(604800),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
```

For tests, load a `.env.test` or set defaults in vitest setup later. For Task 1 health test only, make `createApp` not require full env parse yet — use a lazy/safe parse:

```ts
// src/config/env.ts (Task 1 interim: soft defaults for missing secrets in test)
// Prefer: vitest setupFiles sets process.env before import.
```

Create `tests/setup.ts`:

```ts
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/affiliate_tool_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-32-chars-minimum!!";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-32-chars-minimum!";
process.env.SESSION_VAULT_KEY ??= "12345678901234567890123456789012";
process.env.NODE_ENV = "test";
```

Wire in `vitest.config.ts`: `setupFiles: ["tests/setup.ts"]`.

```ts
// src/lib/errors.ts
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "PLAN_LIMIT"
  | "SHOP_NOT_READY"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL"
  | "NOT_IMPLEMENTED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
```

```ts
// src/lib/logger.ts
export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", msg, ...meta })),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: "error", msg, ...meta })),
};
```

```ts
// src/middleware/error-handler.ts
import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
};
```

```ts
// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  // JSON parser for non-webhook routes (billing webhook raw body added in Task 8)
  app.use(express.json());
  app.use(errorHandler);
  return app;
}
```

```ts
// src/server.ts
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = createApp();
app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
```

```env
# .env.example
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/affiliate_tool
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=change-me-access-secret-min-32-chars
JWT_REFRESH_SECRET=change-me-refresh-secret-min-32-chars
SESSION_VAULT_KEY=0123456789abcdef0123456789abcdef
ACCESS_TOKEN_TTL_SEC=900
REFRESH_TOKEN_TTL_SEC=604800
CORS_ORIGINS=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SHOP_VERIFY_MODE=stub
INVITE_TTL_SEC=604800
```

- [ ] **Step 5: Run health test**

```bash
npm test
```

Expected: PASS `GET /health returns ok`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src tests
git commit -m "chore: scaffold Express TypeScript API with health check"
```

---

### Task 2: Prisma schema, migrate, seed

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Modify: `package.json` (prisma scripts + seed)
- Create: `src/lib/prisma.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`
- Produces: Prisma models matching spec; `prisma` singleton; seed creates Starter/Growth/Agency + 5 bots

- [ ] **Step 1: Install Prisma**

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

- [ ] **Step 2: Write schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus { ACTIVE DISABLED }
enum MembershipRole { OWNER ADMIN MEMBER }
enum MembershipStatus { INVITED ACTIVE DISABLED }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED INCOMPLETE }
enum BotStatus { AVAILABLE RESERVED ASSIGNED DISABLED }
enum ShopRegion { US UK }
enum ShopStatus { PENDING_INVITE VERIFYING ACTIVE FAILED DISCONNECTED }
enum ShopVerifyMode { STUB PLAYWRIGHT }
enum VerificationJobStatus { QUEUED RUNNING SUCCEEDED FAILED }

model User {
  id           String         @id @default(cuid())
  email        String         @unique
  passwordHash String
  name         String
  status       UserStatus     @default(ACTIVE)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  memberships  Membership[]
  refreshTokens RefreshToken[]
}

model Plan {
  id                String   @id @default(cuid())
  code              String   @unique // starter | growth | agency | free
  name              String
  monthlyPriceCents Int
  seatLimit         Int
  shopLimit         Int
  dailyInviteQuota  Int
  stripePriceId     String?
  organizations     Organization[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model Organization {
  id               String         @id @default(cuid())
  name             String
  slug             String         @unique
  planId           String
  plan             Plan           @relation(fields: [planId], references: [id])
  stripeCustomerId String?
  seatLimit        Int
  shopLimit        Int
  dailyInviteQuota Int
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  memberships      Membership[]
  subscription     Subscription?
  shops            Shop[]
}

model Membership {
  id              String           @id @default(cuid())
  userId          String
  organizationId  String
  role            MembershipRole
  status          MembershipStatus @default(ACTIVE)
  inviteTokenHash String?
  inviteExpiresAt DateTime?
  user            User             @relation(fields: [userId], references: [id])
  organization    Organization     @relation(fields: [organizationId], references: [id])
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@unique([userId, organizationId])
  @@index([inviteTokenHash])
}

model Subscription {
  id                   String             @id @default(cuid())
  organizationId       String             @unique
  organization         Organization       @relation(fields: [organizationId], references: [id])
  stripeSubscriptionId String             @unique
  status               SubscriptionStatus
  currentPeriodEnd     DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}

model RefreshToken {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  tokenHash   String    @unique
  expiresAt   DateTime
  revokedAt   DateTime?
  replacedById String?
  createdAt   DateTime  @default(now())
}

model BotIdentity {
  id              String    @id @default(cuid())
  email           String    @unique
  proxyBinding    String?
  status          BotStatus @default(AVAILABLE)
  reservedForOrgId String?
  reservedAt      DateTime?
  shop            Shop?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model Shop {
  id                     String       @id @default(cuid())
  organizationId         String
  organization           Organization @relation(fields: [organizationId], references: [id])
  region                 ShopRegion
  botIdentityId          String       @unique
  botIdentity            BotIdentity  @relation(fields: [botIdentityId], references: [id])
  externalShopId         String?
  displayName            String?
  status                 ShopStatus   @default(PENDING_INVITE)
  statusReason           String?
  sessionVaultCiphertext String?
  verifiedAt             DateTime?
  verificationJobs       ShopVerificationJob[]
  createdAt              DateTime     @default(now())
  updatedAt              DateTime     @updatedAt

  @@index([organizationId])
}

model ShopVerificationJob {
  id        String                @id @default(cuid())
  shopId    String
  shop      Shop                  @relation(fields: [shopId], references: [id])
  bullJobId String?
  mode      ShopVerifyMode
  status    VerificationJobStatus @default(QUEUED)
  attempts  Int                   @default(0)
  lastError String?
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt
}

model StripeEvent {
  id          String   @id @default(cuid())
  eventId     String   @unique
  type        String
  processedAt DateTime @default(now())
}
```

- [ ] **Step 3: Prisma client + seed**

```ts
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

```ts
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const plans = [
    {
      code: "free",
      name: "Free",
      monthlyPriceCents: 0,
      seatLimit: 1,
      shopLimit: 0,
      dailyInviteQuota: 0,
      stripePriceId: null,
    },
    {
      code: "starter",
      name: "Starter",
      monthlyPriceCents: 4900,
      seatLimit: 1,
      shopLimit: 1,
      dailyInviteQuota: 500,
      stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    },
    {
      code: "growth",
      name: "Growth",
      monthlyPriceCents: 11900,
      seatLimit: 3,
      shopLimit: 3,
      dailyInviteQuota: 1500,
      stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,
    },
    {
      code: "agency",
      name: "Agency",
      monthlyPriceCents: 24900,
      seatLimit: 5,
      shopLimit: 10,
      dailyInviteQuota: 5000,
      stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: plan,
    });
  }

  for (let i = 1; i <= 5; i++) {
    const email = `bot-s${i}@example.com`;
    await prisma.botIdentity.upsert({
      where: { email },
      create: { email, status: "AVAILABLE" },
      update: {},
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

Add to `package.json`:

```json
"prisma": { "seed": "tsx prisma/seed.ts" },
"scripts": {
  "prisma:migrate": "prisma migrate dev",
  "prisma:seed": "prisma db seed",
  "prisma:generate": "prisma generate"
}
```

- [ ] **Step 4: Migrate + seed against local/dev DB**

```bash
npx prisma migrate dev --name foundation_init
npx prisma db seed
```

Expected: migration applied; 4 plans + 5 bots.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/prisma.ts package.json package-lock.json
git commit -m "feat: add Foundation Prisma schema, migrate, and seed"
```

---

### Task 3: Crypto, password, tokens, Redis helpers

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `src/lib/password.ts`
- Create: `src/lib/tokens.ts`
- Create: `src/lib/redis.ts`
- Create: `tests/lib/password.test.ts`
- Create: `tests/lib/tokens.test.ts`

**Interfaces:**
- Consumes: `env.JWT_*`, `env.SESSION_VAULT_KEY`, `env.REDIS_URL`
- Produces:
  - `hashPassword(pw: string): Promise<string>`
  - `verifyPassword(hash: string, pw: string): Promise<boolean>`
  - `sha256(input: string): string`
  - `signAccessToken(payload: AccessClaims): Promise<string>`
  - `verifyAccessToken(token: string): Promise<AccessClaims>`
  - `generateRefreshToken(): { raw: string; hash: string }`
  - `encryptVault(plaintext: string): string` / `decryptVault(ciphertext: string): string`
  - `redis` client

```ts
export type AccessClaims = {
  sub: string; // userId
  orgId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};
```

- [ ] **Step 1: Write failing password + token tests**

```ts
// tests/lib/password.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("Secret123!");
    expect(hash).not.toContain("Secret123!");
    expect(await verifyPassword(hash, "Secret123!")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
```

```ts
// tests/lib/tokens.test.ts
import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  sha256,
} from "../../src/lib/tokens.js";

describe("tokens", () => {
  it("round-trips access JWT", async () => {
    const token = await signAccessToken({
      sub: "user1",
      orgId: "org1",
      role: "OWNER",
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("user1");
    expect(claims.orgId).toBe("org1");
    expect(claims.role).toBe("OWNER");
  });

  it("hashes refresh tokens", () => {
    const { raw, hash } = generateRefreshToken();
    expect(hash).toBe(sha256(raw));
    expect(raw).not.toBe(hash);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/lib
```

Expected: FAIL module not found / export missing.

- [ ] **Step 3: Install deps and implement**

```bash
npm install argon2 jose ioredis
```

```ts
// src/lib/password.ts
import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

```ts
// src/lib/crypto.ts
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function encryptVault(plaintext: string): string {
  const key = Buffer.from(env.SESSION_VAULT_KEY.slice(0, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptVault(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = Buffer.from(env.SESSION_VAULT_KEY.slice(0, 32));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
```

```ts
// src/lib/tokens.ts
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { sha256 } from "./crypto.js";

export type AccessClaims = {
  sub: string;
  orgId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};

const accessKey = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey());
  return {
    sub: String(payload.sub),
    orgId: String(payload.orgId),
    role: payload.role as AccessClaims["role"],
  };
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export { sha256 };
```

```ts
// src/lib/redis.ts
import Redis from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/lib
```

- [ ] **Step 5: Commit**

```bash
git add src/lib tests/lib package.json package-lock.json
git commit -m "feat: add password hashing, JWT helpers, crypto, and Redis client"
```

---

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

- [ ] **Step 2: Run — expect FAIL**

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

- [ ] **Step 4: HTTP integration test register → me → refresh**

Use Supertest against `createApp()` with real DB (or skip if DB unavailable — document that integration tests require Postgres + Redis).

- [ ] **Step 5: Run tests PASS, then commit**

```bash
npm test -- tests/auth
git add src tests
git commit -m "feat: implement JWT auth register, login, refresh, logout, me"
```

---

### Task 5: Org context middleware + orgs/members/invites

**Files:**
- Create: `src/middleware/require-org.ts`
- Create: `src/middleware/require-role.ts`
- Create: `src/modules/orgs/orgs.schemas.ts`
- Create: `src/modules/orgs/orgs.service.ts`
- Create: `src/modules/orgs/orgs.routes.ts`
- Create: `tests/orgs/invites.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `AccessClaims` on `req.auth`
- Produces:
  - `GET/PATCH /api/v1/orgs/current`
  - `GET /api/v1/orgs/current/members`
  - `POST /api/v1/orgs/current/invites` `{ email, role }`
  - `POST /api/v1/orgs/invites/:token/accept`
  - Seat limit throws `PLAN_LIMIT` (403)

- [ ] **Step 1: Failing test — inviting beyond seatLimit throws PLAN_LIMIT**

```ts
import { describe, it, expect } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { createInvite } from "../../src/modules/orgs/orgs.service.js";

// Arrange: org with seatLimit 1 and existing OWNER
// Act/Assert:
await expect(
  createInvite({
    organizationId: "...",
    actorUserId: "...",
    email: "va@test.com",
    role: "MEMBER",
  })
).rejects.toMatchObject({ code: "PLAN_LIMIT" });
```

Build arrange helpers that create org with `seatLimit: 1` via prisma in `beforeAll`.

- [ ] **Step 2: Implement createInvite / acceptInvite / listMembers / getCurrent / patchCurrent**

Rules:
- Count seats = memberships where status in `ACTIVE | INVITED`
- Invite stores `inviteTokenHash = sha256(rawToken)`, `inviteExpiresAt = now + INVITE_TTL_SEC`, status `INVITED`, creates User stub only on accept if needed — v1: invitee must already register first OR accept creates user password later. **Locked for plan:** invitee registers normally, then `accept` links membership if email matches; if no user yet, create membership row with email pending via creating User on accept requiring password body:

```ts
acceptInviteSchema = z.object({
  password: z.string().min(8).optional(), // required if user does not exist
  name: z.string().min(1).optional(),
});
```

If user exists and is authenticated as that email, activate membership. If user missing, require password+name and create user.

- [ ] **Step 3: Mount routes; run tests; commit**

```bash
git commit -m "feat: add org current endpoints and seat-limited invites"
```

---

### Task 6: Stripe billing (plans, checkout, portal, webhook)

**Files:**
- Create: `src/modules/billing/stripe.ts`
- Create: `src/modules/billing/billing.service.ts`
- Create: `src/modules/billing/billing.routes.ts`
- Create: `src/modules/billing/webhook.service.ts`
- Create: `tests/billing/webhook.service.test.ts`
- Modify: `src/app.ts` (raw body for webhook)

**Interfaces:**
- Consumes: Stripe SDK, Plan.stripePriceId, Organization.stripeCustomerId
- Produces:
  - `GET /api/v1/billing/plans`
  - `POST /api/v1/billing/checkout-session` `{ planCode }`
  - `POST /api/v1/billing/portal-session`
  - `POST /api/v1/webhooks/stripe`
  - `applySubscriptionFromStripe(event)` idempotent via `StripeEvent`

- [ ] **Step 1: Install Stripe**

```bash
npm install stripe
```

- [ ] **Step 2: Failing test — processing same event twice is idempotent**

```ts
it("ignores duplicate stripe event ids", async () => {
  const event = {
    id: `evt_test_${Date.now()}`,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test",
        status: "active",
        customer: "cus_test",
        items: { data: [{ price: { id: "price_growth" } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  // seed org with stripeCustomerId cus_test and plan stripePriceId price_growth
  await handleStripeEvent(event as any);
  await handleStripeEvent(event as any); // no throw
  const count = await prisma.stripeEvent.count({ where: { eventId: event.id } });
  expect(count).toBe(1);
});
```

- [ ] **Step 3: Implement webhook handler**

On `checkout.session.completed` / `customer.subscription.*`:
1. Insert `StripeEvent` (unique); on conflict return early
2. Resolve org by `stripeCustomerId` or `client_reference_id` / metadata `organizationId`
3. Upsert `Subscription`
4. Find `Plan` by `stripePriceId`; copy `seatLimit`, `shopLimit`, `dailyInviteQuota`, `planId` onto Organization

Checkout session creation:

```ts
await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: org.stripeCustomerId ?? undefined,
  customer_email: org.stripeCustomerId ? undefined : actorEmail,
  line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
  success_url: `${portalUrl}/billing/success`,
  cancel_url: `${portalUrl}/billing/cancel`,
  metadata: { organizationId: org.id },
  client_reference_id: org.id,
});
```

Ensure webhook route uses:

```ts
app.post(
  "/api/v1/webhooks/stripe",
  express.raw({ type: "application/json" }),
  billingWebhookHandler
);
```

Mount this **before** `express.json()`.

- [ ] **Step 4: Run tests; commit**

```bash
git commit -m "feat: add Stripe checkout, portal, and idempotent webhooks"
```

---

### Task 7: Bots + shops connect/list/disconnect

**Files:**
- Create: `src/modules/bots/bots.service.ts`
- Create: `src/modules/shops/shops.schemas.ts`
- Create: `src/modules/shops/shops.service.ts`
- Create: `src/modules/shops/shops.routes.ts`
- Create: `tests/shops/connect.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: org `shopLimit`, BotIdentity pool
- Produces:
  - `reserveBot(organizationId): BotIdentity` (transactional)
  - `connectShop({ organizationId, region })`
  - `listShops`, `getShop`, `disconnectShop`
  - Routes under `/api/v1/shops`

- [ ] **Step 1: Failing tests**

1. `connectShop` when `shopLimit` is 0 → `PLAN_LIMIT`
2. Happy path: reserves bot, shop status `PENDING_INVITE`, returns bot email
3. Second connect when limit 1 → `PLAN_LIMIT`

```ts
it("connects shop and reserves bot", async () => {
  // bump org shopLimit to 1 for test
  const shop = await connectShop({ organizationId, region: "US" });
  expect(shop.status).toBe("PENDING_INVITE");
  expect(shop.botEmail).toMatch(/@/);
});
```

- [ ] **Step 2: Implement reserveBot with `updateMany` optimistic lock**

```ts
export async function reserveBot(organizationId: string) {
  const bot = await prisma.botIdentity.findFirst({
    where: { status: "AVAILABLE" },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) throw new AppError("CONFLICT", "No bots available", 409);

  const updated = await prisma.botIdentity.updateMany({
    where: { id: bot.id, status: "AVAILABLE" },
    data: {
      status: "RESERVED",
      reservedForOrgId: organizationId,
      reservedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new AppError("CONFLICT", "Bot reservation race; retry", 409);
  }
  return prisma.botIdentity.findUniqueOrThrow({ where: { id: bot.id } });
}
```

`disconnectShop`: set shop `DISCONNECTED`, bot `AVAILABLE`, clear reservation fields.

- [ ] **Step 3: Mount routes (OWNER/ADMIN for connect/delete; member for list/get); test; commit**

```bash
git commit -m "feat: add shop connect, list, and disconnect with bot reservation"
```

---

### Task 8: Shop verify queue + stub worker + Playwright scaffold

**Files:**
- Create: `src/lib/queue.ts`
- Create: `src/modules/shops/verify.service.ts`
- Create: `src/workers/shop-verify.processor.ts`
- Create: `src/workers/shop-verify.playwright.scaffold.ts`
- Create: `src/worker.ts`
- Modify: `src/modules/shops/shops.routes.ts` (`POST /:id/verify`)
- Create: `tests/shops/verify-stub.test.ts`

**Interfaces:**
- Consumes: BullMQ, `SHOP_VERIFY_MODE`
- Produces:
  - Queue `shop-verify`
  - Job data `{ shopId, organizationId, mode, verificationJobId }`
  - Stub marks shop `ACTIVE`, bot `ASSIGNED`
  - Playwright scaffold exports `runPlaywrightVerify(job)` throwing `AppError("NOT_IMPLEMENTED", ...)`

- [ ] **Step 1: Install BullMQ**

```bash
npm install bullmq
```

- [ ] **Step 2: Failing test — stub processor activates shop**

```ts
it("stub verify marks shop ACTIVE", async () => {
  const shop = await connectShop(...);
  await enqueueAndProcessStub(shop.id); // call processor function directly in test
  const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
  expect(updated.status).toBe("ACTIVE");
  expect(updated.verifiedAt).toBeTruthy();
});
```

- [ ] **Step 3: Implement queue + processor**

```ts
// src/lib/queue.ts
import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";

export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

export const shopVerifyQueue = new Queue(SHOP_VERIFY_QUEUE, {
  connection: bullConnection(),
});
```

```ts
// src/workers/shop-verify.processor.ts
import { Worker, type Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { bullConnection, SHOP_VERIFY_QUEUE } from "../lib/queue.js";
import { runPlaywrightVerify } from "./shop-verify.playwright.scaffold.js";
import { logger } from "../lib/logger.js";

export type ShopVerifyJobData = {
  shopId: string;
  organizationId: string;
  mode: "STUB" | "PLAYWRIGHT";
  verificationJobId: string;
};

export async function processShopVerify(job: Job<ShopVerifyJobData>) {
  const { shopId, mode, verificationJobId } = job.data;
  await prisma.shopVerificationJob.update({
    where: { id: verificationJobId },
    data: { status: "RUNNING", attempts: { increment: 1 }, bullJobId: String(job.id) },
  });
  await prisma.shop.update({
    where: { id: shopId },
    data: { status: "VERIFYING" },
  });

  try {
    if (mode === "PLAYWRIGHT") {
      await runPlaywrightVerify(job.data);
    } else {
      await new Promise((r) => setTimeout(r, 200));
      await prisma.$transaction([
        prisma.shop.update({
          where: { id: shopId },
          data: {
            status: "ACTIVE",
            verifiedAt: new Date(),
            sessionVaultCiphertext: null,
            statusReason: null,
          },
        }),
        prisma.botIdentity.updateMany({
          where: { shop: { id: shopId } },
          data: { status: "ASSIGNED" },
        }),
        prisma.shopVerificationJob.update({
          where: { id: verificationJobId },
          data: { status: "SUCCEEDED" },
        }),
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: "FAILED", statusReason: message },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: { status: "FAILED", lastError: message },
    });
    throw err;
  }
}

export function startShopVerifyWorker() {
  const worker = new Worker(SHOP_VERIFY_QUEUE, processShopVerify, {
    connection: bullConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) =>
    logger.error("shop-verify failed", { jobId: job?.id, err: err.message })
  );
  return worker;
}
```

```ts
// src/workers/shop-verify.playwright.scaffold.ts
import { AppError } from "../lib/errors.js";
import type { ShopVerifyJobData } from "./shop-verify.processor.js";

/** Scaffold only — real Playwright inbox/accept/login comes later. */
export async function runPlaywrightVerify(_data: ShopVerifyJobData): Promise<void> {
  throw new AppError(
    "NOT_IMPLEMENTED",
    "Playwright shop verify is scaffolded but not implemented",
    501
  );
}
```

```ts
// src/worker.ts
import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { logger } from "./lib/logger.js";

startShopVerifyWorker();
logger.info("worker started");
```

`requestVerify(shopId)`:
- Reject unless status `PENDING_INVITE` or `FAILED` (`SHOP_NOT_READY` otherwise)
- Create `ShopVerificationJob` QUEUED with mode from env
- Enqueue BullMQ job
- Return `{ verificationJobId, status: "VERIFYING" }` after setting shop VERIFYING (or let worker set it — keep consistent with processor)

- [ ] **Step 4: Run tests; commit**

```bash
git commit -m "feat: add shop-verify BullMQ worker with stub and Playwright scaffold"
```

---

### Task 9: Rate limits, README, smoke script

**Files:**
- Create: `src/middleware/rate-limit.ts`
- Modify: auth + verify routes to use rate limit
- Create: `README.md`
- Create: `scripts/smoke-foundation.ts`
- Create: `tests/smoke/foundation.http.test.ts` (optional gated)

**Interfaces:**
- Consumes: redis
- Produces: rate limit on `/api/v1/auth/*` and `POST /shops/:id/verify`; README with run instructions; smoke script covering register → (optional webhook mock) → connect → stub verify

- [ ] **Step 1: Implement Redis sliding window rate limit (e.g. 20 req / 60s for auth)**

```ts
export function rateLimit({ key, limit, windowSec }: {
  key: (req: Request) => string;
  limit: number;
  windowSec: number;
}): RequestHandler
```

- [ ] **Step 2: Write README**

Cover: copy `.env.example`, Postgres/Redis, `prisma migrate`, `seed`, `npm run dev`, `npm run worker`, Stripe CLI webhook forward, portal CORS.

- [ ] **Step 3: Smoke script**

```ts
// scripts/smoke-foundation.ts
// 1. POST /api/v1/auth/register
// 2. Manually upsert org shopLimit=1 (or call billing webhook helper)
// 3. POST /api/v1/shops/connect
// 4. POST /api/v1/shops/:id/verify
// 5. Poll GET until ACTIVE (worker must be running)
```

- [ ] **Step 4: Commit**

```bash
git add src README.md scripts
git commit -m "docs: add Foundation README, rate limits, and smoke script"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Modular Express + worker entry | 1, 8 |
| Prisma models + seed plans/bots | 2 |
| JWT access + refresh rotate/revoke | 3, 4 |
| Register creates org + OWNER | 4 |
| Orgs current + invites + seat limit | 5 |
| Stripe checkout/portal/webhooks | 6 |
| Shop connect bot allocate | 7 |
| Hybrid stub verify + Playwright scaffold | 8 |
| Rate limits + security env | 3, 9 |
| Error envelope | 1 |
| Testing bar unit + integration | 3–8 |

## Placeholder / consistency review

- Invite accept rule locked in Task 5 (register-or-create on accept).
- Bot update uses `shop: { id }` relation filter — if Prisma version rejects, use `botIdentityId` from shop row instead (implementer: load shop first).
- `env` requires secrets even for health — Task 1 setupFiles covers tests.
- Free plan `shopLimit: 0` forces billing or test quota bump before connect — smoke script documents this.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-15-foundation-api.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach?
