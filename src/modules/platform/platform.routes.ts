import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePlatform } from "../../middleware/require-platform.js";
import {
  createBotsSchema,
  createPlatformCreatorSchema,
  listBotsQuerySchema,
  patchBotSchema,
  createStaffSchema,
  grantAccessSchema,
  impersonateUserSchema,
  listQuerySchema,
  patchPlatformCreatorSchema,
  patchStaffSchema,
  revokeAccessSchema,
} from "./platform.schemas.js";
import { impersonateOrganizationMember } from "./platform-impersonate.service.js";
import {
  billingOverview,
  createStaff,
  getOrganization,
  listOrganizations,
  listPlatformShops,
  listStaff,
  patchStaff,
  listAuditLogs,
} from "./platform.service.js";
import {
  grantOrganizationAccess,
  revokeOrganizationAccess,
} from "./platform-grant.service.js";
import {
  createPlatformCreator,
  listPlatformCreators,
  patchPlatformCreator,
} from "./platform-creators.service.js";
import {
  createPlatformBots,
  deletePlatformBot,
  listPlatformBots,
  setPlatformBotEnabled,
} from "./platform-bots.service.js";
import {
  createNavItemSchema,
  navAreaQuerySchema,
  patchNavItemSchema,
} from "./navigation-admin.schemas.js";
import {
  createNavItem,
  listNavigationAdmin,
  patchNavItem,
} from "./navigation-admin.service.js";
import {
  listPlansForPlatform,
  patchPlan,
} from "../billing/billing.service.js";

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
  },
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
  },
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
      const staff = await patchStaff(
        String(req.params.id),
        req.body,
        req.auth.sub,
      );
      res.json(staff);
    } catch (err) {
      next(err);
    }
  },
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
  },
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
  },
);

platformRoutes.post(
  "/organizations/:id/grant-access",
  requirePlatform("SUPERADMIN"),
  validateBody(grantAccessSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(
        await grantOrganizationAccess(
          String(req.params.id),
          req.body,
          req.auth.sub,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

function mayReturnRefreshInBody(req: Request): boolean {
  if (!env.PORTAL_BFF_SECRET) return true;
  const header = req.headers["x-portal-bff-secret"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value === env.PORTAL_BFF_SECRET;
}

platformRoutes.post(
  "/users/:userId/impersonate",
  requirePlatform("SUPERADMIN"),
  validateBody(impersonateUserSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const result = await impersonateOrganizationMember({
        actorUserId: req.auth.sub,
        targetUserId: String(req.params.userId),
        organizationId: req.body.organizationId,
      });
      if (!mayReturnRefreshInBody(req)) {
        throw new AppError(
          "FORBIDDEN",
          "Impersonation tokens are only issued to the portal BFF",
          403,
        );
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.post(
  "/organizations/:id/revoke-access",
  requirePlatform("SUPERADMIN"),
  validateBody(revokeAccessSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(
        await revokeOrganizationAccess(
          String(req.params.id),
          req.body,
          req.auth.sub,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
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
  },
);

platformRoutes.get(
  "/bots",
  requirePlatform("SUPERADMIN", "OPS"),
  validateQuery(listBotsQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listPlatformBots(req.query as any));
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.post(
  "/bots",
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(createBotsSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res
        .status(201)
        .json(await createPlatformBots(req.body.emails, req.auth.sub));
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.patch(
  "/bots/:id",
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(patchBotSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(
        await setPlatformBotEnabled(
          String(req.params.id),
          req.body.enabled,
          req.auth.sub,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.delete(
  "/bots/:id",
  requirePlatform("SUPERADMIN", "OPS"),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      await deletePlatformBot(String(req.params.id), req.auth.sub);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
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
  },
);

platformRoutes.get(
  "/creators",
  requirePlatform("SUPERADMIN", "OPS"),
  validateQuery(listQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listPlatformCreators(req.query as any));
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.post(
  "/creators",
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(createPlatformCreatorSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const creator = await createPlatformCreator(req.body, req.auth.sub);
      res.status(201).json(creator);
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.patch(
  "/creators/:id",
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(patchPlatformCreatorSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const creator = await patchPlatformCreator(
        String(req.params.id),
        req.body,
        req.auth.sub,
      );
      res.json(creator);
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.get(
  "/audit",
  requirePlatform("SUPERADMIN"),
  validateQuery(listQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listAuditLogs(req.query as any));
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.get(
  "/navigation",
  requirePlatform("SUPERADMIN"),
  validateQuery(navAreaQuerySchema),
  async (req, res, next) => {
    try {
      res.json(await listNavigationAdmin((req.query as any).area));
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.post(
  "/navigation/items",
  requirePlatform("SUPERADMIN"),
  validateBody(createNavItemSchema),
  async (req, res, next) => {
    try {
      const item = await createNavItem(req.body);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.patch(
  "/navigation/items/:id",
  requirePlatform("SUPERADMIN"),
  validateBody(patchNavItemSchema),
  async (req, res, next) => {
    try {
      const item = await patchNavItem(String(req.params.id), req.body);
      res.json(item);
    } catch (err) {
      next(err);
    }
  },
);

platformRoutes.get(
  "/plans",
  requirePlatform("SUPERADMIN", "OPS", "FINANCE"),
  async (_req, res, next) => {
    try {
      res.json({ plans: await listPlansForPlatform() });
    } catch (err) {
      next(err);
    }
  },
);

const patchPlatformPlanSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  monthlyPriceCents: z.number().int().nonnegative().optional(),
  seatLimit: z.number().int().nonnegative().optional(),
  shopLimit: z.number().int().nonnegative().optional(),
  botLimit: z.number().int().nonnegative().optional(),
  dailyInviteQuota: z.number().int().nonnegative().optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  stripePriceId: z.string().trim().min(1).max(120).optional().nullable(),
  isPublic: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

platformRoutes.patch(
  "/plans/:id",
  requirePlatform("SUPERADMIN", "OPS"),
  validateBody(patchPlatformPlanSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      res.json(
        await patchPlan(String(req.params.id), req.body, req.auth.sub),
      );
    } catch (err) {
      next(err);
    }
  },
);
