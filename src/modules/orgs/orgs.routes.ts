import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import {
  acceptInviteSchema,
  createInviteSchema,
  patchCurrentOrgSchema,
} from "./orgs.schemas.js";
import {
  acceptInvite,
  createInvite,
  getCurrent,
  listMembers,
  patchCurrent,
} from "./orgs.service.js";

export const orgsRoutes = Router();

orgsRoutes.get(
  "/current",
  authenticate,
  requireOrg,
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const org = await getCurrent(req.auth.orgId);
      res.json(org);
    } catch (err) {
      next(err);
    }
  }
);

orgsRoutes.patch(
  "/current",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(patchCurrentOrgSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const org = await patchCurrent(req.auth.orgId, req.body);
      res.json(org);
    } catch (err) {
      next(err);
    }
  }
);

orgsRoutes.get(
  "/current/members",
  authenticate,
  requireOrg,
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const members = await listMembers(req.auth.orgId);
      res.json({ members });
    } catch (err) {
      next(err);
    }
  }
);

orgsRoutes.post(
  "/current/invites",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(createInviteSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const result = await createInvite({
        organizationId: req.auth.orgId,
        actorUserId: req.auth.sub,
        email: req.body.email,
        role: req.body.role,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

orgsRoutes.post(
  "/invites/:token/accept",
  validateBody(acceptInviteSchema),
  async (req, res, next) => {
    try {
      let actorUserId: string | undefined;
      const header = req.headers.authorization;
      if (header?.startsWith("Bearer ")) {
        const token = header.slice("Bearer ".length).trim();
        if (token) {
          try {
            const claims = await verifyAccessToken(token);
            actorUserId = claims.sub;
          } catch {
            // Optional auth: fall through to password+name path for stubs
          }
        }
      }

      const result = await acceptInvite({
        token: String(req.params.token),
        password: req.body.password,
        name: req.body.name,
        actorUserId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
