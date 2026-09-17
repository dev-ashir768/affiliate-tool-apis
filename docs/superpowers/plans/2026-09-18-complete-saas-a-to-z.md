# Tiksly Complete SaaS Affiliate Product — A→Z Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tiksly as a full multi-tenant SaaS affiliate ops platform: platform backoffice + merchant dashboard, then expand into creator discovery / outreach product features.

**Architecture:** Modular Express/Prisma API (`affiliate-tool-apis`) + Next.js portal BFF (`affiliate-tool-portal`). Stripe, webhooks, bots, and verify stay backend-only. Portal never holds Stripe secrets.

**Tech Stack:** Node 20+, Express, Prisma, Postgres, Redis, BullMQ, Stripe, Next.js 16, React Query, Sonner, Zod.

## Global Constraints

- Portal calls only own `/api/*` BFF (httpOnly cookies → Bearer), never `:4000` from browser.
- Backoffice Users = platform staff; Dashboard Team = org members (never conflate).
- Stripe secrets / webhooks / price IDs = API only.
- Prefer convention-based `route-policy` over hardcoded page inventories.
- Products / Orders / Analytics stay placeholders until commerce sync is designed.
- Commit on feature branches; merge to `main` when slice is green.

---

## Phase map (where we are)

| Phase | Name | Status |
|-------|------|--------|
| **0** | Foundation API (auth, orgs, billing, shops stub) | ✅ Done |
| **1** | Platform identity + DB nav + login routing | ✅ Done |
| **2** | Merchant team + org settings | ✅ Done |
| **3** | Merchant billing UI | ✅ Done |
| **4** | Merchant shops UI | ✅ Done |
| **5** | Backoffice console (staff, orgs, shops, finance) | ✅ Done (proxies/crawler scaffold) |
| **6** | Hardening (reset, audit, finance, playwright dry-run) | ✅ Done |
| **Polish** | Auth contrast, Sonner, proxy route-policy, Stripe cancel→free | ✅ Done on `main` |
| **7** | Ops completeness (proxies, nav admin, email, crawler) | ✅ Done on `main` (crawler on branch → merge) |
| **8** | Real shop verify (Playwright / bot pipeline) | ⬜ Next |
| **9** | Growth product (creators, campaigns, outreach) | ⬜ Post-v1 |
| **10** | Scale & polish (email provider, observability, multi-region) | ⬜ Later |

---

## Phase 7 — Ops completeness (NOW)

### Files (expected)

**API**
- `prisma/schema.prisma` — `ProxyPool`, `ProxyEndpoint` (or single `Proxy`)
- `src/modules/platform/proxies.service.ts` + routes
- `src/modules/platform/crawler.service.ts` — status from Redis/BullMQ
- `src/modules/platform/navigation-admin.service.ts` — CRUD NavSection/NavItem
- `src/lib/email.ts` — provider interface + console/dev adapter
- Auth reset + invite flows call `email.send`

**Portal**
- Delete dead mock users stack (`MOCK_USERS`, `/api/users`, `UsersTable`, …)
- `components/backoffice/proxies/*` — table + add/disable
- `components/backoffice/crawler/*` — status + trigger dry-run job
- `components/backoffice/navigation/*` — SUPERADMIN nav editor
- Wire toasts on all remaining mutations

### Task 7.1: Remove dead mock users stack

- [ ] Delete portal: `lib/users/mock-data.ts`, `lib/users/query.ts`, `lib/users/query.selfcheck.ts`, `types/users.ts`, `services/users.ts`, `hooks/use-users.ts`, `app/api/users/**`, `components/backoffice/users/users-table.tsx`, `users-columns.tsx`
- [ ] Grep confirm no remaining imports
- [ ] Commit: `chore: remove unused mock backoffice users stack`

### Task 7.2: Proxy pool (real data model)

- [ ] Prisma: `Proxy` model (`id`, `label`, `host`, `port`, `protocol`, `username?`, `passwordEnc?`, `region?`, `status` AVAILABLE|IN_USE|DISABLED|BANNED, `lastCheckedAt?`, timestamps)
- [ ] Migrate + seed 0–2 placeholder proxies (optional)
- [ ] API: `GET/POST /platform/proxies`, `PATCH /platform/proxies/:id` (SUPERADMIN|OPS)
- [ ] Portal BFF + table UI + dialog create/disable
- [ ] Commit: `feat: platform proxy pool CRUD`

