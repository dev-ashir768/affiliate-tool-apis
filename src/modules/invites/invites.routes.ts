import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import { createAffiliateInviteSchema } from "./invites.schemas.js";
import {
  createAffiliateInvite,
  getAffiliateInvite,
  listAffiliateInvites,
  listShopProductsForInvite,
} from "./invites.service.js";

export const invitesRoutes = Router();

invitesRoutes.use(authenticate, requireOrg);

invitesRoutes.get("/products", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    const shopId = String(req.query.shopId ?? "");
    if (!shopId) {
      throw new AppError("VALIDATION_ERROR", "shopId is required", 400);
    }
    const pageSize = req.query.pageSize
      ? Number(req.query.pageSize)
      : undefined;
    const pageToken = req.query.pageToken
      ? String(req.query.pageToken)
      : null;
    res.json(
      await listShopProductsForInvite(req.auth.orgId, {
        shopId,
        pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
        pageToken,
      }),
    );
  } catch (err) {
    next(err);
  }
});

invitesRoutes.get("/", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listAffiliateInvites(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

invitesRoutes.get("/:id", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await getAffiliateInvite(req.auth.orgId, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

invitesRoutes.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("affiliate-invite"),
    windowSec: 60,
    limit: 10,
  }),
  validateBody(createAffiliateInviteSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      const result = await createAffiliateInvite(
        req.auth.orgId,
        req.auth.sub,
        req.body,
      );
      res.status(result.status === "QUEUED" ? 202 : 201).json(result);
    } catch (err) {
      next(err);
    }
  },
);
