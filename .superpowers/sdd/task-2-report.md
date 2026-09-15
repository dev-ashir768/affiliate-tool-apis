# Task 2 Report: Prisma schema, migrate, seed

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/foundation-api`  
**Base:** `0a69daef16c3cb96982fda2df280da962967a884`  
**Commit:** `b8148740fd8135a2d2903d48e18f7138e3095e11`

## Summary

Implemented Foundation Prisma schema with all models/enums from the brief, created initial migration, applied it to the remote PostgreSQL database, seeded 4 plans and 5 bot identities, and added `src/lib/prisma.ts` singleton.

## Files Created/Modified

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Created — all models, enums, relations per spec |
| `prisma/seed.ts` | Created — upserts 4 plans + 5 bots |
| `prisma/migrations/20250915175200_foundation_init/migration.sql` | Created — initial DDL |
| `prisma/migrations/migration_lock.toml` | Created |
| `src/lib/prisma.ts` | Created — PrismaClient singleton |
| `package.json` | Modified — prisma deps, scripts, seed config |
| `package-lock.json` | Modified |

## Migrate & Seed Results

| Step | Result |
|------|--------|
| `prisma migrate deploy` | ✅ Applied `20250915175200_foundation_init` |
| `prisma generate` | ✅ Client v6.19.3 generated |
| `prisma db seed` | ✅ Completed without error |
| Verification | ✅ 4 plans, 5 bots in DB |

## Deviations & Workarounds

### 1. Prisma version (6.19.3, not 7/8)

`npx prisma init` initially installed Prisma 8 RC with a new CLI (`migration` vs `migrate`). Downgraded to **Prisma 6.19.3** for compatibility with brief commands (`prisma migrate dev`, `prisma db seed`) and classic `prisma-client-js` generator.

### 2. Enum formatting

Brief's inline enum syntax (`enum UserStatus { ACTIVE DISABLED }`) is invalid Prisma PSL. Reformatted to multi-line blocks with identical values. All models/fields/relations unchanged.

### 3. Shadow database permission (P3014)

`prisma migrate dev --name foundation_init` failed: remote Postgres user lacks `CREATE DATABASE` for shadow DB.

**Workaround used:**
1. `prisma migrate diff --from-empty --to-schema-datamodel` → generated SQL
2. Created `prisma/migrations/20250915175200_foundation_init/migration.sql` manually
3. `prisma migrate deploy` — applied successfully (no shadow DB required)

Migration history is tracked in `_prisma_migrations`; equivalent outcome to `migrate dev`.

### 4. Local `.env` — `DATABASE_URL` missing

`.env` contained `DB_URL` only (not `DATABASE_URL`). Added `DATABASE_URL` locally (same value, **not committed**). App `env.ts` requires `DATABASE_URL`.

### 5. Artifacts not committed

Prisma 8 init created `.cursor/skills`, `.agents/`, `.claude/`, `.devin/` — left untracked per brief commit scope.

## Self-Review

- [x] All 11 models present with correct fields and relations
- [x] All 9 enums with correct values
- [x] Indexes: `Membership.inviteTokenHash`, `Shop.organizationId`, unique constraints
- [x] Seed values match brief exactly (plan codes/prices/limits, bot emails `bot-s1..5@example.com`)
- [x] `src/lib/prisma.ts` exports singleton as specified
- [x] Package scripts: `prisma:migrate`, `prisma:seed`, `prisma:generate`
- [x] `.env` not committed; `.gitignore` unchanged
- [x] Commit message matches brief

## Concerns for Follow-up

1. **Remote DB without shadow DB:** Future `prisma migrate dev` will fail on this host. Options: grant CREATE DATABASE, provide `SHADOW_DATABASE_URL`, or continue `migrate diff` + `deploy` workflow.
2. **`.env` naming:** Standardize on `DATABASE_URL` (remove duplicate `DB_URL` or alias in docs).
3. **Prisma version pin:** Consider pinning exact versions in brief to avoid Prisma 8 RC install surprises.

## Commands for Reproduction

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

Expected seed output: 4 plans (free, starter, growth, agency), 5 bots (bot-s1..5@example.com).

## Post-Review Fix (migrate script)

**Finding:** `prisma:migrate` pointed at `prisma migrate dev`, which fails on remote Postgres without shadow DB (P3014).

**Change:** Updated `package.json` scripts so day-to-day apply uses deploy; dev workflow kept separately:
- `prisma:migrate` → `prisma migrate deploy`
- `prisma:migrate:dev` → `prisma migrate dev` (local/shadow-capable DBs only)

**Verification:** `npm run prisma:migrate` — all migrations already applied, exit 0.
