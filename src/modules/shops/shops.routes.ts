import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { requirePaidAccess } from "../../middleware/require-paid-access.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import { connectShopSchema } from "./shops.schemas.js";
import {
  connectShop,
  disconnectShop,
  getShop,
  listShopProducts,
  listShops,
} from "./shops.service.js";
import { requestVerify } from "./verify.service.js";
import {
  completeTikTokShopOAuth,
  getTikTokOAuthStatus,
  startTikTokShopOAuth,
} from "./tiktok-oauth.service.js";

export const shopsRoutes = Router();

shopsRoutes.use(authenticate, requireOrg);
shopsRoutes.use(requirePaidAccess);

const oauthStartSchema = z.object({
  region: z.enum(["US", "UK"]).default("US"),
  shopId: z.string().min(1).optional().nullable(),
});

const oauthCompleteSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

shopsRoutes.get("/", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const shops = await listShops(req.auth.orgId);
    res.json({ shops });
  } catch (err) {
    next(err);
  }
});

shopsRoutes.get(
  "/tiktok/oauth/status",
  authenticate,
  requireOrg,
  async (_req, res, next) => {
    try {
      res.json(getTikTokOAuthStatus());
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/tiktok/oauth/start",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("tiktok-oauth-start"),
    windowSec: 60,
    limit: 10,
  }),
  validateBody(oauthStartSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId || !req.auth.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const result = await startTikTokShopOAuth({
        organizationId: req.auth.orgId,
        userId: req.auth.sub,
        region: req.body.region,
        shopId: req.body.shopId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/tiktok/oauth/complete",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("tiktok-oauth-complete"),
    windowSec: 60,
    limit: 20,
  }),
  validateBody(oauthCompleteSchema),
  async (req, res, next) => {
    try {
      const shop = await completeTikTokShopOAuth({
        code: req.body.code,
        state: req.body.state,
      });
      if (shop.organizationId !== req.auth?.orgId) {
        throw new AppError("FORBIDDEN", "OAuth shop org mismatch", 403);
      }
      res.json(shop);
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/connect",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(connectShopSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
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
  },
);

shopsRoutes.get("/:id", authenticate, requireOrg, async (req, res, next) => {
  try {
    if (!req.auth?.orgId) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const shop = await getShop(req.auth.orgId, String(req.params.id));
    res.json(shop);
  } catch (err) {
    next(err);
  }
});

shopsRoutes.get(
  "/:id/products",
  authenticate,
  requireOrg,
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const pageSize = req.query.pageSize
        ? Number(req.query.pageSize)
        : undefined;
      const pageToken = req.query.pageToken
        ? String(req.query.pageToken)
        : null;
      const status = req.query.status ? String(req.query.status) : null;
      res.json(
        await listShopProducts(req.auth.orgId, {
          shopId: String(req.params.id),
          pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
          pageToken,
          status,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
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
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const result = await requestVerify(req.auth.orgId, String(req.params.id));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.delete(
  "/:id",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const shop = await disconnectShop(req.auth.orgId, String(req.params.id));
      res.json(shop);
    } catch (err) {
      next(err);
    }
  },
);
