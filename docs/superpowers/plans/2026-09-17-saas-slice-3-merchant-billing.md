# SaaS Slice 3 — Merchant Billing UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire dashboard `/billing` to live Foundation billing APIs via portal BFF — plans list, Stripe checkout, customer portal, success/cancel pages. Show current plan limits from org context.

**Architecture:** API billing endpoints already exist (`GET /plans`, `POST /checkout-session`, `POST /portal-session`). Portal adds BFF routes, React Query hooks, billing page UI. Stripe webhook stays API-only.

**Tech Stack:** Next.js BFF, React Query, shadcn Card/Button, Zod; Express billing module (no API changes expected).

**Spec:** `docs/superpowers/specs/2026-09-17-complete-saas-design.md` § Slice 3

## Global Constraints

- Merchant billing on dashboard `/billing` only (not backoffice finance overview).
- BFF pattern: cookies → Bearer → `/api/v1/billing/...`.
- `GET /plans` is public on API; BFF proxies without auth.
- Checkout + portal require OWNER/ADMIN (match API `requireRole`).
- MEMBER sees read-only plan/limits.
- Success/cancel URLs already configured in API to portal `/billing/success` and `/billing/cancel`.

---

## File structure (portal-focused)

| Path | Responsibility |
|------|----------------|
| `types/billing.ts` | Plan, session response types |
| `validations/billing.validations.ts` | checkout body schema |
| `app/api/billing/plans/route.ts` | GET plans |
| `app/api/billing/checkout-session/route.ts` | POST checkout |
| `app/api/billing/portal-session/route.ts` | POST portal |
| `services/billing.ts` | Client → BFF |
| `hooks/use-billing-plans.ts` | React Query plans |
| `hooks/use-billing-actions.ts` | checkout + portal mutations |
| `components/billing/*` | Page content, plan cards |
| `app/(dashboard)/billing/page.tsx` | Wire billing UI |
| `app/(dashboard)/billing/success/page.tsx` | Post-checkout |
| `app/(dashboard)/billing/cancel/page.tsx` | Checkout cancelled |

API repo: no changes expected unless response shape mismatch.

---

### Task 1: Billing BFF + types

- [ ] `types/billing.ts`, `validations/billing.validations.ts`
- [ ] BFF GET `/api/billing/plans` → `/api/v1/billing/plans` (no auth)
- [ ] BFF POST checkout + portal via `authenticatedApiFetch`
- [ ] Commit: `feat: add billing BFF routes and types`

### Task 2: Services + hooks

- [ ] `services/billing.ts`, `use-billing-plans.ts`, `use-billing-actions.ts`
- [ ] Commit: `feat: add billing services and React Query hooks`

### Task 3: Billing page UI

- [ ] Current plan card (from `useOrg`) + plan grid (from plans)
- [ ] OWNER/ADMIN: upgrade checkout + manage subscription portal
- [ ] MEMBER: read-only
- [ ] Commit: `feat: wire dashboard Billing page with plans and Stripe actions`

### Task 4: Success/cancel pages

- [ ] `/billing/success`, `/billing/cancel` under dashboard layout
- [ ] Commit: `feat: add billing success and cancel pages`

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Plans, checkout, portal | 1–3 |
| `/billing/success`, `/billing/cancel` | 4 |
| Plan limits from org | 3 |

## Execution handoff

Branch from `feat/saas-slice-2-merchant-team` (reuses `useOrg`, `authenticatedApiFetch`).

Execute with **subagent-driven development**.
