import type {
  CreatorDiscoveryProfile,
  Prisma,
  ShopRegion,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { searchDiscoveryInMeili } from "../../lib/meilisearch.js";

/** Metrics fields are optional so mapping stays valid if the TS server lags behind `prisma generate`. */
type DiscoveryRow = {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  creatorOpenId: string | null;
  region: ShopRegion | null;
  followerCount: number | null;
  categories: string[];
  bio: string | null;
  source: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  avatarUrl?: string | null;
  gmvAmount?: string | null;
  gmvCurrency?: string | null;
  gmvRange?: string | null;
  gmvCents?: number | null;
  videoGmvAmount?: string | null;
  liveGmvAmount?: string | null;
  productCardGmvAmount?: string | null;
  avgCommissionRange?: string | null;
  unitsSold?: number | null;
  gpmAmount?: string | null;
  gpmCurrency?: string | null;
  gpmRange?: string | null;
  contactEmail?: string | null;
  metricsRaw?: Prisma.JsonValue | null;
  metricsSyncedAt?: Date | null;
};

function toProfile(row: DiscoveryRow) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.displayName,
    creatorOpenId: row.creatorOpenId,
    region: row.region,
    followerCount: row.followerCount,
    avatarUrl: row.avatarUrl ?? null,
    gmvAmount: row.gmvAmount ?? null,
    gmvCurrency: row.gmvCurrency ?? null,
    gmvRange: row.gmvRange ?? null,
    gmvCents: row.gmvCents ?? null,
    videoGmvAmount: row.videoGmvAmount ?? null,
    liveGmvAmount: row.liveGmvAmount ?? null,
    productCardGmvAmount: row.productCardGmvAmount ?? null,
    avgCommissionRange: row.avgCommissionRange ?? null,
    unitsSold: row.unitsSold ?? null,
    gpmAmount: row.gpmAmount ?? null,
    gpmCurrency: row.gpmCurrency ?? null,
    gpmRange: row.gpmRange ?? null,
    contactEmail: row.contactEmail ?? null,
    categories: row.categories,
    bio: row.bio,
    source: row.source,
    enabled: row.enabled,
    metricsSyncedAt: row.metricsSyncedAt?.toISOString() ?? null,
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
  maxFollowers?: number;
  minUnitsSold?: number;
  minGmvCents?: number;
  gmvRangeContains?: string;
  hasEmail?: boolean;
  sortBy?: "followers" | "units" | "updated" | "gmv";
  enabledOnly?: boolean;
}) {
  const meili = await searchDiscoveryInMeili(params);
  if (meili) {
    if (meili.ids.length === 0) {
      return {
        data: [],
        meta: {
          total: meili.total,
          page: params.page,
          pageSize: params.pageSize,
          engine: "meilisearch" as const,
        },
      };
    }
    const rows = (await prisma.creatorDiscoveryProfile.findMany({
      where: { id: { in: meili.ids } },
    })) as CreatorDiscoveryProfile[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = meili.ids
      .map((id) => byId.get(id))
      .filter((r): r is CreatorDiscoveryProfile => Boolean(r));
    return {
      data: ordered.map(toProfile),
      meta: {
        total: meili.total,
        page: params.page,
        pageSize: params.pageSize,
        engine: "meilisearch" as const,
      },
    };
  }

  const where: Prisma.CreatorDiscoveryProfileWhereInput = {};
  if (params.enabledOnly !== false) where.enabled = true;
  if (params.region) where.region = params.region;

  if (params.minFollowers != null || params.maxFollowers != null) {
    where.followerCount = {
      ...(params.minFollowers != null ? { gte: params.minFollowers } : {}),
      ...(params.maxFollowers != null ? { lte: params.maxFollowers } : {}),
    };
  }
  if (params.minUnitsSold != null) {
    where.unitsSold = { gte: params.minUnitsSold };
  }
  if (params.minGmvCents != null) {
    where.gmvCents = { gte: params.minGmvCents };
  }
  if (params.gmvRangeContains?.trim()) {
    where.gmvRange = {
      contains: params.gmvRangeContains.trim(),
      mode: "insensitive",
    };
  }
  if (params.hasEmail === true) {
    where.contactEmail = { not: null };
  } else if (params.hasEmail === false) {
    where.contactEmail = null;
  }

  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { handle: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      {
        gmvRange: { contains: q, mode: "insensitive" },
      } as Prisma.CreatorDiscoveryProfileWhereInput,
    ];
  }

  const orderBy: Prisma.CreatorDiscoveryProfileOrderByWithRelationInput[] =
    params.sortBy === "units"
      ? [{ unitsSold: "desc" }, { updatedAt: "desc" }]
      : params.sortBy === "updated"
        ? [{ updatedAt: "desc" }]
        : params.sortBy === "gmv"
          ? [{ gmvCents: "desc" }, { updatedAt: "desc" }]
          : [{ followerCount: "desc" }, { updatedAt: "desc" }];

  // Await separately — Promise.all can collapse Prisma row types in the IDE.
  const total = await prisma.creatorDiscoveryProfile.count({ where });
  const rows = (await prisma.creatorDiscoveryProfile.findMany({
    where,
    orderBy,
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  })) as CreatorDiscoveryProfile[];

  return {
    data: rows.map(toProfile),
    meta: {
      total,
      page: params.page,
      pageSize: params.pageSize,
      engine: "postgres" as const,
    },
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
  actorUserId?: string,
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
      throw new AppError("CONFLICT", "Discovery profile already exists", 409);
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
  actorUserId?: string,
) {
  let created = 0;
  let skipped = 0;
  for (const p of profiles) {
    const handle = p.handle.replace(/^@/, "").trim();
    if (!handle) {
      skipped += 1;
      continue;
    }
    try {
      await prisma.creatorDiscoveryProfile.upsert({
        where: { platform_handle: { platform: "TIKTOK", handle } },
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
  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "discovery.profile.import",
      entityType: "CreatorDiscoveryProfile",
      meta: { created, skipped, total: profiles.length },
    });
  }
  return { created, skipped, total: profiles.length };
}

function crmSnapshotFromProfile(profile: DiscoveryRow) {
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    creatorOpenId: profile.creatorOpenId,
    region: profile.region,
    followerCount: profile.followerCount,
    avatarUrl: profile.avatarUrl ?? null,
    gmvAmount: profile.gmvAmount ?? null,
    gmvCurrency: profile.gmvCurrency ?? null,
    gmvRange: profile.gmvRange ?? null,
    videoGmvAmount: profile.videoGmvAmount ?? null,
    liveGmvAmount: profile.liveGmvAmount ?? null,
    productCardGmvAmount: profile.productCardGmvAmount ?? null,
    avgCommissionRange: profile.avgCommissionRange ?? null,
    unitsSold: profile.unitsSold ?? null,
    gpmAmount: profile.gpmAmount ?? null,
    gpmCurrency: profile.gpmCurrency ?? null,
    gpmRange: profile.gpmRange ?? null,
    contactEmail: profile.contactEmail ?? null,
    metricsRaw:
      profile.metricsRaw == null
        ? undefined
        : (profile.metricsRaw as Prisma.InputJsonValue),
    metricsSyncedAt: profile.metricsSyncedAt ?? new Date(),
    notes: profile.bio,
  };
}

export async function saveDiscoveryToCrm(
  organizationId: string,
  profileId: string,
) {
  const profile = (await prisma.creatorDiscoveryProfile.findUnique({
    where: { id: profileId },
  })) as CreatorDiscoveryProfile | null;
  if (!profile || !profile.enabled) {
    throw new AppError("NOT_FOUND", "Discovery profile not found", 404);
  }

  const snapshot = crmSnapshotFromProfile(profile);

  try {
    const creator = await prisma.creator.create({
      data: {
        organizationId,
        ...snapshot,
        stage: "LEAD",
      },
    });
    return {
      id: creator.id,
      handle: creator.handle,
      displayName: creator.displayName,
      creatorOpenId: creator.creatorOpenId,
      followerCount: creator.followerCount,
      // Prefer snapshot: Prisma create payload typing can lag after schema adds.
      gmvAmount: snapshot.gmvAmount,
      gmvRange: snapshot.gmvRange,
      metricsSyncedAt: snapshot.metricsSyncedAt?.toISOString() ?? null,
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
      const existing = await prisma.creator.findFirst({
        where: {
          organizationId,
          platform: "TIKTOK",
          handle: profile.handle,
        },
      });
      if (existing) {
        const updated = await prisma.creator.update({
          where: { id: existing.id },
          data: {
            displayName: snapshot.displayName ?? undefined,
            creatorOpenId: snapshot.creatorOpenId ?? undefined,
            followerCount: snapshot.followerCount ?? undefined,
            avatarUrl: snapshot.avatarUrl ?? undefined,
            gmvAmount: snapshot.gmvAmount ?? undefined,
            gmvCurrency: snapshot.gmvCurrency ?? undefined,
            gmvRange: snapshot.gmvRange ?? undefined,
            videoGmvAmount: snapshot.videoGmvAmount ?? undefined,
            liveGmvAmount: snapshot.liveGmvAmount ?? undefined,
            productCardGmvAmount: snapshot.productCardGmvAmount ?? undefined,
            avgCommissionRange: snapshot.avgCommissionRange ?? undefined,
            unitsSold: snapshot.unitsSold ?? undefined,
            gpmAmount: snapshot.gpmAmount ?? undefined,
            gpmCurrency: snapshot.gpmCurrency ?? undefined,
            gpmRange: snapshot.gpmRange ?? undefined,
            metricsRaw: snapshot.metricsRaw,
            metricsSyncedAt: snapshot.metricsSyncedAt,
            region: snapshot.region ?? undefined,
            ...(snapshot.contactEmail && !existing.contactEmail
              ? { contactEmail: snapshot.contactEmail }
              : {}),
          },
        });
        return {
          id: updated.id,
          handle: updated.handle,
          displayName: updated.displayName,
          creatorOpenId: updated.creatorOpenId,
          followerCount: updated.followerCount,
          gmvAmount: snapshot.gmvAmount,
          gmvRange: snapshot.gmvRange,
          metricsSyncedAt: snapshot.metricsSyncedAt?.toISOString() ?? null,
          stage: updated.stage,
          createdAt: updated.createdAt.toISOString(),
          refreshed: true as const,
        };
      }
      throw new AppError("CONFLICT", "Creator already exists in your CRM", 409);
    }
    throw err;
  }
}
