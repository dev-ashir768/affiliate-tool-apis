# Task 2 Review: Prisma schema, migrate, seed

**Reviewer:** Task reviewer (spec + quality)  
**Base:** `0a69daef16c3cb96982fda2df280da962967a884`  
**Head:** `b8148740fd8135a2d2903d48e18f7138e3095e11`  
**Date:** 2026-09-15

---

## Spec Compliance

- ✅ **Spec compliant**

All required deliverables from the task brief are present in the diff. Schema, seed, client singleton, package scripts, and migration artifacts match the Foundation design.

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| `prisma/schema.prisma` with PostgreSQL + `DATABASE_URL` | ✅ | `prisma/schema.prisma:6-9` |
| All 9 enums with correct values | ✅ | `prisma/schema.prisma:11-66` |
| All 10 Foundation models (User, Plan, Organization, Membership, Subscription, RefreshToken, BotIdentity, Shop, ShopVerificationJob, StripeEvent) | ✅ | `prisma/schema.prisma:68-200` |
| Relations, defaults, unique constraints, indexes per brief | ✅ | e.g. `@@unique([userId, organizationId])`, `@@index([inviteTokenHash])`, `@@index([organizationId])` |
| `src/lib/prisma.ts` singleton | ✅ | `src/lib/prisma.ts:1-3` |
| `prisma/seed.ts` — 4 plans + 5 bots | ✅ | `prisma/seed.ts:4-58` |
| `package.json` prisma scripts + seed config | ✅ | `package.json:18-24` |
| `@prisma/client` dep + `prisma` devDep | ✅ | `package.json:29,43` |
| Initial migration committed | ✅ | `prisma/migrations/20250915175200_foundation_init/migration.sql` |
| Commit scope and message per brief | ✅ | 7 files; `feat: add Foundation Prisma schema, migrate, and seed` |
| Global: TypeScript ESM | ✅ | `"type": "module"`; seed uses ESM imports |
| Global: never commit `.env` | ✅ | `.env` absent from diff |
| Global: models match Foundation design | ✅ | Field-for-field match with brief schema |

**Missing:** None.

**Extra:** None beyond Prisma dependency tree in `package-lock.json`.

**Process deviation (outcome met):** Brief Step 4 specifies `prisma migrate dev --name foundation_init`. Implementer used `migrate diff` + manual migration folder + `migrate deploy` due to remote Postgres shadow-DB permission (P3014). Migration SQL is present, applied, and consistent with schema; seed reported successful (4 plans, 5 bots). Deliverable outcome matches brief expectation; command path differs.

- ⚠️ **Cannot verify from diff alone:** `migrate deploy`, `generate`, and `db seed` success claims are in `task-2-report.md`. Migration SQL and seed logic are consistent with schema; controller may spot-check with `npx prisma migrate deploy && npx prisma db seed` if desired.

---

## Workaround Assessment (DONE_WITH_CONCERNS)

| Workaround | Verdict | Rationale |
|------------|---------|-----------|
| **Enum multi-line formatting** | ✅ Acceptable | Brief inline enum syntax is invalid Prisma PSL. Multi-line blocks are required; enum values unchanged. Not a defect. |
| **Prisma 6.19.3 pin (not 8 RC)** | ✅ Acceptable | Prisma 8 RC breaks brief commands (`migrate dev`, classic generator). Sensible choice; brief did not pin a version. Minor: prefer exact `"6.19.3"` over `"^6.19.3"` for lockstep client/cli. |
| **`migrate diff` + `deploy` instead of `migrate dev`** | ⚠️ Acceptable for task gate; **Important** for ongoing ops | Produces valid migration history and applied schema. Equivalent outcome for this initial migration. However, `prisma:migrate` still runs `migrate dev`, which will fail on the current remote host without shadow DB or `SHADOW_DATABASE_URL`. Document alternate workflow or add `prisma:deploy` script. |

---

## Strengths

- **Faithful schema.** `prisma/schema.prisma` matches the brief’s models, fields, relations, defaults, and indexes without drift.
- **Migration DDL aligns with schema.** `migration.sql` creates all enums, tables, indexes, and FKs expected from the datamodel.
- **Seed matches brief exactly.** Plan codes/prices/limits and bot emails `bot-s1..5@example.com` with upsert idempotency.
- **Clean commit scope.** Only Prisma-related files; no `.env`, no Prisma 8 artifact dirs.
- **Package wiring correct.** `prisma.seed` uses `tsx`; scripts `prisma:migrate`, `prisma:seed`, `prisma:generate` added as specified.
- **ESM-compatible.** Seed and client import paths work with `"type": "module"`.

