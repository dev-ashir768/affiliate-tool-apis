import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import {
  bulkSendOutreachSchema,
  createTemplateSchema,
  patchTemplateSchema,
  sendOutreachSchema,
} from "./outreach.schemas.js";
import {
  bulkSendOutreach,
  createTemplate,
  getOutreachEmailStatus,
  listMessages,
  listTemplates,
  patchTemplate,
  sendOutreach,
} from "./outreach.service.js";

export const outreachRoutes = Router();

outreachRoutes.use(authenticate, requireOrg);

outreachRoutes.get("/email-status", async (_req, res, next) => {
  try {
    res.json(getOutreachEmailStatus());
  } catch (err) {
    next(err);
  }
});

outreachRoutes.get("/templates", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listTemplates(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

outreachRoutes.post(
  "/templates",
  requireRole("OWNER", "ADMIN"),
  validateBody(createTemplateSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(await createTemplate(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  },
);

outreachRoutes.patch(
  "/templates/:id",
  requireRole("OWNER", "ADMIN"),
  validateBody(patchTemplateSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.json(
        await patchTemplate(req.auth.orgId, String(req.params.id), req.body),
      );
    } catch (err) {
      next(err);
    }
  },
);

outreachRoutes.get("/messages", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listMessages(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

outreachRoutes.post(
  "/send",
  requireRole("OWNER", "ADMIN"),
  rateLimit({ key: rateLimitKey("outreach-send"), windowSec: 60, limit: 30 }),
  validateBody(sendOutreachSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
      res.status(201).json(await sendOutreach(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  },
);

outreachRoutes.post(
  "/send-bulk",
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("outreach-bulk"),
    windowSec: 60,
    limit: 10,
  }),
  validateBody(bulkSendOutreachSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId || !req.auth.sub) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      const result = await bulkSendOutreach(
        req.auth.orgId,
        req.auth.sub,
        req.body,
      );
      res.status(result.status === "QUEUED" ? 202 : 200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
