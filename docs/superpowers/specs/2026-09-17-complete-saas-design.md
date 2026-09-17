# Tiksly Complete SaaS — Master Design

Date: 2026-09-17  
Status: Approved for implementation planning  
Scope: Full SaaS product model (platform backoffice + merchant dashboard), APIs + portal  
Stack: Node/Express/Prisma/Postgres/Redis/BullMQ + Next.js portal BFF  

Related:
- Foundation API: `affiliate-tool-apis/docs/superpowers/specs/2026-09-15-foundation-api-design.md`
- Auth E2E portal: `affiliate-tool-portal/docs/superpowers/specs/2026-09-17-auth-e2e-design.md`

## Goal

Ship Tiksly as a proper multi-tenant SaaS:

1. **Backoffice** — platform staff who run the product (superadmin, finance, ops).
2. **Dashboard** — subscriber brands/agencies who pay for outreach tooling.
3. **DB-driven navigation** for both areas, role-filtered.
4. **One identity**, correct area after login, org-scoped merchant data, platform-scoped admin data.

Do not conflate backoffice “Users” with merchant team members.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Delivery | Master design first, then slice-by-slice implementation |
| Architecture | Extend Foundation modular monolith + portal cookie BFF |
| Platform roles | `SUPERADMIN` \| `FINANCE` \| `OPS` via `PlatformMembership` |
| Merchant org roles | `OWNER` \| `ADMIN` \| `MEMBER` (existing) |
| Identity | Same `User` table; platform vs org memberships separate |
| Menus | Postgres `NavSection` / `NavItem` + `GET /navigation/:area` |
| Login | Single `/login` → platform staff to backoffice; else dashboard `/home` |
| Merchant team UI | Dashboard (e.g. Team / Settings), **not** backoffice users |

## Product model

```
┌─────────────────────────────────────────────────────────┐
│                     User (login)                        │
└───────────────┬─────────────────────────┬───────────────┘
                │                         │
    PlatformMembership              Membership (org)
    SUPERADMIN|FINANCE|OPS          OWNER|ADMIN|MEMBER
                │                         │
                ▼                         ▼
         Backoffice UI              Dashboard UI
         (cross-tenant)             (single org)
```

| Surface | Audience | Data scope |
|---------|----------|------------|
| `/backoffice/*` | Platform staff | All organizations, shops, billing overview, proxies, crawler, nav admin |
| Dashboard (`/home`, `/shops`, `/team`, `/billing`, …) | Paying subscribers | Active organization only |

**Login routing**
1. Authenticate.
2. If active `PlatformMembership` → `/backoffice/users` (or backoffice home).
3. Else if org membership → `/home` with JWT `orgId`.
4. If both → prefer backoffice; provide “Open dashboard” later (v1 may hard-prefer backoffice).

## Data model (additions)

### PlatformMembership

- `id`, `userId` (unique active), `role` (`SUPERADMIN`|`FINANCE`|`OPS`), `status` (`ACTIVE`|`DISABLED`)
- Optional: `inviteTokenHash`, `inviteExpiresAt` for staff invites

### Navigation

- `NavArea`: `DASHBOARD` | `BACKOFFICE`
- `NavSection`: `id`, `area`, `label` (nullable), `sortOrder`
- `NavItem`: `id`, `sectionId`, `label`, `href`, `icon`, `sortOrder`, `badge?`, `enabled`
- `NavItemRoleGate` or array columns:
  - `allowedPlatformRoles` (empty = any platform staff for backoffice items; for dashboard items usually empty)
  - `allowedOrgRoles` (empty = any org member)
- Seed from current `dashboard.json` / `backoffice.json`, then adjust hrefs to new IA

### Existing (keep)

User, Organization, Membership, Plan, Subscription, Shop, BotIdentity, billing/shop verify models from Foundation.

### Explicit correction

- **Backoffice Users** = platform staff (`PlatformMembership`), not org `Membership`.
- **Dashboard Team** = org `Membership` + invites.

## JWT / session claims

Extend access token:

```ts
type AccessClaims = {
  sub: string;
  orgId: string | null;
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  platformRole: "SUPERADMIN" | "FINANCE" | "OPS" | null;
};
```

- `/auth/me` returns user, `platformMembership`, `memberships[]`, `currentOrganizationId`.
- Portal topbar: show name/email; area badge (Platform / Org name).

## API surface (target SaaS v1)

Base: `/api/v1`

### Auth (extend)

| Method | Path | Notes |
|--------|------|-------|
| existing | `/auth/*` | Issue platform + org claims |
| GET | `/auth/me` | Include platform membership |

### Navigation

| Method | Path | Notes |
|--------|------|-------|
| GET | `/navigation/:area` | `dashboard` \| `backoffice`; filter by caller roles |
| CRUD | `/platform/navigation/*` | SUPERADMIN only (slice 5+) |

### Platform (backoffice)

