import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { requirePaidAccess } from "../../middleware/require-paid-access.js";
import { rateLimit, rateLimitTenantKey } from "../../middleware/rate-limit.js";
import { connectShopSchema } from "./shops.schemas.js";
import {
  connectShop,
  disconnectShop,
  getShop,
  getShopBotInbox,
  listShopProducts,
  listShops,
} from "./shops.service.js";
import { requestVerify } from "./verify.service.js";
import {
  cancelBotActivation,
  completeBotActivation,
  getActivationFrame,
  sendActivationInput,
  startBotActivation,
} from "./bot-activation.service.js";
import {
  completeTikTokShopOAuth,
  getTikTokOAuthStatus,
  startTikTokShopOAuth,
} from "./tiktok-oauth.service.js";

export const shopsRoutes = Router();

// Applies to every route below — do not repeat per route.
shopsRoutes.use(authenticate, requireOrg, requirePaidAccess);

const oauthStartSchema = z.object({
  region: z.enum(["US", "UK"]).default("US"),
  shopId: z.string().min(1).optional().nullable(),
});

const activationInputSchema = z.object({
  events: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("mouse"),
          action: z.enum(["down", "up", "move"]),
          x: z.number().finite(),
          y: z.number().finite(),
          button: z.enum(["left", "right"]).optional(),
        }),
        z.object({
          type: z.literal("wheel"),
          x: z.number().finite(),
          y: z.number().finite(),
          deltaX: z.number().finite().max(5000).min(-5000),
          deltaY: z.number().finite().max(5000).min(-5000),
        }),
        z.object({ type: z.literal("text"), text: z.string().min(1).max(500) }),
        z.object({ type: z.literal("key"), key: z.string().min(1).max(20) }),
      ]),
    )
    .min(1)
    .max(200),
});

const activationCompleteSchema = z.object({ force: z.boolean().optional() });

function orgOf(req: { auth?: { orgId?: string | null } }): string {
  if (!req.auth?.orgId) {
    throw new AppError("UNAUTHORIZED", "Missing access token", 401);
  }
  return req.auth.orgId;
}

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
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitTenantKey("tiktok-oauth-start"),
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
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitTenantKey("tiktok-oauth-complete"),
    windowSec: 60,
    limit: 20,
  }),
  validateBody(oauthCompleteSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId || !req.auth.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const shop = await completeTikTokShopOAuth({
        code: req.body.code,
        state: req.body.state,
        organizationId: req.auth.orgId,
        userId: req.auth.sub,
      });
      res.json(shop);
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/connect",
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

shopsRoutes.get("/:id", async (req, res, next) => {
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
    key: rateLimitTenantKey("shop-verify"),
    limit: 10,
    windowSec: 60,
  }),
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

shopsRoutes.post(
  "/:id/bot-activation",
  rateLimit({ key: rateLimitTenantKey("bot-activation-start"), limit: 5, windowSec: 60 }),
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      res.status(201).json(await startBotActivation(orgOf(req), String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.get(
  "/:id/bot-activation/frame",
  rateLimit({ key: rateLimitTenantKey("bot-activation-frame"), limit: 600, windowSec: 60 }),
  requireRole("OWNER", "ADMIN"),
  (req, res, next) => {
    try {
      const after = Number(req.query.after);
      const frame = getActivationFrame(
        orgOf(req),
        String(req.params.id),
        Number.isFinite(after) ? after : 0,
      );
      res.setHeader("Cache-Control", "no-store");
      if (!frame) {
        res.status(204).end();
        return;
      }
      res.json(frame);
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/:id/bot-activation/input",
  rateLimit({ key: rateLimitTenantKey("bot-activation-input"), limit: 900, windowSec: 60 }),
  requireRole("OWNER", "ADMIN"),
  validateBody(activationInputSchema),
  async (req, res, next) => {
    try {
      await sendActivationInput(orgOf(req), String(req.params.id), req.body.events);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.post(
  "/:id/bot-activation/complete",
  requireRole("OWNER", "ADMIN"),
  validateBody(activationCompleteSchema),
  async (req, res, next) => {
    try {
      res.json(
        await completeBotActivation(orgOf(req), String(req.params.id), {
          force: req.body.force,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.delete(
  "/:id/bot-activation",
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      await cancelBotActivation(orgOf(req), String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.get(
  "/:id/bot-inbox",
  rateLimit({
    key: rateLimitTenantKey("shop-bot-inbox"),
    limit: 20,
    windowSec: 60,
  }),
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(await getShopBotInbox(req.auth.orgId, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  },
);

shopsRoutes.delete(
  "/:id",
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
