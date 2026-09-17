import { NavArea, type MembershipRole, type PlatformRole } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { AccessClaims } from "../../lib/tokens.js";

export type NavAreaParam = "dashboard" | "backoffice";

export type NavBrand = {
  name: string;
  href: string;
};

export type NavItemResponse = {
  id: string;
  label: string;
  href: string;
  icon: string;
  badge?: string;
  children?: NavItemResponse[];
};

export type NavSectionResponse = {
  id: string;
  label: string | null;
  items: NavItemResponse[];
};

export type NavResponse = {
  area: NavAreaParam;
  brand: NavBrand;
  sections: NavSectionResponse[];
};

const BRAND_BY_AREA: Record<NavAreaParam, NavBrand> = {
  dashboard: { name: "Tiksly", href: "/home" },
  backoffice: { name: "Tiksly Backoffice", href: "/backoffice/users" },
};

function toPrismaArea(area: NavAreaParam): NavArea {
  return area === "dashboard" ? NavArea.DASHBOARD : NavArea.BACKOFFICE;
}

function itemAllowed(
  item: {
    enabled: boolean;
    allowedPlatformRoles: PlatformRole[];
    allowedOrgRoles: MembershipRole[];
  },
  claims: AccessClaims
): boolean {
  if (!item.enabled) return false;

  if (item.allowedPlatformRoles.length > 0) {
    if (
      !claims.platformRole ||
      !item.allowedPlatformRoles.includes(claims.platformRole)
    ) {
      return false;
    }
  }

  if (item.allowedOrgRoles.length > 0) {
    if (!claims.orgRole || !item.allowedOrgRoles.includes(claims.orgRole)) {
      return false;
    }
  }

  return true;
}

export async function getNavigation(
  area: NavAreaParam,
  claims: AccessClaims
): Promise<NavResponse> {
  if (area === "backoffice") {
    if (!claims.platformRole) {
      throw new AppError(
        "FORBIDDEN",
        "Platform membership required for backoffice navigation",
        403
      );
    }
  } else if (area === "dashboard") {
    if (!claims.orgId) {
      throw new AppError(
        "FORBIDDEN",
        "Organization membership required for dashboard navigation",
        403
      );
    }
  } else {
    throw new AppError("VALIDATION_ERROR", "Invalid navigation area", 400);
  }

  const sections = await prisma.navSection.findMany({
    where: { area: toPrismaArea(area) },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const filtered: NavSectionResponse[] = sections
    .map((section) => ({
      id: section.key,
      label: section.label,
      items: section.items.filter((item) => itemAllowed(item, claims)).map(
        (item) => ({
          id: item.key,
          label: item.label,
          href: item.href,
          icon: item.icon,
          ...(item.badge ? { badge: item.badge } : {}),
        })
      ),
    }))
    .filter((section) => section.items.length > 0);

  return {
    area,
    brand: BRAND_BY_AREA[area],
    sections: filtered,
  };
}
