import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePaidAccess } from "../../middleware/require-paid-access.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import {
  createSampleSchema,
  listSamplesQuerySchema,
  reviewSampleSchema,
  syncSamplesSchema,
} from "./samples.schemas.js";
import {
  createManualSampleRequest,
  listSampleRequests,
  refreshSampleFulfillment,
  reviewSampleRequest,
  syncSampleRequestsFromTikTok,
} from "./samples.service.js";

export const samplesRoutes = Router();

samplesRoutes.use(authenticate, requireOrg, requirePaidAccess);

samplesRoutes.use(authenticate, requireOrg);

samplesRoutes.get(
  "/",
  validateQuery(listSamplesQuerySchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(
        await listSampleRequests(req.auth.orgId, {
          status: (req.query as { status?: string }).status as
            | undefined
            | "PENDING"
            | "APPROVED"
            | "REJECTED"
            | "FULFILLING"
            | "FULFILLED"
            | "FAILED"
            | "CANCELED",
          shopId: (req.query as { shopId?: string }).shopId,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

samplesRoutes.post(
  "/",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  validateBody(createSampleSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res
        .status(201)
        .json(await createManualSampleRequest(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  },
);

samplesRoutes.post(
  "/sync",
  requireRole("OWNER", "ADMIN"),
  validateBody(syncSamplesSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(
        await syncSampleRequestsFromTikTok({
          organizationId: req.auth.orgId,
          shopId: req.body.shopId,
          maxPages: req.body.maxPages,
          actorUserId: req.auth.sub,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

samplesRoutes.post(
  "/:id/review",
  requireRole("OWNER", "ADMIN"),
  validateBody(reviewSampleSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(
        await reviewSampleRequest(req.auth.orgId, String(req.params.id), {
          action: req.body.action,
          note: req.body.note,
          actorUserId: req.auth.sub,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

samplesRoutes.post(
  "/:id/fulfillments/refresh",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(
        await refreshSampleFulfillment(req.auth.orgId, String(req.params.id)),
      );
    } catch (err) {
      next(err);
    }
  },
);
