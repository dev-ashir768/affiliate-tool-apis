import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import { createAutomationRunSchema } from "./automations.schemas.js";
import {
  createAutomationRun,
  getAutomationRun,
  listAutomationRuns,
} from "./automations.service.js";

export const automationsRoutes = Router();

automationsRoutes.use(authenticate, requireOrg);

automationsRoutes.get("/", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listAutomationRuns(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

automationsRoutes.get("/:id", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await getAutomationRun(req.auth.orgId, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

automationsRoutes.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("automation-run"),
    windowSec: 60,
    limit: 10,
  }),
  validateBody(createAutomationRunSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      const result = await createAutomationRun(
        req.auth.orgId,
        req.auth.sub,
        req.body,
      );
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  },
);
