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
} from "./discovery.schemas.js";
import {
  createDiscoveryProfile,
  importDiscoveryProfiles,
  saveDiscoveryToCrm,
  searchDiscovery,
} from "./discovery.service.js";

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
