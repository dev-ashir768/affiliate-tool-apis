import { MembershipRole, NavArea, PlatformRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type NavItemSeed = {
  key: string;
  label: string;
  href: string;
  icon: string;
  sortOrder: number;
  enabled?: boolean;
  allowedPlatformRoles?: PlatformRole[];
  allowedOrgRoles?: MembershipRole[];
};

async function seedNavSection(
  area: NavArea,
  key: string,
  items: NavItemSeed[],
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
      allowedOrgRoles: item.allowedOrgRoles ?? [],
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
        error,
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
      description: "No product access until you subscribe.",
      monthlyPriceCents: 0,
      seatLimit: 1,
      shopLimit: 0,
      botLimit: 0,
      dailyInviteQuota: 0,
      trialDays: 0,
      sortOrder: 0,
      isPublic: false,
      active: true,
      stripePriceId: null as string | null,
    },
    {
      code: "starter",
      name: "Starter",
      description: "1 TikTok shop and 1 verify bot. Perfect to get live.",
      monthlyPriceCents: 1000,
      seatLimit: 1,
      shopLimit: 1,
      botLimit: 1,
      dailyInviteQuota: 500,
      trialDays: 7,
      sortOrder: 10,
      isPublic: true,
      active: true,
      stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    },
    {
      code: "growth",
      name: "Growth",
      description: "2 shops and 3 bots for small teams scaling outreach.",
      monthlyPriceCents: 3000,
      seatLimit: 3,
      shopLimit: 2,
      botLimit: 3,
      dailyInviteQuota: 2000,
      trialDays: 7,
      sortOrder: 20,
      isPublic: true,
      active: true,
      stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null,
    },
    {
      code: "pro",
      name: "Pro",
      description: "5 shops and 8 bots for agencies running multi-brand ops.",
      monthlyPriceCents: 7900,
      seatLimit: 5,
      shopLimit: 5,
      botLimit: 8,
      dailyInviteQuota: 8000,
      trialDays: 14,
      sortOrder: 30,
      isPublic: true,
      active: true,
      stripePriceId:
        process.env.STRIPE_PRICE_PRO ?? process.env.STRIPE_PRICE_AGENCY ?? null,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents,
        seatLimit: plan.seatLimit,
        shopLimit: plan.shopLimit,
        botLimit: plan.botLimit,
        dailyInviteQuota: plan.dailyInviteQuota,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        isPublic: plan.isPublic,
        active: plan.active,
        // Keep existing Stripe price if env not set (ops may have edited in backoffice).
        ...(plan.stripePriceId ? { stripePriceId: plan.stripePriceId } : {}),
      },
    });
  }

  // Soft-retire legacy agency code if present — map to pro limits for display.
  await prisma.plan
    .updateMany({
      where: { code: "agency" },
      data: { active: false, isPublic: false },
    })
    .catch(() => undefined);

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
      key: "discover",
      label: "Discover",
      href: "/discover",
      icon: "Search",
      sortOrder: 3,
    },
    {
      key: "campaigns",
      label: "Campaigns",
      href: "/campaigns",
      icon: "Megaphone",
      sortOrder: 4,
    },
    {
      key: "outreach",
      label: "Outreach",
      href: "/outreach",
      icon: "Mail",
      sortOrder: 5,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "invites",
      label: "Invites",
      href: "/invites",
      icon: "Send",
      sortOrder: 6,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "samples",
      label: "Samples",
      href: "/samples",
      icon: "Gift",
      sortOrder: 7,
    },
    {
      key: "automations",
      label: "Automations",
      href: "/automations",
      icon: "Bot",
      sortOrder: 8,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "messages",
      label: "Messages",
      href: "/messages",
      icon: "MessageSquare",
      sortOrder: 9,
    },
    {
      key: "products",
      label: "Products",
      href: "/products",
      icon: "Package",
      sortOrder: 10,
    },
    {
      key: "orders",
      label: "Orders",
      href: "/orders",
      icon: "ShoppingCart",
      sortOrder: 11,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "analytics",
      label: "Analytics",
      href: "/analytics",
      icon: "BarChart3",
      sortOrder: 12,
    },
    {
      key: "team",
      label: "Team",
      href: "/team",
      icon: "Users",
      sortOrder: 13,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "billing",
      label: "Billing",
      href: "/billing",
      icon: "CreditCard",
      sortOrder: 14,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    },
    {
      key: "settings",
      label: "Settings",
      href: "/settings",
      icon: "Settings",
      sortOrder: 15,
    },
    {
      key: "activity",
      label: "Activity",
      href: "/activity",
      icon: "ScrollText",
      sortOrder: 16,
      allowedOrgRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
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
      key: "discovery",
      label: "Discovery",
      href: "/backoffice/discovery",
      icon: "Search",
      sortOrder: 4,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "plans",
      label: "Plans",
      href: "/backoffice/plans",
      icon: "BadgeDollarSign",
      sortOrder: 5,
      allowedPlatformRoles: [
        PlatformRole.SUPERADMIN,
        PlatformRole.OPS,
        PlatformRole.FINANCE,
      ],
    },
    {
      key: "finance",
      label: "Finance",
      href: "/backoffice/finance",
      icon: "BadgeDollarSign",
      sortOrder: 6,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.FINANCE],
    },
    {
      key: "audit",
      label: "Audit",
      href: "/backoffice/audit",
      icon: "ScrollText",
      sortOrder: 7,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN],
    },
    {
      key: "proxies",
      label: "Proxies",
      href: "/backoffice/proxies",
      icon: "Globe",
      sortOrder: 7,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "crawler",
      label: "Crawler",
      href: "/backoffice/crawler",
      icon: "Bot",
      sortOrder: 8,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "navigation",
      label: "Navigation",
      href: "/backoffice/navigation",
      icon: "Menu",
      sortOrder: 9,
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
      (superadminEmail ? ` (superadmin: ${superadminEmail})` : ""),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
