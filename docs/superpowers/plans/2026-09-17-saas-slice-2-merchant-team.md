# SaaS Slice 2 — Merchant Team + Org Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire dashboard `/team` and `/settings` to live Foundation org APIs via portal BFF — members list, invite, accept-invite page, org name edit. Do **not** touch backoffice users.

**Architecture:** API orgs endpoints already exist. Portal adds BFF routes + authenticated fetch helper, team DataTable (adapt from backoffice users pattern), invite dialog, accept page, settings form.

**Tech Stack:** Next.js BFF, React Query, DataTable, Zod; Express orgs module (no API schema changes expected).

**Spec:** `docs/superpowers/specs/2026-09-17-complete-saas-design.md` § Slice 2

## Global Constraints

- Merchant team = org `Membership` on dashboard `/team` only.
- Backoffice `/backoffice/users` stays platform staff (out of scope).
- BFF pattern: cookies → Bearer → `/api/v1/orgs/...`.
- Members list API returns full array; BFF may filter/sort/page for DataTable.
- Invite roles: `ADMIN` | `MEMBER` only.
- Accept invite at `/invite/[token]` (auth layout).
- OWNER/ADMIN can invite/patch org; MEMBER read-only team.

---

## File structure (portal-focused)

| Path | Responsibility |
|------|----------------|
| `lib/api/authenticated-fetch.ts` | Server helper: getAccessToken + apiFetch |
| `app/api/orgs/current/route.ts` | GET/PATCH org |
| `app/api/orgs/current/members/route.ts` | GET members (+ list query adapter) |
| `app/api/orgs/current/invites/route.ts` | POST invite |
| `app/api/orgs/invites/[token]/accept/route.ts` | POST accept |
| `types/orgs.ts` | Org, Member, invite types |
| `services/orgs.ts` | Client → BFF |
| `hooks/use-org.ts` / `use-members.ts` | React Query |
| `components/team/*` | Table, columns, invite dialog |
| `components/settings/org-settings-form.tsx` | Patch org name + show limits |
| `app/(dashboard)/team/page.tsx` | Wire TeamTable |
| `app/(dashboard)/settings/page.tsx` | Wire org form |
| `app/(auth)/invite/[token]/page.tsx` | Accept UI |
| `validations/org.validations.ts` | Invite + patch schemas |

API repo: only if accept/list response needs tiny fix — prefer no API changes.

---

### Task 1: Authenticated BFF helper + org current GET/PATCH

**Files:**
- Create: `affiliate-tool-portal/lib/api/authenticated-fetch.ts`
- Create: `affiliate-tool-portal/types/orgs.ts`
- Create: `affiliate-tool-portal/app/api/orgs/current/route.ts`
- Create: `affiliate-tool-portal/validations/org.validations.ts`
- Test: manual or thin unit for mapper if any

**Interfaces:**
```ts
// types/orgs.ts
export type OrganizationCurrent = {
  id: string;
  name: string;
  slug: string;
  seatLimit: number;
  shopLimit: number;
  dailyInviteQuota: number;
  plan: { id: string; code: string; name: string };
  subscriptionStatus: string | null;
};

export async function authenticatedApiFetch<T>(path: string, init?: RequestInit): Promise<T>
// throws / returns NextResponse pattern used by routes
```

- [ ] **Step 1: Implement `authenticatedApiFetch`**

```ts
import { apiFetch, ApiClientError } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/session";

export async function authenticatedApiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new ApiClientError(401, "UNAUTHORIZED", "Not authenticated");
  }
  return apiFetch<T>(path, { ...init, accessToken });
}
```

- [ ] **Step 2: GET/PATCH `/api/orgs/current`**

Map ApiClientError → JSON like `/api/auth/me`. PATCH body `{ name }` via zod.

- [ ] **Step 3: Commit (portal)**

```bash
git commit -m "feat: add org current BFF with authenticated fetch helper"
```

---

### Task 2: Members list BFF + client hooks

**Files:**
- Create: `app/api/orgs/current/members/route.ts`
- Create: `services/orgs.ts`
- Create: `hooks/use-members.ts`
- Create: `hooks/use-org.ts`

**Interfaces:**
```ts
export type OrgMember = {
  id: string; // membership id
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "INVITED" | "ACTIVE" | "DISABLED";
  name: string;
  email: string;
  userId: string;
};

export type MembersListParams = {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: "name" | "email" | "role" | "status";
  sortOrder?: "asc" | "desc";
};

export type MembersListResponse = {
  data: OrgMember[];
  meta: { total: number; page: number; pageSize: number };
};
```

BFF GET:
1. `authenticatedApiFetch<{ members: Array<...> }>("/api/v1/orgs/current/members")`
2. Map nested `user` → flat OrgMember
3. Apply search/sort/page in memory (same idea as earlier adapter approach)

- [ ] **Step 1: Implement mapper + BFF**
- [ ] **Step 2: services + hooks**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add members list BFF and React Query hooks"
```

---

### Task 3: Team page DataTable + invite dialog

**Files:**
- Create: `components/team/members-columns.tsx`
- Create: `components/team/members-table.tsx`
- Create: `components/team/invite-member-dialog.tsx`
- Create: `app/api/orgs/current/invites/route.ts`
- Modify: `app/(dashboard)/team/page.tsx`

**Interfaces:**
- Invite POST `{ email, role: "ADMIN"|"MEMBER" }` → returns `{ inviteToken, membership }`
- Dialog shows copyable link: `${origin}/invite/${inviteToken}` once

- [ ] **Step 1: Invites BFF POST**
- [ ] **Step 2: Columns + table (reuse DataTable; no export required in v1)**
- [ ] **Step 3: Invite dialog; disable for MEMBER via useMe orgRole**
- [ ] **Step 4: Wire team page**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: wire dashboard Team page with members table and invites"
```

---

### Task 4: Accept invite page

**Files:**
- Create: `app/api/orgs/invites/[token]/accept/route.ts`
- Create: `app/(auth)/invite/[token]/page.tsx`
- Create: `components/invites/accept-invite-form.tsx`

**Interfaces:**
- POST body `{ password?, name? }` optional Bearer from session cookies
- Stub path: password + name required
- Existing user logged in as invitee: Bearer only

- [ ] **Step 1: BFF accept** — forward cookie access token if present
- [ ] **Step 2: Form UI under auth layout**
- [ ] **Step 3: On success → login or `/home`**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add accept-invite page and BFF"
```

---

### Task 5: Org settings form on `/settings`

**Files:**
- Create: `components/settings/org-settings-form.tsx`
- Modify: `app/(dashboard)/settings/page.tsx`

**UI:**
- Show org name (editable OWNER/ADMIN), plan code, seat/shop/daily limits, subscription status (read-only)
- PATCH name via BFF

- [ ] **Step 1: useOrg query + mutation**
- [ ] **Step 2: Form**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: wire org settings form to current organization API"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| BFF orgs/members/invites/accept | 1–4 |
| `/team` page | 3 |
| Settings org name | 5 |
| Not backoffice users | enforced |

## Execution handoff

Plan saved to `affiliate-tool-apis/docs/superpowers/plans/2026-09-17-saas-slice-2-merchant-team.md` (and portal pointer).

Execute with **subagent-driven development** (user preference).
