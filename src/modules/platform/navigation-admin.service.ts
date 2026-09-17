import type { MembershipRole, NavArea, PlatformRole } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

export type AdminNavArea = "dashboard" | "backoffice";

function toPrismaArea(area: AdminNavArea): NavArea {
  return area === "dashboard" ? "DASHBOARD" : "BACKOFFICE";
}

export async function listNavigationAdmin(area: AdminNavArea) {
  const sections = await prisma.navSection.findMany({
    where: { area: toPrismaArea(area) },
    orderBy: { sortOrder: "asc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  return {
    area,
    sections: sections.map((s) => ({
      id: s.id,
      key: s.key,
      label: s.label,
      sortOrder: s.sortOrder,
      items: s.items.map((item) => ({
        id: item.id,
        key: item.key,
        label: item.label,
        href: item.href,
        icon: item.icon,
        sortOrder: item.sortOrder,
        badge: item.badge,
        enabled: item.enabled,
        allowedPlatformRoles: item.allowedPlatformRoles,
        allowedOrgRoles: item.allowedOrgRoles,
      })),
    })),
  };
}

export async function createNavItem(input: {
  sectionId: string;
  key: string;
  label: string;
  href: string;
  icon: string;
  sortOrder: number;
  badge?: string | null;
  enabled?: boolean;
  allowedPlatformRoles?: PlatformRole[];
  allowedOrgRoles?: MembershipRole[];
}) {
  const section = await prisma.navSection.findUnique({
    where: { id: input.sectionId },
  });
  if (!section) {
    throw new AppError("NOT_FOUND", "Nav section not found", 404);
  }

  try {
    const item = await prisma.navItem.create({
      data: {
        sectionId: input.sectionId,
        key: input.key,
        label: input.label,
        href: input.href,
        icon: input.icon,
        sortOrder: input.sortOrder,
        badge: input.badge ?? null,
        enabled: input.enabled ?? true,
        allowedPlatformRoles: input.allowedPlatformRoles ?? [],
        allowedOrgRoles: input.allowedOrgRoles ?? [],
      },
    });
    return {
      id: item.id,
      key: item.key,
      label: item.label,
      href: item.href,
      icon: item.icon,
      sortOrder: item.sortOrder,
      badge: item.badge,
      enabled: item.enabled,
      allowedPlatformRoles: item.allowedPlatformRoles,
      allowedOrgRoles: item.allowedOrgRoles,
      sectionId: item.sectionId,
    };
  } catch {
    throw new AppError(
      "CONFLICT",
      "Nav item key already exists in this section",
      409
    );
  }
}

export async function patchNavItem(
  id: string,
  input: {
    label?: string;
    href?: string;
    icon?: string;
    sortOrder?: number;
    badge?: string | null;
    enabled?: boolean;
    allowedPlatformRoles?: PlatformRole[];
    allowedOrgRoles?: MembershipRole[];
  }
) {
  const existing = await prisma.navItem.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Nav item not found", 404);
  }

  const item = await prisma.navItem.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.href !== undefined ? { href: input.href } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.badge !== undefined ? { badge: input.badge } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.allowedPlatformRoles !== undefined
        ? { allowedPlatformRoles: input.allowedPlatformRoles }
        : {}),
      ...(input.allowedOrgRoles !== undefined
        ? { allowedOrgRoles: input.allowedOrgRoles }
        : {}),
    },
  });

  return {
    id: item.id,
    key: item.key,
    label: item.label,
    href: item.href,
    icon: item.icon,
    sortOrder: item.sortOrder,
    badge: item.badge,
    enabled: item.enabled,
    allowedPlatformRoles: item.allowedPlatformRoles,
    allowedOrgRoles: item.allowedOrgRoles,
    sectionId: item.sectionId,
  };
}
