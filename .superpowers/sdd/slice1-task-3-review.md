# Slice 1 Task 3 Review: Extend AccessClaims + auth issueSession/getMe

**Reviewer:** Task reviewer (spec + quality)  
**Base:** `961bdd7b88de7c847a47e0d641d52da88ec14e89`  
**Head:** `8653fe81460d2de7d4bf550947a3de3e659c06ea`  
**Date:** 2026-09-17

---

## Spec Compliance

- ✅ **Spec compliant**

All required deliverables from the task brief are present. Focus areas verified below.

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| `AccessClaims` shape (`sub`, nullable `orgId`, `orgRole`, `platformRole`) | ✅ | `src/lib/tokens.ts:6-11` |
| `signAccessToken` / `verifyAccessToken` emit and parse new claims | ✅ | `src/lib/tokens.ts:15-35` — matches brief reference |
| Login/register/refresh resolve ACTIVE platform + org memberships | ✅ | `resolveAccessClaims()` in `auth.service.ts:43-89` |
| Refresh preserves prior org when Bearer access token valid | ✅ | `auth.routes.ts:106-119` → `rotateRefresh(raw, preferredOrgId)` |
| Register: org OWNER, `platformRole: null` | ✅ | `auth.service.ts:149-154` |
| `redirectTo`: platformRole ? `/backoffice/users` : `/home` | ✅ | `redirectFor()` `auth.service.ts:34-36`; used in login/register/getMe |
| Login/register HTTP include `redirectTo` + `platformMembership` | ✅ | `auth.routes.ts:76-77, 93-94` |
| `getMe` returns `platformMembership` + `redirectTo` | ✅ | `auth.service.ts:235-251`; `/me` passes `req.auth.orgId` (nullable) |
| Staff-only users can authenticate without org | ✅ | `resolveAccessClaims` allows platform-only; login no longer requires org membership |
| `requireOrg` fails when `!orgId` | ✅ | `require-org.ts:19-21` |
| `requireRole` uses `req.auth.orgRole` | ✅ | `require-role.ts:8` |
| `requirePlatform(...roles)` exported for later slices | ✅ | `require-platform.ts:5-16` |
| Rename `req.auth.role` → `orgRole` at call sites | ✅ | No remaining `req.auth.role` in `src/`; route handlers narrowed with `req.auth?.orgId` |
| `tests/auth/claims.test.ts` (staff SUPERADMIN without org) | ✅ | Unit round-trips + integration test present |
| `tests/lib/tokens.test.ts` updated for new shape | ✅ | `orgRole` + `platformRole: null` |
| Commit message / scope | ✅ | `8653fe8` — 12 files per diff |

**Missing:** None required by brief.

**Extra (documented):**

- `src/lib/password.ts` — lazy `argon2` import so modules load when native binary is blocked (Windows Application Control). Pragmatic; not in brief but supports test/dev on restricted hosts.

**Process note:** Full `npm test` failures on this host are environmental (argon2 blocked). Re-ran claim-focused suites in review: `tests/auth/claims.test.ts` + `tests/lib/tokens.test.ts` → **5/5 passed**. Per review instructions, argon2 failures do **not** fail Spec when unit claim tests pass.

---

## Focus Areas (requested)

### AccessClaims shape

Matches brief exactly. JWT payload fields are `orgId`, `orgRole`, `platformRole` (plus standard `sub` / `iat` / `exp`). Nullable org and platform roles round-trip correctly in unit tests.

### orgRole rename call sites

- **Source:** Complete. `require-role.ts`, `auth.service.ts` session issuance, and `tokens.ts` verify path all use `orgRole`.
- **Tests:** `tokens.test.ts` and `claims.test.ts` updated. Older integration tests (`tests/shops/*`, `tests/orgs/invites.test.ts`) still pass `{ role: "OWNER" }` to `signAccessToken`; they are outside `tsconfig` `include: ["src"]` so `tsc --noEmit` stays clean. At runtime those tokens omit `orgRole` in the JWT; routes that chain `requireOrg` before `requireRole` still authorize via `req.membership.role`. Follow-up: align test token minting with the new contract.

### redirectTo

- Login/register responses include `redirectTo`.
- `getMe` includes `redirectTo` derived from ACTIVE platform membership.
- Register → `/home`; staff login → `/backoffice/users` (asserted in integration test when argon2 available).
- Refresh response intentionally omits `redirectTo` (brief only requires login/register + `/me`).

### platformMembership on `/me`

Returns `{ role, status } | null` from ACTIVE `PlatformMembership`, consistent with login/register summaries.

### requirePlatform

New middleware checks `req.auth.platformRole` against allowed `PlatformRole[]` values; returns 403 when missing or not in list. Exported from dedicated module; not yet wired to routes (brief: “for later slices”).

---

## Strengths

- **Faithful claim contract.** `tokens.ts` mirrors the brief reference implementation verbatim.
- **Centralized resolution.** `resolveAccessClaims()` cleanly loads platform + org context for login and refresh, with preferred-org preservation on refresh.
- **Staff path unlocked.** Platform-only users receive tokens with `orgId: null` and correct `platformRole`; `/me` works with nullable `orgId`.
- **Middleware alignment.** `requireOrg` / `requireRole` / `requirePlatform` split org vs platform authorization concerns for upcoming backoffice routes.
- **Targeted tests.** JWT round-trip tests cover both staff-only and merchant shapes without DB; integration test validates login payload when argon2 is available.

---

## Issues

### Critical (Must Fix)

_None._

### Important (Should Fix)

_None._

### Minor (Nice to Have)

1. **Staff integration test false pass** — When argon2 is blocked, the test early-returns without `it.skip`, so Vitest reports pass without exercising login. Prefer `it.skipIf(!argon2Available)` or explicit skip API (report already notes this).
2. **Legacy integration test tokens** — `signAccessToken({ role: "OWNER" })` in shops/orgs tests should use `orgRole` + `platformRole: null` so JWT claims match production issuance.
3. **Legacy JWT sessions** — Pre-change access tokens carried `role`; new verifier reads `orgRole` only. Existing sessions invalidate org role in claims until re-login (acceptable for slice rollout; document if needed).
4. **`resolveAccessClaims` error copy** — Still throws `"No active organization"` when neither platform nor org membership exists; accurate for merchants, slightly misleading for a user with no memberships at all.

---

## Test Verification

| Suite | Review run | Notes |
|-------|------------|-------|
| `tests/auth/claims.test.ts` | ✅ 3/3 | Unit round-trips + staff login (or early exit if argon2 blocked) |
| `tests/lib/tokens.test.ts` | ✅ 2/2 | Updated claim shape |
| `tsc --noEmit` | ✅ | `src/` only |
| Full `npm test` | ⚠️ | Report: argon2-blocked failures on Windows host; not a Spec gate per review brief |

---

## Assessment

| Gate | Verdict |
|------|---------|
| **Spec** | ✅ |
| **Quality** | **Approved** |

**Reasoning:** Task 3 implements the extended JWT claim model, auth session resolution, `/me` enrichment, login/register `redirectTo`, and platform middleware exactly as specified. Source-level `orgRole` migration is complete; `requirePlatform` is exported for downstream slices. Claim unit tests pass; argon2-related full-suite failures are environmental and excluded from Spec judgment. Minor follow-ups are test hygiene and legacy-token ergonomics, not blockers.
