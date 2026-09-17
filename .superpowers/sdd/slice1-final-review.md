# SaaS Slice 1 — Final Whole-Branch Review

**Date:** 2026-09-17
**Reviewer:** review subagent (read-only)
**Spec:** `docs/superpowers/specs/2026-09-17-complete-saas-design.md` (Slice 1 only)
**Plan:** `docs/superpowers/plans/2026-09-17-saas-slice-1-platform-nav.md`

## Ranges reviewed

| Repo | Branch | Range | Commits |
|------|--------|-------|---------|
| `affiliate-tool-apis` | `feat/saas-slice-1-platform-nav` | `63eef27..HEAD` | 4 (`2445980`, `961bdd7`, `8653fe8`, `10ac0bb`) |
| `affiliate-tool-portal` | `feat/saas-slice-1-platform-nav` | `5834854..HEAD` | 3 (`bb86fb7`, `682fd15`, `82d17cf`) |

Diff size (excluding `.superpowers/`, `docs/`, `graphify-out/`): APIs 21 files / +894 −48; Portal 16 files / +345 −33.

## Verification performed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (apis) | clean |
| `npx tsc --noEmit` (portal) | clean |
| `npx vitest run tests/navigation tests/auth/claims tests/lib/tokens` | 3 files / 8 tests passed |
| `npm test` (apis, full) | 6 passed / 6 failed / 1 skipped file — **all 6 failures are the argon2 native-module block** (`argon2.glibc.node` blocked by Windows Application Control), environmental, not code |
| `npx prisma migrate status` | 3 migrations found, "Database schema is up to date" (`20250917220000_platform_nav` applied) |
| Nav row/seed inspection | not performed (live DB read declined); seed logic verified by code review only |

## Merge readiness

**Not ready as-is.** One guard gap must be closed first (Critical 1, a ~6-line change in `proxy.ts`), and the portal branch has uncommitted work (`components/layout/app-topbar.tsx`) that needs to be committed or reverted before merge.

Everything else in the slice is implemented, matches the plan's locked decisions, typechecks in both repos, and the Slice 1 tests pass. Spec Slice 1 scope (`PlatformMembership`, nav tables + seed, claims + `/auth/me` platform fields, `GET /navigation/:area`, portal BFF nav replacing static JSON, proxy area guards, login redirect) is fully covered, and no later-slice work leaked in.

---

## Critical

### C1 — New dashboard routes `/shops`, `/team`, `/billing` have no session or area guard

`app/(dashboard)/shops`, `/team`, and `/billing` were added in Task 7 and are seeded as dashboard nav hrefs in Task 2, but `proxy.ts` never runs on them: they are absent from both `DASHBOARD_PREFIXES` (lines 16–22) and `config.matcher` (bottom of file). `app/(dashboard)/layout.tsx` only renders `AppShell` and performs no auth check, so nothing else compensates.

Consequences:

