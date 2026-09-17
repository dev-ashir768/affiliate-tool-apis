import type { RequestHandler } from "express";
import type { PlatformRole } from "@prisma/client";
import { AppError } from "../lib/errors.js";

export function requirePlatform(...roles: PlatformRole[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const role = req.auth?.platformRole;
      if (!role || !roles.includes(role)) {
        throw new AppError("FORBIDDEN", "Insufficient platform role", 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
