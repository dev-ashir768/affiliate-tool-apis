import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePaidAccess } from "../../middleware/require-paid-access.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { requirePlatform } from "../../middleware/require-platform.js";
import {
  createDiscoveryProfileSchema,
  createCrawlTermSchema,
  crawlTermListSchema,
  discoveryCrawlPlanSchema,
  discoveryMetricsRefreshSchema,
  discoverySearchSchema,
  importDiscoverySchema,
  patchCrawlTermSchema,
  refreshCreatorMetricsSchema,
  tiktokDiscoverySyncSchema,
} from "./discovery.schemas.js";
import {
  createDiscoveryProfile,
  importDiscoveryProfiles,
  saveDiscoveryToCrm,
  searchDiscovery,
} from "./discovery.service.js";
import {
  enqueueCreatorMetricsRefresh,
  enqueueDiscoveryTikTokSync,
  getDiscoverySyncQueueStatus,
  getDiscoveryTikTokStatus,
  getOrgDiscoveryTikTokStatus,
  refreshOrgCreatorMetrics,
  syncDiscoveryFromTikTok,
} from "./tiktok-sync.service.js";
import {
  enqueueDiscoveryCrawlPlan,
  enqueueDiscoveryMetricsRefresh,
  getDiscoveryCrawlStatus,
  planDiscoveryCrawl,
  refreshDiscoveryProfileMetrics,
} from "./discovery-crawl.service.js";
import {
  createCrawlTerm,
  deleteCrawlTerm,
  ensureCrawlTermsSeeded,
  listCrawlTerms,
  patchCrawlTerm,
} from "./discovery-crawl-terms.service.js";
import {
  getDiscoveryCrawlSchedulerStatus,
  registerDiscoveryCrawlSchedulers,
} from "./discovery-crawl-scheduler.service.js";
import { reindexDiscoveryToMeili } from "../../lib/meilisearch.js";

export const discoveryRoutes = Router();

discoveryRoutes.use(authenticate, requireOrg, requirePaidAccess);

discoveryRoutes.get(
  "/creators",
  authenticate,
  requireOrg,
  validateQuery(discoverySearchSchema),
  async (req, res, next) => {
    try {
      res.json(await searchDiscovery(req.query as any));
    } catch (err) {
      next(err);
    }
  },
);

discoveryRoutes.post(
  "/creators/:id/save",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN", "MEMBER"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      const creator = await saveDiscoveryToCrm(
        req.auth.orgId,
        String(req.params.id),
      );
      res.status(201).json(creator);
    } catch (err) {
      next(err);
    }
  },
);

discoveryRoutes.get(
  "/tiktok/status",
  authenticate,
  requireOrg,
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(await getOrgDiscoveryTikTokStatus(req.auth.orgId));
    } catch (err) {
      next(err);
    }
  },
);

discoveryRoutes.post(
  "/tiktok/sync",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(tiktokDiscoverySyncSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId || !req.auth.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const { sync, shopId, ...rest } = req.body as {
        sync?: boolean;
        shopId?: string | null;
        maxPages?: number;
        keyword?: string | null;
        minFollowers?: number | null;
        pageSize?: 12 | 20;
        categoryIds?: string[] | null;
        propagateCrm?: boolean;
      };
      if (!shopId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "shopId is required — authorize a TikTok shop first",
          400,
        );
      }
      const options = {
        ...rest,
        shopId,
        organizationId: req.auth.orgId,
      };
      if (sync) {
        res.json(await syncDiscoveryFromTikTok(req.auth.sub, options));
        return;
      }
      res
        .status(202)
        .json(await enqueueDiscoveryTikTokSync(req.auth.sub, options));
    } catch (err) {
      next(err);
    }
  },
);

