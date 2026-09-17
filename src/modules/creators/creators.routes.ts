import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import {
  addListMemberSchema,
  createCampaignSchema,
  createCreatorListSchema,
  createCreatorSchema,
  patchCampaignSchema,
  patchCreatorSchema,
} from "./creators.schemas.js";
import {
  addCreatorToList,
  createCampaign,
  createCreator,
  createCreatorList,
  deleteCreator,
  listCampaigns,
  listCreatorLists,
  listCreators,
  patchCampaign,
  patchCreator,
} from "./creators.service.js";

export const creatorsRoutes = Router();

creatorsRoutes.use(authenticate, requireOrg);

creatorsRoutes.get("/", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listCreators(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

creatorsRoutes.post(
  "/",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  rateLimit({ key: rateLimitKey("creators-write"), windowSec: 60, limit: 60 }),
  validateBody(createCreatorSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(await createCreator(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.get("/lists", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listCreatorLists(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

creatorsRoutes.post(
  "/lists",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  validateBody(createCreatorListSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(await createCreatorList(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.post(
  "/lists/:listId/members",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  validateBody(addListMemberSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(
        await addCreatorToList(
          req.auth.orgId,
          String(req.params.listId),
          req.body.creatorId
        )
      );
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.get("/campaigns", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listCampaigns(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

creatorsRoutes.post(
  "/campaigns",
  requireRole("OWNER", "ADMIN"),
  validateBody(createCampaignSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(await createCampaign(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.patch(
  "/campaigns/:id",
  requireRole("OWNER", "ADMIN"),
  validateBody(patchCampaignSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.json(
        await patchCampaign(req.auth.orgId, String(req.params.id), req.body)
      );
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.patch(
  "/:id",
  requireRole("OWNER", "ADMIN", "MEMBER"),
  validateBody(patchCreatorSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.json(await patchCreator(req.auth.orgId, String(req.params.id), req.body));
    } catch (err) {
      next(err);
    }
  }
);

creatorsRoutes.delete(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.json(await deleteCreator(req.auth.orgId, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  }
);