| Method | Path | Roles | Notes |
|--------|------|-------|-------|
| GET/POST | `/platform/staff` | SUPERADMIN | List/invite platform users |
| PATCH | `/platform/staff/:id` | SUPERADMIN | Role/status |
| GET | `/platform/organizations` | SUPERADMIN, FINANCE, OPS | Tenant list + plan/status |
| GET | `/platform/organizations/:id` | same | Detail |
| GET | `/platform/shops` | SUPERADMIN, OPS | Cross-tenant shops |
| GET | `/platform/billing/overview` | SUPERADMIN, FINANCE | MRR/subscription summary (pragmatic v1) |
| Proxies/crawler | `/platform/proxies`, `/platform/crawler` | SUPERADMIN, OPS | Scaffold list/status; full crawler later |

### Merchant (dashboard) — Foundation + UI wiring

| Domain | Endpoints | Portal home |
|--------|-----------|-------------|
| Org | `GET/PATCH /orgs/current` | Settings |
| Team | members + invites + accept | `/team` |
| Billing | plans, checkout, portal | `/billing` + success/cancel |
| Shops | connect, list, get, verify, disconnect | `/shops` |

Stripe webhook remains API-only.

## Portal IA

### Dashboard nav (seed)

- Home `/home`
- Shops `/shops`
- Team `/team`
- Billing `/billing`
- Settings `/settings`
- Products / Orders / Analytics — keep as disabled or “Coming soon” placeholders (no fake commerce APIs)

### Backoffice nav (seed)

- Staff users `/backoffice/users`
- Organizations `/backoffice/organizations`
- Shops `/backoffice/shops`
- Finance `/backoffice/finance`
- Proxies `/backoffice/proxies`
- Crawler `/backoffice/crawler`
- Navigation `/backoffice/navigation` (SUPERADMIN)

### BFF convention

```
app/api/auth/*          # exists
app/api/navigation/[area]/route.ts
app/api/orgs/**         # merchant
app/api/billing/**      # merchant
app/api/shops/**        # merchant
app/api/platform/**     # backoffice → /api/v1/platform/**
```

Client never calls `:4000` directly (except documented edge cases). Always BFF + httpOnly cookies + Bearer server-side.

### Route protection (`proxy.ts`)

- `/backoffice/*` requires `platformRole` (decode JWT or lightweight `/me` cache — prefer JWT claims in cookie-sized access token).
- Dashboard protected routes require `orgId` or org membership.
- Unauthenticated → `/login?next=…`
- Authenticated on auth pages → redirect by role rules above.

## Role matrix (v1)

| Capability | SUPERADMIN | FINANCE | OPS | Org OWNER/ADMIN | Org MEMBER |
|------------|------------|---------|-----|-----------------|------------|
| Manage platform staff | ✓ | | | | |
| Edit DB navigation | ✓ | | | | |
| View all orgs | ✓ | ✓ | ✓ | | |
| Billing overview | ✓ | ✓ | | | |
| All shops / proxies / crawler | ✓ | | ✓ | | |
| Org settings / invites | | | | ✓ | read team |
| Org billing checkout | | | | ✓ | |
| Org shops connect/verify | | | | ✓ | read |

## Build slices (implementation order)

### Slice 1 — Platform identity + DB navigation + login routing
- Prisma: `PlatformMembership`, nav tables, seed menus + SUPERADMIN
- Auth claims + `/auth/me` platform fields
- `GET /navigation/:area`
- Portal: BFF navigation; replace static JSON; proxy area guards; login redirect

### Slice 2 — Merchant Team + org settings
- BFF orgs/members/invites/accept
- Pages: `/team`, settings org name
- **Do not** map these onto backoffice users

### Slice 3 — Merchant billing UI
- Plans, checkout, portal session, `/billing/success`, `/billing/cancel`
- Show plan limits from `/orgs/current` or `/me`

### Slice 4 — Merchant shops UI
- List/connect/verify/disconnect + status polling
- Respect `shopLimit` (upgrade CTA → billing)

### Slice 5 — Backoffice platform console
- Staff users CRUD/invite
- Organizations list/detail
- Cross-tenant shops
- Finance overview
- Proxies/crawler scaffolds
- Nav admin (optional in 5a)

### Slice 6 — Hardening
- Audit logs (optional), forgot-password, richer finance metrics, Playwright shop verify

## Out of scope (explicit)

- Creator discovery, outreach blasts, influencer CRM, unified inbox (post–SaaS-v1 product roadmap)
- Separating into multiple deployable API services
- Merchant “Users” living under `/backoffice/users`

## Success criteria

- Platform staff and merchants land in the correct area with role-filtered DB menus
- Merchant can manage team, billing, and shops against live Foundation APIs
- Backoffice manages staff and sees tenants/shops/finance without seeing merchant passwords
- No static nav JSON required for production paths
- Spec and plans exist per slice before coding that slice

## Spec self-review notes

- Backoffice vs Team separation called out repeatedly to avoid prior wrong mapping
- Pagination for large tenant lists deferred to slice 5 with server-side paging requirement
- Products/Orders remain placeholders so we don’t invent fake commerce APIs
- Forgot-password deferred to slice 6 unless prioritized later
