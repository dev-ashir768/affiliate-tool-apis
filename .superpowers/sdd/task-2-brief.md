### Task 2: Seed SUPERADMIN + navigation menus

**Files:**
- Modify: `affiliate-tool-apis/prisma/seed.ts`
- Test: run seed + query counts

**Interfaces:**
- Consumes: PlatformMembership, NavSection, NavItem
- Produces: seeded dashboard + backoffice menus (Slice 1 IA); one SUPERADMIN if env set

- [ ] **Step 1: Extend seed with nav upserts**

Dashboard section `main` items (enabled):
- home `/home` Home
- shops `/shops` Store (new IA â€” page can stay stub)
- team `/team` Users
- billing `/billing` CreditCard (or Wallet)
- settings `/settings` Settings  
Products/Orders/Analytics: `enabled: false` OR omit (prefer omit for clean nav)

Backoffice section `main`:
- users `/backoffice/users` Users â€” `allowedPlatformRoles: [SUPERADMIN, FINANCE, OPS]`
- organizations `/backoffice/organizations` Building2 â€” all platform roles
- shops `/backoffice/shops` Store â€” SUPERADMIN, OPS
- finance `/backoffice/finance` BadgeDollarSign â€” SUPERADMIN, FINANCE
- proxies `/backoffice/proxies` Globe â€” SUPERADMIN, OPS
- crawler `/backoffice/crawler` Bot â€” SUPERADMIN, OPS

Empty `allowedPlatformRoles` / `allowedOrgRoles` arrays mean â€œany authenticated caller allowed for that areaâ€ after area gate (dashboard requires org membership; backoffice requires platform membership) â€” **filter rule locked in Task 4**.

- [ ] **Step 2: Seed SUPERADMIN user**

If `PLATFORM_SUPERADMIN_EMAIL` + `PASSWORD` set:
- upsert User
- upsert PlatformMembership SUPERADMIN ACTIVE
- Do **not** create org for staff-only unless they also register as merchant

- [ ] **Step 3: Run seed**

```bash
npm run prisma:seed
```

Expected: nav sections/items present; superadmin exists when env set.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: seed platform SUPERADMIN and DB navigation menus"
```

---


