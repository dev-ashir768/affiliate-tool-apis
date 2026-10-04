import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const map: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!,
  growth: process.env.STRIPE_PRICE_GROWTH!,
  pro: process.env.STRIPE_PRICE_PRO!,
};

async function main() {
  const before = await prisma.plan.findMany({
    where: { code: { in: ["starter", "growth", "pro"] } },
    select: {
      code: true,
      name: true,
      monthlyPriceCents: true,
      stripePriceId: true,
      trialDays: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  console.log("BEFORE", JSON.stringify(before, null, 2));

  for (const [code, stripePriceId] of Object.entries(map)) {
    if (!stripePriceId) throw new Error(`Missing env for ${code}`);
    await prisma.plan.update({ where: { code }, data: { stripePriceId } });
  }

  const after = await prisma.plan.findMany({
    where: { code: { in: ["starter", "growth", "pro"] } },
    select: {
      code: true,
      name: true,
      monthlyPriceCents: true,
      stripePriceId: true,
      trialDays: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  console.log("AFTER", JSON.stringify(after, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
