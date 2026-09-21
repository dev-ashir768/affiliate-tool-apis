import type { Prisma, ShopRegion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";

function toProfile(row: {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  region: ShopRegion | null;
  followerCount: number | null;
  categories: string[];
  bio: string | null;
  source: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.displayName,
    region: row.region,
    followerCount: row.followerCount,
    categories: row.categories,
    bio: row.bio,
    source: row.source,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function searchDiscovery(params: {
  page: number;
  pageSize: number;
  search?: string;
  region?: "US" | "UK";
  minFollowers?: number;
  enabledOnly?: boolean;
}) {
  const where: Prisma.CreatorDiscoveryProfileWhereInput = {};
  if (params.enabledOnly !== false) where.enabled = true;
  if (params.region) where.region = params.region;
  if (params.minFollowers != null) {
    where.followerCount = { gte: params.minFollowers };
  }
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { handle: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.creatorDiscoveryProfile.count({ where }),
    prisma.creatorDiscoveryProfile.findMany({
      where,
      orderBy: [{ followerCount: "desc" }, { updatedAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map(toProfile),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function createDiscoveryProfile(
  input: {
    handle: string;
    displayName?: string | null;
    region?: "US" | "UK" | null;
    followerCount?: number | null;
    categories?: string[];
    bio?: string | null;
    source?: string;
    enabled?: boolean;
  },
  actorUserId?: string
) {
  const handle = input.handle.replace(/^@/, "").trim();
  try {
    const row = await prisma.creatorDiscoveryProfile.create({
      data: {
        handle,
        displayName: input.displayName ?? null,
        region: input.region ?? null,
        followerCount: input.followerCount ?? null,
        categories: input.categories ?? [],
        bio: input.bio ?? null,
        source: input.source ?? "manual",
        enabled: input.enabled ?? true,
      },
    });
    if (actorUserId) {
      await writeAuditLog({
        actorUserId,
        action: "discovery.profile.create",
        entityType: "CreatorDiscoveryProfile",
        entityId: row.id,
        meta: { handle },
      });
    }
    return toProfile(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Discovery handle already exists", 409);
    }
    throw err;
  }
}

export async function importDiscoveryProfiles(
  profiles: Array<{
    handle: string;
    displayName?: string | null;
    region?: "US" | "UK" | null;
    followerCount?: number | null;
    categories?: string[];
    bio?: string | null;
    source?: string;
    enabled?: boolean;
  }>,
  actorUserId: string
) {
  let created = 0;
  let skipped = 0;
  for (const p of profiles) {
    const handle = p.handle.replace(/^@/, "").trim();
    try {
      await prisma.creatorDiscoveryProfile.upsert({
        where: {
          platform_handle: { platform: "TIKTOK", handle },
        },
        create: {
          handle,
          displayName: p.displayName ?? null,
          region: p.region ?? null,
          followerCount: p.followerCount ?? null,
          categories: p.categories ?? [],
          bio: p.bio ?? null,
          source: p.source ?? "import",
          enabled: p.enabled ?? true,
        },
        update: {
          displayName: p.displayName ?? undefined,
          region: p.region ?? undefined,
          followerCount: p.followerCount ?? undefined,
          categories: p.categories ?? undefined,
          bio: p.bio ?? undefined,
          enabled: p.enabled ?? undefined,
          source: p.source ?? "import",
        },
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }
  await writeAuditLog({
    actorUserId,
    action: "discovery.profile.import",
    entityType: "CreatorDiscoveryProfile",
    meta: { created, skipped, total: profiles.length },
  });
  return { created, skipped, total: profiles.length };
}

export async function saveDiscoveryToCrm(
  organizationId: string,
  profileId: string
) {
  const profile = await prisma.creatorDiscoveryProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile || !profile.enabled) {
    throw new AppError("NOT_FOUND", "Discovery profile not found", 404);
  }

  try {
    const creator = await prisma.creator.create({
      data: {
        organizationId,
        handle: profile.handle,
        displayName: profile.displayName,
        region: profile.region,
        followerCount: profile.followerCount,
        notes: profile.bio,
        stage: "LEAD",
      },
    });
    return {
      id: creator.id,
      handle: creator.handle,
      displayName: creator.displayName,
      stage: creator.stage,
      createdAt: creator.createdAt.toISOString(),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError(
        "CONFLICT",
        "Creator already exists in your CRM",
        409
      );
    }
    throw err;
  }
}
