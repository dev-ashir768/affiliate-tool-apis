import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePlatform } from "../../middleware/require-platform.js";
import {
  createStaffSchema,
  listQuerySchema,
  patchStaffSchema,
} from "./platform.schemas.js";
import {
  billingOverview,
  createStaff,
  crawlerStatusScaffold,
  getOrganization,
  listOrganizations,
  listPlatformShops,
  listProxiesScaffold,
  listStaff,
  patchStaff,
} from "./platform.service.js";

export const platformRoutes = Router();

platformRoutes.use(authenticate);

platformRoutes.get(
  "/staff",
  requirePlatform("SUPERADMIN"),
  validateQuery(listQuerySchema),
  async (req, res, next) => {
    try {
      const result = await listStaff(req.query as any);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.post(
  "/staff",
  requirePlatform("SUPERADMIN"),
  validateBody(createStaffSchema),
  async (req, res, next) => {
    try {
      const staff = await createStaff(req.body);
      res.status(201).json(staff);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.patch(
  "/staff/:id",
  requirePlatform("SUPERADMIN"),
  validateBody(patchStaffSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const staff = await patchStaff(String(req.params.id), req.body, req.auth.sub);
      res.json(staff);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/organizations",
  requirePlatform("SUPERADMIN", "FINANCE", "OPS"),
  validateQuery(listQuerySchema),
  async (req, res, next) => {
    try {
      const result = await listOrganizations(req.query as any);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/organizations/:id",
  requirePlatform("SUPERADMIN", "FINANCE", "OPS"),
  async (req, res, next) => {
    try {
      const org = await getOrganization(String(req.params.id));
      res.json(org);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/shops",
  requirePlatform("SUPERADMIN", "OPS"),
  validateQuery(listQuerySchema),
  async (req, res, next) => {
    try {
      const result = await listPlatformShops(req.query as any);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/billing/overview",
  requirePlatform("SUPERADMIN", "FINANCE"),
  async (_req, res, next) => {
    try {
      const overview = await billingOverview();
      res.json(overview);
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/proxies",
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await listProxiesScaffold());
    } catch (err) {
      next(err);
    }
  }
);

platformRoutes.get(
  "/crawler",
  requirePlatform("SUPERADMIN", "OPS"),
  async (_req, res, next) => {
    try {
      res.json(await crawlerStatusScaffold());
    } catch (err) {
      next(err);
    }
  }
);
