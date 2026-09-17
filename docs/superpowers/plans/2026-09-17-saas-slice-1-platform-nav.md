# SaaS Slice 1 — Platform Identity, DB Navigation & Login Routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform staff memberships (`SUPERADMIN`|`FINANCE`|`OPS`), Postgres-backed role-filtered navigation, extended JWT/`/auth/me` claims, and portal login + menu + route guards so staff land in backoffice and merchants in dashboard.

**Architecture:** Extend Foundation API (Prisma + Express). Portal keeps cookie BFF; replace static nav JSON with `GET /api/navigation/:area`. Do **not** implement merchant team, billing UI, shops UI, or backoffice CRUD in this slice.

**Tech Stack:** Prisma, Express, Vitest, Next.js 16 (`proxy.ts`), React Query.

**Spec:** `docs/superpowers/specs/2026-09-17-complete-saas-design.md` (Slice 1 only)

## Global Constraints

- Platform roles: `SUPERADMIN` | `FINANCE` | `OPS` via `PlatformMembership` only.
- Backoffice Users ≠ org members (do not rewire `/backoffice/users` to org Membership in this slice).
- Menus from DB; `GET /api/v1/navigation/:area` filtered by caller roles.
- One `/login`: platform staff → `/backoffice/users`; else → `/home` (honor `?next=` only if allowed for that role).
- AccessClaims become `{ sub, orgId: string | null, orgRole, platformRole }`.
- Portal BFF never calls API without Bearer when route requires auth.
- TDD for API claim/nav filter logic; portal smoke via manual or thin tests.
- Work in both repos: `affiliate-tool-apis` and `affiliate-tool-portal`.

---

## File structure

### affiliate-tool-apis

| Path | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | PlatformMembership + Nav enums/models |
| `prisma/migrations/*` | Migration SQL |
| `prisma/seed.ts` | Plans/bots + SUPERADMIN + nav seed |
| `src/config/env.ts` | `PLATFORM_SUPERADMIN_EMAIL`, `PLATFORM_SUPERADMIN_PASSWORD` |
| `src/lib/tokens.ts` | New AccessClaims shape |
| `src/middleware/authenticate.ts` | Attach extended claims |
| `src/middleware/require-platform.ts` | Require platformRole |
| `src/modules/auth/auth.service.ts` | Issue claims including platform; getMe extended |
| `src/modules/navigation/*` | getNavigation(area, claims) |
| `src/app.ts` | Mount `/api/v1/navigation` |
| `tests/auth/claims.test.ts` | Claim issuance |
| `tests/navigation/navigation.test.ts` | Role filtering |

### affiliate-tool-portal

| Path | Responsibility |
|------|----------------|
| `types/auth.ts` | Extend MeResponse with platformMembership |
| `types/navigation.ts` | Keep NavResponse shape compatible |
| `app/api/navigation/[area]/route.ts` | BFF → API |
| `app/api/auth/login/route.ts` | Return `redirectTo` hint from me/claims |
| `services/navigation.ts` | Client fetch BFF |
| `hooks/use-navigation.ts` | Use BFF not static JSON |
| `components/auth/login-form.tsx` | Redirect by `redirectTo` |
| `proxy.ts` | Guard backoffice vs dashboard by JWT claims |
| `lib/auth/jwt-client.ts` or decode in proxy | Decode access JWT payload (no verify secret in edge if Node proxy — proxy is Node in Next 16) |

---

### Task 1: Prisma PlatformMembership + Nav models + migrate

**Files:**
- Modify: `affiliate-tool-apis/prisma/schema.prisma`
- Create: migration via deploy-compatible workflow
- Modify: `affiliate-tool-apis/src/config/env.ts`
- Modify: `affiliate-tool-apis/.env.example`

**Interfaces:**
- Produces: models ready for seed; env keys for bootstrap superadmin

- [ ] **Step 1: Add enums + models to schema**

```prisma
enum PlatformRole {
  SUPERADMIN
  FINANCE
  OPS
}

enum PlatformMembershipStatus {
  ACTIVE
  DISABLED
}

enum NavArea {
  DASHBOARD
  BACKOFFICE
}

model PlatformMembership {
  id        String                    @id @default(cuid())
  userId    String                    @unique
  user      User                      @relation(fields: [userId], references: [id])
  role      PlatformRole
  status    PlatformMembershipStatus  @default(ACTIVE)
  createdAt DateTime                  @default(now())
  updatedAt DateTime                  @updatedAt
}

model NavSection {
  id        String   @id @default(cuid())
  area      NavArea
  key       String
  label     String?
  sortOrder Int      @default(0)
  items     NavItem[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([area, key])
}

model NavItem {
  id                    String     @id @default(cuid())
  sectionId             String
  section               NavSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  key                   String
  label                 String
  href                  String
  icon                  String
  sortOrder             Int        @default(0)
  badge                 String?
  enabled               Boolean    @default(true)
  allowedPlatformRoles  PlatformRole[]
  allowedOrgRoles       MembershipRole[]
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt

  @@unique([sectionId, key])
}
```