1. An unauthenticated visitor hitting `/shops` renders the dashboard shell instead of being redirected to `/login?next=/shops`. (No data leaks today — the pages are placeholders and `useNavigation`/`useMe` 401 into the shell's error state — but the guard is silently absent for any content added in Slices 2–4, which is exactly where `/team`, `/billing`, and `/shops` get their real implementations.)
2. A staff-only session (`platformRole` set, `orgId` null) can sit on `/shops`/`/team`/`/billing` instead of being bounced to `/backoffice/users`. This contradicts the plan's locked rule "Dashboard protected paths → require `orgId`; if staff-only hitting dashboard → redirect `/backoffice/users`", which `enforceAreaAccess` implements correctly but never gets a chance to apply.

Fix: add `"/shops"`, `"/team"`, `"/billing"` to `DASHBOARD_PREFIXES`, and add both `"/x"` and `"/x/:path*"` entries for each to `config.matcher`.

---

## Important

### I1 — `?next=` open redirect via backslash

`resolvePostAuthRedirect` in `lib/auth/access-token.ts` rejects `next` values that do not start with `/` and those starting with `//`, but not backslash forms. `/login?next=/\evil.com` passes the check, and browsers normalize `/\` to `//` for special schemes, so `router.replace("/\\evil.com")` resolves to `https://evil.com` — an external redirect immediately after successful login (phishing-friendly).

This is a pre-existing pattern (the old `login-form.tsx` had the same `next.startsWith("/")` test), but this branch introduced the shared helper that now owns the decision, so it is the natural place to close it. Fix: require the second character to be neither `/` nor `\`, e.g. `if (!/^\/(?![/\\])/.test(next)) return fallback;`, and reject any `next` containing `\`.

### I2 — Task 3's core TDD assertion silently self-skips instead of reporting skipped

`tests/auth/claims.test.ts` wraps its imports plus an `await hashPassword("probe")` probe in a `try/catch`; on argon2 failure it sets `argon2Available = false`, `console.warn`s, and `return`s. Vitest counts that as a **pass**. In this environment the argon2 block means "issues platformRole for SUPERADMIN without requiring org" — the one test that actually exercises `resolveAccessClaims` end-to-end for staff-only login — asserts nothing while reporting green. The same trap will hide a genuine regression in CI if argon2 ever fails to load there.

Fix: take the Vitest test context and call `ctx.skip()` (or use `it.skipIf(...)` with an eagerly computed availability flag) so the suite reports *skipped*, not *passed*.

The underlying argon2 block itself is environmental and non-blocking, as expected: all 6 full-suite failures (`tests/lib/password.test.ts`, `tests/auth/auth.service.test.ts` ×3, `tests/auth/auth.http.test.ts` ×2) trace to `An Application Control policy has blocked this file … argon2.glibc.node`, and two of them are cascades from the first register failing. The lazy `await import("argon2")` refactor in `src/lib/password.ts` is a correct and well-scoped accommodation — it keeps the native module out of the import graph for tests that do not hash. No JWT-secret problems surfaced; `signAccessToken`/`verifyAccessToken` round-trip cleanly in `tests/lib/tokens.test.ts` and `tests/auth/claims.test.ts`.

### I3 — Seed overwrites an existing user's password and name; escape-hatch env var is undocumented

Two issues in `prisma/seed.ts` `seedSuperadmin()`:

1. `prisma.user.upsert({ ..., update: { passwordHash, name: "Platform Superadmin" } })` means re-running `npm run prisma:seed` **resets the password and renames** whatever user already holds `PLATFORM_SUPERADMIN_EMAIL`. If that email ever belongs to a real merchant account, seeding silently takes it over. Prefer `update: {}` (or only update when the user has no `platformMembership`), so the seed bootstraps but never clobbers.
2. `PLATFORM_SUPERADMIN_PASSWORD_HASH` is read from `process.env` but appears in neither `.env.example` nor `src/config/env.ts`. It is the documented workaround for the argon2 block (the warning message names it), so leaving it undiscoverable defeats its purpose. Add it to `.env.example` alongside the two keys that were added.

### I4 — Portal branch has uncommitted work that belongs to this slice

`components/layout/app-topbar.tsx` is modified but not committed. The change replaces the org-role subtitle (`me.memberships.find(...)?.role ?? me.memberships[0]?.role ?? "…"`) with `me.user.email`, and clears the `["auth","me"]` query cache on logout. That is precisely what staff-only sessions need — they have no `memberships`, so the current committed code renders `"…"` in the account menu for every platform staff user. Either commit it as part of Slice 1 or revert it deliberately; merging the branch as-is loses the fix. (`graphify-out/` churn is generated output and can be ignored.)

---

## Notes (non-blocking, no action required for merge)

- **Decode-only claims in the proxy** — `readAccessClaims` parses the JWT payload without verifying the signature, so a forged `access_token` cookie can render the backoffice *shell*. Every data path still goes through the BFF to the API, which verifies signatures, so no data is reachable. This trust boundary was explicitly chosen in the plan and is documented in the file header; the constraint it implies is that backoffice pages must never render sensitive data without an API round-trip.
- **Platform role staleness** — `getNavigation` and `requirePlatform` gate on `claims.platformRole` from the JWT without re-reading `PlatformMembership.status`. Setting a membership to `DISABLED` therefore takes effect only at the next refresh (≤900 s, since `resolveAccessClaims` re-resolves from the DB on rotate). Fine for Slice 1; revisit when Slice 5 adds staff CRUD, because that is where an admin will expect "disable" to be immediate.
- **`/api/users` is unauthenticated** — the portal BFF at `app/api/users/route.ts` serves `MOCK_USERS` with no token check, so `/backoffice/users` page content is not actually protected server-side. Pre-existing and out of Slice 1 scope (spec defers backoffice CRUD to Slice 5), but it is the staff landing page, so it should be closed when it starts serving real data.
- **Nav/`me` BFF do not refresh on expiry** — both return 401 when the access cookie is gone rather than rotating via the refresh cookie, so a tab idle past 900 s shows the shell's nav error until a navigation triggers the proxy's rotation. `app/api/navigation/[area]/route.ts` mirrors `app/api/auth/me/route.ts` exactly, which is what the plan asked for, so this is a pre-existing pattern rather than a new defect.
- **Authed users on auth pages ignore `?next=`** — `redirectAuthedAwayFromAuth` always uses `defaultRedirectForClaims`, so an already-logged-in user hitting `/login?next=/settings` lands on `/home` instead of `/settings`. Minor UX inconsistency with the login-form path, which does honor `next`.
- **`requirePlatform` is exported but unmounted** — intentional per Task 3 Step 4 ("export now" for later slices).
- **`resolveAccessClaims` error copy** — a user with neither a platform membership nor an org membership gets `FORBIDDEN "No active organization"`, which is now slightly misleading for the staff case. Cosmetic.
- **Migration folder timestamp** — `20250917220000_platform_nav` uses year 2025 while today is 2026-09-17, but it matches the existing `20250915*` folders, so lexical ordering is correct and Prisma reports the schema up to date. No action.
- **Static nav JSON left in place** — `public/data/navigation/{dashboard,backoffice}.json` remain but have no code references (only historical spec/plan docs mention them). The plan explicitly allowed this ("files may remain unused").

---

## Spec/plan coverage

| Spec item (Slice 1) | Where | Verdict |
|---|---|---|
| `PlatformMembership` SUPERADMIN/FINANCE/OPS | `prisma/schema.prisma`, `migrations/20250917220000_platform_nav` | Matches plan exactly; `userId @unique` + FK; migration applied |
| `NavSection`/`NavItem` + seed | `prisma/schema.prisma`, `prisma/seed.ts` | All 5 dashboard + 6 backoffice items with the exact roles the plan specified; disabled Products/Orders/Analytics omitted as preferred; icons `CreditCard`/`Building2`/`BadgeDollarSign` added to the portal `nav-icon` map |
| JWT `platformRole` + `orgRole` + nullable `orgId` | `src/lib/tokens.ts` | Matches plan verbatim; all `role` → `orgRole` call sites fixed (`require-role`, `require-org`, orgs/shops/billing routes now guard on `req.auth?.orgId`) |
| `/auth/me` + login/register return `platformMembership` and `redirectTo` | `src/modules/auth/auth.service.ts`, `auth.routes.ts` | Complete; `redirectFor` is the single source of the `/backoffice/users` vs `/home` decision |
| Refresh preserves prior org | `auth.routes.ts` → `rotateRefresh(raw, preferredOrgId)` | Correct: prior access token is *verified* (not decoded) before its `orgId` is trusted, falling back to first ACTIVE membership when expired — matches "keep existing org from prior token when still valid" |
| `GET /api/v1/navigation/:area` role-filtered | `src/modules/navigation/*` | All 4 filter rules implemented as locked; brand strings exact; empty sections dropped; response type is field-for-field identical to portal `types/navigation.ts` |
| Portal menus from API | `app/api/navigation/[area]/route.ts`, `services/navigation.ts`, `hooks/use-navigation.ts` | Static JSON fetch fully removed; BFF error mapping mirrors `/me` |
| Login redirect staff vs merchant | `login-form.tsx`, `signup-form.tsx`, `lib/auth/access-token.ts` | Role-scoped `next` rules correct (staff only under `/backoffice`, merchants only outside it) except for the backslash bypass in I1 |
| proxy area guards | `proxy.ts` | Logic correct, including refresh-then-guard ordering and cookie clearing on failure — but not applied to the three new routes (C1) |
| New IA hrefs don't 404 | `app/(dashboard)/{shops,team,billing}`, `app/(backoffice)/backoffice/{organizations,finance}` | All 5 stubs present with "Coming in a later SaaS slice" copy; every seeded href resolves |
| Deferred work stayed out | — | No merchant team/billing/shops UI, no staff CRUD, no nav admin CRUD, no finance APIs; `/backoffice/users` was not rewired to org `Membership` |
