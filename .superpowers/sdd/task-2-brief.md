### Task 2: Prisma schema, migrate, seed

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Modify: `package.json` (prisma scripts + seed)
- Create: `src/lib/prisma.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`
- Produces: Prisma models matching spec; `prisma` singleton; seed creates Starter/Growth/Agency + 5 bots

- [ ] **Step 1: Install Prisma**

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

- [ ] **Step 2: Write schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus { ACTIVE DISABLED }
enum MembershipRole { OWNER ADMIN MEMBER }
enum MembershipStatus { INVITED ACTIVE DISABLED }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED INCOMPLETE }
enum BotStatus { AVAILABLE RESERVED ASSIGNED DISABLED }
enum ShopRegion { US UK }
enum ShopStatus { PENDING_INVITE VERIFYING ACTIVE FAILED DISCONNECTED }
enum ShopVerifyMode { STUB PLAYWRIGHT }
enum VerificationJobStatus { QUEUED RUNNING SUCCEEDED FAILED }

model User {
  id           String         @id @default(cuid())
  email        String         @unique
  passwordHash String
  name         String
  status       UserStatus     @default(ACTIVE)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  memberships  Membership[]
  refreshTokens RefreshToken[]
}

model Plan {
  id                String   @id @default(cuid())
  code              String   @unique // starter | growth | agency | free
  name              String
  monthlyPriceCents Int
  seatLimit         Int
  shopLimit         Int
  dailyInviteQuota  Int
  stripePriceId     String?
  organizations     Organization[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model Organization {
  id               String         @id @default(cuid())
  name             String
  slug             String         @unique
  planId           String
  plan             Plan           @relation(fields: [planId], references: [id])
  stripeCustomerId String?
  seatLimit        Int
  shopLimit        Int
  dailyInviteQuota Int
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  memberships      Membership[]
  subscription     Subscription?
  shops            Shop[]
}

model Membership {
  id              String           @id @default(cuid())
  userId          String
  organizationId  String
  role            MembershipRole
  status          MembershipStatus @default(ACTIVE)
  inviteTokenHash String?
  inviteExpiresAt DateTime?
  user            User             @relation(fields: [userId], references: [id])
  organization    Organization     @relation(fields: [organizationId], references: [id])
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@unique([userId, organizationId])
  @@index([inviteTokenHash])
}

model Subscription {
  id                   String             @id @default(cuid())
  organizationId       String             @unique
  organization         Organization       @relation(fields: [organizationId], references: [id])
  stripeSubscriptionId String             @unique
  status               SubscriptionStatus
  currentPeriodEnd     DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}

model RefreshToken {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  tokenHash   String    @unique
  expiresAt   DateTime
  revokedAt   DateTime?
  replacedById String?
  createdAt   DateTime  @default(now())
}

model BotIdentity {
  id              String    @id @default(cuid())
  email           String    @unique
  proxyBinding    String?
  status          BotStatus @default(AVAILABLE)
  reservedForOrgId String?
  reservedAt      DateTime?
  shop            Shop?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model Shop {
  id                     String       @id @default(cuid())
  organizationId         String
  organization           Organization @relation(fields: [organizationId], references: [id])
  region                 ShopRegion
  botIdentityId          String       @unique
  botIdentity            BotIdentity  @relation(fields: [botIdentityId], references: [id])
  externalShopId         String?
  displayName            String?
  status                 ShopStatus   @default(PENDING_INVITE)
  statusReason           String?
  sessionVaultCiphertext String?
  verifiedAt             DateTime?
  verificationJobs       ShopVerificationJob[]
  createdAt              DateTime     @default(now())
  updatedAt              DateTime     @updatedAt

  @@index([organizationId])
}

model ShopVerificationJob {
  id        String                @id @default(cuid())
  shopId    String
  shop      Shop                  @relation(fields: [shopId], references: [id])
  bullJobId String?
  mode      ShopVerifyMode
  status    VerificationJobStatus @default(QUEUED)
  attempts  Int                   @default(0)
  lastError String?
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt
}

model StripeEvent {
  id          String   @id @default(cuid())
  eventId     String   @unique
  type        String
  processedAt DateTime @default(now())
}
```

- [ ] **Step 3: Prisma client + seed**

```ts
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

```ts
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const plans = [
    {
      code: "free",
      name: "Free",
      monthlyPriceCents: 0,
      seatLimit: 1,
      shopLimit: 0,
      dailyInviteQuota: 0,
      stripePriceId: null,
    },
    {
      code: "starter",
      name: "Starter",
      monthlyPriceCents: 4900,
      seatLimit: 1,
      shopLimit: 1,
      dailyInviteQuota: 500,
      stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    },
    {
      code: "growth",
      name: "Growth",
      monthlyPriceCents: 11900,
      seatLimit: 3,
      shopLimit: 3,
      dailyInviteQuota: 1500,
      stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,
    },
    {
      code: "agency",
      name: "Agency",
      monthlyPriceCents: 24900,
      seatLimit: 5,
      shopLimit: 10,
      dailyInviteQuota: 5000,
      stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: plan,
    });
  }

  for (let i = 1; i <= 5; i++) {
    const email = `bot-s${i}@example.com`;
    await prisma.botIdentity.upsert({
      where: { email },
      create: { email, status: "AVAILABLE" },
      update: {},
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

Add to `package.json`:

```json
"prisma": { "seed": "tsx prisma/seed.ts" },
"scripts": {
  "prisma:migrate": "prisma migrate dev",
  "prisma:seed": "prisma db seed",
  "prisma:generate": "prisma generate"
}
```

- [ ] **Step 4: Migrate + seed against local/dev DB**

```bash
npx prisma migrate dev --name foundation_init
npx prisma db seed
```

Expected: migration applied; 4 plans + 5 bots.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/prisma.ts package.json package-lock.json
git commit -m "feat: add Foundation Prisma schema, migrate, and seed"
```

---


