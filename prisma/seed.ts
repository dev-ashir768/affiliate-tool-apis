import { NavArea, PlatformRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type NavItemSeed = {
  key: string;
  label: string;
  href: string;
  icon: string;
  sortOrder: number;
  enabled?: boolean;
  allowedPlatformRoles?: PlatformRole[];
};

async function seedNavSection(
  area: NavArea,
  key: string,
  items: NavItemSeed[]
) {
  const section = await prisma.navSection.upsert({
    where: { area_key: { area, key } },
    create: { area, key, sortOrder: 0 },
    update: { sortOrder: 0 },
  });

  for (const item of items) {
    const data = {
      label: item.label,
      href: item.href,
      icon: item.icon,
      sortOrder: item.sortOrder,
      enabled: item.enabled ?? true,
      allowedPlatformRoles: item.allowedPlatformRoles ?? [],
      allowedOrgRoles: [] as const,
    };

    await prisma.navItem.upsert({
      where: { sectionId_key: { sectionId: section.id, key: item.key } },
      create: { sectionId: section.id, key: item.key, ...data },
      update: data,
    });
  }
}

async function seedSuperadmin() {
  const email = process.env.PLATFORM_SUPERADMIN_EMAIL;
  const password = process.env.PLATFORM_SUPERADMIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  let passwordHash = process.env.PLATFORM_SUPERADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    try {
      const { hashPassword } = await import("../src/lib/password.js");
      passwordHash = await hashPassword(password);
    } catch (error) {
      console.warn(
        "Skipping superadmin seed: argon2 unavailable. Set PLATFORM_SUPERADMIN_PASSWORD_HASH or unblock native argon2.",
        error
      );
      return null;
    }
  }
  // Bootstrap only: never overwrite password/name on an existing user.
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      name: "Platform Superadmin",
    },
    update: {},
  });

  await prisma.platformMembership.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: PlatformRole.SUPERADMIN,
      status: "ACTIVE",
    },
    update: {
      role: PlatformRole.SUPERADMIN,
      status: "ACTIVE",
    },
  });

  return user.email;
}

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

  await seedNavSection(NavArea.DASHBOARD, "main", [
    { key: "home", label: "Home", href: "/home", icon: "Home", sortOrder: 0 },
    {
      key: "shops",
      label: "Shops",
      href: "/shops",
      icon: "Store",
      sortOrder: 1,
    },
    {
      key: "creators",
      label: "Creators",
      href: "/creators",
      icon: "Sparkles",
      sortOrder: 2,
    },
    {
      key: "campaigns",
      label: "Campaigns",
      href: "/campaigns",
      icon: "Megaphone",
      sortOrder: 3,
    },
    {
      key: "outreach",
      label: "Outreach",
      href: "/outreach",
      icon: "Mail",
      sortOrder: 4,
    },
    { key: "team", label: "Team", href: "/team", icon: "Users", sortOrder: 5 },
    {
      key: "billing",
      label: "Billing",
      href: "/billing",
      icon: "CreditCard",
      sortOrder: 6,
    },
    {
      key: "settings",
      label: "Settings",
      href: "/settings",
      icon: "Settings",
      sortOrder: 7,
    },
  ]);

  await seedNavSection(NavArea.BACKOFFICE, "main", [
    {
      key: "users",
      label: "Users",
      href: "/backoffice/users",
      icon: "Users",
      sortOrder: 0,
      allowedPlatformRoles: [
        PlatformRole.SUPERADMIN,
        PlatformRole.FINANCE,
        PlatformRole.OPS,
      ],
    },
    {
      key: "organizations",
      label: "Organizations",
      href: "/backoffice/organizations",
      icon: "Building2",
      sortOrder: 1,
    },
    {
      key: "shops",
      label: "Shops",
      href: "/backoffice/shops",
      icon: "Store",
      sortOrder: 2,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "creators",
      label: "Creators",
      href: "/backoffice/creators",
      icon: "Sparkles",
      sortOrder: 3,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "finance",
      label: "Finance",
      href: "/backoffice/finance",
      icon: "BadgeDollarSign",
      sortOrder: 4,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.FINANCE],
    },
    {
      key: "audit",
      label: "Audit",
      href: "/backoffice/audit",
      icon: "ScrollText",
      sortOrder: 5,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN],
    },
    {
      key: "proxies",
      label: "Proxies",
      href: "/backoffice/proxies",
      icon: "Globe",
      sortOrder: 6,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "crawler",
      label: "Crawler",
      href: "/backoffice/crawler",
      icon: "Bot",
      sortOrder: 7,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "navigation",
      label: "Navigation",
      href: "/backoffice/navigation",
      icon: "Menu",
      sortOrder: 8,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN],
    },
  ]);

  const superadminEmail = await seedSuperadmin();

  const [sectionCount, itemCount, membershipCount] = await Promise.all([
    prisma.navSection.count(),
    prisma.navItem.count(),
    prisma.platformMembership.count(),
  ]);

  console.log(
    `Seed complete: ${sectionCount} nav sections, ${itemCount} nav items, ${membershipCount} platform memberships` +
      (superadminEmail ? ` (superadmin: ${superadminEmail})` : "")
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