---

## Issues

### Critical (Must Fix)

_None._

### Important (Should Fix)

1. **Migration dev workflow mismatch** — `package.json:18` exposes `prisma:migrate` as `prisma migrate dev`, but the implementer’s environment (and likely CI/shared remote Postgres) cannot run `migrate dev` without shadow DB permissions. Future schema changes need either: (a) `SHADOW_DATABASE_URL` / `CREATE DATABASE` grant, (b) a documented `migrate diff` + `migrate deploy` runbook, or (c) a `prisma:deploy` script for non-local targets. Without this, the next migration task will hit the same P3014 wall.

### Minor (Nice to Have)

1. **`src/lib/prisma.ts`** — Bare `new PrismaClient()` can spawn multiple instances under `tsx watch` hot reload, exhausting DB connections. Brief specifies this shape; consider a `globalThis` singleton guard when dev ergonomics matter.
2. **`package.json:29,43`** — Caret ranges (`^6.19.3`) allow minor drift between `@prisma/client` and `prisma` CLI. Pin exact matching versions for reproducible builds.
3. **`.env.example`** — Seed optionally reads `STRIPE_PRICE_STARTER|GROWTH|AGENCY`; documenting these (commented) would help operators without affecting seed defaults (`null`).
4. **`prisma/seed.ts`** — Instantiates its own `PrismaClient` rather than importing `src/lib/prisma.ts`. Matches brief; acceptable duplication for seed isolation.

---

## Assessment

**Spec:** ✅  
**Task quality:** Approved

**Reasoning:** The diff delivers the full Foundation Prisma layer as specified — schema, migration, seed, client singleton, and package scripts — with no missing models, enums, or seed data. The three reported workarounds are either required corrections (enum syntax) or environment-driven process adaptations that still produce correct artifacts. One Important operational item remains: align migration scripts/docs with the shadow-DB constraint so the next schema change is not blocked. No Critical defects; task gate passes.

---

## Re-review R2 (post Important fix)

**Reviewer:** Task reviewer (spec + quality)  
**Base:** `0a69daef16c3cb96982fda2df280da962967a884`  
**Head:** `ece35fe28f981f6dec564630724910df210ec10a`  
**Fix commit:** `ece35fe` — `fix: use prisma migrate deploy for prisma:migrate script`  
**Date:** 2026-09-15

### Important Finding — Fixed ✅

| Prior finding | Fix | Verdict |
|---------------|-----|---------|
| `prisma:migrate` ran `migrate dev`, which fails on remote Postgres without shadow DB (P3014) | `prisma:migrate` → `prisma migrate deploy`; added `prisma:migrate:dev` → `prisma migrate dev` for local/shadow-capable DBs | ✅ Resolved |

**Evidence:** `package.json:18-19` — primary apply path uses `deploy` (no shadow DB); dev workflow preserved under separate script. Report confirms `npm run prisma:migrate` exit 0.

### Spec Compliance (R2)

- ✅ **Spec compliant**

All R1 deliverables unchanged and correct. Fix is scoped to `package.json` scripts only (+2/−1 lines in fix commit).

| Requirement | R1 | R2 |
|-------------|----|----|
| Schema, seed, client, migration, deps | ✅ | ✅ (unchanged) |
| `prisma:seed`, `prisma:generate`, seed config | ✅ | ✅ |
| `prisma:migrate` script | ✅ (`migrate dev`, matched brief literal) | ⚠️ **Intentional deviation:** now `migrate deploy` per shadow-DB constraint; brief’s `migrate dev` preserved as `prisma:migrate:dev` |

**Note:** Brief literal specifies `"prisma:migrate": "prisma migrate dev"`. R2 inverts primary vs dev scripts to match the environment used in Task 2. Outcome and operability improve; dev path is not lost. Treat as documented process adaptation, not a missing deliverable.

### Issues (R2)

| Severity | Count | Detail |
|----------|-------|--------|
| Critical | 0 | — |
| Important | 0 | Prior Important item resolved |
| Minor | 4 | Unchanged from R1 (PrismaClient hot-reload, version pin, `.env.example` stripe vars, seed client duplication) |

### Verdict (R2)

**Spec:** ✅  
**Task quality:** Approved

**Reasoning:** The Important operational blocker from R1 is fully addressed — `npm run prisma:migrate` applies migrations via `deploy` on the remote host without shadow DB, while `prisma:migrate:dev` retains the brief’s dev workflow for local use. No new Critical or Important issues introduced. Minor R1 items remain optional follow-ups.
