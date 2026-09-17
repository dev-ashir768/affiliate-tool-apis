# SaaS Slice 1 — Final Review Fix Report

**Date:** 2026-09-17  
**Branches:** `feat/saas-slice-1-platform-nav` (portal + apis)  
**Source:** Critical + Important findings in `slice1-final-review.md`

## Status

**Done.** Critical C1 and Important I1–I4 addressed; commits landed separately in each repo.

## Commits

| Repo | Commit | Summary |
|------|--------|---------|
| `affiliate-tool-portal` | `9e23d4a` | Proxy guards + safe `next=` + staff topbar subtitle |
| `affiliate-tool-apis` | _(this commit)_ | Claims skip, seed non-clobber, `PLATFORM_SUPERADMIN_PASSWORD_HASH` docs |

## What was fixed

### Critical

1. **C1 — Dashboard routes unguarded** (`affiliate-tool-portal/proxy.ts`)
   - Added `/shops`, `/team`, `/billing` to `DASHBOARD_PREFIXES`.
   - Added `/shops`, `/shops/:path*`, `/team`, `/team/:path*`, `/billing`, `/billing/:path*` to `config.matcher`.
   - Unauthenticated and staff-only sessions now hit the same auth/area guards as `/home` and `/settings`.

### Important

2. **I1 — Open redirect via `?next=`** (`lib/auth/access-token.ts`)
   - `resolvePostAuthRedirect` only accepts paths matching `^/[a-zA-Z0-9/_-]*$`.
   - Rejects `\`, `//`, `/\`, and any non-relative or otherwise unsafe path (same rule applied to `redirectTo` fallback).

3. **I2 — False-pass when argon2 blocked** (`tests/auth/claims.test.ts`)
   - On argon2 probe failure, calls `ctx.skip()` instead of bare `return`, so Vitest reports **skipped**, not passed.

4. **I3 — Seed clobber + undocumented hash env**
   - `prisma/seed.ts` SUPERADMIN upsert uses `update: {}` so re-seed does not overwrite `passwordHash` / `name`.
   - Documented optional `PLATFORM_SUPERADMIN_PASSWORD_HASH` in `.env.example` and `src/config/env.ts`.

5. **I4 — Uncommitted topbar fix** (`components/layout/app-topbar.tsx`)
   - Committed: subtitle uses `me.user.email` (works for staff with no org memberships); logout clears `["auth","me"]` query cache.

## Out of scope (unchanged)

- Non-blocking notes from the final review (decode-only proxy claims, nav BFF refresh, etc.).
- `.superpowers/` briefs, graphify churn, and other dirty SDD artifacts were not included in these commits.
