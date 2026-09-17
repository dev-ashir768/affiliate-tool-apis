### Task 4: Navigation API module

**Files:**
- Create: `affiliate-tool-apis/src/modules/navigation/navigation.service.ts`
- Create: `affiliate-tool-apis/src/modules/navigation/navigation.routes.ts`
- Modify: `affiliate-tool-apis/src/app.ts`
- Create: `affiliate-tool-apis/tests/navigation/navigation.test.ts`

**Interfaces:**
- `getNavigation(area: "dashboard"|"backoffice", claims: AccessClaims): Promise<NavResponse>`
- Response shape matches portal `NavResponse` (area, brand, sections[])

**Filter rules:**
1. Caller must be authenticated.
2. `area=backoffice` requires `platformRole != null`; else 403 FORBIDDEN.
3. `area=dashboard` requires `orgId != null` (or any ACTIVE org membership); else 403.
4. Item included if `enabled` and:
   - if `allowedPlatformRoles.length > 0` â†’ claims.platformRole must be in list
   - if `allowedOrgRoles.length > 0` â†’ claims.orgRole must be in list
   - empty arrays â†’ no extra filter beyond area gate

Brand:
- dashboard: `{ name: "Tiksly", href: "/home" }`
- backoffice: `{ name: "Tiksly Backoffice", href: "/backoffice/users" }`

- [ ] **Step 1: Failing tests**

```ts
it("hides finance nav from OPS", async () => { ... });
it("forbids dashboard nav without org", async () => { ... });
it("allows SUPERADMIN all backoffice items", async () => { ... });
```

- [ ] **Step 2: Implement service + `GET /api/v1/navigation/:area`**

Mount with `authenticate` middleware.

- [ ] **Step 3: Pass tests + commit**

```bash
git commit -m "feat: add role-filtered GET /navigation/:area"
```

---