Also add on `User`:
```prisma
platformMembership PlatformMembership?
```

- [ ] **Step 2: Add env keys**

```ts
PLATFORM_SUPERADMIN_EMAIL: z.string().email().optional(),
PLATFORM_SUPERADMIN_PASSWORD: z.string().min(8).optional(),
```

Document in `.env.example`.

- [ ] **Step 3: Migrate**

```bash
cd affiliate-tool-apis
# Prefer migrate diff + deploy if shadow DB unavailable (same as Foundation)
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/mig.sql
# Or create folder prisma/migrations/YYYYMMDDHHMMSS_platform_nav/migration.sql manually then:
npm run prisma:migrate
npx prisma generate
```

Expected: migrate succeeds; client generates.

- [ ] **Step 4: Commit (apis)**

```bash
git add prisma src/config/env.ts .env.example
git commit -m "feat: add PlatformMembership and navigation Prisma models"
```

---

### Task 2: Seed SUPERADMIN + navigation menus

**Files:**
- Modify: `affiliate-tool-apis/prisma/seed.ts`
- Test: run seed + query counts

**Interfaces:**
- Consumes: PlatformMembership, NavSection, NavItem
- Produces: seeded dashboard + backoffice menus (Slice 1 IA); one SUPERADMIN if env set

- [ ] **Step 1: Extend seed with nav upserts**

Dashboard section `main` items (enabled):
- home `/home` Home
- shops `/shops` Store (new IA — page can stay stub)
- team `/team` Users
- billing `/billing` CreditCard (or Wallet)
- settings `/settings` Settings  
Products/Orders/Analytics: `enabled: false` OR omit (prefer omit for clean nav)

Backoffice section `main`:
- users `/backoffice/users` Users — `allowedPlatformRoles: [SUPERADMIN, FINANCE, OPS]`
- organizations `/backoffice/organizations` Building2 — all platform roles
- shops `/backoffice/shops` Store — SUPERADMIN, OPS
- finance `/backoffice/finance` BadgeDollarSign — SUPERADMIN, FINANCE
- proxies `/backoffice/proxies` Globe — SUPERADMIN, OPS
- crawler `/backoffice/crawler` Bot — SUPERADMIN, OPS

Empty `allowedPlatformRoles` / `allowedOrgRoles` arrays mean “any authenticated caller allowed for that area” after area gate (dashboard requires org membership; backoffice requires platform membership) — **filter rule locked in Task 4**.

- [ ] **Step 2: Seed SUPERADMIN user**

If `PLATFORM_SUPERADMIN_EMAIL` + `PASSWORD` set:
- upsert User
- upsert PlatformMembership SUPERADMIN ACTIVE
- Do **not** create org for staff-only unless they also register as merchant

- [ ] **Step 3: Run seed**

```bash
npm run prisma:seed
```

