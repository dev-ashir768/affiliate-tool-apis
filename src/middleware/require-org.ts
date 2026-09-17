import type { RequestHandler } from "express";
import type { Membership } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

declare global {
  namespace Express {
    interface Request {
      membership?: Membership;
    }
  }
}

export const requireOrg: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    if (!req.auth.orgId) {
      throw new AppError("FORBIDDEN", "Organization context required", 403);
    }
    const membership = await prisma.membership.findFirst({
      where: {
        userId: req.auth.sub,
        organizationId: req.auth.orgId,
        status: "ACTIVE",
      },
    });
    if (!membership) {
      throw new AppError("FORBIDDEN", "No active membership for organization", 403);
    }
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
};
