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
