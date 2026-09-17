import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NavArea, PlatformRole, PrismaClient } from "@prisma/client";
import type { AccessClaims } from "../../src/lib/tokens.js";

const prisma = new PrismaClient();

async function ensureBackofficeNavSeeded() {
  const section = await prisma.navSection.upsert({
    where: { area_key: { area: NavArea.BACKOFFICE, key: "main" } },
    create: { area: NavArea.BACKOFFICE, key: "main", sortOrder: 0 },
    update: { sortOrder: 0 },
  });

  const items: Array<{
    key: string;
    label: string;
    href: string;
    icon: string;
    sortOrder: number;
    allowedPlatformRoles: PlatformRole[];
  }> = [
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
      allowedPlatformRoles: [],
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
      key: "finance",
      label: "Finance",
      href: "/backoffice/finance",
      icon: "BadgeDollarSign",
      sortOrder: 3,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.FINANCE],
    },
    {
      key: "proxies",
      label: "Proxies",
      href: "/backoffice/proxies",
      icon: "Globe",
      sortOrder: 4,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
    {
      key: "crawler",
      label: "Crawler",
      href: "/backoffice/crawler",
      icon: "Bot",
      sortOrder: 5,
      allowedPlatformRoles: [PlatformRole.SUPERADMIN, PlatformRole.OPS],
    },
  ];

  for (const item of items) {
    const data = {
      label: item.label,
      href: item.href,
      icon: item.icon,
      sortOrder: item.sortOrder,
      enabled: true,
      allowedPlatformRoles: item.allowedPlatformRoles,
      allowedOrgRoles: [] as const,
    };
    await prisma.navItem.upsert({
      where: { sectionId_key: { sectionId: section.id, key: item.key } },
      create: { sectionId: section.id, key: item.key, ...data },
      update: data,
    });
  }
}

function itemKeys(nav: { sections: Array<{ items: Array<{ id: string }> }> }) {
  return nav.sections.flatMap((s) => s.items.map((i) => i.id));
}

describe("getNavigation", () => {
  let getNavigation: typeof import("../../src/modules/navigation/navigation.service.js").getNavigation;

  beforeAll(async () => {
    await ensureBackofficeNavSeeded();
    ({ getNavigation } = await import(
      "../../src/modules/navigation/navigation.service.js"
    ));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("hides finance nav from OPS", async () => {
    const claims: AccessClaims = {
      sub: "ops-user",
      orgId: null,
      orgRole: null,
      platformRole: "OPS",
    };
    const nav = await getNavigation("backoffice", claims);
    const keys = itemKeys(nav);
    expect(keys).not.toContain("finance");
    expect(keys).toContain("shops");
    expect(keys).toContain("users");
    expect(nav.area).toBe("backoffice");
    expect(nav.brand).toEqual({
      name: "Tiksly Backoffice",
      href: "/backoffice/users",
    });
  });

  it("forbids dashboard nav without org", async () => {
    const claims: AccessClaims = {
      sub: "staff-no-org",
      orgId: null,
      orgRole: null,
      platformRole: "SUPERADMIN",
    };
    await expect(getNavigation("dashboard", claims)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("allows SUPERADMIN all backoffice items", async () => {
    const claims: AccessClaims = {
      sub: "superadmin",
      orgId: null,
      orgRole: null,
      platformRole: "SUPERADMIN",
    };
    const nav = await getNavigation("backoffice", claims);
    const keys = itemKeys(nav);
    expect(keys).toEqual(
      expect.arrayContaining([
        "users",
        "organizations",
        "shops",
        "finance",
        "proxies",
        "crawler",
      ])
    );
    expect(keys).toHaveLength(6);
  });
});
