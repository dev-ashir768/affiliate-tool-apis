### Task 1: Prisma PlatformMembership + Nav models + migrate

**Files:**
- Modify: `affiliate-tool-apis/prisma/schema.prisma`
- Create: migration via deploy-compatible workflow
- Modify: `affiliate-tool-apis/src/config/env.ts`
- Modify: `affiliate-tool-apis/.env.example`

**Interfaces:**
- Produces: models ready for seed; env keys for bootstrap superadmin

- [ ] **Step 1: Add enums + models to schema**

```prisma
enum PlatformRole {
  SUPERADMIN
  FINANCE
  OPS
}

enum PlatformMembershipStatus {
  ACTIVE
  DISABLED
}

enum NavArea {
  DASHBOARD
  BACKOFFICE
}

model PlatformMembership {
  id        String                    @id @default(cuid())
  userId    String                    @unique
  user      User                      @relation(fields: [userId], references: [id])
  role      PlatformRole
  status    PlatformMembershipStatus  @default(ACTIVE)
  createdAt DateTime                  @default(now())
  updatedAt DateTime                  @updatedAt
}

model NavSection {
  id        String   @id @default(cuid())
  area      NavArea
  key       String
  label     String?
  sortOrder Int      @default(0)
  items     NavItem[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([area, key])
}

model NavItem {
  id                    String     @id @default(cuid())
  sectionId             String
  section               NavSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  key                   String
  label                 String
  href                  String
  icon                  String
  sortOrder             Int        @default(0)
  badge                 String?
  enabled               Boolean    @default(true)
  allowedPlatformRoles  PlatformRole[]
  allowedOrgRoles       MembershipRole[]
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt

  @@unique([sectionId, key])
}
```

Also add on `User`:
```prisma
platformMembership PlatformMembership?
```

- [ ] **Step 2: Add env keys**

```ts
PLATFORM_SUPERADMIN_EMAIL: z.string().email().optional(),
PLATFORM_SUPERADMIN_PASSWORD: z.string().min(8).optional(),
```

Document in `.env.example`.

- [ ] **Step 3: Migrate**

```bash
cd affiliate-tool-apis
# Prefer migrate diff + deploy if shadow DB unavailable (same as Foundation)
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/mig.sql
# Or create folder prisma/migrations/YYYYMMDDHHMMSS_platform_nav/migration.sql manually then:
npm run prisma:migrate
npx prisma generate
```

Expected: migrate succeeds; client generates.

- [ ] **Step 4: Commit (apis)**

```bash
git add prisma src/config/env.ts .env.example
git commit -m "feat: add PlatformMembership and navigation Prisma models"
```

---


