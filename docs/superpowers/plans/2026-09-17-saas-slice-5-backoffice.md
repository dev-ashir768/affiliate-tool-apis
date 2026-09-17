# SaaS Slice 5 — Backoffice Platform Console

**Goal:** Platform API + portal backoffice for staff, orgs, cross-tenant shops, finance overview, proxies/crawler scaffolds. Nav admin deferred (optional 5a).

**Spec:** § Slice 5

## API (`/api/v1/platform`)

| Endpoint | Roles |
|----------|-------|
| GET/POST `/staff` | SUPERADMIN |
| PATCH `/staff/:id` | SUPERADMIN |
| GET `/organizations` | SUPERADMIN, FINANCE, OPS |
| GET `/organizations/:id` | same |
| GET `/shops` | SUPERADMIN, OPS |
| GET `/billing/overview` | SUPERADMIN, FINANCE |
| GET `/proxies` | SUPERADMIN, OPS | scaffold |
| GET `/crawler` | SUPERADMIN, OPS | scaffold |

Staff create: `{ email, name, role, password }` → User + PlatformMembership.
Staff patch: `{ role?, status? }` on membership id.

Orgs/shops: server-side page/search/sort.

Finance overview (pragmatic): org counts by plan, subscription status counts, approximate MRR from active paid plans.

## Portal

- BFF `app/api/platform/**`
- Replace mock `/backoffice/users` with live staff
- Wire organizations list + detail, shops, finance
- Proxies/crawler scaffold pages

## Branch

`feat/saas-slice-5-backoffice` from Slice 4.
