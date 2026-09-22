import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { requirePlatform } from "../../middleware/require-platform.js";
import {
  createDiscoveryProfileSchema,
  discoverySearchSchema,
  importDiscoverySchema,
  tiktokDiscoverySyncSchema,
} from "./discovery.schemas.js";
import {
  createDiscoveryProfile,
  importDiscoveryProfiles,
  saveDiscoveryToCrm,
  searchDiscovery,
} from "./discovery.service.js";
import {
  enqueueDiscoveryTikTokSync,
  getDiscoverySyncQueueStatus,
  getDiscoveryTikTokStatus,
  syncDiscoveryFromTikTok,
} from "./tiktok-sync.service.js";

export const discoveryRoutes = Router();

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
  }
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
        String(req.params.id)
      );
      res.status(201).json(creator);
    } catch (err) {
      next(err);
    }
  }
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
        })
      );
    } catch (err) {
      next(err);
    }
  }
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
  }
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
      res.json(
        await importDiscoveryProfiles(req.body.profiles, req.auth.sub)
      );
    } catch (err) {
      next(err);
    }
  }
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
  }
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
      const { sync, ...options } = req.body as {
        sync?: boolean;
        maxPages?: number;
        keyword?: string | null;
        minFollowers?: number | null;
        pageSize?: 12 | 20;
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
  }
);
