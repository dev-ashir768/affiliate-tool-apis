import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import { connectShopSchema } from "./shops.schemas.js";
import {
  connectShop,
  disconnectShop,
  getShop,
  listShops,
} from "./shops.service.js";
import { requestVerify } from "./verify.service.js";

export const shopsRoutes = Router();

shopsRoutes.get("/", authenticate, requireOrg, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const shops = await listShops(req.auth.orgId);
    res.json({ shops });
  } catch (err) {
    next(err);
  }
});

shopsRoutes.post(
  "/connect",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(connectShopSchema),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const shop = await connectShop({
        organizationId: req.auth.orgId,
        region: req.body.region,
      });
      res.status(201).json(shop);
    } catch (err) {
      next(err);
    }
  }
);

shopsRoutes.get("/:id", authenticate, requireOrg, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const shop = await getShop(req.auth.orgId, String(req.params.id));
    res.json(shop);
  } catch (err) {
    next(err);
  }
});

shopsRoutes.post(
  "/:id/verify",
  rateLimit({
    key: rateLimitKey("shop-verify"),
    limit: 10,
    windowSec: 60,
  }),
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const result = await requestVerify(req.auth.orgId, String(req.params.id));
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

shopsRoutes.delete(
  "/:id",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const shop = await disconnectShop(req.auth.orgId, String(req.params.id));
      res.json(shop);
    } catch (err) {
      next(err);
    }
  }
);