discoveryRoutes.post(
  "/tiktok/refresh-crm-metrics",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(refreshCreatorMetricsSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId || !req.auth.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const { shopId, limit, sync } = req.body as {
        shopId: string;
        limit?: number;
        sync?: boolean;
      };
      if (sync) {
        res.json(
          await refreshOrgCreatorMetrics({
            organizationId: req.auth.orgId,
            shopId,
            actorUserId: req.auth.sub,
            limit,
          }),
        );
        return;
      }
      res.status(202).json(
        await enqueueCreatorMetricsRefresh({
          triggeredBy: req.auth.sub,
          organizationId: req.auth.orgId,
          shopId,
          limit,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

/** Platform staff manage the shared discovery index. */
export const platformDiscoveryRoutes = Router();

platformDiscoveryRoutes.get(
  "/",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateQuery(discoverySearchSchema),
  async (req, res, next) => {
    try {
      res.json(
        await searchDiscovery({
          ...(req.query as any),
          enabledOnly: false,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(createDiscoveryProfileSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res
        .status(201)
        .json(await createDiscoveryProfile(req.body, req.auth.sub));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/import",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(importDiscoverySchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(await importDiscoveryProfiles(req.body.profiles, req.auth.sub));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.get(
  "/tiktok/status",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      const config = getDiscoveryTikTokStatus();
      const queue = await getDiscoverySyncQueueStatus().catch(() => null);
      res.json({ config, queue });
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/tiktok/sync",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(tiktokDiscoverySyncSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const { sync, shopId, organizationId, ...rest } = req.body as {
        sync?: boolean;
        shopId?: string | null;
        organizationId?: string | null;
        maxPages?: number;
        keyword?: string | null;
        minFollowers?: number | null;
        pageSize?: 12 | 20;
        categoryIds?: string[] | null;
      };
      if (shopId && !organizationId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "organizationId required with shopId",
          400,
        );
      }
      const options = {
        ...rest,
        shopId,
        organizationId: organizationId ?? null,
      };
      if (sync) {
        res.json(await syncDiscoveryFromTikTok(req.auth.sub, options));
        return;
      }
      res
        .status(202)
        .json(await enqueueDiscoveryTikTokSync(req.auth.sub, options));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.get(
  "/crawl/status",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await getDiscoveryCrawlStatus());
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/crawl/plan",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(discoveryCrawlPlanSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const { sync, ...plan } = req.body as {
        sync?: boolean;
        shopId: string;
        organizationId: string;
        region?: "US" | "UK";
        skipDays?: number;
        maxPages?: number;
        pageSize?: 12 | 20;
        maxCells?: number;
        followerBands?: number[];
        keywords?: string[];
      };
      if (sync) {
        res.json(await planDiscoveryCrawl(req.auth.sub, plan));
        return;
      }
      res.status(202).json(await enqueueDiscoveryCrawlPlan(req.auth.sub, plan));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/crawl/metrics-refresh",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(discoveryMetricsRefreshSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const { sync, ...rest } = req.body as {
        sync?: boolean;
        shopId: string;
        organizationId: string;
        limit?: number;
        olderThanHours?: number;
      };
      if (sync) {
        res.json(
          await refreshDiscoveryProfileMetrics({
            ...rest,
            actorUserId: req.auth.sub,
          }),
        );
        return;
      }
      res.status(202).json(
        await enqueueDiscoveryMetricsRefresh({
          triggeredBy: req.auth.sub,
          ...rest,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.get(
  "/crawl/terms",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateQuery(crawlTermListSchema),
  async (req, res, next) => {
    try {
      res.json(await listCrawlTerms(req.query as any));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/crawl/terms",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(createCrawlTermSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.status(201).json(await createCrawlTerm(req.body, req.auth.sub));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/crawl/terms/seed",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (req, res, next) => {
    try {
      res.json(await ensureCrawlTermsSeeded());
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.patch(
  "/crawl/terms/:id",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(patchCrawlTermSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(
        await patchCrawlTerm(String(req.params.id), req.body, req.auth.sub),
      );
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.delete(
  "/crawl/terms/:id",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(await deleteCrawlTerm(String(req.params.id), req.auth.sub));
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.get(
  "/crawl/scheduler",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await getDiscoveryCrawlSchedulerStatus());
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/crawl/scheduler/register",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await registerDiscoveryCrawlSchedulers());
    } catch (err) {
      next(err);
    }
  },
);

platformDiscoveryRoutes.post(
  "/search/reindex",
  authenticate,
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await reindexDiscoveryToMeili());
    } catch (err) {
      next(err);
    }
  },
);