### Task 7.3: Crawler console (job status)

- [x] API: read BullMQ queue stats + last job; `POST /platform/crawler/run` enqueues noop/dry-run job (SUPERADMIN|OPS)
- [x] Portal: status card + “Run dry check” button + toast
- [x] Commit: `feat: platform crawler status and dry-run trigger`

### Task 7.4: Navigation admin (SUPERADMIN)

- [x] API: list all nav (both areas), create/update items
- [x] Portal: `/backoffice/navigation` editor (sections + items)
- [x] Seed nav item for Navigation (SUPERADMIN)
- [ ] Commit: `feat: backoffice navigation admin`

### Task 7.5: Email adapter

- [x] `EmailProvider` interface + console adapter
- [x] Env: `EMAIL_PROVIDER=console|resend` (+ `RESEND_API_KEY` reserved)
- [x] Wire forgot-password + org invite
- [ ] Commit: `feat: email provider abstraction`

### Task 7.6: Merge polish + Phase 7 to main

- [ ] Merge `feat/saas-polish` → `main` (portal + apis)
- [ ] Push `main`
- [ ] Open `feat/saas-slice-7-ops` from updated main for remaining Phase 7 tasks

---

## Phase 8 — Real shop verify

- [ ] Bot inbox monitoring design (IMAP or provider webhook)
- [ ] Playwright: TikTok Shop invite accept flow (region US/UK)
- [ ] Encrypted session vault write on success
- [ ] Failure taxonomy + retry in BullMQ
- [ ] Portal: live job progress (already polls shop status — extend error messages)
- [ ] Feature flag: `SHOP_VERIFY_MODE=stub|playwright`
- [ ] Commit per vertical slice; never commit secrets

---

## Phase 9 — Affiliate growth product (post SaaS ops)

Product surface for brands (the “affiliate tool” value):

1. **Creator discovery** — search/filter TikTok Shop creators (crawl index or partner API)
2. **Lists / CRM** — save creators, tags, notes, stages
3. **Campaigns** — brief, offer, target list, deadlines
4. **Outreach** — invite templates, send via bot/email, track status
5. **Attribution** — orders/commission sync (replaces Products/Orders placeholders)
6. **Analytics** — GMV, invite→accept→order funnel

Each gets its own design spec before coding. Do not invent fake commerce APIs in Phase 7–8.

---

## Phase 10 — Production readiness

- [ ] Observability: structured logs, Sentry, uptime
- [ ] Rate limits + abuse controls on auth/invite
- [ ] Backup/restore runbook
- [ ] Staging env + Stripe test mode checklist
- [ ] CI: `tsc`, vitest, playwright smoke on portal auth
- [ ] Docs: operator runbook (seed SUPERADMIN, stripe listen, worker)

---

## Role / surface reminder

| Surface | Who | Scope |
|---------|-----|--------|
| `/backoffice/*` | Platform staff | Cross-tenant |
| Dashboard | Paying orgs | Single org |
| Stripe | Backend only | Checkout + webhooks |

---

## Success criteria (complete product)

- [x] Staff vs merchant areas correct with DB menus
- [x] Merchant team, billing, shops against live APIs
- [x] Backoffice staff/orgs/shops/finance/audit
- [ ] Proxies + crawler operational (not scaffold text)
- [ ] Nav editable by SUPERADMIN
- [ ] Transactional email path (even if console in dev)
- [ ] Real shop verify path available behind flag
- [ ] Creator/outreach roadmap specs exist before Phase 9 coding
- [ ] `main` contains polish + Phase 7

---

## Execution order (agents)

1. Task 7.1 mock cleanup (portal)
2. Task 7.2 proxies (API then portal)
3. Task 7.3 crawler
4. Task 7.4 nav admin
5. Task 7.5 email
6. Task 7.6 merge main
7. Start Phase 8 design brief

**Active branch:** `feat/saas-slice-7-ops` (create from current polish HEAD if main lagging).
