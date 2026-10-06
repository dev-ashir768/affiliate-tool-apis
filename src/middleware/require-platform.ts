import type { RequestHandler } from "express";
import type { PlatformRole } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Platform staff guard. The JWT claim is checked first, then the live
 * membership — so a disabled or demoted staff member loses access immediately
 * instead of when the access token expires.
 */
export function requirePlatform(...roles: PlatformRole[]): RequestHandler {
  return async (req, _res, next) => {
    try {
      const claimed = req.auth?.platformRole;
      if (!req.auth?.sub || !claimed || !roles.includes(claimed)) {
        throw new AppError("FORBIDDEN", "Insufficient platform role", 403);
      }
      const membership = await prisma.platformMembership.findFirst({
        where: { userId: req.auth.sub, status: "ACTIVE" },
        select: { role: true },
      });
      if (!membership || !roles.includes(membership.role)) {
        throw new AppError("FORBIDDEN", "Insufficient platform role", 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
