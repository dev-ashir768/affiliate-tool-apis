# SaaS Slice 4 — Merchant Shops UI

> **For agentic workers:** Use subagent-driven development or implement task-by-task.

**Goal:** Wire dashboard `/shops` to live Foundation shops APIs — list, connect (US/UK), verify + status polling, disconnect. Respect `shopLimit` with upgrade CTA → `/billing`.

**Architecture:** API shops endpoints already exist. Portal BFF + React Query + table/dialog UI. No API schema changes expected.

**Spec:** `docs/superpowers/specs/2026-09-17-complete-saas-design.md` § Slice 4

## Global Constraints

- Merchant shops on dashboard `/shops` only (not backoffice cross-tenant shops).
- BFF: cookies → Bearer → `/api/v1/shops/...`.
- Connect / verify / disconnect: OWNER/ADMIN only; MEMBER read-only.
- Active shop count vs `org.shopLimit`; on `PLAN_LIMIT` show upgrade link to `/billing`.
- Poll list while any shop is `VERIFYING`.

## API (existing)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/v1/shops` | org member |
| POST | `/api/v1/shops/connect` `{ region: US\|UK }` | OWNER/ADMIN |
| GET | `/api/v1/shops/:id` | org member |
| POST | `/api/v1/shops/:id/verify` | OWNER/ADMIN |
| DELETE | `/api/v1/shops/:id` | OWNER/ADMIN |

Shop statuses: `PENDING_INVITE` \| `VERIFYING` \| `ACTIVE` \| `FAILED` \| `DISCONNECTED`

## Portal files

| Path | Responsibility |
|------|----------------|
| `types/shops.ts` | Shop types |
| `validations/shop.validations.ts` | connect schema |
| `app/api/shops/route.ts` | GET list |
| `app/api/shops/connect/route.ts` | POST connect |
| `app/api/shops/[id]/route.ts` | GET + DELETE |
| `app/api/shops/[id]/verify/route.ts` | POST verify |
| `services/shops.ts` | Client → BFF |
| `hooks/use-shops.ts` | list + mutations + polling |
| `components/shops/*` | table, connect dialog, actions |
| `app/(dashboard)/shops/page.tsx` | Wire page |

## Tasks

### Task 1: BFF + types
- Types, Zod connect `{ region }`, BFF routes, error mapping like org/billing
- Commit: `feat: add shops BFF routes and types`

### Task 2: Services + hooks
- Client services; `useShops` with `refetchInterval` when VERIFYING; connect/verify/disconnect mutations
- Commit: `feat: add shops services and React Query hooks`

### Task 3: Shops page UI
- List with status badges; connect dialog (region); verify (PENDING_INVITE/FAILED); disconnect
- At limit / PLAN_LIMIT → CTA to `/billing`
- MEMBER: no connect/verify/disconnect
- Commit: `feat: wire dashboard Shops page with connect verify disconnect`

## Branch

From `feat/saas-slice-3-merchant-billing` → `feat/saas-slice-4-merchant-shops`
