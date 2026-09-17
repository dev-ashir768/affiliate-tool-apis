### Task 6: Login redirectTo + proxy area guards

**Files:**
- Modify: `affiliate-tool-portal/app/api/auth/login/route.ts` (pass through `redirectTo`)
- Modify: `affiliate-tool-portal/app/api/auth/register/route.ts` (redirectTo `/home`)
- Modify: `affiliate-tool-portal/components/auth/login-form.tsx`
- Modify: `affiliate-tool-portal/components/auth/signup-form.tsx`
- Modify: `affiliate-tool-portal/proxy.ts`
- Create: `affiliate-tool-portal/lib/auth/access-token.ts` â€” decode JWT payload (base64) for `platformRole`/`orgId` without verify in proxy OR verify with shared secret via `JWT_ACCESS_SECRET` in portal env

**Interfaces:**
- Login JSON includes `redirectTo`
- Login form: `const next = searchParams.get("next");` if next allowed for role use it; else `payload.redirectTo`
- Allowed: staff may only `next` under `/backoffice`; merchants only non-backoffice

**proxy.ts rules:**
- `/backoffice/*` â†’ require `platformRole` in access token (refresh if needed); else redirect `/login` or `/home` if merchant-only
- Dashboard protected paths â†’ require `orgId` OR (merchant session); if staff-only (platformRole && !orgId) hitting `/home` â†’ redirect `/backoffice/users`
- Auth pages: if session â†’ redirect using same rules as login

- [ ] **Step 1: Add `JWT_ACCESS_SECRET` to portal `.env.example`** (same value as API) for optional verify; or decode-only for routing (document trust boundary: httpOnly cookie set only by BFF).

Preferred: decode payload without verify for routing UX; API still verifies on every call. Cookie theft risk unchanged.

```ts
export function readAccessClaims(token: string): {
  orgId: string | null;
  platformRole: string | null;
} | null
```

- [ ] **Step 2: Update login/register forms + BFF responses**

- [ ] **Step 3: Update proxy.ts** with area checks after token present/refresh

- [ ] **Step 4: Manual E2E**
  1. Login SUPERADMIN â†’ `/backoffice/users`, backoffice nav from API
  2. Login merchant â†’ `/home`, dashboard nav from API
  3. Merchant cannot open `/backoffice/users` (redirect)
  4. Staff-only cannot open `/home` (redirect to backoffice)

- [ ] **Step 5: Commit (portal)**

```bash
git commit -m "feat: role-based login redirect and proxy area guards"
```

---


