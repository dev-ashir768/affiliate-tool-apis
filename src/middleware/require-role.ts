import type { RequestHandler } from "express";
import type { MembershipRole } from "@prisma/client";
import { AppError } from "../lib/errors.js";

export function requireRole(...roles: MembershipRole[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const role = req.membership?.role ?? req.auth?.role;
      if (!role || !roles.includes(role)) {
        throw new AppError("FORBIDDEN", "Insufficient role", 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