Expected: nav sections/items present; superadmin exists when env set.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: seed platform SUPERADMIN and DB navigation menus"
```

---

### Task 3: Extend AccessClaims + auth issueSession/getMe

**Files:**
- Modify: `affiliate-tool-apis/src/lib/tokens.ts`
- Modify: `affiliate-tool-apis/src/modules/auth/auth.service.ts`
- Modify: any middleware using `req.auth.role` → `req.auth.orgRole`
- Create: `affiliate-tool-apis/tests/auth/claims.test.ts`

**Interfaces:**
- Produces:

```ts
export type AccessClaims = {
  sub: string;
  orgId: string | null;
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  platformRole: "SUPERADMIN" | "FINANCE" | "OPS" | null;
};
```

- `getMe` returns:
```ts
{
  user: {...},
  currentOrganizationId: string | null,
  platformMembership: { role, status } | null,
  memberships: [...existing shape...],
  redirectTo: string  // "/backoffice/users" | "/home"
}
```

- [ ] **Step 1: Failing test — staff login claims include platformRole**

```ts
it("issues platformRole for SUPERADMIN without requiring org", async () => {
  // arrange: user with PlatformMembership only
  const session = await login({ email: staffEmail, password });
  const claims = await verifyAccessToken(session.accessToken);
  expect(claims.platformRole).toBe("SUPERADMIN");
  expect(claims.orgId).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/auth/claims.test.ts
```

- [ ] **Step 3: Update tokens.ts**

```ts
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    orgRole: claims.orgRole,
    platformRole: claims.platformRole,
  })
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
    orgId: payload.orgId == null ? null : String(payload.orgId),
    orgRole: (payload.orgRole as AccessClaims["orgRole"]) ?? null,
    platformRole: (payload.platformRole as AccessClaims["platformRole"]) ?? null,
  };
}
```

- [ ] **Step 4: Update issueSession helpers in auth.service**

On login/register/refresh:
1. Load `platformMembership` where ACTIVE
2. Load first ACTIVE org membership (or keep existing org from prior token on refresh when still valid)
3. Set claims accordingly
4. Register still creates org OWNER (unchanged) with `platformRole: null`
5. `redirectTo`: platformRole ? `/backoffice/users` : `/home`

Update `authenticate` / `requireOrg` / `requireRole`:
- `requireOrg` fails if `!orgId`
- `requireRole` uses `orgRole`
- Add `requirePlatform(...roles)` for later slices (export now)

Fix all compile breakages from renaming `role` → `orgRole`.

- [ ] **Step 5: Tests pass + commit**

```bash
npm test
git commit -m "feat: extend JWT and /me with platformRole and redirectTo"
```

Also return `redirectTo` from login/register HTTP responses (not only me).

---

### Task 4: Navigation API module

**Files:**
- Create: `affiliate-tool-apis/src/modules/navigation/navigation.service.ts`
- Create: `affiliate-tool-apis/src/modules/navigation/navigation.routes.ts`
- Modify: `affiliate-tool-apis/src/app.ts`
- Create: `affiliate-tool-apis/tests/navigation/navigation.test.ts`

**Interfaces:**
- `getNavigation(area: "dashboard"|"backoffice", claims: AccessClaims): Promise<NavResponse>`
- Response shape matches portal `NavResponse` (area, brand, sections[])

**Filter rules:**
1. Caller must be authenticated.
2. `area=backoffice` requires `platformRole != null`; else 403 FORBIDDEN.
3. `area=dashboard` requires `orgId != null` (or any ACTIVE org membership); else 403.
4. Item included if `enabled` and:
   - if `allowedPlatformRoles.length > 0` → claims.platformRole must be in list
   - if `allowedOrgRoles.length > 0` → claims.orgRole must be in list
   - empty arrays → no extra filter beyond area gate

Brand:
- dashboard: `{ name: "Tiksly", href: "/home" }`
- backoffice: `{ name: "Tiksly Backoffice", href: "/backoffice/users" }`

- [ ] **Step 1: Failing tests**

```ts
it("hides finance nav from OPS", async () => { ... });
it("forbids dashboard nav without org", async () => { ... });
it("allows SUPERADMIN all backoffice items", async () => { ... });
```

- [ ] **Step 2: Implement service + `GET /api/v1/navigation/:area`**

Mount with `authenticate` middleware.

- [ ] **Step 3: Pass tests + commit**

```bash
git commit -m "feat: add role-filtered GET /navigation/:area"
```

---

### Task 5: Portal BFF navigation + useNavigation

**Files:**
- Create: `affiliate-tool-portal/app/api/navigation/[area]/route.ts`
- Create: `affiliate-tool-portal/services/navigation.ts`
- Modify: `affiliate-tool-portal/hooks/use-navigation.ts`
- Modify: `affiliate-tool-portal/types/auth.ts` (platformMembership, redirectTo)

**Interfaces:**
- BFF reads access token; `apiFetch(/api/v1/navigation/${area}, { accessToken })`
- Hook fetches `/api/navigation/${area}` with credentials

- [ ] **Step 1: Implement BFF route**

```ts
export async function GET(_req: Request, ctx: { params: Promise<{ area: string }> }) {
  const { area } = await ctx.params;
  if (area !== "dashboard" && area !== "backoffice") {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid area" } }, { status: 400 });
  }
  const accessToken = await getAccessToken();
  if (!accessToken) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  try {
    const data = await apiFetch(`/api/v1/navigation/${area}`, { accessToken });
    return NextResponse.json(data);
  } catch (err) { /* ApiClientError mapping like /me */ }
}
```

- [ ] **Step 2: Point useNavigation at BFF**

```ts
async function fetchNavigation(area: NavArea): Promise<NavResponse> {
  const res = await fetch(`/api/navigation/${area}`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't load navigation");
  return res.json();
}
```

Keep static JSON files as fallback only if you must — **preferred: remove usage entirely** (files may remain unused).

- [ ] **Step 3: Manual check** — logged-in merchant loads dashboard shell without error.

- [ ] **Step 4: Commit (portal)**

```bash
git commit -m "feat: load navigation from API BFF instead of static JSON"
```

---

### Task 6: Login redirectTo + proxy area guards

**Files:**
- Modify: `affiliate-tool-portal/app/api/auth/login/route.ts` (pass through `redirectTo`)
- Modify: `affiliate-tool-portal/app/api/auth/register/route.ts` (redirectTo `/home`)
- Modify: `affiliate-tool-portal/components/auth/login-form.tsx`
- Modify: `affiliate-tool-portal/components/auth/signup-form.tsx`
- Modify: `affiliate-tool-portal/proxy.ts`
- Create: `affiliate-tool-portal/lib/auth/access-token.ts` — decode JWT payload (base64) for `platformRole`/`orgId` without verify in proxy OR verify with shared secret via `JWT_ACCESS_SECRET` in portal env

**Interfaces:**
- Login JSON includes `redirectTo`
- Login form: `const next = searchParams.get("next");` if next allowed for role use it; else `payload.redirectTo`
- Allowed: staff may only `next` under `/backoffice`; merchants only non-backoffice

**proxy.ts rules:**
- `/backoffice/*` → require `platformRole` in access token (refresh if needed); else redirect `/login` or `/home` if merchant-only
- Dashboard protected paths → require `orgId` OR (merchant session); if staff-only (platformRole && !orgId) hitting `/home` → redirect `/backoffice/users`
- Auth pages: if session → redirect using same rules as login

- [ ] **Step 1: Add `JWT_ACCESS_SECRET` to portal `.env.example`** (same value as API) for optional verify; or decode-only for routing (document trust boundary: httpOnly cookie set only by BFF).

Preferred: decode payload without verify for routing UX; API still verifies on every call. Cookie theft risk unchanged.

```ts
export function readAccessClaims(token: string): {
  orgId: string | null;
  platformRole: string | null;
} | null
```

- [ ] **Step 2: Update login/register forms + BFF responses**

- [ ] **Step 3: Update proxy.ts** with area checks after token present/refresh

- [ ] **Step 4: Manual E2E**
  1. Login SUPERADMIN → `/backoffice/users`, backoffice nav from API
  2. Login merchant → `/home`, dashboard nav from API
  3. Merchant cannot open `/backoffice/users` (redirect)
  4. Staff-only cannot open `/home` (redirect to backoffice)

- [ ] **Step 5: Commit (portal)**

```bash
git commit -m "feat: role-based login redirect and proxy area guards"
```

---

### Task 7: Stub pages for new nav hrefs (portal only)

**Files:**
- Create stub pages if missing: `app/(dashboard)/shops/page.tsx`, `team/page.tsx`, `billing/page.tsx`
- Create: `app/(backoffice)/backoffice/organizations/page.tsx`, `finance/page.tsx`
- Update existing stubs copy: “Coming in SaaS slice N”

Avoid 404s from new seed hrefs.

- [ ] **Step 1: Add minimal placeholder pages** matching AppShell layouts
- [ ] **Step 2: Commit**

```bash
git commit -m "chore: add placeholder pages for Slice 1 navigation hrefs"
```

---

## Spec coverage (Slice 1)

| Spec item | Task |
|-----------|------|
| PlatformMembership SUPERADMIN/FINANCE/OPS | 1–2 |
| NavSection/NavItem + seed | 1–2 |
| JWT platformRole + orgRole + nullable orgId | 3 |
| GET /navigation/:area filtered | 4 |
| Portal menus from API | 5 |
| Login redirect staff vs merchant | 6 |
| proxy area guards | 6 |
| New IA hrefs don’t 404 | 7 |

**Deferred to later slices:** merchant team/billing/shops UI, platform staff CRUD, nav admin CRUD, finance overview APIs.

## Placeholder / consistency review

- AccessClaims rename `role`→`orgRole` will touch requireRole call sites — Task 3 owns full compile fix.
- Seed icons must exist in portal `nav-icon` map — use icons already mapped (Users, Store, Home, Settings, Globe, Bot); for finance use `BadgeDollarSign` or `Wallet` — **add to nav-icon map if missing**.
- Superadmin seed requires env in local `.env` (not committed).

---

## Execution handoff

Plan complete and saved to `affiliate-tool-apis/docs/superpowers/plans/2026-09-17-saas-slice-1-platform-nav.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
